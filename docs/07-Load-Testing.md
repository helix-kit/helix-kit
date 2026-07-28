<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Load Testing: Event Ingestion & Gateway Message Routing

Date: 2026-07-04

This report captures the load-testing work for the Helix appliance's two MQTT
broker data planes — **durable event ingestion** and the **WS↔MQTT gateway
command/response routing** — including the harness, methodology, every command
used, all measured results, the bottleneck analysis, and the identified fix.

All measurements were taken against a single appliance container with its CPU and
memory capped to **2 CPU / 4 GB** so the numbers describe a small, known slice of
hardware.

---

## 1. What Is Under Test

The appliance is one Docker container running ~25 systemd services (PID 1 =
systemd). Two independent data planes flow through it:

### 1a. Event ingestion (durable telemetry)

```
device --(mTLS, QoS1)--> mosquitto --> helix-server MQTT→Kafka bridge
       --> redpanda (Kafka) --> DeviceEventWriter (batched consumer)
       --> Postgres  device_event
```

- Device publishes to `helix/device/<id>/service/<svc>/event`.
- The bridge (`attachDeviceEventIngestion`) buffers raw MQTT bytes and
  micro-batches them to Kafka (`DeviceEventQueue.publishBatch`).
- `DeviceEventWriter` consumes in batches, parses, and inserts.
- Dedupe is at the DB: unique `(device_id, message_id)` with
  `onConflictDoNothing` — so the Kafka producer does **not** need idempotency.

### 1b. Gateway message routing (command/response control plane)

```
WS client --> gateway (startMqttGatewayBridge) --(publish /in)--> mosquitto
          --> device (subscribed /in) --(publish /out)--> mosquitto
          --> gateway (subscribed +/out) --(route by requestId)--> WS client
```

- Cloud→device commands: `helix/device/<id>/in`.
- Device→cloud responses/events: `helix/device/<id>/out`.
- `GatewayRouter` routes a response to the owning WS client by `requestId`
  (TTL 120s); a message with no `requestId` is broadcast to all clients on that
  device.
- Wire format: `{ message: { service, method, payload? }, requestId? }` via
  `jsonPacketCodec`.

### The critical shared resource

Both planes — the gateway bridge, the ingestion producer (bridge), and the
ingestion consumer (writer) — run in **one Node.js process on one event loop**
(`web/apps/helix-server/src/index.ts` `start()`). This is the central fact the
whole report returns to.

---

## 2. The Harness

Everything is driven by the Python `helix` CLI (uv project). No bash scripts, no
pnpm test commands.

### Files

| File | Role |
|------|------|
| `tooling/appliance/appliance.py` | Container lifecycle, cap, `isolate_ingestion_subset`, per-service CPU, lag, latency SQL, migrations, seeding |
| `tooling/appliance/server.py` | `HelixServer` HOST vs PREBAKED (in-container) run modes |
| `tooling/appliance/config.py` | Ports and cap config |
| `tooling/loadtest/certs.py` | `provision_pool` — seeds N devices + real step-ca mTLS certs |
| `tooling/loadtest/generator.py` | Ingestion generator (`run_load`) — multiprocess paho mTLS publisher |
| `tooling/loadtest/routing.py` | Routing generator (`run_routing_load`) — device echo + WS clients, RTT-correlated by requestId |
| `tooling/loadtest/commands.py` | The `helix loadtest` CLI group, samplers, report printers |

### CLI commands

```
helix loadtest run          # ingestion at a fixed rate
helix loadtest ramp         # ingestion rate ramp to find the knee
helix loadtest route        # gateway round trips at a fixed rate
helix loadtest route-ramp   # gateway rate ramp to find the knee
helix loadtest mixed        # ingestion + routing concurrently, same device pool
```

Shared options: `--cpus` (default 2.0), `--memory` (default 4g), `--devices`
(pool size), `--workers` (generator processes), `--duration` (seconds/step),
`--payload` (ingestion padding bytes), `--think` (routing: simulated device
processing delay, ms), `--build` (build the image if missing).

