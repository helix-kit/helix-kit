<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 19 — Linux Device Runtime, Config Management, and Packaging

Date: 2026-07-28

This document describes the foundation of the Helix Linux device runtime: how a
device is configured, how services are packaged and installed, and how they are
supervised. It replaces the earlier bring-up model (one Docker container, a bash
supervisor with a hardcoded app list, and a single hand-written `config.json`)
with a systemd-native runtime, an FHS-standard config system, and an apt/dpkg-
inspired package manager. It ports the mature model from a prior production device tree,
adapted to Helix's principles: reuse `helixd` and the existing `@helix/backend`
release/OTA control plane, one `helix` CLI, no legacy shims.

The scope here is the **foundation slice**. `cloud-transfer`, migrating the other
apps (files, port-forward), and autonomous OTA package push are follow-on work;
their seams are noted at the end.

---

## 1. Runtime model: systemd everywhere

Every Helix service runs under **systemd**. On a real device this is native
systemd on the Helix Linux OS; for x86 development there is a **systemd-in-
container** test host (`linux/device/docker/Dockerfile`) that runs `systemd` as
PID 1 so the identical reconcile / `systemctl` path can be exercised on a laptop.
Docker is only a test host — it is not a runtime model.

Two privilege domains:

- **root** — `helix-runtime-manager` and the package installer. They drive
  systemd, write `/etc/helix`, and own the package database.
- **the `helix` service user/group** — `helixd` and every app service. They only
  *read* config; they never touch systemd or the package DB.

Base units (shipped with the base runtime, `linux/device/systemd/`):

| Unit | Runs as | Role |
| --- | --- | --- |
| `helixd.service` | `helix` | the device core (§4) — `WantedBy=helix.target` |
| `helix-runtime-manager.service` | root | the supervisor (§5) — `WantedBy=multi-user.target` |
| `helix.target` | — | aggregate; app services attach here via `WantedBy=helix.target` |

App services are **not** shipped as static units — they are rendered by
runtime-manager from installed packages (§5).

## 2. Filesystem layout (FHS)

Path constants live in one place: `linux/device/go/internal/shared/config/paths.go`
(rooted at `HELIX_ROOT`, which is empty on a device and a temp dir under test).

```
/usr/lib/helix/bin/                 executables (helixd, helix-runtime-manager, helix-pkg, apps)   root:root 0755
/usr/lib/helix/packages/<name>/     payload root for non-binary kinds (ui-bundle, python venv)
/usr/lib/helix/defaults/<svc>.json  package-shipped default config layer (lowest precedence)
/usr/lib/helix/catalog/<svc>.service.json  package-shipped managed-service seed
/etc/helix/config.json              shared device document (device, mqtt, ipc, gateway, spool, enrollment)  root:helix 0640
/etc/helix/conf.d/<svc>.json        per-service admin/remote drop-in (highest non-secret layer)             root:helix 0640
/etc/helix/secrets/<svc>.env        EnvironmentFile-style secrets                                            root:helix 0640, dir 0750
/etc/helix/pki/                     device.key (0600), chain.pem, root.pem
/var/lib/helix/db/status            dpkg-status-like package database
/var/lib/helix/db/managed-services.json  reconciled catalog runtime-manager consumes
/var/lib/helix/spool/events.db      helixd store-and-forward event spool
/var/lib/helix/tmp/                 install staging (extract then atomic rename)
/run/helix/helix-ipc.sock           helixd IPC bus (0660 helix:helix)
/run/helix/runtime.sock             runtime-manager control socket (0660 root:helix)
/run/systemd/system/helix-<svc>.service   units rendered by runtime-manager
```

## 3. Config management (FHS drop-in + secrets split)

Config resolution for a service (`config.Load(service)`,
`internal/shared/config/layer.go`) deep-merges, lowest to highest precedence:

1. `/etc/helix/config.json` — the shared device document (identity + transports);
2. `/usr/lib/helix/defaults/<svc>.json` — the package-shipped default section;
3. `/etc/helix/conf.d/<svc>.json` — the admin/remote drop-in;
4. `/etc/helix/secrets/<svc>.env` — the secret overlay.

Layers 2–3 form the per-service "app section", decoded via `cfg.AppSection(&dst)`.
Nested objects merge key-by-key; scalars and arrays replace wholesale.

**Secrets are split out and never world-readable.** `secrets.go` refuses to load
a secret file that others can read (broader than `0640 root:helix`). Secrets are
delivered to a service both directly (readable by the `helix` group) and via the
unit's `EnvironmentFile=`.

**Remote config writes** go through runtime-manager's `put-config` (§5): the
service name is validated against the catalog, so a cloud request can only ever
write `/etc/helix/conf.d/<known-service>.json` — never an arbitrary path — and the
drop-in is written `0640 root:helix` so the (non-root) service can read its own
config. The affected unit is then restarted.

