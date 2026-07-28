<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 11 — Workflow Automation Load Testing (Inngest vs. inline)

Date: 2026-07-10

## Why

Helix will offer **user-defined workflow automation** — when a device event
arrives, run a graph of nodes (conditionals, DB queries, LLM calls, notifications)
against it. A prior system's workflow engine builds this on [Inngest](https://www.inngest.com/),
a durable execution engine: one generic function walks a JSON node-graph, each
async node becoming a durable *step* (a checkpoint persisted to Inngest's Postgres,
so a run survives crashes, retries per-step, and is fully observable).

Durability is not free. Before committing to Inngest we wanted a number: **under a
constrained appliance (2 CPU / 4 GB), how many device events per second can we
ingest and run a workflow on — and what does routing through Inngest cost versus
running the same functions inline?** This mirrors the existing ingestion load test
(see `07-Load-Testing.md`), which measured raw ingest throughput; here we add the
workflow-processing stage on top.

This is a **load-test slice, not a full port**: a single hardcoded 6-node graph, not
the user-defined-graph editor/storage. Enough to exercise the real Inngest server
and its state store end to end.

## The workflow under test

A hardcoded graph (`@helix/backend` → `src/workflows/graph.ts`) modelling a
realistic automation, six nodes:

```
trigger ─▶ normalize ─▶ gate ─▶ query-events ─▶ summarize ─▶ notify
└──────── 3 sync ────────┘      └──────────── 3 async ────────────┘
   one durable step             one durable step each
```

