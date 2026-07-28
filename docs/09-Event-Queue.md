# 09 — Durable Event Queue (store-and-forward)

## Why

Device events (health heartbeats, sensor readings, …) are published to the cloud
over MQTT, which needs connectivity. If the link is down — or the device is
BLE-only — events were simply lost. This subsystem makes outbound events
**durable**: every event is persisted locally first, tracked for cloud delivery,
retried until delivered or expired, and cleaned up after a retention window.
It also exposes an `events` query service so a client can inspect the local
queue (how many pending, list, detail) over any transport.

## Architecture

```
helix_event_publish(service, type, payload)          emit choke point
        │  (CONFIG_HELIX_EVENT_QUEUE)
        ▼
helix_event_queue  ── persist pending ──▶  helix_db `events` table (FlashDB)
        │                                         ▲
   retry/expiry/cleanup sweep (FreeRTOS task)     │ query
        │  online? publish envelope (MQTT QoS1)   │
        ▼                                    events service ──▶ MQTT/WS/BLE/serial
   MQTT PUBACK ── mark sent (msgId→row) ──────────┘
```

- **Interposition**: `helix_event_publish()` routes through the queue when
  `CONFIG_HELIX_EVENT_QUEUE` is on, so existing emitters (health, etc.) gain
  durability with no change.
- **Delivery signal**: the MQTT transport now exposes `is_online()` and a
  **publish-ack callback** (fired on `MQTT_EVENT_PUBLISHED`, the QoS-1 PUBACK).
  The queue marks an event `sent` when its publish is acked. The transient
  per-session `msg_id` is mapped to the durable row only within a live session.
- **Stable `msgId`**: generated once at enqueue and reused on every retry, so the
  server's existing `(deviceId, msgId)` dedupe drops duplicate deliveries.
- **Retry/expiry/cleanup**: a single sweep task (also callable via the `sweep`
  method). When online it republishes due, non-expired `pending` rows with
  exponential backoff; past the TTL deadline it marks them `expired`; it deletes
  `sent`/`expired` rows older than the retention window. The sweep is the sole
  writer of row status (deliveries arrive via a lock-protected ring), avoiding
  cross-task status races.
- **Backpressure**: when the store hits `CONFIG_HELIX_EVENT_QUEUE_MAX`, enqueue
  evicts oldest `sent` → oldest `expired` → oldest `pending` to keep accepting
  new events.

### Timing (monotonic, not wall-clock)

Expiry and retention are measured with `esp_timer` (monotonic ms), not the wall
clock. Wall-clock needs SNTP (absent in QEMU) and would expire events early when
the clock jumps after sync. Trade-off: a reboot resets an event's age (safe — it
just gets retried a little longer). The wall-clock `createdTs` is display-only
(0 until SNTP sets the clock).

## `events` service + contract

Contract: `embedded/esp32/platform/contracts/events.json` → generates C
(`events_contract.{c,h}`) and TS (`web/apps/helix/src/generated/contracts/events.ts`)
via `helix protocol generate-all`. Methods:

| Method | Request | Response |
|--------|---------|----------|
| `stats` | — | `{pending, sent, expired, total}` |
| `list`  | `{status?, limit?, offset?}` | `{count, events:[summary]}` |
| `get`   | `{id}` | full event incl. `envelope` |
| `emit`  | `{service, eventType, payload?, ttlSec?}` | `{id, msgId}` |
| `sweep` | — | `{retried, expired, cleaned, pending}` |

Test-only (`CONFIG_HELIX_EVENTS_TEST_HOOKS`): `simulate-delivery {id}` (marks an
event delivered as a real PUBACK would) and `clear`.

## Storage & config

Backed by `helix_db` on the FlashDB `flashdb` partition (see doc 08). Kconfig:

- `HELIX_EVENT_QUEUE` (needs `HELIX_DB` + `HELIX_TRANSPORT_MQTT`)
- `HELIX_EVENT_QUEUE_TTL_SEC` (default 86400) — default max retry window
- `HELIX_EVENT_QUEUE_SWEEP_SEC` (default 5) — retry/cleanup interval
- `HELIX_EVENT_QUEUE_RETENTION_SEC` (default 3600) — keep terminal events this long
- `HELIX_EVENT_QUEUE_MAX` (default 128) — capacity before eviction
- `HELIX_EVENTS_TEST_HOOKS` — enable simulate-delivery/clear

## Gotchas / limits

- **Event size cap**: the stored envelope is capped at 256 B (row ~512 B).
  Larger events are rejected at enqueue. FlashDB GC churn on large values is
  *very* slow under QEMU's flash model, so the `flashdb` partition is kept small
  (128 KB) and the envelope modest — both keep GC cheap. Real hardware is far
  faster; this is primarily a QEMU-emulation constraint.
- **Query cost**: `stats`/`list`/`sweep` full-scan the events table (helix_db has
  no projection), reading each row's value. Fine for hundreds of events; heavy
  scans are slow under QEMU (~seconds), fast on hardware.
- **Config regen footgun**: `qemu-test` reuses the cached sdkconfig; after editing
  `sdkconfig.defaults.qemu` (or Kconfig defaults), run `helix embedded esp32 qemu
  build` once to regenerate before `qemu-test`.

## Proven in QEMU

`tests/e2e/test_esp32_qemu_events.py` (via `helix embedded esp32 qemu-test`,
offline so delivery is driven by the test hook): persist-first, stats/list/get,
delivery marking, TTL expiry, retention cleanup.

## Key files

- Engine: `embedded/esp32/platform/src/helix_event_queue.c` (+ `.h`)
- Service: `embedded/esp32/platform/src/helix_events_service.c`
- Emit interpose: `embedded/esp32/platform/src/helix_event.c`
- MQTT hooks: `embedded/esp32/transports/src/helix_transport_mqtt.c`
- Contract: `embedded/esp32/platform/contracts/events.json`
