# 10 — Streaming Data Plane: Remote Shell & Port Forwarding on Helix

Plan for folding the two experimental features under `experimental/` — browser
**port forwarding** and the browser **remote shell (PTY)** — into the Helix
gateway/protocol as first-class, reusable capabilities. Both currently ship as a
standalone Caddy + Node gateway with two *different*, bespoke binary wire
protocols. This document defines the common substrate they should share and how
each maps onto the existing Helix layering.

## Why

The two experiments proved the feature but do not fit the Helix model on four
axes (confirmed against the code):

1. **Control is mixed into the data channel.** Each agent's data WebSocket
   carries session identity and app semantics as framed messages —
   `REGISTER`/`REGISTER_ACK`, and for port-forwarding `REQ_HEAD`/`RES_HEAD`
   (HTTP method/url/headers as JSON), for the shell `OPEN{cols,rows}`/`RESIZE`.
   None of this is byte-stream data; it is protocol control that belongs on the
   Helix service plane.
2. **Two divergent protocols, no shared base.** `experimental/port-forwarding`
   and `experimental/remote-shell` each define their own frame set. The *only*
   thing they truly share — a multiplexed bidirectional byte stream — is
   duplicated, not factored out.
3. **A parallel gateway.** They run a standalone Caddy + Node gateway addressed
   by subdomain (`<session>.port.helix-kit.com`, `connect.port…/__tunnel__`),
   with self-asserted session ids and **no** MQTT, no `HelixPacket` envelope, no
   `requestId` correlation, no service contracts, and no authentication.
4. **No data plane exists in mainstream Helix to land on.** The web/backend
   protocol is 100% JSON request/response. The only binary precedents are the
   embedded `helix_binary_channel` (serial-only, one-directional, control-plane
   bracketed by JSON — see doc 08) and the discrete mTLS HTTP file API. Neither
   is a persistent bidirectional stream.

The goal is the layering the user asked for — the same shape as the Helix
control stack, but for bytes:

```
CONTROL (exists):   transport ─▶ service (req/rep) ─▶ apps        (JSON over MQTT/BLE/WS)
DATA    (this doc): transport ─▶ HelixStream (mux) ─▶ stream apps (raw bytes over WS/QUIC/…)
```

Session lifecycle (start/stop/list) and all policy live on the **control plane**
(MQTT services). Only opaque bytes flow on the **data plane**. Port forwarding
and the shell become thin *stream apps* over one common multiplexer.

## Architecture

Two parallel stacks joined by a **session** record. Control establishes and
authorizes a session; the data plane carries its bytes.

```
              ┌──────────────────────────── Browser / Web app ────────────────────────────┐
              │  control: @helix/protocol-service client        data: @helix/protocol-stream │
              └────────┬──────────────────────────────────────────────────┬────────────────┘
        control: WS /ws?deviceId  (HelixPacket JSON)          data: WSS binary stream frames
                       │  {requestId, message:{service,method,payload}}     │  [type][streamId][bytes]
                       ▼                                                     ▼
      ┌───────────────────────── helix-server (gateway role) ─────────────────────────────────┐
      │  WS⇄MQTT bridge (exists)          │   HelixStream server (new): mux + session broker      │
      └────────┬──────────────────────────┴──────────────────────────────────┬──────────────────┘
      control: MQTT helix/device/<id>/in|out  (QoS1, mTLS)        data: one mux per device (mTLS)
                       │                                                       │
                       ▼                                                       ▼
      ┌──────────────────────────────────── Device (Linux Go agent) ──────────────────────────────┐
      │  control: linux/protocol/go {core,service,mqtt}      data: linux/protocol/go/stream (mux)   │
      │    service `stream`: open/close/list ── binds ──▶ session table ◀── OPEN/DATA/END/SIGNAL     │
      │  apps: port-forward → net.Dial(target)      shell → forkpty(login shell)                     │
      └────────────────────────────────────────────────────────────────────────────────────────────┘
```

Both device connections are **outbound** (MQTT and the data-plane WS), preserving
the "zero inbound ports on the device" property the experiments established.

### Control plane — session as a Helix service

Session lifecycle becomes an ordinary Helix service, invoked over the existing
WS⇄MQTT bridge (`helix/device/<id>/in|out`) with `requestId` correlation. No new
transport, no side channel. One `stream` service covers all stream apps; the app
is selected by a field so new apps (UART, KVM) plug in later without new control
surface.