- **trigger / normalize / gate** — sync (pure, fast). The gate is the if/else:
  it halts the run when the metric is below a threshold. All three batch into a
  single durable step (the engine's sync-chain optimization).
- **query-events** — async, fake "SELECT last 10 events for this device" (~20 ms).
- **summarize** — async, fake LLM call (**~5 s** blocking wait, modelling a real
  I/O-bound summarization that holds a worker/connection for its duration).
- **notify** — async, fake notification/email (~30 ms), then writes the terminal
  `workflow_run_result` row (the throughput/latency measurement hook).

The async nodes are deliberately fake blocking sleeps so we measure the *plumbing*
(ingest → queue → dispatch → engine → steps), not real infra.

## Pipeline & harness

```
device (MQTT/mTLS) ─▶ ingest ─▶ Kafka/Redpanda ─▶ dispatch ─▶ ┌ inngest.send ─▶ Inngest ─▶ workflow fn (durable steps)
                       (existing ingestion path)               └ runWorkflowDirect (inline, no engine)   ─▶ workflow_run_result
```

Two new **opt-in** helix-server roles (default topology unchanged):

- **`dispatch`** — consumes the device-event Kafka topic and, per `HELIX_WORKFLOW_MODE`:
  - `inngest`: forwards each event to the Inngest server (`inngest.send`, batched).
  - `direct`: runs the same graph *inline* under a bounded worker pool (the no-engine baseline).
- **`workflow`** — hosts the Inngest serve endpoint (`inngest/node`) that the
  self-hosted server syncs to and invokes for each step.

The appliance already self-hosts **Inngest v1.33.0** + Redis + a dedicated `inngest`
Postgres database, so no infra was added. The load test caps the container at
2 CPU / 4 GB (`docker --cpus/--memory`), keeps only
`postgres + redpanda + mosquitto + redis + inngest` running, and drives the existing
MQTT load generator. Backlog is read three ways: `emitted − done`, the dispatch
consumer's Kafka lag, and **Inngest's own in-flight depth** (`function_runs −
function_finishes`). Latency is `completed_at − emittedAtNs` over the completed rows.

Run it (always on an isolated instance so the dev appliance is untouched):

```sh
uv run helix loadtest workflow-ramp --instance 1 --mode inngest \
  --start 10 --stop 35 --step 5 --concurrency 300 --llm-ms 5000 --duration 30 --devices 20
uv run helix loadtest workflow-ramp --instance 1 --mode direct \
  --start 100 --stop 900 --step 100 --concurrency 8000 --llm-ms 5000 --duration 30 --devices 40
```

For the inline path, set `--concurrency` ≥ 5 × the top rate so the worker pool is not
the bottleneck (in-flight ≈ 5 × rate for a 5 s workflow); otherwise the pool caps
throughput at `concurrency / 5` and you measure the cap, not the system.

Two flags isolate where the *app* (not infra) is the bottleneck:

- **`--split "gateway+ingest,writer,dispatch"`** runs the roles as separate
  processes (one HELIX_SERVER_ROLES per comma group), so they use more than one
  Node event loop / core.
- **`--external-postgres`** runs the app database in a separate uncapped Postgres
  container (the appliance's own PG still hosts Inngest's state), so app-DB CPU
  stops competing for the capped cores. The per-service CPU breakdown then shows
  `postgres 0%` inside the appliance.
- **`--external-inngest --inngest-cpus 2`** runs Inngest (the appliance's own
  binary), its Redis, and its Postgres state DB in their own containers, with
  Inngest on its own CPU cap. The app keeps the appliance's cap; Postgres is
  uncapped. The report then shows `appCPU%` and `inngCPU%` side by side so the
  bottleneck (app event loop vs engine) is visible.
- **`--llm-mode blocking|infer`** picks how the summarize node models the LLM
  call: `blocking` runs a fake in-worker sleep inside `step.run`; `infer` uses
  `step.ai.infer` against a fake OpenAI-compatible endpoint (a `node:20-alpine`
  container that sleeps then returns a valid completion), spun up automatically.
  The stack logs which container IP called the fake endpoint, confirming whether
  Inngest offloaded the request.
- **`--mode dbos`** runs the graph in-process via [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts)
  (a durable-execution *library*, not a server): the same executor, but each step
  is `DBOS.runStep` — an in-process call that checkpoints to Postgres, no engine
  round-trip. Implies `--external-postgres` (its system DB lives there) and needs
  no Inngest/Redis.

```sh
# inline path, role-split, external Postgres — find the app-code ceiling
uv run helix loadtest workflow-ramp --instance 1 --mode direct --external-postgres \
  --split "gateway+ingest,writer,dispatch" \
  --start 500 --stop 2500 --step 500 --concurrency 20000 --llm-ms 5000 --duration 30 --devices 60

# DBOS in-process durable engine, fast workflow
uv run helix loadtest workflow-ramp --instance 1 --mode dbos --llm-ms 30 \
  --start 50 --stop 500 --step 50 --concurrency 2000 --duration 30 --devices 40
```

## Results — Inngest path (2 CPU / 4 GB, concurrency 300, 5 s LLM step)

| target/s | wf/s | p50 ms | p95 ms | p99 ms | cpu% (of 200) | mem MiB | in-flight | Inngest DB Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 10 | 5303 | 5445 | 5610 | 73 | 1479 | 56 | +13 MiB |
| 15 | 15 | 5315 | 5456 | 5493 | 114 | 1558 | 80 | +19 MiB |
| 20 | 20 | 5930 | 6816 | 7023 | 139 | 1602 | 122 | +26 MiB |
| 25 | 25 | 10076 | 14430 | 14805 | **195** | 1718 | 274 | +30 MiB |
| 30 | 30 | 13781 | 21658 | 22962 | 192 | 1768 | 412 | +37 MiB |
| 35 | 35 | 19733 | 31237 | 32126 | **204** | 1792 | 604 | +41 MiB |

(`wf/s == target` at every rate because runs that pile up during the window still
finish during the post-load drain; the saturation signal is **latency + in-flight
depth**, not lost work.)

- **Knee ≈ 20–22 events/s.** At 10–20/s, latency is ~5.3–6.8 s (the 5 s work plus a
  small durable-step overhead) and in-flight runs track Little's law (≈ 5 × rate,
  healthy). At **25/s the container hits its CPU cap (195% of 200%)**, p50 latency
  *doubles* to 10 s, and in-flight runs balloon (274 → 412 → 604) — the engine can
  no longer keep up in real time.
- **Inngest itself is the dominant CPU consumer** (per-service split: inngest
  20%→65%, then the SDK/node executing steps, then Postgres). At 35/s Postgres CPU
  spikes to ~45% under the state-write pressure of 600 in-flight runs.
- **Its Postgres grows continuously** — ~41 MiB across ~4,000 runs (~10 KB/run net).
  This is the durable run history/state, and it grows unbounded without the
  retention sweep (`cloud/inngest-cleanup.sql`).

### Is Inngest slow because it's starved? Give it its own cores.

