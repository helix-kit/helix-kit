<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 13 — Appliance EC2 Load Testing (t3.small, 2 vCPU / 2 GB)

Date: 2026-07-12

## 1. Purpose

Establish whether the single-container Helix appliance can run its full production
workload — MQTT + HTTPS(mTLS) event ingestion, DBOS workflows on every event, and
authenticated admin read/write API traffic — on a small cloud box, and find where
it saturates. This is the groundwork for a future custom AMI that drops the
Ubuntu-host + Docker layer the appliance currently sits on.

The earlier attempt ran the appliance container on a full Ubuntu host on a 1 GB
box and failed. Here we characterise a **2 vCPU / 2 GB** box (`t3.small`) under
real load, with genuine TLS, to see how much headroom (if any) exists and what
the bottleneck actually is.

## 2. Test topology

| Role | Instance | Notes |
| --- | --- | --- |
| Appliance-under-test (AUT) | `t3.small` (2 vCPU / 2 GB), ap-south-1 | single appliance container, **no** memory cap (full 2 GB visible) |
| Load generator (GEN) | `m7i-flex.large` (2 vCPU / 8 GB), same AZ | drives the AUT over the private IP; never the bottleneck |

Both were the only free-tier-eligible shapes the account allows. Load hits the
AUT's **private** IP; TLS is real end-to-end (Caddy `tls internal` for the HTTPS
API, step-ca device certs for MQTT/mTLS ingest). The appliance ran
`HELIX_WORKFLOW_MODE=dbos` with `HELIX_SERVER_ROLES=gateway,ingest,writer,dispatch`
so ingested events flow all the way through the DBOS workflow. Workflow tuning:
6-node graph (3 sync + 3 async), `HELIX_WORKFLOW_LLM_MS=200`,
`HELIX_WORKFLOW_CONCURRENCY=100`.

Harness (new, reusable): `tooling/loadtest/remote_harness.py` (mqtt / https / api /
combined drivers), `provision_remote.py` (device-cert pool), `sample_remote.py`
(appliance memory/CPU + backend-counter sampling over SSH). Unlike `helix
loadtest` these target an already-running remote appliance rather than a local
capped container. The **full reproducible setup — provisioning, image ship,
deploy, every fix, test commands, teardown — is the runbook in
`tooling/loadtest/ec2/README.md`** (with `run_remote_test.sh`, `site.env.example`,
`Caddyfile.internal`, `pg-forward.py`).

### Deployment note — DBOS in the self-contained container

DBOS mode had only ever been wired for HOST-mode dev (via `tooling`). To run it
inside the shipped container, `cloud/appliance/bin/helix-server-launch.sh` now
defaults `DBOS_SYSTEM_DATABASE_URL` from `DATABASE_URL` and runs the one-time DBOS
system-schema migration before launch when `HELIX_WORKFLOW_MODE=dbos`. Set the
mode + `dispatch` role in `site.env`. (`dispatch` is opt-in — the default role set
is `gateway,ingest,writer`, so a stock appliance runs **no** workflows.)

Two gotchas for a from-scratch appliance that the tooling normally hides:
app migrations (`pnpm --filter helix db:migrate`) and the `workflow_run_result`
load-test table are applied *externally* (no `helix-cloud-init` bundle is built),
and the in-container Postgres listens on loopback only — external migration needs
a connection that originates from container-localhost.

## 3. Idle baseline

| State | Host mem used | Notes |
| --- | --- | --- |
| Fresh boot, all services up | **1159 MB** / 1905 | matches the observed ~1.1 GB |
| Warmed (after load, caches populated) | ~1410 MB | |

Top RSS: redpanda ~290 MB, Next.js `next-server` ~200 MB, helix-server ~175 MB,
Inngest ~82 MB, openfga ~50 MB, step-ca ~43 MB, Caddy ~45 MB, Postgres workers.
**Inngest + Redis (~33–55 MB reclaimable) are dead weight in DBOS mode.**

## 4. Component results (isolated, with resource sampling)