### How the harness isolates the subject

`_stack()` in `commands.py`:

1. `appliance.up(fresh=True)` with `--cpus/--memory/--memory-swap` caps and a
   safe launch (`--cgroupns=private`, **no** host `/sys/fs/cgroup` bind — a host
   cgroup bind would let the container's systemd tear down the host login
   session).
2. `wait_ready` → `prepare_host_access` → `run_migrations` (real drizzle
   migrations, not duplicated SQL).
3. `server.start()` in **PREBAKED** mode: `pnpm build` → `docker cp dist` into
   the container → run `node dist/index.js` **inside** the container so it shares
   the container cgroup and the 2 CPU / 4 GB cap with mosquitto/redpanda/postgres.
4. `provision_pool` seeds devices and gets a real step-ca cert per device (the
   generator publishes over genuine mTLS, exactly like production devices).
5. `isolate_ingestion_subset()` stops every other helix unit, leaving only
   postgres + redpanda + mosquitto + the prebaked node server. The cap now covers
   only the subject-under-test.

The generator runs on the **host** (unconstrained), so it never competes with
the subject for the capped CPU.

### How results are measured

- **Ingestion throughput**: `count_events_prefix` delta over the run window;
  `_drain` waits for the consumer to catch up post-run to compute true loss.
- **Ingestion latency** (`ingest_latency_ms`): p50/p95/p99 of
  `received_at − payload.publishedAtNs`, in ms, via Postgres `percentile_cont`.
- **Routing throughput/latency**: client-side round-trip time — send ns →
  matching-`requestId` receive ns — captures the *entire* path
  (WS→gateway→MQTT in→device→MQTT out→gateway→WS). Percentiles computed
  numpy-free in `_percentiles`.
- **Per-service CPU attribution** (`per_service_cpu`): an in-container Python
  script sums each process group's `/proc/<pid>/stat` jiffies over an interval,
  attributing CPU% (100% = one core) across mosquitto / node / postgres /
  redpanda. This is what let us find the real bottleneck.
- **Consumer lag** (`consumer_lag`): `rpk group describe` LAG sum.
- **Container totals** (`container_stats`): `docker stats` CPU% and memory.

---

## 3. Ingestion Results & The Optimization Path

Ingestion was measured and tuned across three stages. All at 2 CPU / 4 GB.

### Stage 0 — per-message Kafka produce (baseline)

Each MQTT message triggered its own Kafka `send`. CPU saturated at only
**~1.2–1.8k events/s**. The per-message produce path was the bottleneck.

### Stage 1 — micro-batch Kafka produce

`DeviceEventQueue.publishBatch(events)` sends an array of messages in one
`producer.send`; the bridge buffers and flushes on size or a short timer. Also
tuned the producer for pipelining (safe because dedupe is at the DB, not the
producer):

```ts
idempotent: false,          // idempotent producer forces maxInFlight = 1
maxInFlightRequests: 5,     // allow pipelining
```

Result: knee moved **2.4k → 5.9k events/s** (~3× improvement).

### Stage 2 — raw passthrough + per-service CPU attribution

Forward the **raw MQTT bytes** as the Kafka value (key = deviceId, header =
receivedAt); defer JSON parsing to the batched writer. This removed parse work
from the ingest hot path. Re-ramped 2k→10k.

**The finding that mattered**: with per-service CPU attribution, the **node
process pinned ~90–100% of ONE core** at the knee, while **mosquitto (mTLS
decrypt) sat at only ~30–40% of a core**. mTLS was *not* the bottleneck. The
raw-passthrough was throughput-neutral because it merely relocated the parse
*within the same single event loop* — the event loop itself is the wall.

**Ingestion knee: ~6k events/s** at 2 CPU / 4 GB, node-event-loop bound.

---

