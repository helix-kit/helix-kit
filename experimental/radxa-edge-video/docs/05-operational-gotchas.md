<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 05 — Operational gotchas & problems faced

Date: 2026-07-25

A running log of the non-obvious problems this session hit and how each was
diagnosed and fixed. These cost real time; they're written down so they don't
again.

---

## 1. WiFi starvation looked exactly like a pipeline bug (~1 hr lost)

**Symptom:** after a power-cycle the grid came up as **one blurry, stuck video
with artifacts** — the other three cells frozen, NPU near idle. It looked like a
decoder or driver regression.

**Root cause: the network, not the board.** The board has no Ethernet; it pulls
all 4 RTSP streams over WiFi. After the power-cycle it re-associated to a
**congested 2.4 GHz** SSID at **1.0 Mbit/s rx (MCS1), 1.5–2 second ping RTT** —
starved of H.264 data, so decoders froze.

**Tells of data starvation (vs a real bug):**
- MediaMTX logs `reader is too slow, discarding N frames`.
- `dma_buf` low (~50–100 MB, not ~380 MB).
- `viplite/core_loading` `Inference Time` counter **frozen**, `Core0 Idle`.
- On `systemctl stop`, the driver releases cleanly (no D-state, `dma_buf` → ~18 MB).

**Fix:** switch to the **5 GHz** SSID (chan 40) → **117 Mbit/s tx, 4 ms RTT** →
full clean 4-stream grid instantly. Set
`nmcli con mod "<5G>" connection.autoconnect-priority 20` so it prefers 5 GHz on
boot.

**Lesson:** when the grid is stuck but the driver releases cleanly on stop,
suspect **data starvation first** — check `iw dev wlan0 link` (bitrate/MCS) and
`ping` RTT before touching the pipeline. For a network-independent demo, run the
clips as **local files** (`filesrc`, ~30 MB total) instead of RTSP.

---

## 2. Board OOM kills the compiler

`g++ -O2` on the OpenCV-heavy `npu_grid_display.cpp` **OOM-kills `cc1plus`** on the
~1 GB board (both `earlyoom` — *"SIGTERM to cc1plus badness 735"* — and the kernel
OOM killer). Build recipe that survives ([`src/build_split.sh`](../src/build_split.sh)):

1. **Stop the ~300 %-CPU detection service first** (it saturates the board; SSH
   commands otherwise lag and return empty).
2. `sync; echo 3 > /proc/sys/vm/drop_caches`.
3. Compile with **`-O1`**, one translation unit at a time, then link.

---

## 3. Stale MediaMTX publisher after power loss

After the board lost power mid-stream, MediaMTX held a **stale `/detgrid`
publisher** from the dead RTMP connection, so the new publish was rejected
(*"Could not open resource"*) and `/detgrid` wouldn't play. Fix:
`docker restart mtx-webrtc` clears the stale publisher.

---

## 4. Display starvation via network round-trip

A display design where a **separate process pulled `/detgrid` back** over the
network and rendered it to `kmssink` **starved inference** — the extra ~1.5-core
decode saturated the board, the detection `rtspsrc` inputs hit i/o-timeout on
MediaMTX and **never reconnected**, and the NPU dropped to 0 %. Fixed by building
the display **into** the detection process (direct-DRM, see
[doc 02](02-standalone-display.md)).

---

## 5. Systemd / SSH launch traps

- A background process started via `sudo -S bash -c '... &'` over SSH **dies on
  SIGHUP** when the SSH/sudo parent exits (`setsid`/`disown`/`nohup` didn't
  reliably save it).
- Creating a unit file with a **heredoc inside** `sudo -S bash -c '...'` **silently
  fails** (nested quoting eats it), so `systemctl` kept reporting "unit not found".

**Rule:** for any durable board process, **scp the `.service` file** into place and
`systemctl enable --now` — never background-over-SSH, never heredoc-in-nested-sudo.
Likewise scp build scripts rather than pasting nested heredocs.

---

## 6. The DisplayPort saga (summary)

The multi-hour black-monitor debugging is written up in full in
[doc 02](02-standalone-display.md). One-line version: the **USB-C DP-alt-mode port
trains only 2 lanes**, so **2560×1440 can't link-train** (backlight off), while the
EDID-preferred **1920×1080 works** — and everything had 1440p hardcoded from a
wrong "native mode" note. Then a **macroblock-padding** artifact (decoder emits
1920×**1088**) showed as a magenta cell seam, invisible on the lossy stream but
crisp on direct RGB.