The run above puts Inngest, its Redis, its Postgres, *and* the whole app on the same
two cores. To separate resource contention from Inngest's own limit, we re-ran with
Inngest (the same v1.33.0 binary), its Redis, and its Postgres state store each in
their **own containers** — Inngest capped at its **own 2 cores**, the app capped at
the appliance's 2 cores, Postgres uncapped (`--external-inngest --inngest-cpus 2`).
Now `appCPU%` and `inngCPU%` are the two capped subjects, measured separately:

| target/s | wf/s | backlog | p50 ms | appCPU% | inngCPU% | in-flight |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 20 | 0 | 5913 | 48 | 43 | 128 |
| 40 | 40 | 0 | **21599** | 44 | 82 | 684 |
| 60 | 40 | 703 | 23867 | 61 | 107 | 1288 |
| 100 | 95 | 186 | 65451 | 72 | 130 | 2495 |
| 140 | 94 | 1400 | 70151 | 99 | 130 | 3700 |

Dedicated cores barely helped — the sustainable knee moved only from ~20/s to
**~25–30/s** — and the reason is decisive:

- **The wall is not CPU.** At 40/s, p50 latency is already **21 s** (4× the 5 s of
  real work) while the app is at **44%** and Inngest at **82%** of their 2-core caps.
  Neither is saturated.
- **Inngest cannot use even two cores.** Its CPU plateaus at **~130% (1.3 cores)** and
  never climbs to 200%, no matter how hard we push. The single-node server has an
  internal ceiling below its own CPU budget.

The mechanism: the 5 s summarize is a **blocking** step, so each in-flight run holds
one of Inngest's finite concurrent-invocation slots for the full 5 s. Completion
throughput is therefore ≈ `slots / 5 s ≈ 30–40/s`, set by the engine's single-node
concurrency, not by CPU (the function-level `--concurrency 2000` rules out the
user-facing limit — this is a server-side one). In-flight runs (`function_runs −
function_finishes`) climb without bound (128 → 3700) because Inngest keeps *admitting*
runs it cannot *execute* fast enough.

**So Inngest is slow here because of the durable-execution model on a single node,
not because it was starved** — every step is a queue + persist + HTTP-callback cycle,
and a long *blocking* step pins a scarce execution slot for its whole duration. This
is the crux: our `step.run(() => sleep(5s))` models the LLM call as work executed
*inside* the function, so it holds a slot for the entire 5 s.

### We tried Inngest's recommended AI pattern — on self-hosted it is *slower*

Inngest's guidance is to **not** run an LLM call as ordinary in-function work. Its
recommended primitive, [`step.ai.infer()`](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/step-ai-orchestration),
offloads the provider request to the Inngest server and **parks the run during the
inference** (like `step.sleep`): *"your function is not executing while the request
is in progress."* The intent is that the wait no longer occupies an execution slot.
So we implemented it (`--llm-mode infer`), pointing the summarize node at a fake
OpenAI-compatible endpoint that sleeps 5 s, and re-ran the isolated topology.

**The offload does work on self-hosted.** Every one of the 25,628 fake-LLM requests
came from the *Inngest* container's IP, not the app's — so `inngest start` v1.33.0
genuinely makes the provider call itself and parks the run.

**But throughput got worse, not better** (isolated: Inngest 2 cores, app 2 cores,
Postgres/Redis/LLM separate):

| offered/s | completed/s | backlog | p50 ms | appCPU% | inngCPU% |
| --- | --- | --- | --- | --- | --- |
| 10 | 10 | 0 | 5391 | 44 | 30 |
| 50 | **14** | 1078 | 18162 | 86 | 147 |
| 100 | 38 | 1974 | 38715 | 124 | 144 |
| 200 | 61 | 4304 | 70061 | 88 | 134 |
| 250+ | 0 | runaway | — | ~88 | ~145 |

At 50/s offered, the infer path completes only **~14/s** — vs **~25–30/s** for the
blocking `step.run` on the *same* isolated 2-core Inngest. `step.ai.infer` roughly
**halved** throughput, and Inngest's CPU still plateaus at ~1.3–1.5 cores (never
saturates). (`step.ai.wrap()`, which wraps an SDK call for observability + retries,
runs the call *inside* the function and would behave like our `step.run`.)

