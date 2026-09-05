<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Remote Desktop as a Helix Device Capability — Resource Analysis

Date: 2026-08-14

Helix already exposes two remote-access capabilities to the browser: a **remote
shell** (PTY over the data plane) and **port forwarding** (a device-local TCP
port tunnelled to the cloud). This document asks what it costs to add a third —
**remote desktop** — and answers it with measurements rather than estimates.

Everything below was measured on 2026-08-14 against two live machines:

- **Laptop** — x86_64, 12 cores, 14 GiB RAM, Ubuntu, GNOME on Wayland. Running
  Apache Guacamole + guacd in Docker, driving `gnome-remote-desktop` on :3389.
- **Radxa Cubie A7Z** (`192.168.1.59`) — Allwinner **A733**, 8× Cortex-A55 @
  2.0 GHz, **961 MB RAM**, 480 MB swap, 59 GB eMMC, kernel 5.15. Running the
  Helix device runtime (`helixd`, runtime-manager, shell, port-forward).

---

## 1. The layer decomposition

Remote desktop is not one component. It is five, and they have very different
costs and very different homes:

| # | Layer | What it does | Where it runs |
| --- | --- | --- | --- |
| 1 | **Session** | The desktop being viewed — X/compositor, apps | Device |
| 2 | **Capture + encode** | Framebuffer → compressed updates | Device |
| 3 | **Input injection** | Browser mouse/keyboard → the desktop | Device |
| 4 | **Transport** | Updates + input events across the network | Device ⇄ cloud ⇄ browser |
| 5 | **Gateway + client** | Protocol translation, rendering the pixels | Cloud + browser |

**Guacamole is layers 4–5 only, and it belongs on the central server.** The
device runs a standard VNC or RDP server, which covers layers 2 and 3. This is
the correct reading of the Guacamole architecture and it is the baseline this
document evaluates.

The two facts that drive every conclusion below:

- **Layers 2 and 3 come as one package.** VNC and RDP are complete protocols —
  capture, encode, input injection, clipboard, cursor, and resolution
  negotiation all solved. Anything that replaces them must reimplement layer 3,
  which is not free.
- **Helix already owns layer 4.** The device data plane (`helix-port-forward`,
  running on the board today) tunnels an allow-listed TCP port over the WebRTC
  peer. A VNC server is just another target on it.

---

## 2. Measured: the Guacamole stack

### 2.1 Footprint (measured on the laptop, all components co-located)

| Component | Layer | Resident always | Per session | CPU (session, idle desktop) |
| --- | --- | --- | --- | --- |
| `guacamole` webapp (Tomcat 9 / JDK 21) | 5 | **238 MB RSS** | — | 4.5 % |
| `guacd` parent (listener) | 5 | **12.2 MB RSS** | — | 0 % |
| `guacd` session child (forked per connection) | 5 | — | **141 MB RSS** | **10.9 %** |
| `gnome-remote-desktop` (RDP server) | 2+3 | listener only | **292 MB RSS** | **11.7 %** |

Docker images on disk: **1.51 GB** (`guacamole/guacamole` 1.13 GB +
`guacamole/guacd` 378 MB).

**In the correct deployment these split across two machines:** the 238 MB JVM
and the 141 MB-per-session `guacd` child are **cloud-side**; only the RDP/VNC
server is device-side. The device therefore pays ~292 MB for
`gnome-remote-desktop` — or far less for a plain VNC server (§3.3).

### 2.2 What the cloud side actually costs

`guacd`'s fork-per-connection design means its idle cost is genuinely small
(12.2 MB). The JVM is the fixed tax: **238 MB resident 24/7 regardless of
sessions**, plus **141 MB per concurrent session**. On the appliance that is
affordable — but note it scales linearly with concurrency, and every pixel is
relayed through the cloud box (§5.2).

---

## 3. Measured: the Radxa A733 board

### 3.1 Idle state, as found