## 4. Routing Results (this session, verbatim)

Device model: each simulated device subscribes to `/in` and echoes an `ack` to
`/out` preserving `requestId`, from a dedicated responder thread (paho loop never
blocks; device processes commands serially). `--think` adds optional processing
delay; the runs below used `--think 0`.

### Smoke (sanity)

```
helix loadtest route --rate 200 --duration 12 --devices 8 --workers 4 --cpus 2 --memory 4g
```

```
target/s   route/s      sent      done      loss     p50ms     p95ms     p99ms      cpu%    memMiB     mosq%     node%       pg%      rpk%
     200       200      2400      2400         0      55.6      94.1     115.1      29.1      1267       3.0      14.0       0.0       0.5
```

200/s in → 200/s completed, **zero loss** over real mTLS with the corrected
`/in`/`/out` ACLs. This also proved the gateway bridge — previously ACL-dead —
is functional.

### Ramp

```
helix loadtest route-ramp --start 500 --stop 4000 --step 500 --duration 25 --devices 20 --workers 8 --cpus 2 --memory 4g
```

```
target/s   route/s      sent      done      loss     p50ms     p95ms     p99ms      cpu%    memMiB     mosq%     node%       pg%      rpk%
     500       500     12504     12504         0      50.5      80.9      99.6      50.1      1197       9.5      31.5       0.0       0.0
    1000      1000     25000     25000         0      42.1      78.8      87.3      47.4      1230      13.0      31.5       0.0       1.0
    1500      1500     37504     37504         0      42.9      79.1      95.8      53.6      1263      16.5      40.0       0.0       0.5
    2000      2000     50000     50000         0      47.8      89.8     106.1      77.8      1304      22.0      52.5       0.0       0.5
    2500      2500     62504     62504         0      49.8      90.5     105.6      82.8      1306      26.0      63.5       0.0       0.5
    3000      2999     75000     74978        22      46.6      90.3     107.0     104.9      1333      33.0      71.0       0.0       0.5
    3500      3478     87504     86954       550      47.3      96.0     131.6     120.1      1368      35.0      78.5       0.0       0.5
    4000      3937    100000     98419      1581      49.1      93.9     122.6     116.7      1378      36.5      77.5       0.0       0.5
```

**Routing knee ≈ 3000 round-trips/s**: clean to 2500, first loss (22) at 3000,
degrading past 3500. Latency stays flat (~47ms p50) all the way to the knee —
degradation shows up as **loss, not lag**. node climbs to ~78% of a core;
mosquitto only ~35%.

Each round trip = 2 QoS-1 MQTT hops (`/in`, `/out`) + 2 WS frames, so ~3k
round-trips ≈ **~6k message-events/s** — the same ceiling ingestion hit.

---

## 5. Combined / Simultaneous Results (this session, verbatim)

Both planes run at once over the **same device pool** — each device both emits
telemetry and answers WS commands, mirroring a real device and maximally
stressing the shared broker identity and node event loop.

### Moderate — both clean

```
helix loadtest mixed --ingest-rate 2000 --route-rate 1000 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g
```

```
    plane   target/s     rate/s       loss      p50ms      p95ms      p99ms    peakLag
   ingest       2000       2000          0        0.6        5.9       13.0         67
  routing       1000       1000          0       34.9       63.2       76.3          -
peak cpu 178.2%  mem 1435MiB  |  mosquitto 30.5% node 98.5% postgres 14.0% redpanda 21.5%
```

Ingestion 2000/s **0 loss** (sub-ms p50) and routing 1000/s **0 loss**
simultaneously — with node already at **98.5% of one core**.

### Over the wall — contention

```
helix loadtest mixed --ingest-rate 3000 --route-rate 1500 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g
```

```
    plane   target/s     rate/s       loss      p50ms      p95ms      p99ms    peakLag
   ingest       3000       2865       4047        6.6      102.7      137.4        112
  routing       1500       1500          0       38.3       88.2      122.7          -
peak cpu 184.5%  mem 1409MiB  |  mosquitto 36.5% node 99.5% postgres 16.0% redpanda 15.5%
```

