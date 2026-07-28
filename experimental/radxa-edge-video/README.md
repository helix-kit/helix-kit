<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Radxa edge video — hardware multi-camera grid + WebRTC (experimental)

A DeepStream-equivalent video pipeline built from scratch on a **Radxa Cubie
A7Z** (Allwinner **A733**) board, using the SoC's hardware video codec engine
(**Cedar / VE**) instead of a Jetson. It decodes four camera streams in
hardware, composites them into a 2×2 grid, shows the grid locally on the
DisplayPort output, and simultaneously encodes it in hardware and streams it out
over WebRTC.

The Radxa is a **practice board** — the intended targets are Jetson Nano / x86 /
Raspberry Pi. The point of this experiment is to prove the full
decode → compose → (process) → encode → display + stream loop on cheap edge
hardware, and to understand exactly how portable such a pipeline is across
vendors (see [Portability](#portability)).

> Status: prototype / lab notes. Everything here runs; nothing is wired into the
> main Helix build. The recommended, working configuration is
> [`src/hwgrid_hybrid_opt.c`](src/hwgrid_hybrid_opt.c).

![Clean 2×2 hardware grid, decoded back from the WebRTC stream](images/hybrid-grid-clean.png)

*The 2×2 grid, hardware-decoded → composited → hardware-encoded → streamed, then
decoded back from the published stream to verify. ~1.56 of 8 CPU cores.*

---

## 1. The hardware

The A733 has several independent accelerator blocks. This experiment uses the
video codec engine; the GPU and NPU are noted for context / future work.

| Block | What it is | Node / API | Used here |
| --- | --- | --- | --- |
| **Cedar / VE** | Video codec engine — a **separate** H.264/H.265/… decoder (`ve-dec`, 624 MHz) **and** encoder (`ve-enc0`, 624 MHz) | `/dev/cedar_dev`, proprietary `libcedarc` | ✅ decode + encode |
| **GPU** | PowerVR BXM-4-64 (600 MHz) | `pvrsrvkm` + `sunxi-drm` | display scanout only |
| **NPU** | Vivante VIP9000, 3 TOPS INT8 (1008 MHz) | `/dev/vipcore`, VIPLite 2.0 / awnn | ✅ YOLOv5 detection ([docs/01](docs/01-npu-object-detection.md)) |
| **Display Engine** | `sunxi-drm` KMS, DP-1 = connector 153 | DRM/KMS | ✅ local display |

The VE is a **single hardware block** the kernel driver arbitrates; multiple
decode contexts + an encode context can run concurrently but contend on it (see
[Safety](#4-safety-the-ve-can-hard-hang-the-board)).

---

## 2. Architecture

```
                    ┌── kmssink (DP-1) ─────────────► local 2×2 display
 4× RTSP ─► HW ─► compositor ─► tee ─┤
 cameras   decode   (2×2)            └── HW encode ─► RTMP ─► MediaMTX ─► WebRTC
                                                                          (cloud clients)
```

- **Decode**: 4 H.264 streams, hardware-decoded to NV12/NV21.
- **Composite**: GStreamer `compositor` scales each to a 640×360 cell → 1280×720.
- **Tee**: the composited grid fans out to two consumers with zero re-decode.
- **Display**: scaled to the panel's native mode and scanned out via DRM/KMS.
- **Encode**: the grid is hardware-encoded to H.264 and published via RTMP to a
  [MediaMTX](https://github.com/bluenviron/mediamtx) relay, which re-serves it as
  WebRTC (WHEP) / RTSP to remote clients.

The intended production use is to insert an **image-processing stage** (object
detection + bounding-box overlay on the NPU) between compose and encode, so the
*processed* grid is what gets displayed and streamed.

---

## 3. What each file is

Built in this order; later files supersede earlier ones. The **recommended**
program is `hwgrid_hybrid_opt.c`.

### Milestones (libcedarc, direct VE)
| File | What it proves |
| --- | --- |
| [`src/hwdec.c`](src/hwdec.c) | Minimal Cedar HW **decode** of an annexb `.h264` file → NV12 frame. ~2% CPU. Establishes the libcedarc init/feed/teardown dance. |
| [`src/hwdisp.c`](src/hwdisp.c) | Decode → **DRM/KMS scanout** of the decoder's DMABUF (`nBufFd`), zero-copy. 7 MB PSS, ~2% CPU. (Exhibits the green-lines artifact — see below.) |
| [`src/hwgst.c`](src/hwgst.c) | Bridges Cedar into GStreamer for one camera via `appsink`/`appsrc`. |
| [`src/hwgrid.c`](src/hwgrid.c) | 4-camera 2×2 grid, **software** x264 encode. |

### Safe lifecycle (the VE-deadlock fix)
| File | What it adds |
| --- | --- |
| [`src/hwgrid_safe.c`](src/hwgrid_safe.c) | 4-decoder grid + **graceful teardown** (signal → stop feeds → join → `DestroyVideoDecoder`+`CdcVeRelease` → `CdcMemClose`) + watchdog. Proven leak-free across repeated start/stop. |
| [`src/hwgridhe.c`](src/hwgridhe.c) | First attempt at Cedar **HW encode** — *broken* bitstream (kept for reference). |
| [`src/hwgridhe_safe.c`](src/hwgridhe_safe.c) | 4-decoder + **working Cedar HW encode** + safe teardown. Full VE decode+encode path. |

### Portable / recommended (OMX decode + Cedar encode)
| File | What it is |
| --- | --- |
| [`src/omxgrid.sh`](src/omxgrid.sh) | 100% stock-GStreamer grid using the vendor **OMX** codec elements (no custom C). Decode works great; OMX *encode* is broken (see below). |
| [`src/hwgrid_hybrid.c`](src/hwgrid_hybrid.c) | **Hybrid**: `omxh264dec` decode (stock GStreamer) + libcedarc HW encode. Clean image, no green lines. |
| [`src/hwgrid_hybrid_opt.c`](src/hwgrid_hybrid_opt.c) | **★ Recommended.** Hybrid with the redundant `videoconvert` removed (compositor converts NV21→NV12 itself). ~1.56 cores. |

### Diagnostics
| File | What it does |
| --- | --- |
| [`src/veleak.c`](src/veleak.c) | Create/feed/destroy N decoders in a loop; asserts dma_buf returns to baseline (leak test). |
| [`src/encleak.c`](src/encleak.c) | Same for the encoder. |
| [`src/encdump.c`](src/encdump.c) | Dumps the raw encoder bitstream + toggles `bEncH264Nalu`; how the encode format was reverse-engineered. |

### NPU detection + standalone display (see [`docs/`](docs/))
| File | What it is |
| --- | --- |
| [`src/npu_grid_display.cpp`](src/npu_grid_display.cpp) | **★ The detection appliance.** 4-stream decode → YOLOv5 on the NPU → 2×2 composite → Cedar HW encode → WebRTC **+ standalone direct-DRM display**. Runs as `npu-detgrid.service`. ([docs/01](docs/01-npu-object-detection.md), [docs/02](docs/02-standalone-display.md)) |
| [`src/npu_grid.cpp`](src/npu_grid.cpp) | Single-threaded 4-stream NPU throughput probe (no encode/display). |
| [`src/npu_bench.c`](src/npu_bench.c) | Bare single-image NPU latency probe. |
| [`src/drmshow.c`](src/drmshow.c) | Minimal direct-DRM RGB primary-plane test — how the 1080p DP path was proven. |
| [`src/boardtop.sh`](src/boardtop.sh) | A733 accelerator + memory monitor ([docs/03](docs/03-accelerator-telemetry.md)). |
| [`src/build_split.sh`](src/build_split.sh) | `-O1` split compile that survives the 1 GB board OOM killer. |
| [`src/npu-detgrid.service`](src/npu-detgrid.service) | Durable systemd unit (display + WebRTC, `Conflicts=sddm`). |

---

## 4. Safety: the VE can hard-hang the board

This is the most important operational finding.

- Running many concurrent Cedar contexts (4 decoders + 1 encoder) and then
  `kill -9`-ing the process **mid-VE-ioctl** wedges the driver: threads get stuck
  uninterruptibly in `_compat_cedardev_ioctl` (**D-state**), unkillable, holding
  **leaked dma_heap buffers** (observed: 505 MB). `free` shows huge "used" with
  little live memory.
- **`systemctl reboot` does not reliably recover it** — on this BSP the software
  shutdown completes but the *kernel restart hangs* on the wedged VE, leaving the
  board dead (no SSH, frozen display) until power is **physically pulled**.
- **The fix is a graceful teardown** so the process never gets `kill -9`'d mid-op:
  stop feeding → let in-flight ioctls finish → join threads → destroy/release
  every VE context (`DestroyVideoDecoder`/`VideoEncUnInit` + `CdcVeRelease`) →
  `CdcMemClose`. A watchdog thread `_exit()`s if teardown ever wedges.
- Verified: repeated start/stop cycles of the full 4-decoder + HW-encoder
  pipeline each return dma_buf to **0**, no D-state, no accumulation.

**Rule:** never `kill -9` a running VE program — send `SIGTERM`/`SIGINT` and let
it tear down. If the VE ever does deadlock, only a physical power cycle recovers.

---

## 5. Cedar HW encode — the three fixes

The vendor `libcedarc` encoder is usable but has non-obvious requirements
(reverse-engineered with `encdump.c`):

1. **`cfg.bEncH264Nalu = 0`** (not `1`). The flag is inverted from its name:
   `=1` emits length-prefixed AVC *and* returns a garbage SPS/PPS from
   `VideoEncGetParameter`; `=0` emits clean **annexb** slices *and* a **valid**
   annexb SPS/PPS. With `=0` no bitstream conversion is needed.
2. **`AlreadyUsedInputBuffer()`** after `VideoEncodeOneFrame`, before
   `ReturnOneAllocInputBuffer`. Missing this exhausts the input pool and the
   encoder **stalls after exactly `nBufferNum` (4) frames**.
3. **Prepend the captured SPS/PPS before every keyframe** (`nFlag &
   VENC_BUFFERFLAG_KEYFRAME`). The encoder emits no inline SPS/PPS, so late
   WebRTC joiners can't decode without this.

`VencOutputBuffer.pData0/pData1` is a **ring-buffer wrap** — concatenate both
parts for one frame.

The green horizontal streaks visible in the *hand-written libcedarc decode*
(`hwdisp.c`, `hwgridhe_safe.c`) are a reference-frame/cache bug in that decode
loop — **not** an encode defect, and **not** present when decoding with OMX:

| libcedarc decode (green lines) | OMX decode (clean) |
| --- | --- |
| ![](images/libcedarc-decode-green-lines.png) | ![](images/omx-decode-clean.png) |

---

## 6. Portability

**Yes — a single generic GStreamer pipeline works across Radxa / RPi / Jetson;
you swap only the codec element.** Everything else (`compositor`, `tee`,
`kmssink`, `flvmux`, `rtmpsink`, `videoscale`) is stock and unchanged.

| Platform | Decode element | Encode element | Memory |
| --- | --- | --- | --- |
| Jetson | `nvv4l2decoder` | `nvv4l2h264enc` | NVMM |
| Raspberry Pi | `v4l2h264dec` | `v4l2h264enc` | DMABUF (V4L2) |
| Intel/AMD | `vah264dec` | `vah264enc` | VASurface/DMABUF |
| **Radxa (A733)** | **`omxh264dec`** ✅ | ~~`omxh264videoenc`~~ ❌ → libcedarc | OMX / DMABUF |

Select per platform via `decodebin3` (rank-based auto-pick) or a config'd element
name. The portable zero-copy currency is **DMABUF + GStreamer caps features**.

**The real-world caveat, proven here:** the element slots in, but *vendor plugin
quality varies*. On this Radxa BSP:

- `omxh264dec` (decode) **works great** — clean image (no green lines), outputs
  `video/x-raw(memory:DMABuf)`, GStreamer manages the VE lifecycle so it tears
  down with no D-state / no leak. **Use it** instead of the hand-written decode.
- `omxh264videoenc` (encode) is **vendor-broken** — it never emits an SPS (output
  is AUD + PPS + IDR, no NAL type 7), so the stream is undecodable and RTMP
  publish fails. No property fixes it. Hence the **hybrid**: OMX decode +
  libcedarc encode. On Jetson/RPi the encode is just `nvv4l2h264enc`/`v4l2h264enc`
  and the whole thing is pure GStreamer.

There is **no working V4L2 stateless codec** on this vendor kernel (`/dev/video*`
is empty; mainline `cedrus` is absent), which is why OMX is the only stock path.

---

## 7. Results (Radxa A733, 8 cores @ 1.79 GHz)

| Config | CPU | Notes |
| --- | --- | --- |
| Cedar HW decode (1 cam, `hwdisp`) | ~2% / 1 core | vs 5–40% software; 7 MB PSS |
| Software x264 grid (`hwgrid`) | ~37–55% total | software encode is the cost |
| Full libcedarc grid + HW encode (`hwgridhe_safe`) | loadavg ~1.5/8 † | all on VE; green lines |
| **Hybrid OMX decode + Cedar encode (`hwgrid_hybrid`)** | **2.30 cores** | clean image |
| **Hybrid, optimized (`hwgrid_hybrid_opt`)** | **1.56 cores** | dropped 4× `videoconvert`; clean |

The **bold** figures are accurate `/proc`-delta measurements of total process CPU.
† `hwgridhe_safe` was only sampled via 1-minute loadavg (which lags for a
~15 s run), so it under-reports and is **not** directly comparable — treat it as
"roughly a couple of cores" like the hybrids, not as cheaper than them.

The optimization: feed `omxh264dec ! queue` straight into `compositor` instead of
`omxh264dec ! videoconvert ! NV12 ! queue` — the compositor does the NV21→NV12
conversion *and* the scale in one pass (~32% CPU cut, colors correct).

---

## 8. Build & run

### Board prerequisites
Allwinner A733 BSP (Debian bullseye) with: `libcedarc` headers+libs, GStreamer
1.x + `gst-plugins-{base,good,bad}` + `gst-libav` + the vendor `omx` plugin.
GStreamer app headers via a locally-extracted
`libgstreamer-plugins-base1.0-dev` (`./gstdev`) — see [`build.sh`](build.sh).

### RTSP camera sources (on a laptop/dev box)
Any H.264 RTSP server works. This experiment used MediaMTX + ffmpeg looping a
file into `stream1`..`stream4`, and MediaMTX also relays the grid out as WebRTC:
```sh
# MediaMTX serves rtsp:8554 (in), rtmp:1935 (grid in), rtsp:8555 / webrtc:8889 (out)
mediamtx &
for i in 1 2 3 4; do
  ffmpeg -re -stream_loop -1 -i input.mp4 -an -c:v copy -bsf:v h264_mp4toannexb \
    -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/stream$i &
done
```

### Build + run on the board
```sh
scp -r src build.sh radxa@<board>:/home/radxa/cedar/
ssh radxa@<board>
cd /home/radxa/cedar
systemctl stop sddm        # free the DP/DRM master for kmssink (bare-KMS). DO NOT reboot.
./build.sh
./hwgrid_hybrid_opt <laptop-ip>      # SIGTERM / Ctrl-C to stop cleanly
```
View the grid at `http://<laptop-ip>:8889/grid` (WebRTC). Stop with `SIGTERM`
(never `kill -9`).

### Validate the encoded stream
```sh
gst-launch-1.0 rtspsrc location=rtsp://<laptop-ip>:8555/grid ! rtph264depay ! \
  h264parse ! avdec_h264 ! videoconvert ! pngenc ! multifilesink location=/tmp/f%03d.png
# view a LATE frame — the first is a P-frame w/o its IDR (looks like noise)
```

---

## 9. Gotchas

- **Never `kill -9` a VE program** — graceful `SIGTERM` only (§4).
- **`systemctl reboot` is unreliable on this board** — it hangs at the kernel
  restart; a physical power cycle is the only sure recovery.
- **DP is over USB-C alt-mode = 2 lanes** — the monitor is on the USB-C
  DisplayPort-alt-mode port, which shares lanes with USB3 and brings up only
  **2 DP lanes**. `2560x1440@60` (248 MHz) **cannot link-train** on 2 lanes
  (backlight stays off = black); use the panel's EDID-**preferred**
  `1920x1080@60`. Enumerate with `modetest -M sunxi-drm -c` (connector 153 =
  DP-1). Full write-up: [docs/02](docs/02-standalone-display.md). *(An HDMI cable
  on connector 147 would likely give 4 lanes and allow 1440p.)*
- **Run on bare KMS** — `systemctl stop sddm` first so `kmssink` gets the DRM
  master; don't fight the KDE compositor for DP-1.
- **`snapshot=true` grabs the first frame** = a P-frame without its IDR ref =
  looks like noise. Capture many frames and view a later one.
- **Process names truncate to 15 chars** — `pgrep -x hwgrid_hybrid_opt` never
  matches (`hwgrid_hybrid_o`); use `pgrep -f` and grab the PID once.
- **No RTC** — the board's clock resets each boot; journal wall-clock timestamps
  are unreliable across boots (use `journalctl --list-boots`).

---

## 10. Follow-on work (built on top of this — see `docs/`)

The base grid grew into a full detection appliance. Deep-dives:

- **[NPU object detection](docs/01-npu-object-detection.md)** ✅ — YOLOv5 on the
  VIP9000 NPU, composited into the grid before encode. The actual
  DeepStream-equivalent (decode → detect → annotate → compose → encode →
  display/stream). ~21 inf/s, 2-worker pipelined.
- **[Standalone on-device display](docs/02-standalone-display.md)** ✅ — direct-DRM
  RGB scanout of the detection grid onto the DP monitor, no laptop/WebRTC. Includes
  the multi-hour DP-alt-mode black-screen root cause and the macroblock-padding
  seam fix.
- **[Accelerator telemetry](docs/03-accelerator-telemetry.md)** ✅ — `boardtop.sh`.
- **[Profiling & analysis](docs/04-profiling-and-analysis.md)** — memory/CPU,
  Jetson comparison, USB-camera feasibility.
- **[Operational gotchas](docs/05-operational-gotchas.md)** — the problems faced.

Still open:

- **Wrap the libcedarc encode as a real GStreamer element** (`cedarenc`) so even
  the Radxa path is a pure, portable pipeline.
- **Eliminate the fp32 output copy** (postprocess on the raw INT NPU output) — the
  biggest remaining CPU cost (~16 ms/inference).
- **Debug the libcedarc green-lines** decode bug (moot if we standardize on
  `omxh264dec`, which is clean).
- **Wrap `boardtop.sh` as `helix device board-top`** (one developer entry point).
- **View switching** with zero memory for stopped views (process-per-view,
  kill-to-free) — the browser kiosk is one switchable view alongside the camera
  grid.