```
Mem:   961 MB total,  287 MB used,  609 MB available
Total RSS across all processes: 433 MB
Load average: 0.02
```

| Process | RSS |
| --- | --- |
| `sddm-greeter` | **119.5 MB** |
| `X` | **28.0 MB** |
| `sddm` + `sddm-helper` | **27.6 MB** |
| `helixd` | 24.8 MB |
| `NetworkManager` | 16.2 MB |
| `helix-runtime-manager` | 8.7 MB |
| `helix-shell` | 7.8 MB |

**SDDM + X are 171 MB — 18 % of the board's RAM — rendering a login screen to
nothing.** Both DRM connectors report `disconnected`. Masking SDDM reclaims
171 MB immediately; this is worth doing regardless of remote desktop.

The Helix runtime is cheap: `helixd` + runtime-manager + shell + port-forward
≈ **58 MB total**.

Hardware present: **Cedar VE** (H.264 encoder + decoder) at `/dev/cedar_dev`,
KMS at `card0`/`card1`/`renderD128`. Not installed: ffmpeg, GStreamer, VNC, any
desktop. (`ffmpeg`, `tigervnc-standalone-server`, `x11vnc`, `x11-apps` and
`x11-xserver-utils` were installed on the board for these benchmarks and can be
removed with `apt-get remove`.)

### 3.2 Measured: VNC on the board — the Option-B device cost

Headless `Xvnc` (TigerVNC, X server + VNC server in one process) at
**1280×720×24**, Tight encoding, driven by a real RFB client on the board
requesting incremental updates at 30 Hz. Xvnc CPU is a `/proc` delta on the
server process alone; bandwidth is bytes actually delivered to the client.

| Scenario | Xvnc CPU | Bandwidth |
| --- | --- | --- |
| **Static desktop** | **0.9 %** of 1 core | ~0 KB/s |
| **Paced text, ~20 lines/s** (realistic admin work) | **5.7 %** of 1 core | 1.2 KB/s |
| Text flood (`yes` scrolling as fast as possible) | 103.5 % of 1 core | 7.9 KB/s |
| Full-screen image blits (`x11perf -putimage500`) | 97.5 % of 1 core | 164 KB/s (1.34 Mbit/s) |
| **Full-screen video, 720p30** | 51.7 % of 1 core | **2640 KB/s (21.6 Mbit/s)** |

Memory: **47.4 MB RSS idle** (listening, no client) → **54.9 MB** with a client
connected.

Read carefully:

- **For the actual use case — administering a device, clicking through a UI,
  reading logs — VNC costs 5.7 % of one core, 1.2 KB/s, and ~50 MB.** That is
  cheap enough to be uninteresting. The user is right that this architecture
  fits the device.
- The two ~100 % rows are **X server rendering cost, not VNC encoding cost** —
  the flood and blit tests make X draw as fast as it can. They are worst cases,
  not representative.
- **The real weakness of VNC is bandwidth under motion, not CPU.** 21.6 Mbit/s
  for full-screen video. RFB has no temporal compression — it ships changed
  tiles, so animation costs roughly what the pixels cost.

### 3.3 Measured: software H.264 encode capability (the alternative to VNC)

10-second clips of moving content, `libx264 -tune zerolatency`. **`cores to
sustain`** is `cores busy ÷ realtime factor`, with separately-measured
source-generation overhead subtracted.

| Configuration | cores busy | realtime | **cores to sustain 30 fps** |
| --- | --- | --- | --- |
| *source only, 720p (baseline)* | 1.00 | 8.46× | *0.12* |
| *source only, 1080p (baseline)* | 1.00 | 4.45× | *0.22* |
| 720p30 ultrafast, 4 threads | 2.11 | 2.37× | **0.77** |
| 720p30 veryfast, 4 threads | 2.19 | 1.24× | **1.65** |
| 1080p30 ultrafast, 8 threads | 2.60 | 1.30× | **1.78** |
| 1080p30 veryfast, 8 threads | 3.02 | **0.81×** | **not achievable** |
| 720p15 ultrafast, 2 threads | 1.43 | 2.80× | **0.39** |