node at **99.5%**. Under saturation, **ingestion (fire-hose QoS1) sheds load
first** (2865/s, 4k loss, p99 137ms, lag 112) while **routing (self-pacing
request/response) holds** at 1500/s, 0 loss. The synchronous round-trip nature of
routing naturally throttles the offered load; the fire-and-forget ingestion hose
does not, so it overflows first.

---

## 6. Analysis — The Single Wall

- **The bottleneck is the Node.js event loop, on one core.** Gateway bridge,
  ingestion producer, and consumer/writer all share it. Total ceiling is
  **~6k message-events/s across both planes combined**, whether those events are
  ingestion publishes or routing hops.
- **mTLS is not the bottleneck.** mosquitto (TLS decrypt + ACL) never exceeds
  ~36% of a core in any run.
- **Postgres and redpanda are comfortable** (pg ~14–16%, rpk ~15–22%).
- **Latency is stable until saturation.** Both planes hold flat latency and shed
  via loss/lag only once node hits ~100% of its one core.
- **Routing degrades gracefully; ingestion does not.** Request/response
  self-throttles; the telemetry hose overflows. Under mixed overload, routing is
  the survivor.
- **Memory is a non-issue** at this scale (~1.4 GB of the 4 GB cap).

---

## 7. The Fix: Splitting Roles Across Processes (implemented & measured)

Because the wall is one event loop on one core, the lever is to **use the second
core**: run the data-plane workloads as separate OS processes so they are no
longer serialized through a single event loop. They already coordinate only
through mosquitto / redpanda / postgres, so the cut is clean.

### The mechanism

`helix-server` is now decomposed into three composable **roles** (one binary,
selected at boot):

| role | work | talks to |
|------|------|----------|
| `gateway` | public HTTP (PKI/FS), device mTLS file API, WS↔MQTT bridge | mosquitto, postgres |
| `ingest`  | durable MQTT 5 subscribe → micro-batch → Kafka **produce** | mosquitto, redpanda |
| `writer`  | Kafka **consume** → parse → postgres insert | redpanda, postgres |

`HELIX_SERVER_ROLES` (comma-separated subset; unset = all three in one process,
the historical default) selects which roles a process runs. Each role starts
independently and coordinates only through the shared broker/queue/DB, so any
partition across processes is valid. The load harness drives this with
`--roles`, e.g. `--roles "gateway+writer,ingest"` runs two processes (commas =
processes, `+` = roles co-located).

### Which cut matters — the producer, not the writer

The doc originally guessed the writer was the thing to peel off. Measurement says
otherwise. At the mixed over-the-wall point (**ingest 3000 / route 1500**, the
row that shed ~4k in §5), ingest loss by topology:

| topology | ingest/s | ingest loss | node% | total cpu% |
|----------|---------:|------------:|------:|-----------:|
| combined (baseline)          | 2959 | 1229 | 107.5 | 185 |
| `gateway+ingest \| writer`   | 2953 | 1418 | 127.5 | 207 |
| `gateway \| ingest+writer`   | 2976 |  701 | 139.5 | 210 |
| **`gateway+writer \| ingest`** | **2999** | **29** | 136.0 | 203 |
| `gateway \| ingest \| writer` (3-way) | 2987 | 379 | 130.5 | 207 |

**Isolating the ingest _producer_ on its own process** (`gateway+writer, ingest`)
drops ingest loss 1229 → 29 (near-zero). The producer intake path (MQTT receive +
Kafka batch-produce) — not the writer, not gateway contention — was the limiting
stage for the fire-hose. In every split, node CPU exceeds 100% (127–140% of a
core), confirming the second core is now doing real work: **the single-event-loop
wall is broken.**

### How far it goes — the wall moves, it doesn't vanish

