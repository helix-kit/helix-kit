<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 17 — Custom Firmware Builds

Date: 2026-07-16

A self-serve path for building **customized ESP32 firmware** from the admin
console: pick apps, toggle feature fragments, set sdkconfig overrides and a
target, and a long-running build container compiles the image and registers an
OTA-ready release. It reuses the release/build control plane from
`08`/`06` (Tier-0 dedupe, content-addressed artifacts, build callbacks) and adds
the two pieces that were missing: a **build container that actually runs the
build**, and a **UI to drive it**.

## The shape

```
Admin UI (web/apps/helix, /admin/builds/new)
   │  releases.builds.catalog / .request / .get   (session-authed tRPC)
   ▼
@helix-hq/backend/releases
   │  requestBuild()  → Tier-0 dedupe + queued build row + callback token
   │  dispatchBuild() → POST /build to the container
   ▼
Build container (cloud/build-service/worker.py, in the lean ESP-IDF image)
   │  helix embedded esp32 link  → firmware artifacts
   │  POST {publicUrl}/api/build/artifact-url  (presign, content-addressed)
   │  PUT  <signed url>                          (upload each blob, deduped)
   │  POST {publicUrl}/api/build/complete        (register + publish the release)
   ▼
Release backend (helix-server /api/build/*, same DB the admin app writes)
```

The admin app **creates the build row** (via `requestBuild`, sharing the exact
Tier-0 logic the public `/api/builds/request` uses) and **dispatches** the job to
the container. The container builds and drives the callbacks against the release
backend's public plane (`helix-server`), which shares the appliance Postgres, so
the callback lands on the same build row. The UI then polls `releases.builds.get`
until the build reaches `success` / `failed`.

## The options catalog is served by the container

Rather than hardcode the selectable options in the web app, the **build container
publishes them** over `GET /catalog`, assembled by `tooling/release/catalog.py`
from the real firmware sources so it can never drift from what
`helix embedded esp32 link` understands:

- **apps** — from `embedded/esp32/core/apps/manifest.json` (name, label,
  description, and any feature fragments the app declares it needs);
- **feature fragments** — from `embedded/esp32/core/features/*.defaults`, using
  each fragment's leading comment block as its description (`hw-test` is hidden —
  it is a test build, not a user option);
- **chips / flash sizes / sdkconfig knobs** — curated in `catalog.py` (properties
  of the build service, not of any one source file).

The backend proxies the catalog (`releases.builds.catalog` →
`fetchCatalog(workerUrl)`); the `@helix-hq/firmware-builder` package renders it. Run
`helix release catalog` to print the same catalog locally.

## Packages and files

- **`@helix-hq/firmware-builder`** (`web/packages/firmware-builder`) — the UI.
  `FirmwareBuilderForm` (apps, feature toggles that auto-enable app-required
  fragments, chip/flash-size, sdkconfig overrides, name/version/channel) and
  `BuildStatusPanel` (live queued → success/failed). Presentational only: the app
  passes the catalog and wires the tRPC request/poll.
- **`@helix-hq/backend/releases`** — `build-dispatch.ts` adds `requestBuild`,
  `dispatchBuild`, `fetchCatalog` and the catalog/config types. `api-router.ts`'s
  `buildsRequest` now uses the shared `requestBuild`. `admin-router.ts`'s
  `builds` sub-router gains `serviceStatus`, `catalog`, `request`, `get`.
- **`cloud/build-service/worker.py`** — the long-running service: `GET /catalog`,
  `POST /build`, `GET /health`. The build itself (build → upload → complete) is
  shared with the CLI worker via
  `tooling/release/build_worker.py::complete_build`, so there is one
  implementation of the worker side of the protocol. `mock_backend.py` is a
  stdlib stand-in for helix-server that speaks the same callback protocol, for
  running the container in isolation.

## Configuration

The admin builder is gated on two env vars (see `web/apps/helix/src/lib/env.ts`);
with either unset the page shows a "not configured" notice:

- `HELIX_BUILD_WORKER_URL` — the build container (its `GET /catalog` +
  `POST /build`).
- `HELIX_BUILD_CALLBACK_BASE_URL` — the release-backend base the container calls
  back to (`{url}/api/build/*`), usually helix-server's public URL. **It must be
  reachable from the container** — e.g. `http://host.docker.internal:4000` when
  the container runs under docker-compose against a host helix-server.

## Fake mode (fast verification)

A real ESP-IDF build takes minutes. Set `HELIX_BUILD_FAKE=1` on the container (or
send `fake: true` in a job) to synthesize artifacts instead — exercising the full
request → dispatch → upload → complete → release path in seconds. This is how the
flow is verified without a compile:

```sh
# Container service in isolation (no docker needed), against the mock backend:
export PYTHONPATH="$PWD"
HELIX_BUILD_FAKE=1 WORKER_PORT=9098 python cloud/build-service/worker.py &
WORKER_URL=http://localhost:9098 PUBLIC_URL=http://localhost:9099 \
  STORAGE_DIR=/tmp/hstore MOCK_PORT=9099 python cloud/build-service/mock_backend.py &

curl -s localhost:9098/catalog | python3 -m json.tool
MOCK=http://localhost:9099 FAKE=true ./cloud/build-service/try-build.sh
```

Or the whole harness in the ESP-IDF image via docker-compose:

```sh
HELIX_BUILD_FAKE=1 HOST_UID=$(id -u) HOST_GID=$(id -g) \
  docker compose -f cloud/build-service/docker-compose.yml up
```

## Deployment note (container vs host)

The build container is required today. The appliance/minimal AMI has no Docker, so
a later change will add a **host** build mode (the same `worker.py` running as a
process, selected the same way the ESP32 CLI already chooses host vs
`IN_ESP_IDF_DOCKER`), and the service will support both. That work is out of scope
here; this slice ships the container path and verifies it locally.
