<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 15 — The P2P Data Plane: WebRTC as a Helix Transport

Date: 2026-07-14

Helix's data plane (doc 10) is **relayed**: a device app dials
`wss://<host>:4001/stream/device`, the gateway multiplexes **HelixStream** frames,
and the browser attaches over a WebSocket to `/stream/client`. Remote shell and
port forwarding ride it. Every byte crosses the cloud — a 128 MB transfer is
128 MB in and 128 MB out across the EC2 NIC.

This document describes the second transport under that same data plane: a direct
**WebRTC** connection between the browser and the device, where the cloud brokers
only the handshake. The experiment behind it (`experimental/p2p-transport`) moved
128 MB peer-to-peer while relaying **5,762 bytes** of SDP/ICE through EC2 — a
~24,000× reduction in cloud bandwidth for the same transfer.

## The layering

WebRTC is **not** a second data plane. It is a transport *under* the existing one,
and it carries media *beside* it. The base unit is the **peer**:

```
                    ┌──────────────── Helix Peer (WebRTC) ─────────────────┐
  signaling ───────▶│  DataChannel (reliable, ordered) ─▶ HelixStream mux  │─▶ shell, port-forward, files
  (control plane)   │  Media track(s) (H.264 / Opus)                       │─▶ live feed, audio
                    └──────────────────────────────────────────────────────┘
```

Two consequences, and they are the whole point:

- **Every stream app works over either transport, unchanged.** `open` takes a
  `transport: "relay" | "p2p"` and the app's accept loop does not change a line.
  HelixStream's framing, its credit-based flow control, its half-close and its
  keepalive are transport-agnostic already (doc 10 anticipated exactly this:
  *"WebSocket binary today; QUIC / WebRTC datachannel / BLE-L2CAP later"*).
- **Live video does not need a second stack.** A media track rides the same peer as
  the mux, so one device app can serve a shell and stream a camera over one
  negotiated connection. (Helix's predecessor carried video on WebRTC with a
  bespoke gateway side-channel; here it is just another thing on the transport.)

## Signaling rides the control plane

There is no signaling server, no room model, and no new endpoint. SDP and ICE are
ordinary control-plane messages on the app's own service:

```
browser  --open{sessionId, transport:"p2p", iceServers}-->  gateway --MQTT--> device
device   --opened{sessionId, offer}--------------------->  browser        (the SDP offer)
browser  --signal{sessionId, answer}-------------------->  device
both     --signal{sessionId, candidate} / candidate----->  (trickle ICE, both ways)
```

- **The device is the offerer** and creates the DataChannel. So its offer comes back
  in `open`'s *existing* response — no extra round trip — and the device needs no
  inbound reachability.
- **Device → browser candidates** ride an unsolicited response (empty `requestId`).
  The gateway already forwards those; see "session affinity" below.
- The three signaling methods live in **one shared contract fragment**
  (`linux/device/go/internal/peer/contracts/peer.fragment.json`), which a service
  pulls in with `"includes": [...]`. They are not copied per app.

`open` never blocks on the connection: it answers as soon as the offer exists and
lets ICE finish in the background. Blocking would deadlock — the browser cannot
answer an offer it has not received.

## Session affinity in the gateway

The gateway used to **broadcast** every unsolicited device packet to all browsers
attached to that device. For WebRTC that is wrong: one tab's ICE candidates would
be delivered to every other tab.

The fix is one app-agnostic rule in `GatewayRouter`, not a WebRTC special case:

> A `sessionId` in a payload marks a long-lived sub-session owned by one client.
> The gateway learns the owner from the exchange that creates it, and routes later
> packets carrying that id to the owner instead of broadcasting.

