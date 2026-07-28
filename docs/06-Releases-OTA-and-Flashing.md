# Releases, OTA, Custom Firmware Builds & Flashing UI

Date: 2026-07-04

This is the implementation plan for the end-to-end device software lifecycle:
CI-produced releases, a robust multi-artifact-type release manifest, a runtime
custom-firmware build service, profile-based OTA distribution, and a full-fledged
browser flashing + provisioning UI. It supersedes the two disjoint predecessor
release systems and builds on the ESP32 build pipeline in
[05-ESP-Build-Optimizations.md](./05-ESP-Build-Optimizations.md) and the backend
in [04-Backend-Design.md](./04-Backend-Design.md).

---

## 1. Goal

One release/artifact control plane that handles **every** kind of deliverable —
ESP32 firmware (with per-user app/feature customization and custom versions),
Linux binaries (arm/amd), appliance bundles (Next.js + backend), and future
device types — produced either by CI or by on-demand user builds, distributed to
devices via profiles + OTA, and flashable/provisionable from the browser.

Design tenets, learned from a prior-system post-mortem (§9 of doc 05 research):
- **DB-backed, not JSON-in-object-storage.** A prior production system kept all
  release state in `metadata.json` / `manifest.json` blobs updated by CAS; it
  does not scale to many kinds × profiles × users and has no relational querying.
- **One generalized model, not one stack per artifact kind.** The prior system
  has two disjoint systems (device-packages v2, appliance v1) with different
  schemas, endpoints, and upload scripts. Adding a kind meant a third stack.
- **Flexible identity, not a rigid 4-segment semver path.** The prior system
  hardcodes `service/version/platform/file` and `^\d+\.\d+\.\d+$` everywhere. We need
  channels, custom versions, per-user customization, and arbitrary targets.
- **Content-addressed artifacts.** Dedupe identical files (a bootloader rarely
  changes across firmware variants) and make integrity intrinsic.
- **Profile-gated distribution + scoped tokens**, not "any device can fetch any
  path" and a single open release token.

## 2. Current State (what we reuse vs. build)

**Reuse as-is (already built, production-shaped):**
- Firmware OTA consumer — `embedded/esp32/platform/src/helix_ota.c`: direct-URL /
  package-path / device-path sources, mTLS signed-URL download, sha256 verify +
  rollback, status reporting. `cloud_config.profile_id` already carried.
- ESP32 build pipeline — `prebuild`/`link` CLI, transport Kconfig toggles +
  `features/*.defaults` fragments, ccache fast path (~20–35 s config builds,
  ~4 s app relinks), validated CI→EC2 bundle (143 MB / 38 MB gz). See doc 05.
- Storage abstraction — `helix-backend/src/storage`: FS/S3/MinIO/Azure providers,
  signed up/download URLs, standalone FS HTTP server.
- Device mTLS data plane (`:4001`/`:8443`) — cert-CN identity
  (`device-mtls/trpc.ts:34`), device/package download+upload sessions.
- PKI enrollment (step-ca) gated by `device.access_token` (`pki/router.ts`).
- MQTT↔WS gateway — commands already flow to `helix/device/{id}/in`
  (`gateway/mqtt-bridge.ts:87`).
- **Browser esptool-js flasher — complete but unwired** —
  `@helix/esp32-flasher`: `flashEsp32`, `useEsp32Flasher`, `Esp32FirmwareManifest`
  ({artifacts:{offset,url,sha256,size}} + chip/flash params + profile), sha256+size
  verify, ESP32 USB port filters.
- Browser transport stack — serial/BLE/MQTT/WS, all `HelixTransport`, typed
  contracts + React/Query hooks (`@helix/protocol-*`).
- Design system — full shadcn kit: `data-table`, `dynamic-form`, `progress`,
  `mutation-modal`, `sidebar`, `app-header`.
- Idle-but-ready — TS OTA contract `apps/helix/src/generated/contracts/ota.ts`.