1080p30 at `veryfast` cannot be sustained (~24 fps ceiling); x264's threading
efficiency, not core count, is the limit — 8 threads kept only 3.02 cores busy.

With **Cedar hardware encode** these costs largely vanish. The
`experimental/radxa-edge-video` lab measured a full 4-stream decode + 2×2
composite + Cedar HW encode pipeline at **1.56 cores** (the four decodes
dominate), and single-stream HW decode at **~2 % of one core**.

The comparison that matters: **H.264 delivers the 21.6 Mbit/s video case at
roughly 2–4 Mbit/s** — a 5–10× bandwidth reduction — at a cost of 0.77 cores in
software or a few percent on Cedar.

---

## 4. Answering the specific questions

### 4.1 Docker vs. running natively on device hardware

**Essentially zero CPU/RAM delta.** Docker here is namespaces and a bridge NIC,
not virtualization. The measurable costs are disk (1.51 GB of images) and base
image bloat. Moving Guacamole out of Docker onto metal saves the image on disk
and roughly zero RAM — the cost is the JVM, not the container. Since Guacamole
runs on the server anyway, this is not a device concern at all.

### 4.2 On-demand — what does idle actually cost?

| Component | Idle cost | Where |
| --- | --- | --- |
| Guacamole webapp (JVM) | **238 MB**, always | Cloud |
| `guacd` listener | 12.2 MB | Cloud |
| `Xvnc` listening, no client | **47.4 MB** | Device |
| `Xvnc` spawned per session | **0** | Device |
| `helix-shell`-style service stub | ~8 MB | Device |

Helix already has the on-demand pattern in production on this board:
`helix-shell.service` sits at **7.8 MB** and spawns a PTY per session. A VNC
server can be socket-activated or spawned by the same supervisor, taking the
device-side idle cost to **~8 MB and 0 % CPU**. This is the HELIX-148
demand-gating model applied to a different resource.

The caveat: **on-demand only helps layers 2–5.** If the device runs a desktop
session so there is something to look at (layer 1), that memory is spent whether
or not anyone connects.

### 4.3 Is there even a desktop to remote into?

The board today runs **no desktop**. KDE Plasma *is* installed
(`plasma-desktop` 5.20.5, `startplasma-x11`, `plasmashell`, `kwin_x11` all
present), but nothing is running it: SDDM is sitting at its **login greeter** on
`:0`, no user has logged in graphically, and both physical connectors report
`disconnected` — there is no monitor attached. A greeter is not a session.

Starting a real Plasma session on the board settles the question empirically.
`startplasma-x11` comes up — `kwin_x11`, `kded5`, `kglobalaccel`, KSplash all
activate — and then:

```
oom-kill: task=plasmashell,pid=5534  anon-rss:603656kB
Out of memory: Killed process 5534 (plasmashell)
oom-kill: task=plasmashell,pid=6518  anon-rss:620288kB
Out of memory: Killed process 6518 (plasmashell)
```

On the **VNC** display, `plasmashell` ballooned to **603–665 MB** and was
OOM-killed four times. That looked like "KDE does not fit on a 1 GiB board".

**It is not.** On the board's own physical display, with a monitor attached and
the same 1 GiB of RAM, the same Plasma session runs comfortably — *and so does
Chrome*:

| Process | RSS on the physical display `:0` |
| --- | --- |
| `chrome` (6 processes) | ~400 MB total |
| **`plasmashell`** | **41.5 MB** |
| `X` | 20 MB |
| `kwin_x11` | 14.8 MB |

`Mem: 603 used / 261 available` of 961 MB, swap 321 MB, **zero OOM kills**.

**`plasmashell` is 41.5 MB there and was 603–665 MB on `Xvnc` — a 15× difference
for the same binary.** The desktop was never the problem. Two things were:

1. **No GPU on the VNC display.** `Xvnc` exposes no DRI/GLX, so Plasma's QtQuick
   scene graph falls back to software GL (llvmpipe/swrast), which allocates
   enormously — and grew on each restart (603 → 620 → 661 → 665 MB), i.e. it was
   thrashing, not sizing.
2. **Two display stacks at once.** Those runs had SDDM's greeter (~110 MB) *and*
   its X server on `:0` *and* `Xvnc` on `:9` all resident, before Plasma asked
   for anything. A logged-in session on `:0` has one X server and no greeter.

### Verified: KDE over VNC works once Qt Quick stops asking for GL

Re-running Plasma on the same `Xvnc :9`, as the sole window manager, with the
session capped in a cgroup at 300 MB:

```sh
QT_QUICK_BACKEND=software   # Qt Quick raster renderer instead of the GL scene graph
KWIN_COMPOSE=Q              # kwin composites with XRender, not OpenGL
```

| | `plasmashell` | `kwin_x11` | whole session |
| --- | --- | --- | --- |
| `:0`, real GPU | 41.5 MB | 14.8 MB | — |
| **`:9`, software backend** | **169 MB** | **35.3 MB** | **261 MB** |
| `:9`, GL fallback (no env vars) | 603–665 MB | 14 MB | OOM-killed ×4 |

The desktop renders correctly — wallpaper, panel, system tray, clock — and is
stable. So `QT_QUICK_BACKEND=software` is worth **~3.5×** and turns an
unbootable session into a working one, though it is still ~4× the GPU-backed
cost. Both variables are now set by `/usr/local/bin/helix-vnc-session` on the
board when `HELIX_VNC_SESSION=plasma`.

> A first attempt at this measurement reported 18 MB and was **wrong**: openbox
> was still running as the window manager on `:9`, so kwin never took over and
> plasmashell mapped no windows — a shell that renders nothing is cheap. The
> tell was `0x2000e3 "Openbox"` in `xwininfo -root -tree` and plasmashell's CPU
> ticks frozen in `poll`. Always confirm the desktop actually mapped windows
> before believing a memory number.

So the correct reading is: **1 GiB is fine for this board's desktop** — the
measurement was an artifact of the environment it was taken in, not a property
of KDE. See HELIX-208 for the (separate, now symptom-free) question of whether
the device tree's 1 GiB memory node under-reports the physical RAM.

On this class of hardware:

- A **full GNOME session** is 400 MB+ (the laptop's `gnome-shell` alone measured
  **307 MB**).
- **KDE Plasma fits fine** — 41.5 MB for `plasmashell` + 14.8 MB for `kwin_x11`
  on the physical display, with Chrome alongside it (§4.3).
- A **minimal compositor** (labwc/sway/weston) + terminal is ~40–80 MB.
- A **headless `Xvnc`** with no desktop at all is 47 MB — and for a virtual
  remote session that is often all you need.
- The **Chromium kiosk** already built for this board in
  `experimental/kiosk-display` measured **~299 MB** after optimization.

So on the Radxa, "remote desktop" realistically means **a headless Xvnc virtual
session, or a window onto the kiosk UI** — not a general-purpose desktop. A full
desktop is a 2 GB+ hardware requirement, not a software optimization.

### 4.4 Does a WebRTC video track give mouse and keyboard control?

**Not by itself — a media track is one-way.** But the input question splits in
two, and only one half is solved:

- **Transport of input events: already solved.** The Helix peer carries a
  bidirectional DataChannel mux alongside media tracks. Remote shell already
  sends keystrokes device-ward over it, and the LVGL device UI already streams a
  framebuffer out and takes `pointer` events back
  (`docs/16-Device-UI-LVGL.md`).
- **Injection into a real desktop: genuinely new code.** Turning a browser
  `mousemove`/`keydown` into an X or Wayland input event means `XTEST`, `uinput`,
  or the wlroots virtual-pointer/virtual-keyboard protocols — plus clipboard
  sync, cursor shape, and resolution renegotiation. **VNC and RDP give all of
  this for free.** This is the strongest argument for the VNC/RDP-on-device
  architecture and the main thing §6 of the previous revision of this document
  under-weighted.