## 4. helixd (the device core)

`helixd` (`internal/core`) owns the single cloud MQTT link (mTLS) and the local
IPC bus, routing between them (`helix/device/<id>/{in,out,service/<svc>/event}`).
It is app-agnostic — it routes on `message.service` and never interprets payloads.
Beyond the bridge it now carries the former "cloud-comm" responsibilities:

- **Event spool** (`spool.go`) — a SQLite (`modernc.org/sqlite`, pure-Go, so
  `helixd` still builds `CGO_ENABLED=0`) store-and-forward buffer. Telemetry
  events are persisted before publish, survive restarts/disconnects, drain
  in-order with delete-on-ack, and are bounded (oldest-dropped). Control
  responses are not spooled.
- **Enrollment + rotation** (`enrollment.go`, `rotation.go`) — optional
  (`enrollment.apiUrl`) CSR-based first-boot enrollment and a 15-minute rotation
  loop that re-enrolls within 6h of expiry and forces an MQTT reconnect (the TLS
  client cert is loaded per-handshake, so a reconnect presents the new cert).
  When enrollment is not configured, the device uses a cert provisioned
  out-of-band by the CLI (§7) and this is a no-op.

The MQTT link connects non-blocking with retry, so `helixd` stays up and serves
its IPC bus even when the broker is unreachable.

## 5. Packaging and the runtime-manager

### Package format (`.helixpkg`)

A package is a gzip tar containing a control manifest, a filesystem-overlay
payload, and optional maintainer scripts:

```
helix-control.json   name, version, kind, depends, conffiles, maintainerScripts, service{…}
payload/…            extracted relative to the device root (a rootfs overlay)
maintainer/…         preconfigure | preinst | postinst | prerm | postrm | postconfigure
```

Kinds: `go-binary`, `python` (wheel + `setupCommand` venv), `ui-bundle` (static
assets, often no service), `asset`. The `service` block is the managed-service
descriptor (execStart, user/group, after/requires, restart, wantedBy, the
`core`/`enabled`/`allowControl`/`allowUpdate` flags). Packs are **deterministic**
(sorted entries, zeroed timestamps) so identical inputs hash identically and the
content-addressed release store dedupes.

### Installer (`internal/pkg`, `cmd/helix-pkg`)

Install/upgrade is dpkg-ordered and never touches a byte before verifying the
package `sha256` and resolving `depends` against the package DB:

`fetch + verify → depsolve → preconfigure → preinst → extract payload (per-file
atomic write; dpkg 3-way conffile handling) → setupCommand → postinst → post-
configure → record in the DB → publish the service descriptor to the catalog`.

Conffile 3-way: an unmodified conffile is replaced on upgrade; a locally modified
one is kept and the new default is dropped alongside as `<path>.helix-new`. Remove
deletes payload files (keeping conffiles unless `--purge`) and runs prerm/postrm.
A failure after activation marks the package `half-installed` for repair.

### runtime-manager (`internal/runtimemanager`, `cmd/helix-runtime-manager`)

The root daemon that turns installed packages into supervised systemd services:

- **Render** (`render.go`) — a deterministic systemd unit per service. Helix uses
  journald, so `ExecStart` runs the service directly; there is no wrapper script.
- **Reconcile** (`reconcile.go`) — on boot and after every install/remove, it
  renders/updates units for every catalog service (core first), removes units for
  services that vanished, `daemon-reload`s only when something changed, and
  enables+starts (or disables+stops) each per its `enabled` flag. This is what
  **auto-starts** services from config.
- **Control API** (`control.go`, `operations.go`) — a local trusted control
  socket (`/run/helix/runtime.sock`, used by the CLI) *and* registration as the
  cloud-facing `runtime` service on helixd's bus (untrusted → per-service
  `AllowControl` gates). Methods: `get-status`, `get/put-config`,
  `start/stop/restart-service`, `install/remove/upgrade-package`, `list-packages`.
  Installs run the installer inside a **transient systemd unit** (`systemd-run`)
  so they are isolated and journald-logged.

### Metrics (per-service + pluggable hardware providers)

runtime-manager runs a background sampler (`internal/runtimemanager/{health,metrics}.go`,
~5 s) that caches a snapshot served by the `get-status` and `get-metrics` control
methods (request/response over the `runtime` service and the local socket) and
rolled up into helixd's heartbeat.

- **Per-service metrics are built in** and generic: from each service's systemd
  `MainPID`, the sampler reads `/proc/<pid>/stat` (CPU% from the tick delta
  between samples), `/proc/<pid>/status` `VmRSS` (memory), and starttime →
  uptime. These work on every Linux target, so they live in runtime-manager.