**Why:** both patterns hit the same wall — the single-node engine's scheduling /
state throughput (~1.3–1.5 cores, never CPU-bound). `step.ai.infer` *adds* work to
that bottleneck: instead of the always-on app holding the 5 s wait, the **Inngest
server** now holds the outbound provider call plus extra park → gateway → resume
state transitions, and the self-hosted AI gateway's concurrency is evidently lower
than its normal invocation path.

**The lesson:** `step.ai.infer`'s benefit ("your function isn't executing, you don't
pay for compute") is a **serverless** benefit — it frees *your* paid function slots
while Inngest **Cloud's** scaled gateway absorbs the offload. On a **self-hosted
single-node** engine, the engine itself is the bottleneck, so moving the wait into it
makes throughput worse. Either pattern, the real lever is **horizontal Inngest
scaling** (more engine nodes) — not the AI primitive and not more cores (Inngest
already leaves its cores idle).

### What about a *fast* workflow (no LLM)? ~50–70/s

The 5 s LLM was pathological (each run pinned a slot for 5 s). For a normal
automation — a couple of quick DB queries then a notification — every step is fast,
so throughput is bound by the engine's *per-step* scheduling, not slot-holding. We
re-ran with the summarize node dropped to a fast ~30 ms step (`--llm-ms 30`), so the
graph is 3 sync checks + query + query + notify — all fast — isolated with Inngest on
its own 2 cores:

| offered/s | completed/s | p50 ms | inngCPU% | in-flight |
| --- | --- | --- | --- | --- |
| 50 | 50 | 425 | 118 | 31 |
| 100 | 100 | 21003 | 186 | 1743 |
| 150 | 150 | 37981 | 191 | 3638 |
| 300 | 300 | 68665 | 189 | 8212 |

Sustainable knee **~50–70/s**: at 50/s it is healthy (425 ms latency, Inngest 118%),
but by 100/s latency has exploded to **21 s** with in-flight runs piling to 1743.
Crucially, **Inngest's CPU now climbs to ~190%** (nearly its full two cores) rather
than plateauing at ~1.3 as in the blocking-5 s case — so the fast workflow is
genuinely **Inngest-CPU-bound**: the engine is doing real work, ~4 durable steps per
run, each a queue op + Postgres state write + HTTP callback, at roughly **250–280
step-transitions/sec ÷ 4 steps ≈ 60–70 runs/sec**.

So dropping the LLM roughly **doubled** Inngest's throughput (~30 → ~60/s) but left it
~30× below the inline path — durability *itself* is the cost. Throughput scales as
`engine-step-rate ÷ steps-per-run`, so a workflow with fewer durable steps goes
proportionally higher, more steps lower.

**Summary — this workflow on a 2-core self-hosted Inngest:**

| workflow shape | throughput | bound by |
| --- | --- | --- |
| 5 s LLM via `step.ai.infer` | ~14/s | engine scheduling (offload adds work) |
| 5 s LLM via blocking `step.run` | ~25–30/s | invocation slots (`slots / 5 s`) |
| fast: 2–3 DB queries + notify | ~50–70/s | engine CPU (per-step cost × ~4 steps) |
| inline, no engine | ~2000/s | app event loop + DB |

### An in-process durable engine: DBOS (~200–250/s, ~4× Inngest on half the cores)

The whole per-step tax has two parts: (a) an HTTP/RPC round-trip to a separate
engine, and (b) a durable state-write. Inngest pays both. [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts)
pays only (b): it is a **TypeScript library that runs inside the Node process** and
checkpoints each step to Postgres — no separate engine, no round-trip. We wired it as
a third mode (`--mode dbos`, reusing the *same* graph executor via a `DBOS.runStep`
step adapter) and ran the fast workflow, app on its 2 cores, checkpoints to the
external Postgres:

| offered/s | completed/s | p50 ms | appCPU% | dispatch lag |
| --- | --- | --- | --- | --- |
| 50 | 50 | 101 | 74 | 2 |
| 150 | 150 | 101 | 93 | 4 |
| 200 | 200 | 109 | 113 | 3 |
| 250 | 250 | 206 | 135 | 3 |
| 300 | 300 | 2993 | 142 | 5 |
| 350+ | 350+ | 9000+ | ~140 | 3179 → runaway |

DBOS holds **flat ~100 ms latency to ~200/s**, knee **~200–250/s** — bound by the
single Node event loop (all roles + DBOS in one process, ~140%) plus the checkpoint
I/O. Same durability as Inngest (per-step Postgres checkpoint, resume-on-crash), but:

