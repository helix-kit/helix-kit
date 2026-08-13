# Helix — Guide for Coding Agents

This document tells any coding agent (Claude, Codex, or otherwise) how to work in
this repository: what Helix is, the principles every change must respect, where
things live, and how to build, run, test, and document your work. Read it before
making changes, and prefer the conventions here over your own defaults.

---

## 1. What Helix is

Helix is an IoT management platform assembled from **reusable, independently
adoptable components**. The goal is not a single monolithic product: it is a set
of open-source libraries and SDKs that other developers install and compose to
build their own management platform.

Helix spans the full stack:

- **Embedded devices** — ESP32 (ESP-IDF) and Arduino/AVR firmware.
- **Linux edge platforms** — a minimal, purpose-built OS for Jetson Nano,
  Raspberry Pi, and x86 (`linux/platform_os`), plus the device runtime for
  Linux-class devices (`linux/device`): a single app-agnostic `helixd` core
  process (MQTT⇄IPC bridge) that apps attach to over a Unix socket, with Go and
  Python app SDKs. Adapted from a prior production cloud-comm model.
- **Cloud platform** — orchestration, provisioning, releases/OTA, event
  ingestion, and a gateway, packaged both as a multi-container stack and as a
  single self-contained appliance image.
- **Clients** — a React/Next.js web app and a native Android (Jetpack Compose)
  app.

Devices communicate over the **Helix protocol**: a transport-neutral framework
that abstracts BLE, Serial, MQTT, and WebSockets behind one typed
request/response + query/mutation surface, so the same application logic runs
over any transport, local or remote.

---

## 2. Core principles

These are non-negotiable. When a change conflicts with one of them, stop and
raise it with the user rather than working around it.

### 2.1 Build reusable pieces, not hardcoded paths

Treat everything you write as a library or SDK that an external developer will
consume — not as glue for one specific deployment. Before implementing, ask:

- How will this be **reused** by someone building their own platform?
- How is it an **optional, pluggable** feature rather than a locked-in choice or
  a choice removed entirely?

The codebase already models this split; follow the same pattern:

- **Embedded** — `embedded/esp32/protocol` is the transport-abstracting core
  (packet + dispatch + endpoint + transports, and *nothing else* — it owns no
  Wi-Fi, provisioning, credentials, OTA, or app services). Application services
  (`file`, `db`, OTA, provisioning, storage sinks) are layered on top in
  `embedded/esp32/platform`. New transports implement the `helix_transport`
  seam; new services register with the dispatcher.
- **Web** — all *core* backend capability (DB, tRPC routers, storage providers,
  PKI, event queue, MQTT bridge, releases/OTA) lives in the `@helix-hq/backend`
  package (`web/packages/helix-backend`). The apps (`web/apps/helix`,
  `web/apps/helix-server`) are thin wiring that imports and composes it.
  **Non-core features live in their own package**, holding both their backend
  (drizzle schema + tRPC routers) and their frontend, so an adopter who does not
  want a feature simply does not install it — `@helix-hq/blog` (`web/packages/blog`)
  is the reference shape. Such a package never imports the host's `AppRouter`:
  it declares the mount keys its routers must be composed under, and its client
  components resolve them back out through the shared feature context in
  `@helix-hq/web-core` (`web/packages/web-core`), which also owns the router-agnostic
  React/tRPC scaffolding (query client, links, RSC `fetchQuery`). Feature tables
  reach the database through `createDb`'s `extraSchema` option rather than core's
  own schema. See `web/packages/blog/README.md` for the wiring contract.
- **Android** — protocol/service/transport concerns are separated by package
  (`dev.helix.protocol.core`, `.protocol.service`, `.transport.ble`,
  `.transport.mqtt`) inside the reusable `:helix` SDK module, mirroring the web
  packages; the `:app` module is the consumer.

If new functionality can plug into existing seams without an ad-hoc side channel,
that is always the correct approach.

### 2.2 No duplication