| Method | Request | Response | Notes |
| --- | --- | --- | --- |
| `open` | `{ app, params }` | `{ sessionId, expiresAt }` | `app` ∈ `shell` \| `port-forward`; `params` is app-specific and validated *on the device* against local policy (allowlist). |
| `close` | `{ sessionId }` | `{ ok }` | Tears the session down; the device rejects further streams for it. |
| `list` | `{}` | `{ sessions: [...] }` | Active sessions for observability. |

`params` per app:
- `port-forward`: `{ target: "127.0.0.1:3000" }` — the device validates against a
  configured service allowlist (named services, not arbitrary host:port — the
  SSRF control from doc 08's design notes and the experiment chats).
- `shell`: `{ shell: "/bin/bash", mode: "login" }` — future: diagnostic vs root
  vs break-glass shell levels (separately authorized).

The device is the authority: it enforces the allowlist and allocates the
`sessionId`. The **gateway snoops `stream` responses** (it already parses the
`HelixPacket` envelope as the `requestId` owner) to populate its data-plane
routing table `sessionId → (deviceId, app, expiresAt)` and to hand the initiating
browser a short-lived data-plane grant. This keeps all *control messages* on
MQTT while giving the gateway the minimal state it needs to route bytes.

### Data plane — HelixStream (the common byte-stream base)

One binary multiplexer, shared by every stream app — the factored-out common
part. It runs over any transport that carries binary messages, mirroring how the
control `HelixTransport` abstracts its carriers. It knows nothing about HTTP, TCP,
or PTYs.

Two transports exist today, and a session picks one with `transport` on `open`:

| Transport | Carrier | Path | Notes |
| --- | --- | --- | --- |
| `relay` | WebSocket (mTLS) | browser → gateway → device | Always works. Every byte crosses the cloud. The **gateway** runs the mux; the browser just opens a WebSocket per stream. |
| `p2p` | WebRTC DataChannel | browser ⇄ device, direct | The cloud brokers only SDP/ICE. The **browser** runs the mux itself, since no gateway sits in the middle. Falls back to a TURN relay when no direct path exists. See **doc 15**. |

The apps below are identical on both — which is the point of putting WebRTC under
the mux rather than beside it. (QUIC / BLE-L2CAP would slot in the same way.)

Frame layout (promoted from the experimental agents, which already use it):

```
byte 0      frame type
bytes 1..4  stream id (uint32, big-endian; 0 = connection control)
bytes 5..N  payload (raw bytes; JSON only for control / SIGNAL frames)
```

| Type | Dir | Payload | Meaning |
| --- | --- | --- | --- |
| `OPEN` | gw→dev | — | Open stream N (its app+target come from the session, not the frame). |
| `DATA` | either | raw bytes | Stream payload — the only byte-carrying frame. |
| `END` | either | — | Half-close: no more `DATA` this direction (EOF). |
| `RESET` | either | JSON `{code,reason}` | Abort stream N. |
| `SIGNAL` | either | JSON | App-defined per-stream control (e.g. shell `{resize,cols,rows}`, exit `{code}`). |
| `CREDIT` | either | uint32 | Flow-control window update (bytes the peer may send). |
| `HELLO`/`PING` | conn (id 0) | JSON | Handshake (protocol version) + keepalive. |

Design points that fix the experiments' shortcomings:

- **Stream ids** are split gateway-even / device-odd (HTTP/2 style) so either
  side can open without collision.
- **Flow control (`CREDIT`)** is new. The experiments had none — one slow
  browser could head-of-line-block every stream over the shared socket. Per-
  stream credit windows bound this.
- **Session/identity/target are gone from the wire.** `REGISTER` disappears
  (device identity = mTLS client cert; session = control-plane record).
  `REQ_HEAD`/`RES_HEAD` disappear (port-forward is a raw TCP relay — see below).
  `OPEN{cols}` disappears (shell size is a session param + `SIGNAL`).

### Stream apps — what each becomes

Both apps collapse to "on `OPEN`, connect a local byte source and pipe":

- **port-forward** — device does `net.Dial(session.target)` and raw-pipes bytes
  both ways. Because bytes are opaque, this is **protocol-transparent** (HTTP,
  WebSocket upgrades, SSE, gRPC — anything), which is *simpler and more correct*
  than the current HTTP-parsing gateway. Each browser connection = one stream.
  (An optional HTTP-aware sub-layer can be added later purely for request-level
  audit logging; it is not required for transport.)
- **shell** — device does `forkpty(session.shell)` and pipes `DATA` ↔ PTY. Each
  browser terminal = one stream. Terminal resize is a `SIGNAL{resize,cols,rows}`
  frame; shell exit is `SIGNAL{code}` then `END`.

The before/after, i.e. what moves off the data channel:

| Concern | Today (two bespoke protocols) | Target (one substrate + control plane) |
| --- | --- | --- |
| Device identity | `REGISTER{sessionId}` on data WS (self-asserted) | mTLS client cert (step-ca PKI) |
| Session / target / shell params | `REGISTER` + `OPEN{cols,rows}` frames | `stream.open` MQTT service (device-enforced allowlist) |
| HTTP semantics (port-fwd) | `REQ_HEAD`/`REQ_DATA`/`RES_HEAD`/… JSON frames | none — raw TCP relay |
| New connection / terminal | `OPEN` (+ params) | `OPEN` (no params) |
| Bytes | `REQ_DATA`/`RES_DATA`/`WS_DATA` / `DATA` | `DATA` (single type) |
| Resize | `RESIZE` frame | `SIGNAL{resize}` frame |
| Teardown | `CLOSE`/`EXIT`/`ABORT` | `END` / `RESET` |
| Flow control | none | `CREDIT` |

## Device side

The agent stops being a bespoke binary and becomes a **Helix device that runs
one service and one stream client**, reusing the existing Go core.

- **Control: reuse `linux/protocol/go/{core,service,mqtt}` verbatim.** These
  already give MQTT request/response with `requestId` correlation and the
  `service.PacketSender` + `Endpoint.Receive` seam (exactly what
  `cmd/helix-cloud-comm-sample` wires up). The `stream` service is a normal
  dispatcher handler (`Invocation.Respond/Fail`).
- **Data: new `linux/protocol/go/stream` package** — the Layer-1 mux, promoted
  from `experimental/port-forwarding/agent/protocol.go` (same 5-byte header) plus
  flow control, running *alongside* the service endpoint, not through it. A
  companion `linux/protocol/go/wsstream` provides the outbound mTLS binary-WS
  transport (the experimental agent already dials with `gorilla/websocket`; this
  generalizes it and adds the client cert).
- **Apps: `linux/protocol/go/apps/{portforward,shell}`.** Each contributes a
  `stream`-service handler (validate params, register the session) and a stream
  handler (on `OPEN`, dial/forkpty and pipe). The shell app keeps `creack/pty`
  and the fixes already made in the experiment (heartbeat reaping, UTF-8 locale,
  full `vim`).
- **Allowlist enforcement lives here** — the device refuses `stream.open` for a
  disallowed target and refuses `OPEN` for any session it did not authorize.

Python/ESP32 devices get the same treatment only if/when they need these apps;
the Go path is first.

## Gateway

Fold the standalone Caddy + Node gateway into `helix-server`'s existing gateway
role (`web/apps/helix-server/src/roles/gateway.ts`) and `@helix/backend`.

- **Keep** the WS⇄MQTT bridge (`helix-backend/src/gateway/*`) for control —
  unchanged.
- **Add** a HelixStream server under `helix-backend/src/streams/`: the binary-WS
  endpoint, the per-device mux, the session broker (the `sessionId → deviceId`
  table populated by snooping `stream` responses), and subdomain routing for
  port-forward (`<session>.port.<domain>` → session → device mux). Gateway-side
  app logic lives in `helix-backend/src/streams/apps/{port-forward,shell}`.
- **Ingress/TLS:** the appliance's ingress terminates TLS and the
  `*.port.<domain>` wildcard (the role Caddy played in the experiment). The
  device's data-plane WS is mTLS so the gateway authenticates the device on the
  data plane — replacing the `REGISTER` frame and reusing step-ca.
- **Retire** `experimental/{port-forwarding,remote-shell,deploy}` once ported.
  The `experimental/bandwidth` toolkit's findings (≈1.07× egress, ≈2.13× total,
  per-session counters) carry over and should inform the gateway's metrics.