**Pure ingestion** (gateway idle, so this is the clean 2-stage producer|writer
split on 2 cores), combined vs producer-isolated, ramped 4k→12k:

| target/s | combined ingest/s (loss) | node% | split ingest/s (loss) | node% | split peakLag |
|---------:|-------------------------:|------:|----------------------:|------:|--------------:|
|  4000 | 3988 (237)   | 101 | 4000 (0)     | 127 |   150 |
|  6000 | 5965 (706)   |  88 | 5953 (933)   | 111 |   773 |
|  8000 | 7241 (15179) |  88 | 7586 (8284)  | 116 |  2664 |
| 10000 | 7327 (53465) |  88 | 8227 (35446) | 108 | 17561 |
| 12000 | 7046 (99058) |  86 | 8297 (67166) | 111 | 29366 |

- **Combined** pegs node at ~88–101% (one core) and tops out ~7.3k ev/s.
- **Producer-split** pushes node to ~108–127% (>1 core) and tops out ~8.3k ev/s —
  clean all the way to 4k where combined already dropped 237.
- But it does **not** double. Past ~8k the **single-partition writer** becomes the
  new ceiling: consumer lag explodes (peakLag 17.5k → 29k) because one Kafka
  partition = one writer consumer, and the DB-insert stage can't be parallelized
  by the process split alone.

Under **mixed** high load the same limit bites from the other side: at
`ingest 5000 / route 2500` the split delivers **4405 ingest/s vs combined's
2724/s**, but the writer (co-located with gateway) then starves routing, so
routing sheds. Three heavy stages (producer, writer, gateway-routing) contend for
two cores — a 2-way split relieves exactly one contention point.

### The remaining lever (identified, not yet done)

To move past ~8k ingest the writer must scale horizontally, which the process
split enables but does not by itself provide:

1. Raise `EVENT_QUEUE_TOPIC_PARTITIONS` (currently 1) to N.
2. Run **N `writer` processes in one consumer group** so partitions drain in
   parallel — this is the doc's original "N workers" option, now the clear next
   bottleneck rather than a speculative idea.
3. With the producer already isolated (§7) and the gateway on its own core, a
   4-role/4-core layout (`gateway | ingest | writer×2`) is the path toward the
   original ~12k target — but that needs >2 CPU to actually help.

**Net:** splitting roles is implemented, breaks the event-loop wall, and buys
~+15% pure-ingestion throughput and a near-elimination of ingest shedding at the
old knee on 2 cores — with the writer's partition parallelism now identified as
the next wall.

### 7a. Tuning the writer within 2 CPU

With the producer isolated, the writer is the ceiling. Two knobs, now tunable via
env and the harness (`--partitions`, `--writer-concurrency`, `--writer-batch`):

**Partition concurrency — helps at overload.** Creating the topic with 4
partitions and setting the writer's `partitionsConsumedConcurrently: 4` lets one
writer overlap its per-partition DB-insert/commit waits. Pure-ingestion at the 8k
step: loss **10571 → 4028**, p95 **71 → 52ms**. The hard ceiling barely moves
(~9k) but overload behaviour is much healthier. `p4/c4` is the tuned load config;
env defaults stay `1/1` so production topics are never silently repartitioned.

**Batch size — no-op.** Raising `EVENT_QUEUE_WRITER_BATCH_SIZE` 500 → 2000 → 4000
did nothing (slightly worse), pg CPU unchanged. The insert path has no
reclaimable slack; 500 stays.

**Why the ceiling is ~9k.** At the knee the container total CPU is pinned at
~200-220% = **both cores full**, split across node (~110%) + mosquitto mTLS
(~45-50%) + postgres (~30-38%) + redpanda (~10%). No longer event-loop- or
I/O-stall-bound — genuinely out of CPU across all services. Going past ~9k needs
cheaper CPU-per-event (mTLS cost, codec, pg tuning), not more parallelism.