**Build net-new:**
- Release/artifact/profile/build DB schema + tRPC routers (the control plane).
- Generalized CI release CLI + register/presign endpoints (multi-kind).
- On-demand ESP32 build service (build container + orchestration).
- Profile-based download authorization + OTA command producer.
- Flashing UI, provisioning UI, profile/build management UI, UI↔backend client.
- Ingress `/api/external/*` → `/api/*` rewrite; scoped CI tokens.

## 3. Core Data Model (the linchpin)

New Postgres/Drizzle tables in `helix-backend/src/db/schema.ts`. All IDs are
prefixed ULIDs. Kind-specific detail lives in `jsonb` so new artifact kinds add
no columns.

```
artifact_kind := esp32-firmware | linux-binary | python-wheel
               | ui-bundle | appliance-bundle | container-image | ...   (enum, extensible)

artifact            -- one content-addressed file
  id            pk
  sha256        text unique          -- content address (dedupe key)
  size_bytes    bigint
  storage_key   text                 -- artifacts/<kind>/<sha256>
  content_type  text
  kind          artifact_kind
  metadata      jsonb                -- {chip, flashMode,...} | {os, arch} | ...
  created_at

release             -- a named, versioned, kind-specific deliverable
  id            pk
  kind          artifact_kind
  name          text                 -- slug: "helix-esp32-default", "cloud-comm"
  version       text                 -- FREE string: "0.3.1", "0.3.1-custom.ab12", "2026.07.04-nightly"
  channel       text                 -- stable | beta | nightly | custom
  target        jsonb                -- {chip,flashSize} | {os,arch} | {minBaseImageVersion}
  config        jsonb                -- customization that produced it: {apps, features, sdkconfigHash}
  manifest      jsonb                -- resolved flash/install manifest (roles→artifact refs, offsets)
  analysis      jsonb                -- size breakdown, section sizes, build metadata
  status        text                 -- draft | ready | failed | yanked
  source_commit text, source_dirty bool
  owner_user_id text null            -- null = official/CI; set = user custom build
  build_id      text null fk         -- provenance for on-demand builds
  created_at, published_at
  unique(kind, name, version)

release_artifact    -- release -> artifacts, by role  (M:N)
  release_id fk, artifact_id fk
  role       text                    -- app|bootloader|partition-table|ota-data|flasher-args | binary | wheel
  offset     text null               -- flashable offset (esp32)
  path       text null               -- install path (linux)
  pk(release_id, role)

profile             -- a group of "tracks" a device is allowed to run
  id pk, name, description
  owner_user_id text null            -- null = system profile
  created_at

profile_track       -- what a profile should run (resolves to a concrete release)
  id pk, profile_id fk
  kind          artifact_kind
  name          text                 -- release name/slug this track follows
  channel       text null            -- track latest of (kind,name,channel) ...
  pinned_release_id text null fk      -- ... or pin a specific release
  auto_update   bool default true    -- push OTA when the resolved release advances

device_profile      -- device -> profiles  (M:N)
  device_id fk, profile_id fk, assigned_at
  pk(device_id, profile_id)

build               -- an on-demand / CI build job
  id pk, kind
  status        text                 -- queued|running|uploading|success|failed
  request_config jsonb               -- {apps, features, chip, flashSize, versionLabel}
  config_hash   text                 -- sdkconfig+apps hash -> dedupe/cache key
  owner_user_id text
  release_id    text null fk          -- set on success
  callback_token_hash text
  analysis      jsonb, error_summary text
  duration_ms   int, ccache_hit bool
  created_at, started_at, finished_at
  index(config_hash, status)

device_release_state -- OTA tracking (optional, phase 3)
  device_id fk, kind
  current_release_id fk null, current_version text
  last_ota_status text, last_ota_at
  pk(device_id, kind)
```