## Security

- **Device identity** — mTLS on both planes (MQTT control already; extend to the
  data-plane WS). Reuses the existing step-ca PKI; no self-asserted ids.
- **Session grant** — `stream.open` is authorized by the device (allowlist) and
  by the web user's identity at the gateway. The gateway issues a short-lived,
  session-scoped capability token to the initiating browser; the data-plane
  connection presents `{sessionId, token}`, which the gateway validates against
  its session table before opening streams.
- **Fixes a real gap** — the current WS gateway *parses* a `token` but never
  validates it (`helix-backend/src/gateway/mqtt-bridge.ts`). Both the control WS
  and the data-plane WS must authenticate the web user; this plan makes that a
  requirement, not a TODO.
- **Device-side allowlist** — named services only, no arbitrary host:port/shell,
  enforced on the device (defence in depth even if the gateway is compromised).
- **Isolation** — opaque per-session subdomains, short expiry, no ambient app
  cookies forwarded to proxied services (per the experiment chats).

## Contracts & codegen

- Add `stream` (and, if kept per-app, `shell`/`port-forward`) contract JSON and
  register them in `helix.contracts.json`; generate the **TypeScript** client
  contract for the web app (`web/apps/helix/src/generated/contracts`).
- **Gaps to close first:** the Go and Python generators in
  `tooling/protocol/commands.py` are **name-only stubs** (only TS and embedded-C
  are full). The device `stream` service therefore needs either (a) the Go
  generator implemented, or (b) a hand-written Go contract for now. Recommend
  implementing the Go generator — it unblocks every future Linux-device service,
  not just this one.
