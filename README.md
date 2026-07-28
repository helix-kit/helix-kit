# Helix

Helix is an IoT management platform assembled from **reusable, independently
adoptable components** — a set of open-source libraries and SDKs that developers
install and compose to build their own management platform, rather than a single
monolithic product.

Helix spans the full stack:

- **Embedded devices** — ESP32 (ESP-IDF) and Arduino/AVR firmware.
- **Linux edge platforms** — a minimal, purpose-built OS plus protocol reference
  implementations (Go, Python).
- **Cloud platform** — orchestration, provisioning, releases/OTA, event
  ingestion, and a gateway, packaged as a multi-container stack and as a
  single self-contained appliance image.
- **Clients** — a React/Next.js web app and a native Android (Jetpack Compose) app.

Devices communicate over the **Helix protocol**: a transport-neutral framework
that abstracts BLE, Serial, MQTT, and WebSockets behind one typed
request/response + query/mutation surface, so the same application logic runs
over any transport, local or remote.

## Repository layout

| Path | What it is |
| --- | --- |
| `embedded/` | ESP32 (ESP-IDF) and Arduino/AVR firmware; the transport-abstracting protocol core + services on top. |
| `linux/` | Minimal Helix Linux OS image build + protocol reference implementations (Go, Python). |
| `web/` | pnpm + Turborepo monorepo: `@helix/backend` core, protocol/transport packages, `apps/helix` (ONE Next.js app: public site + docs + blog + console), `apps/helix-server` (headless backend). |
| `android/` | Native Kotlin/Compose `:helix` SDK + `:app`. |
| `cloud/` | Cloud infra: the single-image `appliance/`, build service, and the multi-container stack. |
| `tooling/` | The `helix` Python CLI — the one developer entry point. |
| `tests/` | Python unit + end-to-end suites. |
| `docs/` | Numbered design/research documents. |

## Prerequisites

- **Docker** — all host-touching builds and the cloud stack run in containers.
- **[uv](https://docs.astral.sh/uv/)** — runs the `helix` Python CLI (`uv run helix ...`).
- **[pnpm](https://pnpm.io/)** + **Node 24** — the web monorepo toolchain.

Android and the embedded/Linux subtrees have their own toolchains — see
[`CLAUDE.md`](CLAUDE.md) for the full developer guide.

## Getting started (web + cloud)

The appliance image houses every backend dependency (Postgres, OpenFGA, Inngest,
Redis, Redpanda, Mosquitto, step-ca), so you run the web apps on your host against
the container's services — no local database or broker needed.

```bash
# 1. Install web dependencies.
cd web && pnpm install && cd ..

# 2. Build the appliance image (once; needs Docker).
uv run helix appliance build

# 3. Boot the backend. This maps the service ports to localhost, runs the
#    database migrations, exports the mTLS PKI, and generates a `.env` for
#    apps/helix and apps/helix-server wired to the container.
uv run helix appliance up

# 4. Start the host apps: helix :3000 (site + docs + blog + console), helix-server.
cd web && pnpm dev
```

`helix appliance up` (default `--fresh`) recreates the data volume and writes fresh
`.env` files, backing up any existing one to `.env.bak`. Use `--no-fresh` to keep
your data and env — it resyncs only the appliance-managed keys and preserves your
edits (SMTP creds, ports, etc.). Stop with `uv run helix appliance down`.

No admin user is seeded. Sign up at http://localhost:3000, then grant yourself the
sysadmin role:

```bash
uv run helix appliance psql "UPDATE \"user\" SET role='sysadmin' WHERE email='you@example.com'"
```

See the appliance [README](cloud/appliance/README.md) for the environment model,
storage/role options, and observability.

## Developer tooling

There is one developer entry point — the `helix` CLI (`uv run helix ...`), covering
embedded firmware, device requests, protocol contracts, the appliance, e2e tests,
load tests, releases/OTA, and the Linux OS. Run `uv run helix --help` for the
command groups. Web and Android use their native toolchains (pnpm/Turbo, Gradle).

## Contributing & licensing

- Read [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) before making changes —
  they define the architecture principles every change must respect.
- Contribution process: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Code is `AGPL-3.0-only`; docs and media are `CC-BY-SA-4.0`. Licensing details:
  [`LICENSING.md`](LICENSING.md).
