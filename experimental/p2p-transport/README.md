# Helix P2P Transport (experimental)

A **pure peer-to-peer** transport channel between a Linux device and a browser,
built on a WebRTC DataChannel. The cloud (EC2) only brokers the handshake; once
the channel opens, **all bulk data flows directly device↔browser and never
touches EC2**. One channel, reusable for any payload: file transfer (proven
here), and later media/video and generic streams.

> Motivation: today's scattered approach (device → temp S3 → browser download
> for files; a separate relay for WebRTC video) wastes cloud bandwidth and is
> slow to scale. This proves one direct channel that bypasses the relay
> entirely — the data-plane analogue of `docs/10-Streaming-Data-Plane.md`, but
> P2P instead of gateway-relayed.

## Result (measured)

Both peers on one laptop, **signaling on the Mumbai EC2** (`helix-kit.com`), data
direct:

| Transfer | Payload | Path (ICE) | Integrity | Throughput | **Bytes across EC2** |
|----------|--------:|------------|-----------|-----------:|---------------------:|
| local signaling  |  32 MB | `host` (direct) | SHA-256 ✓ | 31 MB/s | **4.9 KB** |
| **EC2 signaling** | **128 MB** | `host` (direct) | **SHA-256 ✓** | **29 MB/s** | **5.76 KB** |

For the 128 MB run the EC2 relayed **5,762 bytes** of SDP/ICE — **0.004%** of the
payload. The relay approach (port-forwarding/remote-shell) would have pushed
**128 MB in + 128 MB out ≈ 256 MB** across the EC2 NIC (see
`../bandwidth`). That is a **~24,000× reduction** in cloud bandwidth for the same
transfer. Screenshots in `docs/`.

The selected ICE candidate pair is `host`/`prflx`, i.e. a **direct** path — not
`relay` (TURN). No bytes are proxied.

## Architecture

```
  Browser (laptop)                                   Device: Go agent (laptop / any Linux)
        │                                                        │
        │  1. WSS signaling (tiny: SDP + ICE, a few KB)          │
        └──────────────►  EC2 signaling server  ◄───────────────┘
                          p2p.port.helix-kit.com
                          (room rendezvous + opaque JSON relay)
        │                                                        │
        └═══════════ 2. WebRTC DataChannel (ALL the bytes) ══════┘
                          DIRECT peer-to-peer — EC2 not in path
```

- **Rendezvous** is a shared `room` id. Each room holds one `device` + one
  `browser`. The **device is the WebRTC initiator** — it creates the DataChannel
  and the SDP offer; the browser answers.
- **Signaling** (`/__p2p__` WS) is an opaque relay: the server forwards SDP/ICE
  JSON between the two peers verbatim and never inspects it. It also counts the
  bytes it relayed (`/__p2pstats__`) so you can watch them stay tiny.
- **NAT traversal**: STUN (`stun.l.google.com`) for reflexive candidates; on the
  same laptop the peers connect via **host candidates**. The Go agent enables
  pion **mDNS query+gather** so it can resolve Chrome's `.local` host candidates
  (without this, same-LAN peers behind identical NAT often fail to connect).

## Wire format (over the DataChannel)

App-level file protocol — mirrors the embedded "JSON control + binary data"
precedent (doc 08). WebRTC preserves message order on an ordered channel, so
control strings and binary chunks interleave safely:

| Message | Kind | Payload |
|---------|------|---------|
| `file-meta` | string (JSON) | `{name, size, mime, sha256, chunk}` |
| _chunk_     | binary        | up to `chunk` bytes of file data |
| `file-end`  | string (JSON) | `{}` — receiver then verifies SHA-256 |

**Backpressure**: the sender pauses when the DataChannel's `BufferedAmount`
exceeds 1 MiB and resumes on `OnBufferedAmountLow` — bounding memory and avoiding
channel drops on a fast producer / slow consumer.

## Layout

```
signaling/   Node/TS signaling server + web-client host (behind Caddy on EC2)
web/         browser client (single self-contained index.html)
agent/       Go device agent (pion/webrtc; streams a file over the DataChannel)
docs/        result screenshots
```

## Run it

### Local (signaling on your machine)

```bash
# 1. signaling + web client on :9200
cd signaling && npm install && PORT=9200 npx tsx src/index.ts

# 2. device agent (generates 32 MB of random data by default)
cd agent && go build -o p2p-agent . && \
  SIGNAL_URL=ws://localhost:9200/__p2p__ ROOM=demo GEN_SIZE=$((32*1024*1024)) ./p2p-agent

# 3. open http://localhost:9200/  → room "demo" → Connect
```

### Real topology (signaling on EC2, data P2P)

