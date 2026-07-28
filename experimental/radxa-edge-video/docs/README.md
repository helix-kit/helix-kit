<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Radxa edge video — session deep-dives

Longer-form write-ups of the work layered on top of the base hardware video grid
(see the [top-level README](../README.md) for the decode → compose → encode →
WebRTC core). These docs cover the **NPU object-detection** and **standalone
on-device display** work and the profiling / debugging behind it.

| Doc | What it covers |
| --- | --- |
| [01 — NPU object detection](01-npu-object-detection.md) | YOLOv5 on the VIP9000 NPU: VIPLite 2.0 / awnn stack, 4-stream pipeline, 2-worker pipelining (15 → 21.4 inf/s), per-inference cost, custom models. |
| [02 — Standalone display + DP root cause](02-standalone-display.md) | Why the DP monitor was black (USB-C DP-alt-mode = 2 lanes, 1440p can't train, 1080p can); direct-DRM RGB primary-plane scanout; the macroblock-padding magenta-seam fix; durable standalone boot. |
| [03 — Accelerator telemetry](03-accelerator-telemetry.md) | `boardtop.sh`: reading NPU/GPU/VE utilisation and the DMA working set from vendor debugfs (what btop can't see). |
| [04 — Profiling & analysis](04-profiling-and-analysis.md) | Memory profile (DMA-dominated ~396 MB), journald fix, CPU per-stage breakdown, the honest Jetson-Nano comparison, USB-camera feasibility. |
| [05 — Operational gotchas](05-operational-gotchas.md) | Problems faced: WiFi starvation misdiagnosis, board OOM at compile, stale MediaMTX publisher, display starvation, systemd/SSH launch traps. |

## New source in this round

| File | Role |
| --- | --- |
| [`../src/npu_grid_display.cpp`](../src/npu_grid_display.cpp) | The full pipeline: 4-stream decode → NPU detect → 2×2 composite → Cedar HW encode → WebRTC **+ standalone direct-DRM display**. Runs as `npu-detgrid.service`. |
| [`../src/npu_grid.cpp`](../src/npu_grid.cpp) | Single-threaded 4-stream NPU throughput probe (no encode/display). |
| [`../src/npu_bench.c`](../src/npu_bench.c) | Bare single-image NPU latency probe. |
| [`../src/drmshow.c`](../src/drmshow.c) | Minimal direct-DRM RGB primary-plane test (4-quadrant pattern) — how the 1080p DP path was proven. |
| [`../src/boardtop.sh`](../src/boardtop.sh) | A733 accelerator + memory monitor (doc 03). |
| [`../src/build_split.sh`](../src/build_split.sh) | `-O1` split compile that survives the 1 GB board's OOM killer. |
| [`../src/npu-detgrid.service`](../src/npu-detgrid.service) | Durable systemd unit (standalone display + WebRTC, `Conflicts=sddm`). |
