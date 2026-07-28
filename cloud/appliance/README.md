# Helix single-container appliance

One Docker image that runs the **entire** Helix cloud stack — the same ~25
services that are separate containers in `cloud/docker-compose.yml`, plus the
observability stack — as **systemd units inside a single container**. PID 1 is
systemd.

Goal: portable bring-up at a remote site or a dev box with one `docker run`, no
env juggling (first boot self-seeds everything), and **over-the-air app updates**
driven from the cloud app itself.

> Status: **Phase 1 — base image + host-built bundles.** The data-plane stack,
> env seeding, PKI, and bundle install/run are implemented here. The FS storage
> provider and the in-app remote-update agent are Phase 2 (see "Roadmap").

---

## How it's structured

| Piece | Where |
|---|---|
| Image definition | `Dockerfile` (third-party services baked in as native binaries) |
| App code | **NOT** baked into OS layers — shipped as zip **bundles** (`bundles/*.zip`) built on the host by `scripts/build-appliance-bundles.sh`, unpacked into `/opt/helix/apps/<name>/<version>` |
| systemd units | **generated** from `systemd-units.json` by `bin/gen-units.py` at build time (writes the ~27 units + enable symlinks + Debian-service masks) |
| First-boot seeding | `bin/seed-env.sh` → generates `/var/lib/helix/env/{secrets,internal,site}.env` |
| Bootstrap | `bin/pki-init.sh` (MQTT PKI), `bin/pg-prepare.sh` (PG cluster), `bin/bootstrap.sh` (roles, topic, migrations, sysadmin) |
| Bundle install | `bin/install-bundles.sh` (unpack zip → repoint `current` symlink) |
| Config reuse | The `cloud/` originals are reused where possible — `cloud/Caddyfile` (env-driven), `cloud/mosquitto/{device,service}.acl` (merged at prepare time). The host-sensitive observability configs are **derived** from `cloud/observability/*` by `bin/localize-obs.sh` at build (docker hostnames → `127.0.0.1`); only `observability/{prometheus.yml,config.alloy}` are appliance-specific (structurally different) |

Everything that needs to persist lives on **one volume**: `/var/lib/helix`
(Postgres, Redpanda, Redis, step-ca PKI, Loki/Tempo/Prometheus TSDB, the
generated env files, and the unpacked app tree). The container itself is
disposable — replace it and the data + identity survive.

---

## Build & run

```bash
# 1. Build the app bundles ON THE HOST (turbo build + stage runtime deps + zip).
scripts/build-appliance-bundles.sh                 # -> cloud/appliance/bundles/*.zip

# 2. Build the appliance image (context = repo root).
docker build -f cloud/appliance/Dockerfile -t helix-appliance:dev .

# 3. Run it — ALWAYS through the CLI (sets the correct cgroup/stop flags for you):
uv run helix appliance up                          # boot + migrate + seed features + gen app .env files
docker exec helix-e2e systemctl status             # watch the stack come up
docker exec helix-e2e journalctl -u helix-app -f   # follow a unit's journal
```

(Step 2 is exactly what `uv run helix appliance build` runs; step 1 stages the app
bundles into the image and is still a separate host step.)