How the model answers the requirements:
- **Multi-kind** → `kind` enum + `target`/`config`/`metadata`/`manifest` jsonb.
- **Custom versions** → `version` is a free string (no semver regex).
- **Channels** → `channel` + `profile_track`.
- **Profiles gate downloads** → `device → device_profile → profile_track →
  release → release_artifact → artifact.storage_key` is the device's allowed set.
- **Per-user custom builds** → `owner_user_id` + `build` + `config_hash` dedupe.
- **CI artifacts** → `owner_user_id = null`, kind-specific.
- **Analysis per build** → `release.analysis` / `build.analysis`.
- **Dedup** → `artifact.sha256` unique; identical files shared across releases.

## 4. Storage Key Convention

Content-addressed, kind-namespaced, replacing the prior system's rigid 4-segment path:

```
artifacts/<kind>/<sha256>              -- immutable blob (the real bytes)
```

The DB (`release_artifact`) maps a release's logical roles to blobs. Devices and
the browser never construct paths — the backend resolves a release to signed URLs.
For OTA path-based sources, the backend hands the device the signed URL for the
release's `app` artifact after profile authorization (§7).

## 5. CI Release Pipeline (generalized, multi-kind)

A single `helix release` CLI (generalizing a prior `devtool package release`
command), runnable on a normal CI runner **and inside the lean esp-idf
container**. It unifies the two prior stacks behind one register endpoint.