- **Host / hardware metrics are pluggable**, because the deployment target is not
  fixed and every board exposes different hardware (radxa NPU/GPU/video-engine,
  jetson `tegrastats`, Pi throttling, …). A provider is an **executable** in
  `/usr/lib/helix/metrics/` that prints one JSON line —
  `{"provider","hardwareProfile","metrics":{…}}` (contract:
  `internal/metricsplugin`). runtime-manager discovers and runs every provider
  each sample (bounded by a timeout), merging them under `host.providers.<name>`;
  an optional `metrics.providers` allow-list narrows what runs. Discovery re-runs
  each sample, so a newly installed provider is reported with **no
  runtime-manager restart**.

  This uses the **process boundary, not a shared-object ABI** — deliberately not
  Go `plugin` `.so`, which would force CGO and a byte-identical toolchain/dep
  build, breaking the static binaries and the no-rebuild goal. A provider can be
  written in any language.

- **Providers ship as packages.** The baseline `helix-metrics-linux` (generic
  `/proc` CPU/mem/load/disk) is a `.helixpkg` whose payload lands in the metrics
  dir with no service block. Adding a board type is therefore
  `helix device package install helix-metrics-radxa` — no runtime-manager rebuild,
  no restart — and runtime-manager starts reporting that hardware's metrics on the
  next sample. Providers run root-owned and package-verified (the package system
  is the trust boundary). `helix device status` / `helix device metrics` view the
  result.

## 6. Release/OTA backend reuse

Packages flow through the existing `@helix/backend` release/artifact/OTA control
plane rather than a new repository — a new artifact `typeKey`
(`helix-linux-package`). Publish uses the existing content-addressed ingest
(dedup by sha256); a device pulls a package via the existing
`POST /api/storage/packages/download-session` over mTLS, authorized by the same
profile-track resolution used for ESP32 OTA. See doc 06 (Releases & OTA) and
`web/packages/helix-backend/src/{releases,device-mtls}`.

## 7. Provisioning and the `helix` CLI

Everything routes through `helix device` (`tooling/device/`):

- `provision [--local | --host <cloud>]` — mints a device identity + a config
  bundle (`config.json` + `pki/`). Cloud mode seeds the device row over SSH and
  has step-ca issue a cert for a locally-generated CSR (reused from the retired
  `helix device docker`); `--local` generates a throwaway self-signed CA + leaf
  for infra-free testing.
- `package build <name>` — compiles a package spec under
  `linux/device/packages/<name>/` (Go binaries per `build.json`) into a
  `.helixpkg` via `helix-pkg`.
- `test-host up|down|logs|status` — build + boot the systemd-in-container test
  host with the provisioned identity.
- `package install|remove|list` and `config-push` — drive the on-device
  runtime-manager through its control socket (via `docker exec` on the test host).

## 8. Testing

- **Go unit tests** — `internal/shared/config` (layer precedence, deep-merge,
  secret-permission refusal), `internal/pkg` (manifest, depsolve, conffile 3-way,
  install/remove on a temp root, deterministic pack), `internal/runtimemanager`
  (golden unit render, reconcile start/stop + idempotence + stale-unit removal,
  put-config path-confinement + AllowControl gate; `/proc` CPU%/RSS/uptime
  parsing from fixtures; provider discovery/allow-list/failure), `internal/core`
  (spool in-order drain/retain/restart/bound; enrollment against a fake PKI).
- **End-to-end** — `tests/e2e/device_runtime/` boots the systemd-in-container host
  and proves the full lifecycle through the CLI: provision → core services active
  → build + install `helix-shell` → runtime-manager auto-starts it as `helix` and
  the app registers on the IPC bus → `config-push` reconfigures it (drop-in
  `0640 root:helix`) without breaking it → per-service metrics + a host-metrics
  provider that appears **without a runtime-manager restart** after installing the
  `helix-metrics-linux` plugin package → remove tears down unit + payload + DB.

## 9. Seams for follow-on work

- **cloud-transfer** — a durable presigned mTLS transfer queue; plugs in as a
  second package consuming the same `/api/storage/*` sessions, or a sibling spool
  in helixd.
- **Other apps** — files and port-forward become their own package specs under
  `linux/device/packages/` exactly like helix-shell.
- **Board-specific metrics providers** — radxa (NPU/GPU/video-engine/thermal from
  `/sys` + vendor tools), jetson (`tegrastats`), Pi (throttle/temp), … each a
  provider package like `helix-metrics-linux`, installed per hardware profile.
- **Autonomous OTA package push** — generalize `releases/ota.ts` to route a
  package update to the `runtime` service, which calls the installer. The device
  pull path already exists.
- **Real-device image** — the base runtime (binaries + units + seeded catalog)
  installs into the `linux/platform_os` rootfs the same way it is baked into the
  test image.