---

## 5. Options, compared

Device-side figures are for the Radxa; cloud-side figures are what the appliance
carries.

| Option | Device RAM | Device CPU (real admin use) | Cloud cost | Input/clipboard | Video bandwidth |
| --- | --- | --- | --- | --- | --- |
| **A.** Guacamole + guacd on server, **VNC/RDP on device** | 47–55 MB (Xvnc) | **5.7 %** of a core | 238 MB JVM + 141 MB/session | ✅ free | 21.6 Mbit/s, **relayed through cloud** |
| **B.** noVNC in browser, **VNC on device over the Helix data plane** | 47–55 MB | **5.7 %** of a core | **~0** (tunnel only) | ✅ free | 21.6 Mbit/s, **P2P — bypasses cloud** |
| **C.** WebRTC H.264 media track | ~25 MB + encoder | 0.77 cores (x264) / ~2–5 % (Cedar) | ~0 (signaling) | ❌ must build | **2–4 Mbit/s**, P2P |

### 5.1 Why option B is attractive

The device half already exists. `helix-port-forward` is running on the board
now, and `HandleOpen` gates on an allow-list of `host:port` targets
(`linux/device/go/internal/portforward/service.go:85`):

```go
if _, ok := r.allowed[req.Target]; !ok {
    return generated.PortForwardSessionOutput{}, fmt.Errorf("target not allowed: %s", req.Target)
}
```

Adding `127.0.0.1:5909` to `allowedTargets` makes a VNC server reachable over
the existing WebRTC data plane with **zero new device code**.

The browser half is a small adapter, not a new stack. `HelixStream`
(`web/packages/protocol/src/stream/stream.ts:19`) already exposes exactly the
shape noVNC needs:

```ts
write(data: Uint8Array): Promise<void>
onData?: (chunk: Uint8Array) => void
close(): void
```

noVNC's `RFB` class accepts a custom WebSocket-like transport, so bridging it
onto a `HelixStream` is on the order of tens of lines. **Caveat: the
browser-side port-forward consumer is not built yet** — `linux-port-forward` is
currently only a feature-flag declaration
(`web/apps/helix/src/features/linux-port-forward.mts`), so the UI/route is real
work, though it sits on the already-built peer + stream machinery used by remote
shell and the file browser.

### 5.2 The cloud-egress argument

This is where A and B genuinely differ. Guacamole relays every pixel through the
appliance. At the measured **21.6 Mbit/s** for a video-heavy desktop, and given
the egress economics established in `experimental/bandwidth` (≈1.07× egress /
2.13× total per session byte on the EC2 box), that is a real running cost that
scales with concurrent sessions. Option B rides the existing P2P peer — the
`experimental/p2p-transport` work established 128 MB of payload for 5.7 KB of
cloud signaling — so the cloud carries essentially nothing.

---

## 6. Recommendation

**Build option B; keep Guacamole for what only Guacamole does.**

1. **Primary path — VNC on the device, noVNC in the browser, over the existing
   Helix data plane.** Device cost measured at ~50 MB and 5.7 % of one core for
   real administrative use, ~8 MB if spawned on demand. Input, clipboard, cursor
   and resize come free with RFB. No JVM anywhere, and no pixels through the
   cloud. The device side needs a config entry, not code.

2. **Keep Guacamole (server-side) as the multi-protocol gateway.** It earns its
   238 MB when you need RDP *and* VNC *and* SSH behind one auth model, session
   recording, or access to third-party endpoints Helix does not control. That is
   a real product capability — it is just not the cheapest way to reach a Helix
   device that already has a data plane.