- **~4× Inngest's throughput on *half* the cores** — DBOS uses **2** (app only) vs
  Inngest's **4** (2 app + 2 engine), so roughly an **8× efficiency win per core**.
- **~100 ms latency vs Inngest's seconds** — no HTTP round-trip per step.
- Still ~8× below the no-durability inline path (~2000/s): that gap is the honest cost
  of the per-step Postgres checkpoint (~4 writes/run) — a far better trade than
  Inngest's. Role-splitting DBOS across processes (as we did for the inline path)
  would push it higher still.

**Full ladder (fast 4-step workflow, ~2-core budget):**

| engine | throughput | cores | latency | durability |
| --- | --- | --- | --- | --- |
| inline `direct` | ~2000/s | 2 | fast | none (Kafka at-least-once) |
| **DBOS (in-process)** | **~200–250/s** | 2 | ~100 ms | per-step PG checkpoint |
| Inngest (fast) | ~50–70/s | 4 | high | per-step PG checkpoint |
| Inngest 5 s-LLM `step.run` | ~30/s | 4 | 5 s+ | per-step PG checkpoint |
| Inngest 5 s-LLM `step.ai.infer` | ~14/s | 4 | 5 s+ | per-step PG checkpoint |

**Recommendation:** for the high-throughput hot path, run the graph **in-process**
(the `direct` executor, durability handled at the Kafka layer). Where a workflow
genuinely needs per-step durability, use **DBOS** — same guarantees as Inngest at a
fraction of the cost — rather than an out-of-process engine or a hand-rolled one.

### DBOS role-split 2×2: Postgres location × workflow shape (CPU-saturated)