### 7b. Runtime experiment: node vs Bun (Bun is slower here)

The bundle is self-contained ESM, so `--runtime bun` copies the host bun binary
into the capped container and runs the same `dist/index.js`. Bun (1.3.x) boots the
**entire** stack — including the `node:https` client-cert mTLS server, kafkajs,
pg, mqtt, ws. But it is **slower for this workload**. Fair *solo* comparison at
2 CPU, producer-isolated `p4/c4`:

| target/s | node ingest/s (loss) | node cpu% | Bun ingest/s (loss) | Bun cpu% |
|---:|---|---:|---|---:|
|  6000 | 5932 (1370)  | 115 | 4678 (26440)  | 139 |
|  8000 | 7680 (6394)  | 123 | 6034 (39323)  | 128 |
| 10000 | 8726 (25474) | 116 | 5595 (88089)  | 133 |
| 12000 | 8602 (65907) | 107 | 5060 (138787) | 129 |

Bun peaks ~6k vs node's ~8.7k (**~30-45% lower**) and burns **more** CPU per event
(higher process CPU% for lower throughput). The tell: on boot kafkajs logs a
`TimeoutNegativeWarning` under Bun — an internal timeout computes negative and is
clamped to 1ms, i.e. kafkajs's request/retry timing misbehaves on Bun (extra
polling for less work). This workload is dominated by node-compat library
internals (kafkajs protocol framing, pg wire protocol, TLS), where Bun's
emulation trails V8+libuv. **Node stays the runtime.**

**Methodology note — parallel is wrong for a runtime A/B.** The harness can run N
isolated capped stacks at once (`--instance N` offsets every port and suffixes the
container/volume). That is right for throughput/soak, but *invalid for comparing
runtimes*: even with each container CPU-capped, the two subjects share host memory
bandwidth and the host-side load generators, and a staggered start hands ramp
steps asymmetric contention (a first parallel run showed Bun *speeding up* at
higher target rates — the artefact of node exiting mid-ramp). The table above is
**sequential, each runtime alone on the box**. Run stacks in parallel only when
they are meant to coexist.

### 7c. Deploying the split (appliance + compose)

The role split is wired into both production paths behind a flag; **both default
to a single all-roles process** so nothing changes unless you opt in. The knob is
the same `HELIX_SERVER_ROLES` mechanism the load harness uses (§7).

**Appliance (systemd).** `helix-server.service` runs `helix-server-launch.sh`,
which runs all roles by default. Set `HELIX_SERVER_ROLES_SPLIT=1` in
`site.env` and the primary unit runs the **gateway** role (keeping its name,
ports 4000/4001 and health endpoint, so `helix`/`caddy` are unaffected) while
`helix-server-ingest.service` and `helix-server-writer.service` — gated by an
`ExecCondition` on the same flag — start the other two roles. All three units are
enabled; the ingest/writer units are simply skipped (not failed) when the flag is
off.

```bash
# on the appliance: enable the split, then restart the server units
echo 'HELIX_SERVER_ROLES_SPLIT=1' >> /var/lib/helix/env/site.env
systemctl daemon-reload
systemctl restart helix-helix-server helix-helix-server-ingest helix-helix-server-writer
```

**Compose.** Default `docker compose up` runs one `helix-server`. Layer the
overlay to split:

```bash
docker compose -f docker-compose.yml -f docker-compose.server-split.yml up -d
```

The overlay sets `helix-server` to the gateway role (unchanged name/ports/health,
so dependents and the Caddy upstream stay valid) and adds `helix-server-ingest`
and `helix-server-writer` sibling services (no published ports, health check
disabled), all inheriting the same env/image via `extends`.

