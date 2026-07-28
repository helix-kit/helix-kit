# Helix Port Forwarding (experimental)

Codespaces / Cloudflare-Tunnel-style port forwarding on our own infra. A Linux
device forwards a local HTTP port to the cloud so a user anywhere can open
`https://<session>.port.helix-kit.com/` in a browser and reach it — with the
device exposing **zero inbound ports**.

> Experimental slice. Auth, device identity, DB persistence, session expiry,
> RBAC, audit, and the service allowlist are intentionally **skipped** here —
> this proves the core tunneling only. See "Next steps".

## Result

Verified end-to-end: a Python web app in a container on a laptop (no published
ports) was reached from an off-network client via
`https://demo.port.helix-kit.com/`, ~137 ms total latency (≈40 ms of which is
just the TLS RTT to the Mumbai EC2 box).

## Architecture

```
  Browser (anywhere)
    │  HTTPS / WSS      https://<session>.port.helix-kit.com
    ▼
  Caddy on EC2         wildcard TLS (*.port.helix-kit.com, Cloudflare DNS-01)
    │  HTTP/1.1 + Upgrade, flush_interval -1
    ▼
  Gateway (Node/TS)    routes by Host header → owning agent
    │  one persistent WebSocket per agent, binary-framed multiplex
    ▼  (outbound-initiated by the device — no inbound ports)
  Agent (Go) on device
    │  net.Dial 127.0.0.1:<port>
    ▼
  Local service (e.g. Python http server)
```

The device dials the gateway **outbound** at
`wss://connect.port.helix-kit.com/__tunnel__` and registers a session id. Every
browser connection for that session is multiplexed as a logical stream over the
single agent WebSocket. HTTP responses are streamed (never fully buffered);
WebSocket upgrades are passed through as a raw byte pipe.

## Wire protocol

One binary frame per WebSocket message, kept byte-compatible between
`gateway/src/protocol.ts` and `agent/protocol.go`:

```
  byte 0      frame type
  bytes 1..4  stream id (uint32 big-endian; 0 = control)
  bytes 5..N  payload (raw bytes, or JSON for *_HEAD / control frames)
```

| Type          | Dir        | Payload                              |
|---------------|------------|--------------------------------------|
| `REGISTER`    | dev → gw   | JSON `{sessionId, target}`           |
| `REGISTER_ACK`| gw → dev   | JSON `{ok, host, error}`             |
| `REQ_HEAD`    | gw → dev   | JSON `{method, url, headers}`        |
| `REQ_DATA`    | gw → dev   | raw request-body bytes               |
| `REQ_END`     | gw → dev   | —                                    |
| `RES_HEAD`    | dev → gw   | JSON `{status, headers}`             |
| `RES_DATA`    | dev → gw   | raw response-body bytes              |
| `RES_END`     | dev → gw   | —                                    |
| `ABORT`       | either     | JSON `{error}`                       |
| `WS_OPEN`     | gw → dev   | raw HTTP upgrade request head        |
| `WS_ACK`      | dev → gw   | raw HTTP `101` response head         |
| `WS_DATA`     | either     | raw bytes                            |
| `WS_CLOSE`    | either     | —                                    |

Hop-by-hop headers are stripped at both ends.

## Layout

```
gateway/    Node + TypeScript cloud gateway (behind Caddy)
agent/      Go device agent (outbound tunnel + local dialer)
deploy/     EC2 docker-compose (caddy + gateway) and Caddyfile
localtest/  Single container: Python app + agent (the acceptance test)
```

## Deploy the gateway (EC2)

Caddy TLS-terminates `*.port.helix-kit.com` via Cloudflare DNS-01 and reverse
proxies to the gateway. `caddy_data` / `caddy_config` are declared `external` in
compose to reuse the already-issued wildcard cert (avoids ACME rate limits).

```bash
# on the EC2 box, in deploy/ with a .env holding CLOUDFLARE_API_TOKEN
docker compose --env-file .env up -d --build
```

The gateway has no host ports; only Caddy publishes 80/443.

## Run the device side (acceptance test)

One container runs the Python app **and** the agent — the device publishes
nothing inbound:

```bash
# from experimental/port-forwarding/
docker build -f localtest/Dockerfile -t helix-localtest .
docker run -d --name helix-localtest -e SESSION_ID=demo helix-localtest
# → open https://demo.port.helix-kit.com/
```

Env knobs: `SESSION_ID` (subdomain), `APP_PORT` (local port), `GATEWAY_URL`.

Run the agent standalone against any local service:

```bash
go run ./agent -session demo -target 127.0.0.1:3000
```

## Known limitations (MVP)

- **No auth / no allowlist.** Anyone who knows a live session id can reach it,
  and the agent forwards to any `-target`. This is the biggest gap vs. the
  design in `01-chat.md` / `02-chat.md`.
- **Session ids are self-asserted** by the agent (no DB, no expiry). Last
  writer for a given id wins.
- **Head-of-line blocking.** One WebSocket per agent with a shared write
  channel; a single slow browser stream can back-pressure others. Request
  bodies are written on the read loop, so a slow local reader can stall the
  agent. Fine for browsing web UIs; revisit with per-stream flow control /
  yamux / HTTP-2 / QUIC for heavy concurrency.
- Host header is preserved to the local service (good for relative links; may
  need rewrite logic for apps like Grafana that build absolute URLs).

## Next steps (toward productization)

1. Session broker + DB: create/expire sessions, map subdomain → device/service.
2. Device identity (mTLS) and a signed per-session grant the agent validates.
3. Device-side **service allowlist** (prevent SSRF / arbitrary LAN pivot).
4. AuthN/AuthZ at the gateway (bind subdomain to user/tenant, short expiry).
5. Better multiplexing (yamux / HTTP-2 / QUIC) + per-stream flow control.
6. Audit: bytes, method/path/status, duration per session.