To find DBOS's real ceiling under the 2-core cap, we role-split it
(`--split "gateway+ingest,writer,dispatch"`, so ingest/writer stop stealing the
dispatch process's event loop) and ran the full matrix — Postgres in-appliance
(shares the cap) vs external (uncapped), and the fast workflow vs the 5 s LLM. Knee =
the highest rate where latency is still ≈ the real work:

| knee (sustainable/s) | external PG | in-appliance PG |
| --- | --- | --- |
| fast (2–3 DB + notify) | **~200–250/s** | ~100–150/s |
| 5 s LLM | **~250–300/s** | ~100–150/s |

- **Postgres location roughly halves/doubles it.** At the in-appliance knee the CPU
  split shows **`postgres 97–99%`** — Postgres eats a whole core for checkpoints +
  the app write, leaving ~1 core for the app. Moving it out drops in-appliance
  `postgres` to 0% and gives both cores to the app. Either way the split
  **saturates the two cores** (appCPU 185–210% at/after the knee) — the point of the
  split.
- **On DBOS the 5 s LLM is ~free.** At 200/s the 5 s-LLM p50 is **5071 ms** — exactly
  the work, no queuing — and its knee (~250–300/s) matches the fast workflow.
  In-process, the 5 s await is a **Node timer**, not a held slot, so it barely dents
  throughput. This is the opposite of Inngest, where 5 s collapsed it to ~14–30/s.
  **DBOS runs a 5 s-LLM durable workflow at ~250–300/s — ~10× Inngest — on half the
  cores.**
- External-PG combos are bound by the **single DBOS dispatch process's event loop**
  (~1.5 cores); in-appliance combos are bound by **Postgres CPU**.

### Does DBOS scale with cores? Multi-dispatch sweep (2 / 4 / 8 cores)

A single Node process is one event loop (~1 core), so to use more cores we run **N
dispatch processes** — each its own DBOS instance — over an N-partition topic
(`--dispatch-processes N`, plus a one-off system-schema migration first, since
concurrent DBOS launches deadlock on the migration). External Postgres, fast
workflow, appliance capped at 2/4/8 cores with N = cores:

| appliance cap | dispatch procs | sustainable knee | appCPU @ knee | pgCPU @ knee | app cores used |
| --- | --- | --- | --- | --- | --- |
| 2 cores | 2 | ~200/s | 156% | 118% | ~1.6 / 2 |
| 4 cores | 4 | ~200/s | 156% | 140% | ~1.6 / **4** |
| 8 cores | 8 | ~200–250/s | 195% | 133% | ~2 / **8** |

**DBOS does not scale with app cores here — the knee is stuck at ~200–250/s at 2, 4,
*and* 8 cores.** The signature is unmistakable: at 4 and 8 cores the run is already
backlogged (6–12 s latency) while **appCPU is only ~1.8–2.7 cores and the rest sit
idle** — not CPU-bound. Meanwhile **pgCPU is ~1.3 cores at the knee and climbs to
~2–3 cores under overload without throughput rising** — the classic **single-Postgres
write/commit ceiling**: WAL fsync is serialized and all N dispatch processes contend
on DBOS's shared system-DB tables (status, step outputs, queue). More processes
hammering one database means more lock/WAL contention, not more throughput.

**So the ~200–250/s DBOS ceiling is the single Postgres's, not the app's.** But is it
Postgres's *disk*, or something deeper? We re-ran the sweep against a **max-speed
Postgres** (`--fast-pg`: data on tmpfs/RAM, `fsync`/`synchronous_commit`/
`full_page_writes` off — unsafe, but no WAL/commit wall):

| appliance cap | dispatch procs | knee | p50 @ 400/s | appCPU @ 400/s | pgCPU |
| --- | --- | --- | --- | --- | --- |
| 2 cores | 2 | ~300/s | 467 ms | 185% (saturated) | 245% |
| 4 cores | 4 | ~250–300/s | 3345 ms | 194% (~2 of 4 cores) | 206% |
| 8 cores | 8 | ~200–250/s | **13182 ms** | 219% (~2.7 of 8 cores) | 195% |

Two conclusions, and they are decisive:

- **Removing Postgres durability raised the ceiling only ~1.5× (200 → ~300/s).** So
  WAL fsync was maybe a third of the wall — real, but not the whole story.
- **DBOS still does not scale with cores, and gets *worse* with more processes.** At
  400/s: 2c → 0.47 s, 4c → 3.3 s, **8c → 13.2 s** — more dispatch processes = *worse*
  latency at the same rate, while the appliance CPU sits at ~2–2.7 cores with 4–8
  free. This **negative scaling** points to **lock contention on DBOS's shared
  system-DB tables** (workflow status, queue, step outputs): every instance
  coordinates through the same rows in the one system database, so adding instances
  means more concurrent transactions contending on the *same* rows — serialized by
  row locks/MVCC, which tmpfs cannot fix (it is transaction serialization, not I/O).

We then chased that hypothesis to the end. Three more experiments, all at the point
that was backlogged (4c/4d @ 400/s, fast PG):

| variant | p50 @ 400/s | what it tests |
| --- | --- | --- |
| shared 'dbos' schema | 3345 ms | baseline |
| one schema per dispatch process | 3562 ms | DBOS *table* row-lock contention |
| one **Postgres process** per dispatch (`--dbos-shards`) | 5081 ms | single-PG WAL/commit ceiling |
| separate PG + `systemDatabasePoolSize=100` | **2131 ms** | DBOS connection-pool concurrency |
| separate PG + pool = 200 | 7362 ms | over-concurrency |

**None of it unlocked core-scaling, and the surprises are the finding:**

- **Sharding the coordination DB — by schema *or* by separate Postgres process —
  does not help** (3.3 s → 3.6 s → 5.1 s). So it was never DBOS's table locks *or*
  the single-PG WAL ceiling. With separate PG shards the app-PG CPU drops to ~18%
  and the shard PGs are near-idle — Postgres is simply *not* the bottleneck.
- **The real lever is DBOS's `systemDatabasePoolSize`** — its default (~20) serializes
  runs even with everything idle. Bumping it to 100 nearly halved latency (5.1 s →
  2.1 s). But it has a **sweet spot**: 200 was *worse* (7.4 s) — too many concurrent
  transactions thrash. Even at the optimum, 400/s is still 2 s latency while the
  appliance uses only **~2 of 4 cores**.

**So the wall is the DBOS *execution model itself*: it is latency-bound, not
throughput-bound.** Every step is a synchronous DB round-trip, so an instance spends
its time *waiting* (~2 cores of real CPU work, the rest idle) and its throughput is
`pool-concurrency ÷ per-run round-trips` — with a concurrency sweet spot. Adding
cores, sharding Postgres, or cranking the pool past the sweet spot does not raise it.

**Verdict on "does a larger setup help?" — no.** For this fine-grained (4-durable-step)
workflow DBOS tops out at a few hundred/s per instance and does not scale with cores
or Postgres. The levers that *do* help are **fewer durable steps per run** (each step
is a round-trip) and **tuning `systemDatabasePoolSize`** to the sweet spot — not
hardware. DBOS's win over Inngest is **latency and efficiency (in-process, no HTTP
round-trip), not unlimited scale**; both are single-node durable engines bound by
per-step DB round-trips. For genuinely high fan-out, only the **in-process `direct`
executor** (~2000/s, no per-step checkpoint at all) scales with the ingestion
pipeline.