- **The data plane stays outside codegen.** The contract schema models discrete
  JSON messages only (`string|number|boolean|json|array`, no `bytes`/stream
  type). HelixStream framing is hand-written, exactly as the embedded
  `helix_binary_channel` data plane is today (control in contracts, bytes
  out-of-band). A later extension could add a `stream`/`channel` declaration to
  the contract system; not required for this work.

## Proposed package & file layout

| Path | What |
| --- | --- |
| `web/packages/protocol/helix-stream` (`@helix/protocol-stream`) | Layer-1 mux (browser + gateway) + flow control |
| `web/packages/protocol/transport-ws-binary` | binary-WS transport for the mux (distinct from JSON `@helix/transport-websocket`) |
| `web/packages/core/helix-backend/src/streams/` | gateway HelixStream server, session broker, subdomain router |
| `web/packages/core/helix-backend/src/streams/apps/{port-forward,shell}` | gateway-side app logic |
| `linux/protocol/go/stream/` | device Layer-1 mux (promote experimental framing) |
| `linux/protocol/go/wsstream/` | outbound mTLS binary-WS transport |
| `linux/protocol/go/apps/{portforward,shell}/` | device apps: `stream`-service handler + stream handler |
| `linux/protocol/go/cmd/helix-agent/` | the composed device agent (control + data) |
| `.../contracts/stream.json` + `helix.contracts.json` | control-plane contract(s) |
| `web/apps/helix/src/features/{shell,port-forward}` | web UIs (port the React shell UI + a port-forward UI) |
| _retire_ `experimental/{port-forwarding,remote-shell,deploy}` | folded into the above |

## Rollout phases

1. **Extract the substrate.** Build `@helix/protocol-stream` (TS) and
   `linux/protocol/go/stream` (Go) from the experimental framing, add
   `CREDIT` flow control, and re-implement *both* experimental agents/gateways on
   it — still standalone — to prove one substrate serves both apps.
2. **Move control to MQTT.** Add the `stream` service contract; implement
   `open/close/list` on the device (allowlist-enforcing) and drop
   `REGISTER`/`REQ_HEAD`/`OPEN{cols}` from the data plane. Session/target/size
   now come from the control plane.
3. **Fold into the gateway.** Stand up the HelixStream server + subdomain routing
   in `@helix/backend`/`helix-server`; device dials the data plane over mTLS;
   retire the standalone Caddy + Node gateway (keep only appliance ingress TLS).
4. **Web UIs.** Port the shell UI and add a port-forward UI into
   `web/apps/helix`, using the generated contract for control and the stream
   client for data.