Both paths run the general **3-way** split (one role per process). The tuned
2-way topology from the benchmarks (producer isolated, `gateway+writer | ingest`)
is available by hand-setting `HELIX_SERVER_ROLES` on the units/services — e.g. set
the primary to `gateway,writer` and keep only the ingest sibling. Writer tuning
(`EVENT_QUEUE_WRITER_CONCURRENCY`, `EVENT_QUEUE_TOPIC_PARTITIONS`) is plain env on
whichever process runs the writer.

---

## 8. Reproducing Everything

Prereqs: `uv sync`, Docker, and the appliance image built (`helix appliance
build`). The ACLs must use `/in` and `/out` (baked into the image).

```bash
# Build the appliance image (needed after any cloud/mosquitto ACL change)
uv run helix appliance build

# Ingestion
uv run helix loadtest run  --rate 5000 --duration 60 --devices 20 --workers 8 --cpus 2 --memory 4g
uv run helix loadtest ramp --start 2000 --stop 10000 --step 1000 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g

# Routing
uv run helix loadtest route      --rate 2000 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g
uv run helix loadtest route-ramp --start 500 --stop 4000 --step 500 --duration 25 --devices 20 --workers 8 --cpus 2 --memory 4g
# Add device think-time: --think 20

# Both at once (same device pool)
uv run helix loadtest mixed --ingest-rate 2000 --route-rate 1000 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g

# Split roles across processes to use the second core (see §7). Any command
# accepts --roles; commas separate processes, '+' co-locates roles in one.
# Best mixed topology (isolate the ingest producer):
uv run helix loadtest mixed --ingest-rate 3000 --route-rate 1500 --duration 30 --devices 20 --workers 8 --cpus 2 --memory 4g --roles "gateway+writer,ingest"
# Pure-ingestion producer|writer split:
uv run helix loadtest ramp  --start 4000 --stop 12000 --step 2000 --duration 20 --devices 20 --workers 8 --cpus 2 --memory 4g --roles "gateway+writer,ingest"
# Tuned writer (4 partitions, consume 4 concurrently) — best overload behaviour:
uv run helix loadtest ramp  --start 6000 --stop 12000 --step 2000 --duration 20 --devices 20 --workers 8 --cpus 2 --memory 4g --roles "gateway+writer,ingest" --partitions 4 --writer-concurrency 4

# Alternate runtime (needs host bun: curl -fsSL https://bun.sh/install | bash):
uv run helix loadtest ramp --runtime bun ...same flags...
# Two isolated capped stacks at once (throughput/soak only — NOT a fair runtime A/B):
uv run helix loadtest ramp --instance 0 ... &   # ports 24000/25432/...
uv run helix loadtest ramp --instance 1 ... &   # ports 24100/25532/... , container helix-e2e-1
```

Report columns:

- Ingestion: `target/s ingest/s loss p50ms p95ms p99ms cpu% memMiB peakLag mosq% node% pg% rpk%`
- Routing: `target/s route/s sent done loss p50ms p95ms p99ms cpu% memMiB mosq% node% pg% rpk%`
- Mixed: one row per plane — `plane target/s rate/s loss p50ms p95ms p99ms peakLag` + a peak cpu/mem/breakdown line.

---

## 9. Gotchas & Hard-Won Facts

- **Safe container launch.** Always `--cgroupns=private` and **no** host
  `/sys/fs/cgroup` bind. A host cgroup bind lets the container's PID-1 systemd
  tear down the host's login session on shutdown.
- **Prebaked, not host, for capped runs.** Only the in-container (prebaked) node
  server shares the cgroup cap. A host-side `pnpm dev` server would run
  uncapped and invalidate the measurement.
- **Redpanda advertised address.** Redpanda advertises `127.0.0.1:9092`. A host
  Kafka client over a remapped port needs a systemd drop-in overriding
  `--advertise-kafka-addr`, or metadata redirects it to an unreachable 9092. In
  prebaked mode the only Kafka client is in-container, so this is skipped.
- **Process-group cleanup (host mode).** `pnpm → tsx → node`: SIGTERM to the
  pnpm wrapper alone leaves node holding the ports (`EADDRINUSE`). The server is
  launched with `start_new_session=True` and stopped via
  `os.killpg(pgid, …)`.
