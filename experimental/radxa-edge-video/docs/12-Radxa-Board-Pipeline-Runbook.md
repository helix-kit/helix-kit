<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 12 — Radxa A733 board: full-pipeline runbook (stock Debian OS)

Date: 2026-07-29

How to bring the **full 4-stream yolo11s e2e pipeline** (`helix_pipeline`) up on the Radxa Cubie A7Z
(A733) running the **stock Radxa Debian 11** image — decode (Cedar) → NPU (yolo11s) → overlay →
2×2 composite → encode (Cedar) → RTMP → WebRTC. Written because a fresh OS reinstall lost the setup
and it had to be reverse-engineered from a home-dir backup. **Do not lose this again.**

## The one big lesson: GStreamer was never "blocked"

Earlier notes claimed "GStreamer RTSP/WebRTC blocked by Radxa BSP packaging." **That was a false
signal.** The probe `gst-inspect-1.0 <plugin>` reported every plugin "missing" — but the real cause
was that **`gstreamer1.0-tools` (the `gst-inspect`/`gst-launch` CLIs) isn't installed**, so the
command was simply *not found*, and the `&& echo OK || echo missing` idiom printed "missing" for
everything.

Reality on the stock image:
- **255 GStreamer plugin `.so` are present** in `/usr/lib/aarch64-linux-gnu/gstreamer-1.0/`,
  including `libgstomx` (Cedar `omxh264dec`), `libgstrtsp`, `libgstrtmp`, `libgstapp` (appsink/appsrc).
- The packages `gstreamer1.0-plugins-{base,good,bad,ugly}`, `-libav`, `-rtp` are installed.
- **`helix_pipeline` uses the GStreamer *library* directly** (links `libgstreamer-1.0` + `libgstapp`),
  not the CLI — so it doesn't need `gstreamer1.0-tools` at all.

To *probe* by hand, install the CLI once: `sudo apt-get install -y gstreamer1.0-tools`. It is **not**
required to run the pipeline.

## What the board needs (all already on the stock image + restored home dir)

| piece | location |
| --- | --- |
| GStreamer plugins (omx/rtsp/rtmp/app/…) | `/usr/lib/aarch64-linux-gnu/gstreamer-1.0/` (stock) |
| Cedar VE (HW H.264 dec/enc) | `/dev/cedar_dev` (root-only → run under sudo), `libcedarc`/`libvenc*` (stock BSP) |
| NPU runtime (VIPLite v2.0 + awnn) | `~/ai-sdk/viplite-tina/...`, with **`~/npu -> ~/ai-sdk` symlink** (the plugin rpath is `/home/radxa/npu/viplite-tina/lib/aarch64-none-linux-gnu/v2.0`) |
| the pipeline itself | `~/lab/plugins/` — `helix_pipeline` + 10 `hx_*.so` + `configs/all-11s.json` |
| models | `~/lab/yolo11s.nb`, `~/lab/yolo11m.nb` |
| GStreamer build headers (only to *rebuild* the `.so`) | `~/cedar/gstdev/usr/include/gstreamer-1.0` (extracted from `libgstreamer-plugins-base1.0-dev_1.18.4-2+deb11u4_arm64.deb`, kept in `~/cedar/`) — the BSP ships no matching `-dev`, so headers are vendored here |

## Recovery from the home-dir backup (what was actually done)

Backup: `~/helixos-a733/backups/home-radxa-2026-07-28.tar` (on the laptop). To restore onto a fresh
stock image:

```sh
# 1. push the working tree to the board (tar-over-ssh; the board has no rsync)
cd /tmp && tar xf .../home-radxa-2026-07-28.tar radxa/lab radxa/cedar radxa/ai-sdk
tar cf - -C /tmp/radxa lab cedar | ssh radxa@BOARD 'cd ~ && tar xf -'
# 2. NPU path the plugins were built against
ssh radxa@BOARD 'ln -sfn ~/ai-sdk ~/npu'          # if not already present
```

The prebuilt `~/lab/plugins/*.so` + `helix_pipeline` run as-is on the reinstalled stock image (same
OS → ABI-compatible). Rebuild only if libs changed: `make -C ~/lab/plugins`
(needs `~/cedar/gstdev` headers; build at **`-O1`** — `-O2` OOM-kills `cc1plus` on this board).

