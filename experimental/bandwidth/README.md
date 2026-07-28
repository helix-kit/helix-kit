# Bandwidth measurement & reconciliation (experimental)

Measures **per-session** tunnel bandwidth and reconciles it against the EC2
instance's **real NIC byte counters**, so you can size limits and approximate
cost.

Two independent layers, tied together by a known-size workload:

1. **Ground truth — EC2 `ens5` counters** (`netmon.sh`). The kernel's per-NIC
   byte counters: real on-the-wire bytes = TLS-encrypted payload + WebSocket
   framing + TCP/IP + Ethernet + ACKs + retransmits. This is what AWS meters and
   what counts against the instance's network allowance. Docker-bridge traffic
   (Caddy↔gateway, plaintext) stays internal and is **not** on `ens5`.
2. **Per-session attribution — gateway counters** (`/__helixstats__`). Each
   gateway counts the plaintext payload it relays per session (`up`/`down` for
   port tunnels, `in`/`out` for shells).

## Why a tunnel costs ~2× on the instance

The EC2 is a **relay in the middle**: for one download, the payload crosses
`ens5` twice — **in** from the device-agent leg, **out** to the viewer leg —
both TLS-wrapped:

```
viewer  <--egress(TLS)--  EC2 gateway  <--ingress(TLS)--  device agent
         (billable)                      (free ingress)
```

So **instance bandwidth ≈ 2× payload**, but **billable egress ≈ 1× payload**
(AWS bills data-out only; data-in is free).

## Measured results

Instance: **t3.small**, ap-south-1 (Mumbai), iface `ens5`. All numbers are real
measurements (`measure.sh`), payloads incompressible, no gzip.

### Idle (30 s windows, per connected session)

| State                         | ens5 rx | ens5 tx | notes                        |
|-------------------------------|--------:|--------:|------------------------------|
| Infra idle (no agents)        |   268 B |   288 B | ~9–10 B/s — essentially zero  |
| + 1 idle port tunnel          |   400 B |   444 B | keepalive ≈ +5 B/s            |
| + 1 idle shell agent          |   556 B |   712 B | keepalive ≈ +15 B/s           |

→ **An idle connected session costs ~5–25 B/s** (WS ping/pong), i.e. tens of
MB/month, almost all free ingress. Negligible.

### Active transfer

| Workload                     | payload   | ens5 tx (egress, billable) | ens5 total | egress/payload | total/payload |
|------------------------------|----------:|---------------------------:|-----------:|---------------:|--------------:|
| Port tunnel, 50 MiB download | 50.00 MiB | 53.63 MiB                  | 106.4 MiB  | **1.072×**     | **2.13×**     |
| Shell, 20 MiB PTY output     | 20.00 MiB | 21.30 MiB                  | 42.58 MiB  | **1.065×**     | **2.13×**     |

The gateway per-session counters matched the payload **exactly** (port `down` =
52,428,800 B; shell `out` = 20,971,739 B incl. marker), so per-session
attribution is exact. Both features show the **same overhead profile** (~7%
egress overhead, 2.13× total) — same relay, same TLS/WS framing.

## Cost & limit model

Take **payload P** = bytes delivered to the viewer for a session.

- **Billable egress** ≈ `1.07 × P`. Ingress from the device is free.
- **Instance NIC** ≈ `2.13 × P` total (rx+tx) — this is what hits the network
  throughput limit.
- **Data-out cost** (ap-south-1, ~\$0.1093/GB after the 100 GB/mo free tier):
  ≈ **\$0.12–0.13 per GiB of payload delivered** (`1.07 × 1.0737 GB × $0.1093`).
- **Throughput ceiling**: t3.small baseline ≈ 0.128 Gbps sustained (burst 5
  Gbps). Since the NIC does 2.13× payload, sustained **aggregate** deliverable
  payload ≈ `128 Mbps / 2.13 ≈ 60 Mbps` (~7.5 MB/s) across all sessions before
  the baseline throttles (higher in bursts via network credits).
- **Idle**: a few MB/month per connected session. Fleet idle cost ≈ nil.

> Rule of thumb: **1 GiB a user pulls through a tunnel ≈ 1.07 GiB egress ≈
> \$0.13, and ≈ 2.13 GiB of the instance's network allowance.**

## Reproduce

```bash
# on EC2 (already synced to ~/helix-experimental/bandwidth):
netmon.sh sample 30            # idle NIC delta
netmon.sh watch 20             # per-second in/out

# from the laptop (needs one tunnel/shell agent connected):
EC2_KEY="~/Downloads/Helix Kit Admin.pem" \
EC2_HOST=ubuntu@ec2-... \
  ./measure.sh idle 30
  ./measure.sh port  https://<session>.port.helix-kit.com/<big-file>
  ./measure.sh shell 20971520
```

`GET /__helixstats__` on either gateway (via `docker exec ... wget
localhost:9000|9100/__helixstats__`) returns live per-session payload counters.

## Caveats

- Measured at ~2 MB/s / ~14 Mbps because the test client **and** device agent
  were both on one laptop (payload traverses its uplink twice). The **overhead
  ratios are bandwidth-independent** — they're TCP/IP + TLS + WS framing, not
  throughput.
- Ratios assume MTU 1500 and no compression. Larger transfers amortize the
  handshake so overhead trends slightly lower; tiny interactive traffic (single
  keystrokes) has a much higher *ratio* but negligible absolute bytes.
- AWS meters data-out at its own boundary; `ens5 tx` is a very close proxy.
  Confirm against Cost Explorer / CloudWatch `NetworkOut` for billing-exact
  figures. Pricing figure is indicative — verify current ap-south-1 rates.