The gateway never learns the words `sdp`, `candidate`, or `webrtc`. Ownership is
for **routing only** — it is deliberately not an authorization check, because any
browser authorized for a device may manage its sessions (the shell UI lists every
session and lets you close another tab's).

## ICE and TURN

`ice.config` (tRPC, session-authenticated) returns the STUN/TURN servers. The
browser passes them to the device in `open`, so the device needs no cloud
credentials of its own and only gets a relay for a session someone authorized.

**TURN credentials are ephemeral.** coturn's `use-auth-secret` model: the username
is `<expiry-unix>:<userId>` and the password is
`base64(HMAC-SHA1(secret, username))`. coturn recomputes the HMAC to verify, and
rejects anything past its expiry. The shared secret never leaves the server, and a
leaked credential expires on its own.

> The config this replaced had a **static** `user=helix:helix-secret` committed to
> the repo. On a public box that is an open relay: anyone could push traffic
> through it on our bandwidth bill. It had also lost the `denied-peer-ip` hardening,
> which is what stops a client from aiming the relay at the instance's own subnet or
> at the cloud metadata endpoint (169.254.169.254). Both are restored; do not
> reintroduce a static credential.

TURN is a **fallback**. A relayed session works but costs cloud bandwidth — the
thing P2P exists to avoid — so the shell header shows the negotiated ICE path
(`host`/`srflx` = direct, `relay` = TURN).

### Deploying it

```sh
helix ami sg-turn --sg <security-group>     # 3478, 5349, 49160-49259
```

Then in `site.env`:

- `TURN_PUBLIC_IP` — the box's **public** address. coturn binds the private one but
  must advertise the public one, or it hands out candidates nobody can reach.
- `TURN_DOMAIN` — e.g. `turn.example.com`, a **DNS-only** record (Cloudflare: grey
  cloud). The proxy carries HTTP(S) only and will not relay TURN — the same reason
  MQTT and the device data plane dial the origin directly. It needs a hostname
  rather than an IP because `turns:5349` presents a certificate that must match.

`TURN_STATIC_AUTH_SECRET` is generated into `secrets.env` on boot. The relay port
range is not optional: without it, TURN allocation *succeeds* and then no bytes
flow, which reads like a WebRTC bug rather than a firewall one.

## What runs where

| Piece | Path |
| --- | --- |
| Device peer (pion): DataChannel → `stream.Transport`, media tracks | `linux/device/go/internal/peer/` |
| Transport-agnostic session open (relay **or** p2p) | `linux/device/go/internal/shared/dataplane/` |
| Shared signaling contract fragment | `linux/device/go/internal/peer/contracts/peer.fragment.json` |
| Browser peer + DataChannel transport | `web/packages/protocol/src/peer/` |
| Browser channel abstraction (one API, two transports) | `web/packages/device-apps/src/data-plane/` |
| ICE servers + ephemeral TURN credentials | `web/packages/helix-backend/src/ice/` |
| Gateway session affinity | `web/packages/helix-backend/src/gateway/router.ts` |
| TURN relay | `cloud/coturn/`, `cloud/appliance/bin/coturn-prepare.sh` |

## Gotchas worth keeping

- **A custom pion `NewAPI` has an empty MediaEngine.** Unlike the package-level
  `webrtc.NewPeerConnection`, it registers no codecs — media tracks then negotiate
  nothing and silently never flow, while the DataChannel keeps working. Register the
  default codecs + interceptors.
- **Tracks must be declared before the offer.** Helix does a single offer/answer
  exchange and does not renegotiate, so every track a session needs is in
  `peer.Config.Tracks`.
- **`RTCDataChannel.send` never blocks.** A WebSocket at least applies TCP pressure;
  a DataChannel does not, so a fast producer grows `bufferedAmount` without bound
  until the channel dies. Both transports gate on a high-water mark and resume on
  `bufferedamountlow`. The mux's credit window bounds *one* stream; this bounds the
  sum.
- **mDNS query+gather is required** (`SetICEMulticastDNSMode`), or two peers on the
  same LAN behind identical NAT fail to resolve Chrome's `.local` host candidates and
  never connect, even though a direct path exists.
- **Copy inbound frames.** The frame decoder hands payloads to the app as subarrays
  of the transport's buffer, so it must not be reused.
- **`emit-event` cannot reach a browser.** It publishes to
  `helix/device/<id>/service/<svc>/event`, which the gateway does not subscribe to.
  Device→browser pushes are responses with an empty `requestId`.