3. **Treat the WebRTC H.264 track as an optimization, not a replacement.** It is
   the right answer only if video-heavy desktops matter, where it turns
   21.6 Mbit/s into 2–4 Mbit/s and drops to a few percent of a core on Cedar.
   It costs building input injection, clipboard and resize from scratch — so it
   should be a second encoder behind the same session UI, chosen per session,
   not a fork of the whole feature.

4. **Free win, independent of all of the above:** mask SDDM + X on the Radxa and
   reclaim **171 MB**.

### Suggested sequencing

1. Mask SDDM/X on the board (171 MB back).
2. Add a VNC target to the port-forward allow-list; verify the tunnel end-to-end
   with the existing e2e harness (`linux/device/go/internal/portforward/e2e_test.go`).
3. Build the browser-side port-forward route and bridge noVNC onto `HelixStream`.
4. Socket-activate or supervisor-spawn `Xvnc` so idle cost is ~8 MB.
5. Fold session auth into the HELIX-129 remote-shell security model — same
   problem, solved once.
6. *Later, if video matters:* add a Cedar-encoded H.264 track as an alternate
   encoder behind the same session UI.

---

## 7. Implementation — what was built and proven

Option B is implemented and verified end to end against the Radxa board.

### Device side — configuration only, no new code

The `helix-port-forward` service already dials an allow-listed `host:port` per
data-plane stream, so exposing VNC is a drop-in:

```jsonc
// /etc/helix/conf.d/port-forward.json
{ "allowedTargets": ["127.0.0.1:5909", "127.0.0.1:8080"] }
```

A `helix-vnc.service` unit runs `Xvnc :9 -geometry 1280x720 -depth 24` plus a
session (`/usr/local/bin/helix-vnc-session`, switched by `HELIX_VNC_SESSION`;
`openbox` fits, `plasma` OOMs per §4.3).

### Browser side — a new device app

`@helix-hq/device-apps/src/linux-remote-desktop/`:

| File | Role |
| --- | --- |
| `novnc-transport.ts` | Adapts a Helix `DeviceChannel` into noVNC's "raw channel" (WebSocket/RTCDataChannel) shape |
| `rfb.ts` | Local types for noVNC (it ships none) + the dynamic loader |
| `desktop.tsx` | The viewer: session lifecycle, transport picker, view-only / scale / Ctrl+Alt+Del, byte counters |
| `surface.tsx`, `app.ts` | Device-app surface and registration, gated on `linux-port-forward` |

It reuses `useDataPlaneSession`, `openRelayChannel` / `openPeerChannel` and
`TransportPicker` unchanged, so it inherits both transports for free.

### Two bugs the integration exposed

Both are recorded because they are the non-obvious part of bridging RFB onto a
credit-windowed mux:

1. **Send-buffer aliasing.** noVNC's `send()` hands out a *view onto its reused
   send buffer* and overwrites it immediately, while `HelixStream.write()` may
   hold the bytes until the credit window opens. Without a copy the stream ships
   whatever landed there next. `novnc-transport.ts` copies every frame.
2. **Open/data ordering.** `openPeerChannel` reports open *synchronously from
   inside its own call*, before it has returned the channel sends must go out
   on. Deferring the open event to a microtask fixes that but breaks the relay,
   which calls `confirmOpen()` and then delivers the server's greeting in the
   same synchronous step — noVNC then rejects the bytes with
   `Unknown init state`. The fix is to fire open synchronously and **buffer the
   early sends** until the channel arrives.
3. **Close events must be CloseEvent-shaped.** noVNC's `_socketClose(e)` reads
   `e.code`; passing no argument throws `Cannot read properties of undefined`.

### Verified

Against `radxa-a733-1` over the **relay** transport, with `Xvnc` + `openbox` on
the board:

- Desktop renders in the browser at 1280×720, live — a window opened on the
  device appeared with no reconnect.
- **Keyboard**: typing `id` returned
  `uid=1000(radxa) gid=1000(radxa) groups=…,107(render),108(gpio),109(spidev),110(pwm),116(i2c)`
  — unmistakably the board.