Flow per artifact kind:
1. **Plan** — diff source hashes (reuse the prior approach, but the input set is
   per-kind and declared, not hardcoded to the predecessor's trees); decide version bump
   or accept an explicit version/channel.
2. **Build** —
   - **esp32**: `prebuild` once → `link` each declared device profile
     (apps × feature fragments) → `analyze` for size → produces a bundle.
   - **linux/appliance/etc.**: per-target build → artifact file(s).
3. **Upload (content-addressed)** — for each file: compute sha256 → ask backend
   `POST /api/ci/artifacts/upload-url {kind, sha256, size, contentType}` (scoped
   CI token) → if blob already exists, backend returns "exists" (skip upload);
   else returns a presigned PUT → upload bytes.
4. **Register** — `POST /api/ci/releases` with the release descriptor:
   `{kind, name, version, channel, target, config, manifest, analysis,
   artifacts:[{role, sha256, offset?, path?}]}`. Backend inserts `artifact` (if
   new) + `release` + `release_artifact`, idempotent on `(kind,name,version)`.
5. **Promote** (optional) — `POST /api/ci/releases/{id}/publish` to set channel /
   mark ready.

Auth: **scoped CI tokens** (per pipeline/kind), not the prior system's single open token.
Store hashed in DB; endpoints reject when unset (no silent-open).

ESP32 official profiles (built every push, uploaded ready-to-use) are declared in
a `release.profiles.json` next to `apps/manifest.json`, e.g. `default`
(all transports), `minimal` (serial-only), `no-ble`. Each is a `link` invocation
with an apps list + feature fragments; each becomes a `release`
(kind=esp32-firmware, channel=stable).

## 6. On-Demand Custom Firmware Build Service

> **Implemented** — see doc 17 (Custom Firmware Builds) for the shipped slice:
> the `cloud/build-service` container (`GET /catalog` + `POST /build`), the
> `@helix/backend/releases` dispatch (`requestBuild` / `dispatchBuild`), the
> `@helix/firmware-builder` UI, and the `/admin/builds/new` page. The container
> serves the build-options catalog itself; a `HELIX_BUILD_FAKE` mode verifies the
> full flow without a compile. Appliance/host (no-Docker) mode is still pending.

New long-lived container in `cloud/docker-compose.yml`, e.g. `helix-build-esp32`,
running the lean esp-idf image + helix CLI + the prebuild bundle (warm
`.build/dynamic`) + a shared ccache volume + a thin HTTP worker. Realizes the
Tier-2 build from doc 05 (~20–35 s with warm ccache).

Sequence (exactly the shape requested):
1. User configures a firmware in the UI (chip, apps, features, version label) and
   clicks Build.
2. UI → helix-server `builds.request({kind, config})`.
3. Backend computes `config_hash`. **Cache hit**: a `ready` release with the same
   hash exists → return it immediately (Tier-0). **Miss**: insert `build`
   (queued), mint a `callback_token`, `POST` the job to the build container:
   `{buildId, config, callbackUrl, callbackToken}`.
4. Build container (per-request isolation from doc 05: reflink-copy `core`):
   compose `SDKCONFIG_DEFAULTS` from feature fragments → `link` (warm ccache) →
   `analyze` → for each output file, request a presigned PUT from the backend
   (`POST /api/build/artifact-url {buildId,sha256,size}` authed by
   `callbackToken`, content-addressed so unchanged bootloader/partition dedupe) →
   upload → finalize `POST /api/build/complete {buildId, status, release,
   analysis, durationMs}`.
5. Backend on `complete`: create `artifact`/`release`/`release_artifact`, set
   `build.status=success`, `release.status=ready`. UI polls
   `builds.get({buildId})` (or subscribes) → shows status + size analysis.

Notes:
- **Every build carries analysis** (`analyze.py` output: total, section sizes,
  partition free %, per-feature deltas) attached to `build.analysis` /
  `release.analysis`, surfaced in the UI.
- Concurrency: internal work queue in the worker; per-request tree copy; shared
  ccache. Failure → `build.status=failed` + `error_summary`.
- The same worker HTTP contract generalizes to other kinds later (a
  `helix-build-linux` container), so the backend↔worker protocol is kind-agnostic.
- Flash-size customization depends on de-hardcoding `build.py::copy_firmware_outputs`
  (fixed `--flash_size 4MB` + offsets) to be partition-derived (doc 05 gap).

## 7. Distribution: Profile Authorization + OTA Producer

**Fix the authorization gap.** `createPackageDownloadSession`
(`fileRouter.ts:45`) currently signs any `device-packages/<path>` for any device.
Replace with: resolve the device's allowed artifact set (`device → device_profile
→ profile_track → release → release_artifact → artifact.storage_key`); sign only
if the requested key/release is in it, else 403. Also re-check `device.is_active`.

**OTA command producer (new backend service / Inngest workflow).** Nothing today
publishes `ota-update`. Add a producer that, given (deviceId, releaseId), sends an
`ota-update` Helix packet to `helix/device/{id}/in` with
`{devicePath|packagePath, version, sha256}` (path-based; the device then requests
a profile-gated signed URL) — or a pre-signed `firmwareUrl` for the simplest path.
Triggers:
- **Manual** — UI "Update device to release X".
- **Profile auto-update** — when a `profile_track` (auto_update=true) resolves to
  a newer release, enqueue OTA for all devices carrying that profile. This is the
  `1 Device ↔ N Profiles`, profile-declares-allowed-paths model from doc 04.
- Record outcome in `device_release_state` from the firmware's OTA status packets.

## 8. Flashing, Provisioning & Management UI

The Next app (`web/apps/helix`) currently has only throwaway GPIO test pages and
**no backend client**. Add:

**8a. UI↔backend integration** — a tRPC/REST client + provider (absent today);
better-auth session provider (schema exists). React Query already wired.

**8b. Flashing UI** — wire the existing `useEsp32Flasher`. Flow: connect device
(WebSerial, ESP32 VID filters) → pick a `release` → backend produces its
`Esp32FirmwareManifest` (roles→signed URLs + offsets, already the flasher's shape)
→ `flashEsp32` with progress (`progress` component). **Port-ownership
coordination**: release `SerialTransportProvider`'s port before flashing, re-acquire
after (esptool needs its own raw Transport). Widen manifest `chip` validation for
"other devices" later.

**8c. Provisioning UI** — none exists. A `dynamic-form` (WiFi creds, deviceId,
apiUrl, mqttHost, tokens, profileId) written post-flash over
`@helix/transport-serial` (NVS_SET JSON) or BLE, via a new provisioning contract
analogous to `gpio_control.ts`.

**8d. Management UI** (design-system `sidebar` + `data-table` + `mutation-modal`):
- **Devices** — list/detail, assigned profiles, current version, OTA history,
  "Update"/"Provision"/"Flash" actions.
- **Firmware Builder** — chip + apps (from `apps/manifest.json`) + feature toggles
  (BLE/WiFi/MQTT/WebSocket/IPv6/flash-size/log-level…) + version label → Build →
  live status + **size analysis** → creates a release → assign to profile.
- **Profiles** — CRUD, tracks (kind+name+channel or pinned release), device
  assignment.
- **Releases** — browse CI + custom releases across kinds/channels, analysis,
  download, promote.

## 9. Cross-Cutting

- **Ingress rewrite** — firmware calls `/api/external/*` but routers mount at
  `/api/*`; add a Caddy rewrite in `cloud/Caddyfile` (or mount under
  `/api/external`). Currently missing.
- **Local dev** — the appliance image lets us run cloud apps on host against
  infra in the container; the build container can run locally the same way for
  end-to-end testing before EC2.
- **Scoped tokens** for CI + build callbacks; hashed at rest.
- **Observability** — build durations, ccache hit rate, OTA success rate into the
  existing Grafana/Prometheus stack.

## 10. Phased Roadmap

**Phase 0 — Foundations (unblocks everything)**
- DB schema (§3) + migration. tRPC routers skeleton (`releases`, `profiles`,
  `builds`, `ci`). Ingress `/api/external` rewrite. Scoped-token infra.

**Phase 1 — CI Releases**
- `helix release` CLI (esp32 first: prebuild → link profiles → analyze → publish).
- `POST /api/ci/artifacts/upload-url` + `POST /api/ci/releases` (content-addressed,
  idempotent). `release.profiles.json`. GitHub workflow building the lean image +
  running prebuild + publishing official ESP32 profiles.

**Phase 2 — On-Demand Build Service**
- `helix-build-esp32` container + HTTP worker + queue. `builds.request/get`,
  build callback endpoints, config-hash dedupe. Wire `analyze` into every build.
- De-hardcode `build.py` flash-size/offsets for flash-size customization.

**Phase 3 — Distribution / OTA**
- Profile-gated `createPackageDownloadSession`. OTA producer (manual + profile
  auto-update). `device_release_state` from OTA status packets.

**Phase 4 — UI**
- UI↔backend client + auth. Flashing UI (wire `useEsp32Flasher`). Provisioning UI.
- Management UI (devices/profiles/builder/releases) with size analysis.

**Phase 5 — Generalize to other kinds**
- `helix-build-linux`, appliance-bundle CI, container-image kind — all reuse the
  same release/artifact model, register endpoint, and worker protocol.

## 11. Open Decisions

1. **OTA source**: backend sends a pre-signed `firmwareUrl` (simplest) vs.
   path-based where the device requests a profile-gated signed URL (more secure,
   short-lived, device-authenticated). Recommend path-based; support both.
2. **Build worker transport**: direct HTTP request/callback (matches the stated
   design, simplest) vs. a queue (Redpanda/Inngest, better for scale/retries).
   Recommend HTTP now, queue later — the worker protocol is the same.
3. **Version strategy**: source-hash auto-bump (prior-system style) for CI vs.
   explicit versions; custom builds get `…-custom.<hash>` labels. Recommend both.
4. **Storage layout**: content-addressed `artifacts/<kind>/<sha256>` (dedupe,
   recommended) vs. human-readable pathed. Recommend content-addressed; the DB
   holds the human-facing naming.
5. **Manifest source of truth**: DB (recommended) with an optional exported
   `metadata.json` in storage for cache/CDN/back-compat, vs. the prior system's
   JSON-in-storage. Recommend DB-authoritative.

---

## 12. Build Service — Practice Findings (2026-07-04)

Per the "build the service before finalizing the schema" decision, a working
prototype was built and exercised end-to-end: `cloud/build-service/` — a
dependency-free **mock backend** (`mock_backend.py`: dispatch → content-addressed
presigned PUT → local blob store → completion callback) and a **build worker**
(`worker.py`) running inside the lean ESP-IDF image, driven by
`docker-compose.yml` + `try-build.sh`. The CLI `link` was extended with
`--feature`, `--set`, `--build-dir`, `--out-name` (composes `SDKCONFIG_DEFAULTS`
from `features/*.defaults` + arbitrary overrides).

**Validated flow (real builds):** UI/curl → mock `POST /builds` → dispatch to
worker → `link` (custom apps + features + version) → `analyze --host --format json`
→ hash + content-addressed upload of every bundle file → `POST …/complete`. A
`no-ble` custom build (`gpio_control+status_display`, version `1.0.0-custom`)
produced a 995,344-byte app, 7 artifacts stored with **integrity=ok**, in ~44 s.

**Findings that shape the schema:**

1. **Content-addressing dedups only the invariant artifacts.** A second identical
   build re-deduped bootloader / partition-table / ota-data / flash-args (4/7) but
   the **app binary changed sha256** — ESP-IDF embeds a build timestamp
   (`esp_app_desc`) so `esp32_firmware.bin` is **not reproducible by default**.
   → Two dedup levels are required: **blob-level by sha256** (invariant files) and
   **logical-level by `config_hash`** for the Tier-0 "already built this request"
   cache. The Tier-0 cache MUST key on `config_hash`, not artifact sha.
   → Recommend enabling `CONFIG_APP_REPRODUCIBLE_BUILD=y` so the app bin (and thus
   the OTA sha256) is stable per config; then blob dedup also covers the app.

2. **The worker already emits the browser flasher's manifest verbatim.** The
   `flasherManifest` in the callback matches `@helix/esp32-flasher`'s
   `Esp32FirmwareManifest` 1:1 (chip, baudRate, flashMode/Freq/Size, profile,
   `artifacts[{id,name,offset,sha256,size,url}]`) — only `url` is filled by the
   backend at flash/OTA time from the artifact's `storage_key`. → Store it as
   `release.manifest`; no transform needed for the flashing UI.

3. **Analysis is build-produced and rich.** `analyze` yields `partitionUsage`
   (factory 75.9% used / 315 KB free), `sectionSummary`
   (flash.text/rodata/iram/dram + debug-only), top symbols/archives. → Store as
   `release.analysis` / `build.analysis` and surface in the UI.

4. **Custom build ≈ 44 s** with a fresh per-build tree (Tier-2, matches doc 05).
   Reusing a warm per-`config_hash` tree instead of a fresh `svc-<id>` dir would
   drop repeat builds toward the ~15 s incremental path — a later optimization.

**Confirmed completion-payload → schema mapping:**

| Payload field | Table.column |
|---|---|
| `artifacts[].{sha256,size,storageKey,fileName}` + `kind` | `artifact` (sha256 unique) |
| `config` (profileName, apps, features, set, chip, flashSize) | `build.request_config`, `release.config` |
| `config_hash` (worker/backend computed) | `build.config_hash` — Tier-0 dedup key |
| `flasherManifest` | `release.manifest` (jsonb) |
| `analysis` | `release.analysis` / `build.analysis` |
| `artifacts[].{role,offset}` | `release_artifact` (role, offset) |
| `appArtifact` | the OTA target (role=app) |
| `source.{revision,dirty}`, `durationMs`, `status` | `release.source_*`, `build.duration_ms/status` |

The §3 model holds; the only additions are the explicit **`config_hash` dedup
key** and the **reproducible-build** recommendation. Known worker gaps to close
next: ccache hit-rate parsing (regex mismatch → reported null), per-`config_hash`
warm-tree reuse, and per-request core isolation for parallel builds.