## Run it (must be root — Cedar `/dev/cedar_dev` is root-only)

RTSP sources + WebRTC server run on the dev laptop (`192.168.1.35`): `fake-camera` (RTSP `:8554`,
4 streams) + `mtx-webrtc` (MediaMTX: RTMP `:1935`, WebRTC `:8889`).

```sh
# on the board — transient systemd unit survives the ssh session, runs as root
sudo systemd-run --unit=helixpipe --collect \
  --working-directory=/home/radxa/lab/plugins \
  --setenv=HELIX_PLUGIN_DIR=/home/radxa/lab/plugins \
  /home/radxa/lab/plugins/helix_pipeline \
  /home/radxa/lab/plugins/configs/all-11s.json 192.168.1.35

journalctl -u helixpipe -f | grep AGG        # AGG=33 inf/s at steady state
# view: http://192.168.1.35:8889/detgrid
sudo systemctl stop helixpipe                 # stop
```

Notes / harmless noise in the log: `XDG_RUNTIME_DIR not set`, `gst-plugin-scanner … GLib-CRITICAL`
(one broken plugin skipped during the scan), `fail! '115:h264' already register!` (Cedar
double-register). None affect the pipeline.

## Verified result (2026-07-29, restored board)

`AGG = 33.0 inf/s` — 4× yolo11s @ ~8/s@40 ms each, the single-NPU-core pipelined ceiling. CPU overlay
+ CPU 2×2 composite. This is the **baseline** for the GPU-compositor (`hx_comp_grid_gpu.so`)
comparison — see docs/10 §7 and `../gridbench/` for the CPU-vs-GPU-composite trade
(GPU 3× faster composite + frees CPU, but contends with the NPU for LPDDR bandwidth).

## GPU compositor in the pipelined pipeline — the resolution crossover (2026-07-29)

Built `hx_comp_grid_gpu.so` (in `src/plugins/comp_grid_gpu/`) — a **drop-in GPU compositor**: same JSON
params as `hx_comp_grid`, does the 4-cell→grid downscale on the PowerVR GPU via OpenCL zero-copy
(`CL_MEM_ALLOC_HOST_PTR`, BGR end-to-end, no format conversions), CPU fallback if OpenCL init fails.
Swap it in by config only (`compositor.module: hx_comp_grid_gpu`), no host recompile —
`make gpu` builds it (`-lOpenCL`). Boxes are drawn upstream per-stream by `hx_overlay_boxes`, so this
isolates the composite.

Measured live (4×yolo11s, NPU-bound ~33 inf/s; whole-process CPU cores via `/proc/pid/stat`):

| grid | CPU compositor | GPU compositor | verdict |
| --- | --- | --- | --- |
| **1280×720** (640×360 quads) | 2.94 cores, 32.7 AGG | 3.08 cores, 32.9 AGG | **GPU loses** (+0.14 cores) |
| **1920×1080** (960×540 quads) | 2.84 cores, 32.7 AGG | **2.38 cores, 33.8 AGG** | **GPU wins** (−0.46 cores, +1 AGG) |

**Finding — the GPU-composite win is resolution-dependent (a crossover between 720p and 1080p).** At
720p the composite is ~0.3 cores on CPU; the GPU path's per-tick memcpy of 4 cells + `clFinish` +
GPU↔NPU LPDDR contention *exceed* that → slight net loss. At 1080p the composite is 2.25× heavier, so
GPU offload **frees 0.46 CPU cores**, and since those cores return to the 4 NPU worker threads,
throughput even rises (32.7→33.8). This reconciles the earlier results: gridbench saw a big GPU win
because it was 1080p (docs/10 §7 / `../gridbench`); the x86 study saw a loss because frames were small
(docs/10 §2). **Rule: move the compositor to the GPU only when the grid is ≥1080p (heavy composite) —
at 720p keep it on CPU.** Configs: `all-11s.json` / `all-11s-gpu.json` (720p),
`all-11s-1080.json` / `all-11s-gpu-1080.json` (1080p).