If you must launch by hand, copy the safe recipe VERBATIM. systemd is PID 1 and
needs a WRITABLE cgroup; `--cgroupns=private` (Docker's default on cgroup v2)
gives it a private one of its OWN subtree — that is all it needs.

```bash
docker run -d --name helix \
  --cgroupns=private --privileged \
  --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
  --stop-signal SIGRTMIN+3 \
  -v helix_data:/var/lib/helix \
  -v "$PWD/my-site.env:/etc/helix/site.env:ro" \
  -p 80:80 -p 443:443 -p 8883:8883 -p 8884:8884 \
  helix-appliance:dev
```

> ⚠ **NEVER** add `-v /sys/fs/cgroup:/sys/fs/cgroup:rw` (or any host cgroup bind
> mount). On a cgroup v2 host it overrides Docker's private, namespaced cgroup
> mount with the host's REAL cgroup root, so the container's systemd manages the
> HOST's cgroups and, on stop (SIGRTMIN+3), tears down your user session +
> system slices — an abrupt logout/reboot. `--cgroupns=host` is the same trap.
> The launcher and `dev-compose.yml` are preflighted to never do this.

> Verified end-to-end on a fresh volume: all 17 units active in ~16s, env
> auto-seeded (14 secrets + 36 internal vars), 32 migrations applied, device-event
> topic created, app/helix-server/openfga/inngest all responding, release state
> written. (Podman runs systemd natively — drop `--privileged`; it doesn't share
> the host cgroup namespace by default.)

---

## Use it as a dev backend

The same image doubles as a **dev backend**: it houses every dependency (Postgres,
OpenFGA, Inngest, Redis, Redpanda, Mosquitto, step-ca), so you can run the cloud
app + helix-server on your **host** (hot reload) against the container's services —
no local Postgres/OpenFGA/etc. needed.

```bash
uv run helix appliance build     # once — build the image
uv run helix appliance up        # boots the backend, generates the app .env files
cd web && pnpm dev               # host apps: helix :3000, website :3001, helix-server
```

`helix appliance up` (default `--fresh`) maps the service ports to `127.0.0.1` on
off-defaults (see below), runs the drizzle migrations, seeds the device-feature
catalog from the app's registered features, exports the step-ca +
mosquitto mTLS material to `web/apps/helix-server/.dev-pki/`, and writes a `.env`
into each of `apps/helix`, `apps/helix-server`, and `apps/website` wired to those
mapped ports and the container's generated secrets (DB password, `BETTER_AUTH_SECRET`).

Each `.env` has a `[managed]` block (DB URL, auth secret, broker/PKI wiring) and a
"yours to edit" block (SMTP creds, ports, public URLs):

- **`--fresh`** (default; recreates the data volume): the managed secrets change,
  so any existing `.env` is backed up to `.env.bak` and a clean one is written.
- **`--no-fresh`** (keeps the volume): only the managed keys are resynced; your
  edits to everything else (and any keys you added) are preserved.

Mapped dev ports: Postgres `25432`, step-ca `29000`, Redpanda `29092`, Mosquitto
device `28883` / service `28884`. Stop with `helix appliance down`.

## The environment model (no more env juggling)

On first boot `seed-env.sh` writes three files to the data volume; every unit
loads all three via `EnvironmentFile=`:

- **`secrets.env`** — generated **once**, never rotated (bound to on-disk data):
  all auth secrets, the Inngest keys, the Postgres passwords, the
  `HELIX_PACKAGE_RELEASE_TOKEN`, VAPID key.
- **`internal.env`** — regenerated every boot, fully deterministic: every
  internal service URL is `127.0.0.1` because all services share one network
  namespace. **This is the ~80% of env that used to be hand-managed.**
- **`site.env`** — the **only** file a human touches. Seeded from the mounted
  `/etc/helix/site.env` (or a placeholder): public URL/domain, storage backend
  choice, SMTP/Microsoft creds, first sysadmin. ~10 values.

To change a site value: edit `/var/lib/helix/env/site.env`, then
`systemctl restart helix-app helix-server` (or restart the container).

### Storage backend selection
`site.env` sets `STORAGE_PROVIDER` to one of **`S3` | `AZURE` | `MINIO` | `FS`**
(the appliance default is `FS`). `FS` keeps release bundles + uploads on the local
data volume (`FS_STORAGE_ROOT`, default `/var/lib/helix/storage`) — fully
self-contained, no external object store. A filesystem can't issue presigned URLs,
so the FS provider mints HMAC-signed URLs pointing at the local
`/api/internal/fs-storage` route (the signing secret is `FS_STORAGE_SIGNING_SECRET`,
falling back to `BETTER_AUTH_SECRET`). It implements the full provider contract
including the CAS primitives the release-metadata writers need. Verified
end-to-end (upload/download round-trip + concurrency-safe manifest writes).

### helix-server role split (opt-in)
`helix-server.service` runs all data-plane roles (gateway + ingest + writer) in
one process by default. To spread them across cores, set
`HELIX_SERVER_ROLES_SPLIT=1` in `site.env`: the primary unit then runs the
**gateway** role only (unchanged name/ports/health) and the conditional
`helix-server-ingest` / `helix-server-writer` units run the rest. See
`docs/07-Load-Testing.md` §7 for the measured effect (breaks the single-event-loop
wall; ~9k ev/s at 2 CPU is then CPU-bound across services).

---

## Observability (opt-in, NOT baked into the image)

The Grafana/Prometheus/Loki/Tempo/Alloy/exporter stack is the bulk of the image
size and most sites never enable it, so its **binaries are not shipped in the
image** — only the small configs + systemd units are. A sysadmin installs them
on demand onto the persistent volume (so they survive container recreation):

```bash
docker exec helix /opt/helix/bin/install-observability.sh   # one-time per volume
docker exec helix systemctl start helix-observability.target
```

Binaries land in `/var/lib/helix/observability/{bin,grafana}`; the units point
there. Re-run with `--force` to re-download (e.g. to pick up version bumps).

Grafana listens on **3001** (the cloud app owns 3000). Alloy ships the systemd
**journald** to Loki (there's no docker.sock in a single container). Tempo's OTLP
receiver is moved to **4417/4418** to avoid colliding with the otel-collector.
To send app traces, set in `site.env`:
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces`.

---

## Remote updates (built — Phase 2b)

The appliance updates via **OTA zip bundles**, never image re-pulls. The whole
cloud-app suite ships as ONE versioned release (all app bundles + a minimum
base-image requirement), tracked in an object-storage manifest
(`appliance-releases/manifest.json`, CAS-updated — no DB table).

**Versioning model** (`appliance-version-state.ts`):

- The running container bakes `/opt/helix/BASE_IMAGE_VERSION` (an integer).
- `install-bundles.sh` writes `/var/lib/helix/state/release.json` — the
  installed release version + per-app versions + the base version at install.
- Each release declares `minBaseImageVersion`. The cloud app compares it to the
  running base to decide: **hot-upgradeable** (app-only, applied in place) vs
  **base-upgrade-required** (binaries/deps changed — needs a new image).

**Publish** (`scripts/publish-appliance-release.sh`): builds the bundles,
sha256s each, uploads them, and CAS-merges the release into the manifest via the
token-authed release API. This must target a **standalone** cloud (the publish
routes are 403'd on a combined appliance, which only consumes releases). A
`--direct-fs <root>` mode writes straight to an FS storage root for local tests.

**Apply** — the flow when a sysadmin opens **Updates** (`/updates`, combined
mode only) and clicks *Update now*:

1. `appliance.triggerUpgrade` POSTs the target version to the root
   **update-agent** (`cloud/appliance/bin/update-agent.mjs`, a systemd unit on
   `127.0.0.1:9787`). The cloud app runs unprivileged and can't restart itself.
2. The agent (root) reads the manifest from the local cloud API, then for each
   app bundle: presigns a download, fetches it, and **sha256-verifies** it into
   a temp dir before touching the live tree.
3. It calls `install-bundles.sh <zip>` per bundle (atomic `current` symlink
   swap, writes `release.json`), re-runs migrations (`systemctl restart
   helix-bootstrap`), then restarts the app units. Rollback = flip the symlink
   back (the last 3 versions are kept).
4. Progress streams to `/var/lib/helix/state/upgrade-status.json`, which
   `appliance.upgradeProgress` reads — so the Updates page polls live progress
   even across the cloud app's own restart mid-upgrade.

A **base-upgrade** is intentionally NOT automated (the in-container agent can't
replace its own base). The Updates page surfaces the exact `docker pull` +
recreate steps for the operator; the data volume is preserved.

`HELIX_DEPLOYMENT_MODE=standalone` (the default for the compose deployment)
hides the Updates page — the same cloud app image behaves correctly in both.

---

## Known gotchas / things to resolve in the build-test loop

- **First build is a real loop.** The Dockerfile pins binary versions and
  download URLs; some will need fixups (arch suffixes, redpanda apt token,
  smallstep tarball layout). Build iteratively and watch each download step.
- **`NEXT_PUBLIC_*` are build-inlined.** The cloud-app client bundle bakes
  `PUBLIC_APP_URL` at host-build time. For a per-site public URL either build the
  cloud-app bundle with the right value, or rely on the app's runtime-config
  path. `seed-env.sh` sets the runtime copies but cannot change the client bundle.
- **Mosquitto AppArmor.** The host's path-based `mosquitto` AppArmor profile
  auto-attaches to `/usr/sbin/mosquitto` on exec (even when privileged) and
  confines it to `/etc/mosquitto` only. The image runs a copy at
  `/usr/local/sbin/helix-mosquitto` to dodge the profile. (The custom
  `mosquitto_acl_file.so` plugin is gone — replaced by native `acl_file`, since
  the .acl files were already native syntax; see `cloud/appliance/mosquitto.acl`.)
- **Port collisions** were resolved for grafana (3001) and tempo OTLP (4417/4418);
  re-check if you add services.
- **TURN/coturn** needs host networking or explicit port maps to relay; its unit
  is installed but disabled by default.
- **systemd-in-container** needs cgroup access + `SYS_ADMIN` (or `--privileged`).
  Hardened hosts may refuse it — Podman is friendlier.
- **`--privileged` shares the host `/dev` — mask the device-grabbing units.**
  `--privileged` (required so the container's systemd can manage its cgroup) also
  bind-mounts the host's *entire* `/dev` into the container: `/dev/tty1-6`,
  `/dev/dri` (GPU), `/dev/input`, `/dev/rfkill`. Left to its defaults the
  container's systemd starts `getty@tty1-6` on the host's virtual terminals and
  (if pulled in) `systemd-logind`, which does seat/DRM management — so on a
  desktop host the appliance **steals the VT / DRM master from the running
  compositor and logs the user out of their GUI session** (distinct from the
  cgroup-teardown trap above; `--cgroupns=private` does not prevent it). The
  headless appliance needs none of these, so `systemd-units.json` **masks**
  `getty.target`, `getty@.service`, `autovt@.service`, `console-getty.service`,
  `serial-getty@.service`, and `systemd-logind.service`. Do not unmask them.
  Verify a fresh container holds no host devices: no process under
  `/proc/*/fd` should have `/dev/{tty[0-9],dri,input,fb0}` open.

---

## Roadmap

- **Phase 2a — FS storage provider:** ✅ done (see "Storage backend selection").
- **Phase 2b — update-agent + Updates UI:** ✅ done (see "Remote updates" above):
  root `update-agent.mjs` unit, `/updates` admin page, versioning + decision
  engine, and `publish-appliance-release.sh`.
- **Phase 2c — CI:** add a bundle-publish step (`publish-appliance-release.sh`)
  alongside the GHCR image build.

## Port map (inside the container)

| Service | Port |
|---|---|
| Caddy | 80, 443 |
| cloud app | 3000 |
| grafana | 3001 |
| openfga playground | 3002 |
| helix-server | 4000 (Public HTTP: WS + FS storage + cert provisioning), 4001 (device mTLS) |
| postgres | 5432 |
| redis | 6379 |
| openfga | 8080, 8081 |
| inngest | 8288, 8289 |
| mosquitto | 8883 (device), 8884 (service) |
| step-ca | 9000 |
| redpanda | 9092, 9644 |
| prometheus | 9090 · loki 3100 · tempo 3200 (OTLP 4417/4418) · alloy 12345 |
| otel-collector | 4317/4318 (ingest), 8889 (prom) |