| Surface | Load | Result | CPU (of 200%) | Mem |
| --- | --- | --- | --- | --- |
| MQTT ingest → writer | 250 & 600 ev/s | **lossless**; all events persisted to `device_event`; writer keeps up | — | — |
| MQTT ingest path | >~700 ev/s | ingest into Kafka tops ~700/s; higher rates lose messages **client-side** (paho queue dropped on disconnect), not in the appliance | — | — |
| HTTPS mTLS ingest (`POST /api/device/events`, :4001) | 250 ev/s (50 req/s) | 0 errors; p50 **69 ms**, p99 **245 ms** | ~188% | ~1.65 GB |
| DBOS workflow (end-to-end) | ramp | **ceiling ≈ 230–250 workflows/s**, CPU-bound; above it Kafka backlog + memory grow | **~190%** | 1.2–1.65 GB |
| Admin API read/write (tRPC over HTTPS) | c20 / c50 | **ceiling ≈ 220 req/s**; c20 p50 88 ms, c50 p50 216 ms (queuing, not more throughput); 0 errors | 160–180% | ~1.6 GB |

The **DBOS workflow stage is the dominant bottleneck** — it is CPU-bound and
pins both cores at ~250/s. Ingestion (broker + Kafka + writer) is comparatively
cheap and lossless; HTTPS/mTLS termination cost is modest. At 250/s sustained,
every event was persisted *and* every workflow completed with zero dispatch lag.

## 5. Combined results (the realistic scenario)

| Test | Load | Outcome |
| --- | --- | --- |
| **Sustainable** | MQTT 120 + HTTPS 100 (=220 ev/s workflows) + API c10, 60 s | **0 errors**; all 13,200 events ingested; 11,680 workflows done (tiny backlog). **CPU 200% (pegged)**, mem-free **68 MB** min, load 9.2. API throughput fell 218→73 req/s under CPU contention. |
| **Overload** | MQTT 400 + HTTPS 300 (=700 ev/s) + API c20, 30 s | **Degrades but does NOT crash** — no OOM kill, every service stayed active (mem-free floor **49 MB**). Latencies exploded: HTTPS p99 **20 s**, API p99 **12 s**, a few request timeouts. |

## 6. Verdict & limits (t3.small, 2 vCPU / 2 GB)

- **It fits, with essentially zero headroom.** The full workload runs, but at only
  ~**200 events/s** of combined ingest+workflow (plus light API) the box is already
  at **100% CPU** and **~68 MB free RAM**.
- **Bottleneck #1 is CPU, via DBOS.** In-process DBOS workflows checkpoint each
  step to Postgres; at ~250/s they saturate both vCPUs. This — not ingestion — caps
  sustained throughput.
- **Bottleneck #2 is RAM, via redpanda backlog.** When ingest outruns the workflow
  stage, unprocessed events buffer in redpanda and free memory falls toward the
  OOM edge (49–68 MB). The floor is dominated by redpanda (~290 MB) + the two Node
  processes (~380 MB), none of which shrink.
- **No hard failure observed.** Across every overload, the Linux OOM killer never
  fired and no service was lost; the appliance degraded (huge latency) rather than
  crashing. There is real cache to reclaim, so it rides the edge without tipping.
- **Ingestion and the writer are robust and lossless** for everything that reaches
  Kafka; TLS termination is not a meaningful cost at these rates.

### Recommendations for the AMI / slim-down effort

1. **Drop Inngest + Redis** when shipping DBOS mode (~33–55 MB, and two fewer
   services). Mask the units in `systemd-units.json` for a DBOS build.
2. **CPU, not RAM, is what buys workflow throughput** — a 2-vCPU box tops out near
   250 workflows/s regardless of RAM. More cores raise the ceiling roughly linearly
   until the single-partition Kafka writer / Postgres coordination becomes the wall
   (see doc 11).
3. **The custom AMI removes the Ubuntu-host + Docker layer** the container sits on
   today; that layer (dockerd, containerd, snapd, host kernel caches) is a chunk of
   the idle 1.16 GB and the most promising RAM reclaim for a 1 GB target.
4. For a 2 GB box, budget the appliance to **~150–200 events/s** for acceptable
   latency (p99 < 400 ms). Beyond that, latency — not crashes — is the failure mode.