- **Mouse**: a click at the canvas centre put the remote pointer at
  **`x:639 y:359`** on a 1280×720 screen — the coordinate mapping is exact.
- Transport switching (relay → p2p → relay) tears down and re-attaches cleanly.
- `pnpm lint` + `pnpm typecheck` clean for `@helix-hq/device-apps` and the app.

**Not verified: the p2p transport.** `ice.config` returns
`401 — Sign in to use the P2P data plane`, so P2P needs an authenticated
session. The code path is shared with relay (that is the point of
`DeviceChannel`), but it has not been exercised.

### Device prerequisite found along the way

The board's device certificate had **expired on Aug 1** (24-hour leaf) and
`helixd` had been offline since, because `config.json` carried no `enrollment`
section and so could never renew. Enabling helixd's built-in CSR enrollment
fixes it permanently:

```jsonc
"enrollment": {
  "apiUrl": "https://helix-kit.com/api/certificates/device",
  "accessTokenFile": "/etc/helix/enrollment.token"
}
```

This also needs `/etc/helix/pki` to be group-writable by `helix` (it was
`root:root 0755`, so helixd could not write its own renewed leaf —
`open /etc/helix/pki/chain.pem.tmp: permission denied`). **Any device
provisioned without an `enrollment` section goes permanently offline after 24
hours**; that is worth fixing in the provisioning path, not per device.

---

## 8. Summary of measured numbers

| Measurement | Value |
| --- | --- |
| Guacamole webapp (Tomcat/JVM), resident — **cloud-side** | 238 MB RSS |
| `guacd` listener, idle — **cloud-side** | 12.2 MB RSS |
| `guacd` per-session child — **cloud-side** | 141 MB RSS, 10.9 % CPU |
| `gnome-remote-desktop`, session active | 292 MB RSS, 11.7 % CPU |
| Guacamole Docker images on disk | 1.51 GB |
| **Xvnc idle, no client (Radxa)** | **47.4 MB RSS** |
| **Xvnc with client connected (Radxa)** | **54.9 MB RSS** |
| **Xvnc, static desktop** | **0.9 % of 1 core, ~0 KB/s** |
| **Xvnc, realistic admin use (~20 lines/s)** | **5.7 % of 1 core, 1.2 KB/s** |
| Xvnc, text flood (worst case) | 103.5 % of 1 core, 7.9 KB/s |
| Xvnc, full-screen image blits | 97.5 % of 1 core, 1.34 Mbit/s |
| **Xvnc, full-screen 720p30 video** | **51.7 % of 1 core, 21.6 Mbit/s** |
| Radxa idle RAM used / available | 287 MB / 609 MB of 961 MB |
| Radxa SDDM + X (reclaimable) | 171 MB |
| Radxa Helix runtime (helixd + 3 services) | 58 MB |
| Radxa x264 720p30 ultrafast | 0.77 cores (~10 % of board) |
| Radxa x264 1080p30 ultrafast | 1.78 cores (~22 % of board) |
| Radxa x264 1080p30 veryfast | not sustainable (~24 fps ceiling) |
| Radxa x264 720p15 ultrafast | 0.39 cores |
| Radxa Cedar HW decode, 1 stream (lab) | ~2 % of one core |
| Radxa Cedar 4-decode + compose + HW encode (lab) | 1.56 cores |
| Laptop `gnome-shell` (desktop-cost scale) | 307 MB |
| **Radxa `plasmashell` on the physical display** | **41.5 MB** |
| Radxa `kwin_x11` on the physical display | 14.8 MB |
| Radxa Chrome (6 processes) alongside KDE | ~400 MB |
| Radxa `plasmashell` on `Xvnc`, `QT_QUICK_BACKEND=software` | **169 MB** (kwin 35.3 MB; session 261 MB) |
| Radxa `plasmashell` on `Xvnc`, GL fallback (no env vars) | 603–665 MB, OOM-killed ×4 — see §4.3 |
| Radxa Chromium kiosk, optimized (lab) | ~299 MB |