- **Readiness probe.** Uses a Python `socket.create_connection` check, not a
  `/dev/tcp` bash-ism (the appliance's `sh` is dash).
- **ACLs.** Command/response is `/in` (cloud→device) and `/out` (device→cloud).
  The old `/service/<svc>/command|response` topics were dead legacy-template
  config used by no code. Changing ACLs (`cloud/mosquitto/*.acl`) requires an
  **image rebuild** — they are baked in at build and merged at boot.
- **Dedupe.** `(device_id, message_id)` unique + `onConflictDoNothing`, which is
  *why* the Kafka producer can safely run non-idempotent with
  `maxInFlightRequests: 5`.
- **The generator runs on the host** (unconstrained) on purpose, split across
  `--workers` processes so it always outpaces the capped subject.
- **Role split (`--roles`).** Prebaked launches one node process per comma group,
  each tagged with `--helix-role-group=<slug>` in its argv so `pgrep` can tell
  siblings apart (slug joins roles with `-`, regex-safe; pattern is anchored with
  `$` so `gateway` doesn't match `gateway-ingest`). Only the `gateway` process
  binds the HTTP/mTLS ports; `ingest`/`writer` bind nothing, so co-locating ports
  across all processes is harmless. Every role must be covered exactly once across
  the groups (the CLI rejects gaps/dupes).
- **Splitting isn't free scaling.** Two cores relieve one contention point, not
  all three stages. On 2 CPU the producer-isolated split buys ~+15% ingestion and
  kills the shedding at the old knee, but the **single-partition writer** then
  caps throughput — scaling past it needs more partitions + a writer consumer
  group, which the split enables but does not itself deliver (§7).
- **Bun runs the bundle but is slower here.** `--runtime bun` copies the host bun
  binary into the container and boots the full stack (mTLS server included), but
  is ~30-45% slower than node at 2 CPU and burns more CPU — kafkajs's timers
  misbehave on Bun (`TimeoutNegativeWarning` on boot). Node stays the runtime
  (§7b).
- **Parallel stacks ≠ fair A/B.** `--instance N` gives fully isolated capped
  stacks (offset ports, suffixed container/volume) for throughput/soak, but two
  subjects still share host memory bandwidth and the generators, so a runtime or
  config comparison must be run **sequentially**, each alone on the box.

---

## 10. Status

- Ingestion: tuned to a ~6k ev/s knee at 2 CPU / 4 GB; node-event-loop bound.
- Routing: harness built and validated; ~3k round-trips/s knee; same wall.
- Mixed: both planes verified working simultaneously with zero loss at moderate
  load; contention characterized past the wall.
- **Role split: implemented and measured (§7).** `helix-server` is now
  role-composable (`HELIX_SERVER_ROLES`), the harness drives any topology
  (`--roles`), and the second core is provably in use (node CPU 88% → 110–140%).
  Isolating the ingest producer nearly eliminates ingest shedding at the old knee
  and lifts pure-ingestion throughput ~7.3k → ~8.7k ev/s. It does **not** double
  on 2 CPU: the single-partition writer is the next ceiling.
- **Writer tuning (§7a):** partition concurrency (`p4/c4`) halves overload loss;
  batch size is a no-op. The ~9k ceiling is now genuinely 2-core CPU-bound across
  node + mosquitto(mTLS) + postgres.
- **Runtime (§7b):** Bun boots the whole stack but is ~30-45% slower than node at
  2 CPU (kafkajs timer compat); node stays the runtime.
- Next: scale the writer horizontally (raise `EVENT_QUEUE_TOPIC_PARTITIONS`, run
  a `writer` consumer group) and re-ramp on >2 CPU to chase the ~12k target; or
  cut CPU-per-event (mTLS/codec/pg) to lift the 2-CPU ceiling itself.