Signaling is deployed at **https://p2p.port.helix-kit.com/** (folded into the
unified `../deploy` stack as `p2p-signaling`, behind Caddy, reusing the
`*.port.helix-kit.com` wildcard cert). Run the device anywhere:

```bash
cd agent && SIGNAL_URL=wss://p2p.port.helix-kit.com/__p2p__ \
  ROOM=laptop-demo GEN_SIZE=$((128*1024*1024)) ./p2p-agent
# open https://p2p.port.helix-kit.com/  → room "laptop-demo" → Connect
```

Agent env knobs: `SIGNAL_URL`, `ROOM`, `FILE` (serve a real file instead of
random data), `GEN_SIZE` (random payload bytes), and `-chunk`.

Watch the cloud cost stay flat: `curl https://p2p.port.helix-kit.com/__p2pstats__`.

## Deploy notes

Added to `../deploy/docker-compose.yml` (`p2p-signaling` service) and
`../deploy/Caddyfile` (`p2p.port.helix-kit.com` block). To redeploy on EC2:

```bash
# rsync p2p-transport/ + deploy files, then on the box:
cd ~/helix-experimental/deploy
docker compose --env-file .env up -d --build p2p-signaling
# NB: Caddy bind-mounts a single Caddyfile — after editing it, force-recreate so
# Caddy re-binds the new inode (rsync/editors replace the inode):
docker compose --env-file .env up -d --force-recreate caddy
```

## TURN relay (fallback for restrictive networks)

Direct P2P (host/srflx) fails when a peer can't hole-punch — the observed case
was a laptop on a **corporate VPN** (UDP blocked, symmetric NAT): ICE went to
`failed`. A **coturn** relay on EC2 (`experimental/deploy`, service `coturn`)
fixes this. Both clients advertise it as an ICE server:

```
turn:turn.port.helix-kit.com:3478?transport=udp   # normal
turn:turn.port.helix-kit.com:3478?transport=tcp   # UDP-blocked networks
turns:turn.port.helix-kit.com:5349?transport=tcp  # TLS — corporate firewalls
username=helix credential=helixsecret             # static creds (experiment)
```

coturn runs `network_mode: host`, advertises the EC2 public IP via `external-ip`
(essential — its NIC only has the private 172.31.x address), and reuses Caddy's
`*.port.helix-kit.com` wildcard cert for `turns:` (runs as root to read the
`0600` key). When a relay path is used the payload crosses EC2 (device→EC2→peer),
so the bandwidth monitor's `cum_tx` climbs — a nice contrast with the flat
direct-P2P case.

**EC2 security-group inbound rules this needs** (source `0.0.0.0/0`):

| Port | Proto | Purpose |
|------|-------|---------|
| 3478 | UDP | STUN + TURN (primary) |
| 3478 | TCP | TURN over TCP (UDP-blocked networks) |
| 5349 | TCP | TURN over TLS (`turns:`) — the corporate-firewall path |
| 5349 | UDP | TURN over DTLS (optional) |
| 49160–49259 | UDP | **relay media/data ports — required**, else allocation succeeds but no bytes flow |

Bring it up: `docker compose --env-file .env up -d coturn`. Test a peer forced
onto the relay by setting `iceTransportPolicy: "relay"` in the browser, or just
connect from a network that has no direct path.

## Known limitations (MVP)

- **No auth.** Anyone who knows a `room` id can join it. No device identity, no
  capability token — the productization path (mTLS device identity + short-lived
  gateway-issued session grant) is `docs/10`.
- **TURN fallback deployed** (coturn on EC2 — see below). Direct P2P still
  bypasses EC2; only peers that can't hole-punch (e.g. a corporate VPN blocking
  UDP) fall back to the relay, which *does* use EC2 bandwidth.
- **One app (file), one channel.** The generic framing (HelixStream: multiplexed
  `[type][streamId][payload]` with per-stream `CREDIT` flow control from doc 10)
  is not implemented here — this uses a single reliable channel with an
  app-specific header. Next step is to run that same mux over the DataChannel so
  files, media, and streams share one substrate.
- **Reliable-ordered only.** For live video you'd open a second *unreliable*
  DataChannel (`maxRetransmits: 0`) or a media track; the transport supports it,
  this demo doesn't exercise it.

## How this fits Helix

`docs/10` folds port-forwarding + remote-shell onto one **gateway-relayed** byte
mux (`HelixStream`). This experiment adds the **peer-to-peer** carrier for that
same mux: for large/bulk/real-time data between a device and a browser, run
HelixStream over a WebRTC DataChannel instead of the WSS relay, and the gateway
shrinks from a bandwidth-metered relay to a ~KB signaling broker. Control plane
(session lifecycle, allowlist, auth) stays on MQTT exactly as in doc 10.
```
