# 08 — Generic File Transfer & On-Device Storage

## Why

Helix messaging is JSON over pluggable transports (serial, BLE, MQTT, WebSocket).
That is fine for commands and telemetry but cannot carry files: the JSON layer
has small per-packet caps (BLE ~768 B in / 480 B out, serial 2 KB/line) and no
chunking. Bulk data (firmware images, logs, configs, ML models) previously had to
go through the cloud — the device pulls over HTTPS, which needs Wi-Fi. A BLE- or
serial-only device had no way to receive a file.

This subsystem adds a **transport-agnostic, use-case-agnostic file-transfer
service**. Firmware OTA is just one consumer of it (write to the OTA partition
instead of a file); the same protocol moves any bytes to any sink.

## Architecture

```
host / central ─ JSON control ─▶ file service ─▶ sink vtable ─┬─▶ fs_sink  (FAT file: "fs:path")
   (serial/BLE)  binary data  ▶   (sessions)                  └─▶ ota_sink (esp_ota_write) [planned]
```

Two planes:

- **Control plane** — JSON on the existing `file` service (fully transport-agnostic,
  rides `service_dispatcher`). Methods: `begin`, `commit`, `abort`, `stat`.
- **Data plane** — a **binary side-channel** carrying raw payload bytes, avoiding
  base64 inflation and the JSON size caps. Each transport frames binary its own
  way and forwards decoded chunks to a single consumer via `helix_binary_channel`.

### Protocol

| Method | Request (JSON payload) | Response |
|--------|------------------------|----------|
| `begin`  | `{dest, size?, sha256?, chunkSize?}` | `file-begin {session, maxChunk, resumeOffset}` |
| `commit` | `{session, sha256?}` | `file-commit {session, ok, size, sha256}` |
| `abort`  | `{session}` | `file-abort {session}` |
| `stat`   | `{dest}` (fs: only) | `file-stat {exists, size, sha256}` |

- `dest` is scheme-prefixed: `fs:<path>` (FAT file under the storage mount), later
  `ota:next` (next OTA slot).
- `begin` allocates a session handle; binary data frames reference it. `maxChunk`
  is the negotiated per-chunk ceiling (currently 1024, the serial frame cap).
- **Integrity**: the device computes a streaming SHA-256 as chunks land and
  verifies it (and the declared size) at `commit`; a mismatch aborts the sink and
  fails the commit. `stat` reads a stored file back and returns size+SHA so a host
  can verify independently.
- **v1 requires in-order chunks** (write-at-offset with `offset == received`).
  Resume / out-of-order / windowed acks are future work (needed for lossy BLE; the
  sink `write(offset, …)` signature already accommodates it).

### Serial binary framing

Multiplexed on the same UART as the JSON control lines. JSON lines start with the
printable `SERVICE ` prefix, so a `0x02` marker at line start is unambiguous:

```
0x02 | ver(1) | session(2 LE) | offset(4 LE) | len(2 LE) | payload[len] | crc32(4 LE)
```

`crc32` is a reflected CRC-32 (poly `0xEDB88820`) over `ver..payload`. It is an
**internal frame checksum, not tied to any external CRC-32 standard** — the
firmware (`frame_crc_step` in `helix_transport_serial.c`) and the host driver
(`frame_crc` in `embedded/esp32/commands/simulator.py`) run the identical loop;
the only contract is that both ends agree bit-for-bit.

## Storage

FAT on a wear-levelled SPI-flash `storage` data partition
(`esp_vfs_fat_spiflash_mount_rw_wl`), mounted at `/storage`
(`CONFIG_HELIX_STORAGE_*`). The 8 MB layout (`partitions_8mb.csv`) adds the
partition alongside factory + dual OTA; the stock 4 MB table is full.

An **SD card** (`sdmmc`/`sdspi`) is the intended larger-capacity backend but is a
hardware-only target: Espressif's QEMU models the SPI flash, UART and OpenETH but
**has no SD peripheral**. The same sink vtable will get an `sd_sink` behind a
Kconfig/runtime switch, validated on real hardware.

## What is proven (QEMU) vs. hardware-deferred