If logic can be extracted into a common lib or helper, do it immediately rather
than copying it. Shared code already lives in `tooling/common`, `@helix-hq/backend`,
the `:helix` SDK, and the symlinked `HelixProtocol` library that lets the Arduino
firmware reuse the ESP32 protocol core verbatim. Add value with every change; do
not restate what already exists.

### 2.3 No legacy or compatibility paths

Helix is **unreleased and not deployed anywhere**. Do not design fallback paths,
shims, or backward-compatibility layers for old behavior. If a change — including
a fundamental protocol change — would break existing code, delete the old code
and reimplement cleanly. When such a rewrite is warranted, present it to the user
as an explicit option before proceeding, so obsolete code can be removed properly.

### 2.4 Investigate, don't shortcut

Understand the architecture before changing it. Do not take shortcuts or bolt on
ad-hoc side channels. Do not add unnecessary comments that bloat the code — match
the surrounding code's comment density and idiom, and comment only where the code
cannot speak for itself.

### 2.5 Escalate before falling back

If you cannot do what was asked — a blocker, a missing capability, an unexpected
challenge — **call out to the user before deciding on a fallback**. Do not
silently substitute a lesser approach. Surface the obstacle and the options, then
let the user choose.

---

## 3. Repository map

| Path | What it is |
| --- | --- |
| `embedded/esp32/` | ESP-IDF firmware. `protocol/` (transport-abstracting core), `platform/` (services on top), `core/` (firmware project, apps, partitions, sdkconfig), `flashdb/` (vendored KVDB), `docker/` (build image), `commands/` (CLI). |
| `embedded/arduino/` | Arduino/AVR firmware. Reuses the ESP32 protocol core via symlinks in `libraries/HelixProtocol`; patched FreeRTOS for `qemu-system-avr`; `commands/` (CLI). |
| `linux/platform_os/` | Minimal Helix Linux OS image build (debootstrap → rootfs → disk/ISO → QEMU). |
| `linux/device/` | Linux device runtime (adapted from a prior production cloud-comm model). `go/` — the single `helixd` core (`cmd/helixd`: MQTT⇄IPC bridge, app-agnostic), the Go app SDK (`internal/ipc` client, `internal/shared/{servicemain,ipcutil,config}`), apps (`cmd/helix-*`), and the bytestream data-plane package. `python/helix_service_runtime` — the thin Python IPC SDK (contracts only, no core reimplementation). |
| `ui/` | Common device UI (LVGL). Screens are pure LVGL and portable; a display seam (`helix_ui_display_t`) decides where pixels go — today a streaming driver that ships them to a host viewer (`helix ui sim`), tomorrow an SPI panel or a Linux framebuffer. Ships the ESP32 port and the `ui` service (`info`/`refresh`/`pointer`). Opt-in: only a build carrying the `ui` feature compiles it, so no other firmware pays for LVGL. |
| `web/` | pnpm + Turborepo monorepo. `packages/helix-backend` (`@helix-hq/backend`, the backend core), `packages/protocol` (`@helix-hq/protocol` — packet core, service contracts, HelixStream, WebRTC peer, and the BLE/MQTT/serial/WebSocket transports), `packages/web-core` (`@helix-hq/web-core` — router-agnostic React/tRPC scaffolding shared by the app and every feature package), `packages/blog` (`@helix-hq/blog` — an optional feature package owning its own schema, routers, and UI), `packages/helix-design-system`, `apps/helix` (ONE Next.js app: marketing site, fumadocs `/docs`, blog, and the `/admin` + `/device` console), `apps/helix-server` (headless backend), `e2e/` (Playwright hardware-in-the-loop). |
| `android/` | Native Kotlin/Compose. `:helix` SDK module (protocol/service/transport packages) + `:app`. BLE-first. |
| `cloud/` | Cloud infra: `appliance/` (single-image stack), `build-service/` (on-demand firmware builds), `mosquitto/`, `coturn/`, `observability/`, and the multi-container `docker-compose.yml`. |
| `tooling/` | The `helix` Python CLI (see §4): `device`, `protocol`, `appliance`, `e2e`, `loadtest`, `release`, `common`. |
| `tests/e2e/` | Python end-to-end test suite (pytest) with appliance + QEMU + browser harnesses. |
| `docs/` | Numbered design/research documents (see §7). |