5. **Harden.** Enforce web-user auth + capability tokens, finish flow control,
   and extend the e2e harnesses (a HelixStream fixture in `tests/e2e/_gateway.py`
   plus Go device stream tests) so the feature is regression-covered like the
   rest of Helix.

## Open decisions

- **Resize placement** — recommend an in-band `SIGNAL{resize}` frame (data-
  adjacent, like SSH's connection-protocol window-adjust). Alternative:
  a `shell.resize` MQTT method (stricter control/data split, but couples MQTT to
  a data-plane `streamId` and adds latency). Chosen: `SIGNAL`.
- **Data-plane connection lifetime** — recommend **one persistent per-device
  mux** (a warm connection, sessions authorize streams over it), not a
  connection per session. Fewer handshakes, matches the experiment.
- **Go/Python contract codegen** — *resolved:* the Go and Python generators are
  implemented (`helix protocol generate --target {go,python}`). The device
  services (`echo`, `shell`, `port-forward`) consume generated typed dispatch
  from a co-located contract JSON that is the single source of truth for Go,
  Python, and the app's TypeScript contract. See doc 02.
- **Caddy** — keep as the TLS/wildcard terminator in front of the appliance, or
  replace with the appliance's own ingress. Either works; decide with the
  appliance ingress owner.

## What exists today vs. to build

| Piece | Status |
| --- | --- |
| Control plane: services, `requestId`, MQTT topics, WS⇄MQTT bridge | ✅ exists, reuse verbatim |
| Device control core (`linux/protocol/go/{core,service,mqtt}`) | ✅ exists, reuse verbatim |
| step-ca PKI + device mTLS on MQTT | ✅ exists |
| Multiplexed byte-stream framing | ⚠️ prototyped in `experimental/*/agent/protocol.go`; not a lib, no flow control |
| Outbound WS binary transport (Go) | ⚠️ prototyped in the experimental agent; needs mTLS + generalizing |
| `@helix/protocol-stream` + `linux/protocol/go/stream` (Layer-1 mux) | ⛔ to build |
| `stream` service contract + device handlers + allowlist | ⛔ to build |
| Go/Python full contract codegen | ✅ implemented — typed structs + `Dispatch`/`Handler` from co-located contract JSON |
| HelixStream server in `@helix/backend` + subdomain routing | ⛔ to build (fold experiment) |
| mTLS on the data-plane WS | ⛔ to add (PKI exists) |
| Web-user auth on control/data WS | ⛔ gap: token parsed but never validated |
| Flow control (`CREDIT`) | ⛔ to add |

## Key files

Existing (reuse / extend):
- `web/packages/protocol/protocol-core/src/index.ts` — `HelixTransport`, `HelixPacket`, `HelixRequestRegistry`.
- `web/packages/protocol/protocol-service/src/index.ts` — `HelixMessage{service,method,payload}`, `defineServiceContract`, `HelixServiceClient`.
- `web/packages/core/helix-backend/src/gateway/{mqtt-bridge.ts,router.ts}` — WS⇄MQTT bridge (`helix/device/<id>/in|out`, `/ws?deviceId=`).
- `web/apps/helix-server/src/roles/gateway.ts` — gateway role wiring.
- `linux/protocol/go/{core,service,mqtt,cloudcomm}` — device control core + example service.
- `embedded/protocol/src/{helix_transport.h,service_dispatcher.h,helix_binary_channel.h}` — the transport seam, dispatcher, and the control-plane-plus-out-of-band-binary precedent (doc 08).
- `tooling/protocol/commands.py` + `helix.contracts.json` — contract validate/generate (`helix protocol generate-all`).

To create:
- `web/packages/protocol/helix-stream`, `.../transport-ws-binary`.
- `web/packages/core/helix-backend/src/streams/**`.
- `linux/protocol/go/{stream,wsstream,apps/portforward,apps/shell,cmd/helix-agent}`.
- `docs`/contracts for the `stream` service.

Prior art being promoted (then retired):
- `experimental/port-forwarding/{agent,gateway}` — the `[type][streamId][payload]` framing and raw relay.
- `experimental/remote-shell/{agent,gateway,ui}` — the PTY app + React terminal UI (with the shell fixes).
- `experimental/bandwidth` — the per-session counters + NIC-reconciliation methodology for gateway metrics.