| Piece | Status |
|-------|--------|
| FAT-on-flash storage mount + 8 MB layout | ✅ QEMU |
| Sink vtable + `fs_sink` | ✅ QEMU |
| `file` service (begin/commit/abort/stat, sessions, streaming SHA) | ✅ QEMU |
| Serial binary framing data plane | ✅ QEMU |
| End-to-end: transfer over serial → store on FAT → SHA verify → read-back | ✅ QEMU (`qemu-test`) |
| BLE binary data characteristic + MTU negotiation | ⛔ hardware only (no BT radio in QEMU) |
| `ota_sink` (OTA-over-transfer, `ota:next`) | ⛔ planned |
| `sd_sink` (SD card) | ⛔ hardware only |
| Windowed/acked flow control + resume (for lossy BLE) | ⛔ planned |

### QEMU specifics

`sdkconfig.defaults.qemu` disables the timer-group watchdogs (fault in the WDT ISR
under QEMU) and the Bluetooth controller (`btdm_low_power_mode_init` asserts —
no radio). Flash bumped to 8 MB with `partitions_8mb.csv`.

## Running the e2e

```
helix embedded esp32 qemu-test
```

Re-execs into `helix/esp-idf:release-v5.4-lean`, boots the firmware under
`idf.py qemu` with UART0 on a TCP socket, and drives the transfer from
`tests/e2e/test_esp32_qemu_filexfer.py` via `embedded/esp32/commands/simulator.py`.

## On-device single-table store (FlashDB)

For structured records with SQLite-like CRUD (but **no joins** — one table at a
time) there is `helix_db`, built on **vendored FlashDB KVDB**. Chosen over SQLite
because SQLite's engine adds ~500 KB to the app binary (won't fit the 4 MB OTA
slots); FlashDB's compiled footprint is **~15.5 KB** (+ a few KB for `helix_db`),
and it brings power-fail-safe, wear-levelled writes for free.

### Storage backend

FlashDB runs in **FAL mode on a dedicated raw `flashdb` partition** (custom type
`0x40`, see `partitions_8mb.csv`) via a small esp_partition FAL port — max usable
space, native wear-levelling, separate from the file-transfer FAT area. The
vendored component lives at `embedded/esp32/flashdb/` (KVDB only; TSDB compiled
out). Enabled by `CONFIG_HELIX_DB`.

### Data model & query engine

`helix_db` stores each row as a KV blob keyed `"<table>#<id>"` (auto-increment
id; `"<table>:seq"` holds the next id). A schema describes typed columns
(`HDB_I64`/`HDB_F64`/`HDB_TEXT`, offsets into the app's row struct). Queries are a
**full-table scan over the KV iterator** with schema-driven compare/sort — the
right approach for a single MCU table (no indexes):

| Capability | API |
|---|---|
| Create / Read / Update / Delete by id | `hdb_insert` / `hdb_get` / `hdb_update` / `hdb_delete` |
| WHERE (any column; `= != < <= > >=`, `LIKE` substring; AND-combined) | `hdb_select` / `hdb_count` / `hdb_delete_where` via `hdb_query_t.conds` |
| ORDER BY any column, ASC/DESC | `hdb_query_t.order_by` / `.descending` |
| LIMIT / OFFSET (applied after ordering) | `hdb_query_t.limit` / `.offset` |

Not supported (single-table scope): joins, multi-column sort, `OR` predicates,
`LIKE` wildcards beyond substring. Select materialises matches into a
caller-sized buffer before sorting, so size `max_rows >= offset + limit`.

### `db` service

`helix_db_service.c` exposes a demo `users` table (`id, name, age, score`) on the
message layer — the reference for wiring a table to the wire:
`insert / get / update / delete / select / count / deleteWhere`, with `where`
as `[{col, op, val}]` and `op` ∈ `eq ne lt le gt ge like`.

Proven in QEMU (`test_esp32_qemu_db.py`): CRUD, WHERE on numeric columns,
`LIKE` on text, ORDER BY asc/desc, LIMIT/OFFSET, COUNT, deleteWhere.

## Key files

- On-device DB: `embedded/esp32/platform/src/helix_db.c` (+ `helix_db_service.c`), vendored engine `embedded/esp32/flashdb/`
- Firmware service: `embedded/esp32/platform/src/helix_file_service.c`
- Sinks: `.../helix_xfer_sink.{c,h}`, `.../helix_fs_sink.c`
- Storage mount: `.../helix_storage.c`
- Binary channel: `embedded/esp32/protocol/src/helix_binary_channel.c`
- Serial framing: `.../helix_transport_serial.c` (`frame_crc_step`, `receive_binary_frame`)
- Host harness: `embedded/esp32/commands/simulator.py`
- Partition/config: `embedded/esp32/core/partitions_8mb.csv`, `sdkconfig.defaults.qemu`