---

## 4. Developer tooling: the `helix` CLI

There is **one developer entry point**: the uv-based `helix` CLI
(`tooling/cli.py`, exposed as `helix = "tooling.cli:cli"`). An end developer
working on Helix should never need to learn another CLI or run one-off bash
scripts. This is a hard rule:

- Everything a developer does routinely goes through `helix ...`.
- Do **not** ask the user to run stray shell scripts. If a task needs another
  language or an external tool, wrap it in a thin `helix` subcommand that shells
  out (as the ESP32 commands re-exec into Docker, and the Arduino commands drive
  `arduino-cli`/`qemu-system-avr`). Keep tooling maintainable in one place.

Run commands with `uv run helix ...`. In lean environments without the optional
extras (e.g. the ESP-IDF build image, which only needs the `embedded` group),
use `python -m tooling.cli ...`; the CLI skips command groups whose dependencies
are absent rather than failing.

Command groups:

| Command | Purpose |
| --- | --- |
| `helix embedded esp32` | ESP32 firmware: `link` (build final image), `prebuild` (component archives), `apps`/`select` (dynamic app selection), `analyze` (size), `flash`, `qemu`, `qemu-test`, `vscode`. Note: the build verb is `link`, not `build`. |
| `helix embedded arduino` | Arduino/AVR firmware: `build`, `run` (QEMU), `flash`, `smoke`, `test`. |
| `helix device` | Send Helix requests to devices: `ble` (`scan`/`request`), `serial request`, `mqtt request`, `latency`. Plus `console` (`open`/`ports`) — a raw interactive UART session for board bring-up that auto-detects the USB bridge and reconnects across device resets. |
| `helix protocol` | Contract tooling: `validate`, `generate --target {ts,py,go,cpp,embedded-c}`, `generate-all`. |
| `helix ui` | Common device UI (LVGL): `build` (the `ui_demo` firmware for QEMU), `sim` (boot it and show the device's screen in a window; clicks go back as pointer events), `shot` (headless PNG capture). |
| `helix appliance` | Appliance container: `build`, `up`, `down`, `psql`, `bundles`, and `remote` (run the web apps locally against a LIVE appliance — SSH-tunnels its loopback services and generates the `.env` from the box). |
| `helix e2e` | End-to-end tests: `run` (pytest-backed appliance suite), `browser` (Playwright HIL). |
| `helix loadtest` | Ingestion/routing load tests: `run`, `ramp`, `route`, `route-ramp`, `mixed`. |
| `helix release` | Release/OTA control plane: `sim-ci-esp32`, `custom-build`, `build-firmware`, `trigger-ota`, `emit-seed-sql`. |
| `helix os` | Linux platform OS: `rootfs {build,clean,size,qemu}`. |
| `helix android` | Android SDK/app maintenance: `deps` (check the Gradle version catalog for newer library/plugin releases, `--apply` to write them back — the Android analogue of `pnpm update:check`). |
| `helix reports` | Repository metric reports: `cloc` (line counts), `cli-docs` (auto-generated CLI reference for every command). Output goes to `reports/`. |
| `helix lint` | The repo-wide quality gate: `go` (gofmt, vet, staticcheck, shadow, deadcode, gopls, dupl, govulncheck), `python` (ruff, black, mypy — root *and* device scopes), `web` (eslint + tsc via Turbo), `all`. `--fix` applies every auto-fix. |

Web and Android have their own native toolchains (pnpm/Turbo and Gradle
respectively) — those are the idiomatic entry points for those subtrees, not
replacements for `helix` on the Python/embedded/cloud side.

---

## 5. Build and run in Docker

Anything that touches the host machine should run in Docker. This keeps builds
reproducible and lets a developer bring up the whole cloud stack with a single
image.

- **ESP32 builds happen only in Docker.** The `helix embedded esp32` commands
  re-exec themselves inside `helix/esp-idf:release-v5.4-lean`
  (`embedded/esp32/docker/esp-idf-lean.Dockerfile`). A local ESP-IDF install
  exists **only** for editor bindings (`helix embedded esp32 vscode`); real
  builds, QEMU runs, and tests go through the container.
- **The cloud stack ships as one appliance image.** `cloud/appliance` packages
  the ~25-service cloud stack (Postgres, MQTT, step-ca PKI, Redpanda/Kafka,
  Inngest, OpenFGA, observability, helix-server, …) as systemd units inside a
  single container. Bring it up with `helix appliance up`; app code ships as
  versioned bundles, not baked into OS layers, and all state lives on one
  disposable volume.

### Web development against the appliance

The appliance is the backing infra for local web development — Postgres, MQTT,
PKI, event queue. Unless the user says otherwise, this is the required flow.

**Fresh clone — build once, then start.** In HOST mode (the default), `up`
exports the mTLS PKI and **writes each web app's `.env`**
(`web/apps/{helix,helix-server}/.env`) wired to the appliance's mapped
ports, then applies the drizzle migrations. Those `.env` files are what let the
web app connect — do not hand-write them.

```sh
helix appliance build      # or: helix appliance up --build  (builds if the image is missing)
helix appliance up
```

**Before starting the appliance, check what's already there — never blindly
recreate it.** Recreating wipes real state.

- *Already running?* `docker ps --filter name=helix-e2e`. Expect the mapped
  loopback ports: postgres `25432`, step-ca `29000`, redpanda `29092`,
  mosquitto `28883`/`28884`. If it is up with those ports, **reuse it — do
  nothing.** (`helix appliance up --no-fresh` is also a safe no-op when it is
  already running.)
- *Stopped container present?* `docker ps -a --filter name=helix-e2e`. Resume it
  in place with `docker start helix-e2e` — this reuses the container and its
  data.
- *Only the data volume remains* (container removed via `helix appliance down
  --keep`)? `docker volume ls | grep helix-e2e-data`, then
  `helix appliance up --no-fresh` — this recreates the container against the
  preserved volume instead of purging it.
- The default `helix appliance up` is `--fresh`, which **purges the container
  and the `helix-e2e-data` volume** (database, PKI, seeded state — all gone).
  Only use it for a genuinely clean start; otherwise reuse via one of the paths
  above.

**Never stop or tear down the appliance** (`helix appliance down`, `docker
stop`/`rm`) unless the user explicitly asks. Leave it running across sessions —
other work, and other parallel agents, may depend on it. If asked to bring it
down, prefer `--keep` (preserve the volume) unless told to wipe it.

**Start the core Next.js app** — only the `helix` app, not the whole monorepo,
and with the required heap cap (it OOMs under Turbopack dev without it):

```sh
cd web/apps/helix
NODE_OPTIONS=--max-old-space-size=2048 pnpm run dev
```

It serves at `http://localhost:3000`. Confirm `web/apps/helix/.env` exists first;
if it is missing, the appliance has not provisioned it yet — run
`helix appliance up` (per the checks above).

**helix-server is usually not needed.** It handles device communication (the
MQTT bridge, mTLS ingestion, PKI, releases/OTA); day-to-day website/UI work does
not require it. When you do need it, run it on the host the same way against the
same appliance — `cd web/apps/helix-server && pnpm run dev` — using the `.env`
provisioned alongside the others.

---

## 6. Testing

Every new feature needs **both unit tests and full end-to-end tests**, so that
later changes can be verified against them. When working on anything non-trivial,
write a **reusable test harness or reproduction script** rather than running
arbitrary one-off commands — reproducibility is the point.

- Python/appliance e2e lives in `tests/e2e/` and runs via `helix e2e run`
  (which sets the mode/keep/build env and invokes `pytest tests/e2e`). Shared
  harnesses: `conftest.py` (appliance boot + mTLS provisioning fixtures),
  `_gateway.py` (WS↔MQTT gateway + simulated device), `_events.py` (MQTT/HTTP
  ingestion helpers).
- Embedded is exercised in emulation without hardware: `helix embedded esp32
  qemu-test` (file transfer + on-device DB over serial in `qemu-system-xtensa`)
  and `helix embedded arduino test` (`qemu-system-avr`). The reusable, click-free
  drivers are `embedded/*/commands/simulator.py`.
- Browser transports are tested against real hardware via Playwright
  (`web/e2e/`, `helix e2e browser`).
- Load and routing behavior has its own harness under `helix loadtest`.

Prefer extending these harnesses over inventing parallel ones.

---

## 7. Documentation

Findings from research and any non-trivial investigation get written up as a new
document in `docs/`. Follow the existing convention: sequentially **numbered
files** `NN-Kebab-Title.md`, opening with a top-level `#` heading and (for
reports) a `Date:` line. Existing docs run `01-Plan.md` through
`08-File-Transfer-and-Storage.md`; new work adds the next number. Documentation
files carry the `CC-BY-SA-4.0` SPDX header (see §8), not the code license.

**Keep docs in sync with code.** When you change something that a doc describes —
a command, a wire format, a config key, a file path, an architectural boundary —
update every doc that references it in the same change. A doc that describes code
that no longer exists is worse than no doc.

---

## 8. Code quality and licensing

**Verify behavior before you polish.** While a feature is work-in-progress and
still needs live testing, do **not** burn cycles on lint/format/typecheck. Get it
running and proven in a live environment first — running the tooling repeatedly on
code that then fails when actually executed is wasted effort. Once the feature is
tested and confirmed working end-to-end, run the quality tooling below to finish
it off.

**One gate for every language: `helix lint`.** Rather than remembering each
toolchain, run the gate — `helix lint all`, or a single language with
`helix lint {go,python,web}`. `--fix` applies every available auto-fix
(`gofmt -w`, `ruff --fix`, `black`, `eslint --fix`). `helix lint go --skip <check>`
drops an individual check.

- **Go:** `gofmt`, `go vet`, **staticcheck** (plus ST1000 package comments),
  **shadow**, **deadcode**, **gopls check**, **dupl** (clone detection) and
  **govulncheck** — the same suite a prior production device tree uses. The analyzers are
  version-pinned and installed on first use into `linux/device/go/.bin` (gitignored),
  so the suite is reproducible with no global installs. Generated contract packages
  (`internal/*/generated`) are excluded from the style/dead-code checks. Keep
  `govulncheck` clean: it gates real CVEs, and the fix is usually
  `go get <mod>@<fixed>` or bumping the `toolchain` directive in `go.mod`.
- **Python style:** `line-length = 100`, strict typing. Two scopes, because they
  target different interpreters:
  - the repo's dev tooling (`tooling/`, `embedded/`, `cloud/`, `tests/`) targets
    **3.14**, configured in `pyproject.toml` (ruff + black + mypy strict);
  - the device packages (`linux/device/python/`) target **CPython 3.10** and have
    their own `ruff.toml` / `black.toml` / `mypy.ini`. This is not incidental: under
    the root's `py314` target, ruff and black rewrite `except (A, B):` into
    `except A, B:` (PEP 758), which is a **SyntaxError on the device**. Never lint or
    format that tree with the root config — `helix lint python` runs both correctly.

  Tests and `experimental/` are still checked for real errors but are not required to
  carry full annotations; generated bindings and build artifacts (notably the
  debootstrapped rootfs under `cloud/ami/artifacts`) are excluded outright.
- **Web style:** each package exposes `lint` (`eslint --max-warnings=0 .`) and
  `typecheck` (`tsc --noEmit`); run them via Turbo from `web/`
  (`pnpm lint`, `pnpm typecheck`, `pnpm build`) or per-package — or just
  `helix lint web`. Before building UI or backend routers in the Next.js app, follow
  the **`nextjs-web-app` skill** (`.claude/skills/nextjs-web-app/`): tRPC router
  factories, server-first data fetching, server/client boundaries, nuqs query params,
  and the design-system `DataTable`.
- **Android:** the Gradle daemon is pinned to a Temurin **JDK 21** toolchain
  (`android/gradle.properties`, `org.gradle.java.home`) because AGP cannot run on
  the system's newer JVM; adjust that path per machine. Code compiles to JVM 17.
  Build/test with `./gradlew :helix:testDebugUnitTest`, `./gradlew :app:assembleDebug`.
- **Publishing an npm package:** the five `@helix-hq` packages are released with
  **Changesets**. Any change to one needs `pnpm changeset` committed alongside it —
  that file is what produces the version bump and the `CHANGELOG.md` entry. Two gates
  run on every push and again at release: `pnpm api:check` (an api-extractor report
  per published entry point, in `packages/*/etc/*.api.md` — a diff there *is* the
  semver signal, so run `pnpm api:update` and review it after an intentional API
  change) and `pnpm publint` (publint + are-the-types-wrong against a real `pnpm pack`
  tarball, since the workspace `exports` resolve to `src` and only the tarball
  exercises `dist`). Releasing is deliberate and never happens on push:
  `gh workflow run release.yml`. Internal deps use `workspace:^`, never
  `workspace:*` — the latter publishes as an exact pin. Full write-up:
  `docs/21-Release-Engineering.md`.
- **Licensing:** code is `AGPL-3.0-only`; docs and media are `CC-BY-SA-4.0`.
  Every file carries the appropriate SPDX identifier, tracked via REUSE
  (`.reuse/dep5`). Do not replace a third-party license with the Helix license,
  and update `NOTICE` when attribution is required. CI enforces this
  (`.github/workflows/license-compliance.yml`).

---

## 9. Working discipline (git, commits, memory)

### 9.1 Work directly on `main` in `~/code/helix`

We own this repo, so we do not pay the cost of a contribution workflow designed for
strangers. There is **one checkout — `~/code/helix` — and it stays on `main`.**

- **No feature branches. No worktrees. No pull requests.** Edit `main` in place and
  push. Branch-per-change, PR-per-change, and the review/merge round-trip were dropped
  deliberately: the mechanics (conflict resolution, waiting on merges, worktree
  bookkeeping) cost more than they returned for the repo owner.
- **Do not create worktrees or branches** unless the user explicitly asks. If you think
  a change genuinely needs isolation — a risky migration you may want to abandon, or
  two conflicting changes in flight at once — raise it with the user (§2.5) rather than
  branching unilaterally.
- **One change at a time.** With everything on one branch there is no isolation to fall
  back on, so keep the working tree focused: finish and push a change before starting
  the next, and only edit files that belong to the change you are on.

The PR flow still exists — for **external contributors**. They fork, open a PR, and the
`linear-id` check runs on the PR title. That path is enforced for everyone except the
owner's admin account (§9.2), so leave it in place.

### 9.2 Commit signed off as Hardik Jain; push straight to `main`

- **Push directly to `main`.** `git push origin main`. Two GitHub rulesets remain on
  `helix-kit/helix-kit`, and neither slows down normal work:
  - **`main: no force-push`** — `non_fast_forward`, no bypass actors, so a stray
    `push --force` cannot rewrite shared history. This one applies to everybody.
  - **`main: PR required for non-owners`** — the `pull_request` rule plus the `linear-id`
    required check, with the repo `admin` role as a bypass actor. Hardik's account pushes
    straight through; outside contributors still open PRs.
- **Sign off every commit as Hardik Jain** with `git commit -s` (the repo git identity
  is `Hardik Jain <jainhardik120@gmail.com>`). Commits are the user's work — **do not
  attribute them to Claude, Codex, or any agent**: no agent `Co-Authored-By` and no
  agent sign-off trailer.
- **Put the `HELIX-<id>` in every commit message.** `HELIX-123: <summary>` as the subject
  is the convention; a `Refs: HELIX-123` trailer also works.

  ⚠️ **On direct pushes this is enforced only by the local `commit-msg` hook**
  (`.githooks/commit-msg`, activated per clone with
  `git config core.hooksPath .githooks`). It is preventive but *bypassable* — a
  `--no-verify`, or a clone that never set `core.hooksPath`, sails past it. GitHub cannot
  close that gap here: `commit_message_pattern` rules are silently inert on the org's free
  plan (verified — the API accepts the rule and reports it active, but it never
  evaluates, while `non_fast_forward` on the same repo rejects correctly), and there are
  no pre-receive hooks outside Enterprise Server. So **treat the id as your discipline,
  not the server's** — the only path with a real server-side gate is the contributor PR
  flow, where the `linear-id` check reads the PR title.
- **Ask before committing.** Agents do not commit or push on their own. Leave the change
  in the working tree, tell the user what is ready, and commit only when they say so.
  Direct-to-`main` removes the PR gate, which makes this rule *more* important, not
  less: nothing reviews what you push except the user.
- **Pushing `main` deploys.** `.github/workflows/build-deploy.yml` runs on every push to
  `main` and ships the web bundles to the live box. Treat a push as a release: the
  change should be verified (§8) before it goes out.

### 9.3 Maintain your memory files

Whatever agent you are (Claude, Codex, …), keep your persistent memory current:
update existing memory entries as facts change, and delete stale ones rather than
letting them accumulate. Outdated memory that names a file, command, or flag that
has since changed is actively misleading — treat memory hygiene as part of the
work, not an afterthought.

### 9.4 Track all work in Linear

Helix progress is tracked in **Linear** (the `linear` MCP server) so nothing is
half-done-and-forgotten. This is a **hard gate, not optional**: opening (or locating)
the issue and moving it to `In Progress` is the **first action of every substantive
task** — you may not write/edit code, run a fix, provision infra, change prod, or
deploy until it exists. Then you record progress **as you go**, in the same turn as
the work — never batched at the end, never "later". **There is no urgency or size
exemption:** an urgent breakage, a "quick hotfix", or a one-line fix all require the
issue first (urgent prod fixes are precisely the work that most needs a trail). If you
find yourself thinking "I'll log it after I fix this," that is the failure mode — log
it now. Skipping preflight on one task means the follow-on tasks have no in-progress
issue to update, so a whole session goes untracked.

Track each change **end to end (0 → 100)**: `In Progress` before the first edit, an
activity-log comment at every meaningful step, and `Done` only once it is pushed and
verified. Every commit carries the issue id (§9.2) — with no branch or PR named for the
issue, **the commit trail and the activity log are the only record**, so keep both
honest. (`In Review` now means only what it says: work parked for the user to look at.)

**Capture every session for the next one.** At the end of each work session — and whenever
you pause a task mid-flight — append a handoff comment to the issue with the raw command
logs, screenshots, evidence/artifacts, current state, decisions, and next steps, attaching
screenshots/log files as Linear attachments. A later session (often a different agent) must
be able to resume from the issue alone; nothing done in the session may live only in the
chat transcript.

Follow the **`linear-tracking` skill** (`.claude/skills/linear-tracking/`) **before**
starting any task and **after** every accomplishment. It tells you how to confirm
tracking is live, find or open the right issue under the correct epic (find before
create), keep status honest (`In Progress` → `Done`-only-when-verified), and append a
per-issue activity-log comment on every status change or meaningful step.