## Results — inline baseline (same cap, same graph, no engine)

The slow node here is a **non-blocking timer**, so it burns *no CPU while waiting* —
the inline path's throughput is bound by the *real* per-event work, not by the 5 s.
Concurrency must therefore be set high enough that it is not itself the cap: at rate
R with ~5 s latency, in-flight ≈ 5 × R, so 2000/s needs a worker pool ≥ 10 000. (A
first run with `--concurrency 300` plateaued at exactly 300 / 5.05 s ≈ **59/s** — a
measurement artifact of the cap, *not* a real ceiling. The numbers below use
`--concurrency 4000`–`25000`.)

| target/s | wf/s | p50 ms | cpu% (of 200) | node% | postgres% | backlog |
| --- | --- | --- | --- | --- | --- | --- |
| 200 | 200 | 5056 | 82 | 32 | 12 | 0 |
| 500 | 500 | 5058 | 147 | 68 | 28 | 0 |
| 1000 | 1000 | 5057 | 172 | 70 | 41 | 0 |
| 1500 | 1500 | 5059 | **201** | 82 | 55 | 0 |
| 2000 | 2000 | 5063 | 210 | 83 | 64 | 13 |
| 2500 | 2449 | 5093 | 206 | 84 | 72 | 1542 |
| 3000 | 2623 | 5193 | 206 | 78 | **90** | 11321 |

- **Flat ~5.06 s latency and 0 backlog up to ~2000/s**, where the container **hits
  its 2-core CPU cap**. Beyond that, throughput plateaus at ~2.4–2.6k/s and backlog
  runs away. The inline ceiling under 2 CPU / 4 GB is **~2000 events/s** — the 5 s
  node stays free; what saturates is the *real* work.
- **What binds is node + Postgres together.** The whole pipeline runs in one node
  process/event loop (node ~82%), and Postgres does **two inserts per event** — the
  writer's *batched* `device_event` and the notify node's **unbatched, single-row**
  `workflow_run_result` — so Postgres CPU climbs from 12% to **90%** and overtakes
  node as the rate rises.

### Why ~2000/s and not the ~6–8 k/s of the raw-ingestion load test?

Both run at 2 CPU / 4 GB, but the workflow-direct path does markedly more per event:

1. **One process, one event loop.** The 6–8 k ingestion figure came from
   *role-splitting* across processes to break the single-event-loop wall (see
   `07-Load-Testing.md`). Here `ingest + writer + dispatch + workflow` all share one
   event loop. Splitting `dispatch`/`workflow` into their own processes would raise
   this ceiling the same way it did for ingestion.
2. **Each event is consumed off Kafka twice** — once by the writer, once by the
   dispatch consumer — doubling deserialization.
3. **A second, unbatched Postgres insert.** Ingestion writes one *batched* row/event;
   the workflow adds a per-run single-row insert, which dominates Postgres CPU at
   high rate.

So per-event cost is ~3–4× raw ingestion → ~2 k vs ~6–8 k. Not a regression — the
extra work is the workflow.

### Removing the bottlenecks: role-split + external Postgres

To find what actually caps the inline path, we ran two levers — moving the app DB
into an uncapped Postgres container (`--external-postgres`, so DB CPU stops
competing for the capped cores) and splitting the roles across processes
(`--split "gateway+ingest,writer,dispatch"`, three event loops instead of one):

| config (direct, 2 CPU / 4 GB) | ceiling | what walls it | node % @ wall | Postgres % (in appliance) |
| --- | --- | --- | --- | --- |
| combined, **local** PG | ~2000/s | 1 event loop + PG contention | ~82 | ~64 |
| combined, **external** PG | ~2000/s | **single node event loop (~1 core)** | ~97 | 0 |
| **split (3 proc)**, external PG | **~2500/s** | **2-core CPU cap** (~206%) | ~141 | 0 |

The isolation is the interesting bit: **external Postgres alone did *not* raise the
ceiling** (still ~2000/s). With everything in one process, node plateaus at **~97%
— one core — while total CPU is only ~150%**, so the wall is the **single Node event
loop**, not Postgres and not the CPU cap. Moving the DB out just frees a core the
single event loop cannot use.

**Role-splitting is what breaks the wall**: three processes = three event loops, so
node climbs past one core (~141% ≈ 1.4 cores) and throughput rises to **~2500/s**,
where it finally hits the **2-core cap** (both cores ~100%, 0 backlog, flat ~5.1 s
latency). External Postgres pairs with it by ensuring both freed cores go to *app
code* rather than being shared with the DB (Postgres CPU in the appliance is 0% at
every rate). Split+external-PG at 500→2500/s: node 95 → 141%, Postgres 0%, latency
flat.

**Net:** the inline app-code ceiling under 2 CPU / 4 GB is **~2500 events/s** for this
workflow, bound by the two cores once the single-event-loop wall is removed. Beyond
that needs more cores (splitting scales with them) or less per-event node work — the
biggest lever being to **batch the `workflow_run_result` insert** (today one row per
run) the way the ingestion writer already batches `device_event`.

## The durable-workflow "tax"

Same graph, same 2 CPU / 4 GB, same 5 s work:

| dimension | inline (direct) | Inngest | tax |
| --- | --- | --- | --- |
| Sustainable throughput | **~2000/s** | ~20–22/s | **~90–100×** |
| CPU per (event/s) | ~0.10% | ~7.3–8.9% | **~75×** |
| Added latency @ low load | 0 (pure work) | +~300 ms (4 step round-trips) | — |
| Latency under saturation | flat 5.06 s | 10–31 s | blows up |
| Postgres growth | 0 | ~10 KB/run, unbounded | storage cost |

**Reading it:** routing a workflow through Inngest costs roughly **75× the CPU per
event** and caps sustainable throughput at **~1/90th** of the inline path, while
continuously growing a Postgres state store. That is the price of what Inngest
*buys*: durability (runs survive crashes), automatic per-step retries, step-level
memoization/replay, concurrency control, and a fully queryable run history. The
inline path has none of those — an in-flight run is lost on restart, with no retry
and no observability.

The gap is this wide precisely *because* the slow step is I/O, not CPU: the inline
path parks thousands of near-free pending timers and pays only for the real ingest +
insert work, whereas Inngest pays CPU to persist, schedule, and replay every one of
those waits as a durable step. For a workflow whose cost is genuinely CPU-bound work
(not an I/O wait), the two would converge — the tax is largest exactly for the
LLM-call / webhook / "wait then act" shapes automations are usually made of.

For a **single constrained appliance**, the practical takeaway is that Inngest
saturates ~20 events/s of this 3-async-step, 5 s-LLM workflow at 2 CPU / 4 GB — with
Inngest, its Redis queue, and its Postgres all contending for the same two cores —
while the inline path runs the same 20/s at ~2% CPU and has headroom for 40× more.
Production would scale the engine on its own resources; this number is the
self-contained-appliance floor for the durable path.

## Caveats

- The 5 s LLM node defaults to a blocking in-worker wait (`step.run(() => sleep)`,
  the `step.run` / `step.ai.wrap` shape). We also implemented and measured Inngest's
  recommended `step.ai.infer` (`--llm-mode infer`): on this **self-hosted single-node**
  engine it was *slower*, not faster (see the isolation section) — its slot-freeing
  benefit is serverless-specific. On Inngest Cloud (scaled AI gateway) the result
  could differ; we did not test that.
- Numbers are single-run at 30 s/step; they locate the knee, not a certified SLA.
- Self-hosted Inngest here shares the 2-core cap with Postgres/Redis/the app. That
  contention is the point (constrained appliance), but it is not representative of a
  horizontally-scaled deployment.
- The role-split + external-Postgres levers were applied to the **inline** path (to
  find the app-code ceiling). They were not re-run for the Inngest path: its wall is
  the engine (the `inngest` server + its Postgres state store burning CPU per durable
  step), not the app's event loop, so splitting the *app* roles would not move it —
  scaling Inngest itself (and moving its state store off the cap) is the separate
  lever there.
