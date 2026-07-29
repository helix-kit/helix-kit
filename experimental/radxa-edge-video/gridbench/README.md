<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# gridbench — CPU vs PowerVR-GPU compositing for a 4-stream detect pipeline

Measures the DeepStream-shaped loop (**4 streams → NPU YOLO → overlay → 2×2 composite**) on
the Radxa A733, comparing the **compositing/overlay** stage on the **CPU** (OpenCV/NEON) vs
the **PowerVR BXM GPU** (OpenCL, zero-copy). The point: does moving the composite to the GPU
(the one thing it's good at — see [`../../radxa-gpu`](../../radxa-gpu)) pay off in a real
pipeline?

The exact original pipeline couldn't be reproduced (the yolo11 `.nb` is gone → **YOLOv5**;
GStreamer's RTSP/WebRTC plumbing is blocked by Radxa BSP packaging → **image-fed harness**,
libcedarc/NPU intact). The detector and transport are constants, so the CPU-vs-GPU composite
comparison is unaffected. Streams = 4×1080p, grid = 1080p (2×2, each quadrant scaled 1080p→540p),
25 representative boxes/stream. NPU load is identical in both modes.

## Results (150 frames, dog scene ×4, single-thread)

| stage | **CPU** (OpenCV) | **GPU naive** | **GPU optimized** |
| --- | --- | --- | --- |
| composite+overlay / frame | 29.1 ms | 250 ms | **12.6 ms** |
| CPU consumed | **0.97 cores** | 0.15 cores | **0.29 cores** |
| composite-fps (NPU-bound) | 5.7 | 2.5 | 6.1 |
| correctness (quad-means) | [126,126,127,127] | — | [127,127,127,127] ✓ |

NPU (constant): **27.4 inf/s** yolov5, ~146 ms/frame for 4 serial infers — the pipeline
bottleneck (~6 fps with one NPU core; pipeline 4 workers to lift it).

## Findings

- **A naive GPU kernel LOSES badly** (250 ms, 8.5× slower than CPU): it looped all 25 boxes
  *per pixel* (O(pixels·boxes) ≈ 51 M iters) and re-uploaded frames each iteration. This is the
  trap that sank the earlier on-board OpenCL attempt.
- **A proper zero-copy kernel WINS**: composite = one sample per output pixel (memory-bound,
  O(pixels)); boxes drawn only on edge pixels (O(boxes·perimeter)); frames in
  `CL_MEM_ALLOC_HOST_PTR` buffers written once (a real decoder writes them directly — no copy).
  Result: **12.6 ms — 2.3× faster than optimized CPU**, and it **frees the CPU from 0.97 → 0.29
  cores**. Output verified correct (2×2 grid + overlays, `grid_gpu.png`).
- **So the GPU is worth it for compositing** — but only done right; the naive version is a 20×
  swing from the good one. In this single-NPU pipeline the win shows up as **freed CPU** more
  than fps (the NPU is the ceiling); with a pipelined multi-worker NPU, the composite becomes a
  bigger share and the GPU's 2.3× + offload matters directly.

## Build / run (on the board)

```sh
# deps: opencv + g++; NPU SDK restored to ~/ai-sdk (viplite v2.0 + libawnn); OpenCL ICD (radxa-gpu setup.sh)
gcc -O1 -fPIC -DNPU_SW_VERSION=2 -I ~/ai-sdk/examples/libawnn_viplite -I <VIP>/inc -I ~/ai-sdk -c ~/ai-sdk/examples/libawnn_viplite/awnn_lib.c -o awnn_lib.o   # + awnn_quantize.c
g++ -O1 gridbench.cpp awnn_lib.o awnn_q.o -DNPU_SW_VERSION=2 -I... $(pkg-config --cflags --libs opencv4) -L<VIP> -lNBGlinker -lVIPhal -lOpenCL -lpthread -lm -o gridbench
LD_LIBRARY_PATH=<VIP> ./gridbench --mode cpu|gpu --frames 150 --nb <yolov5.nb> --dump <img>
```

## Update — yolo11m + the GPU/NPU memory-contention finding (2026-07-29)

Re-ran CPU vs GPU with **yolo11m** (yolo11s.nb unavailable; composite cost is model-independent so the
overlay comparison is unaffected — only the NPU load differs). 4×1080p → 1080p grid, 80 frames.

| metric | **CPU** | **GPU** | change |
| --- | --- | --- | --- |
| composite+overlay / frame | 35.2 ms | **11.3 ms** | **3.1× faster** |
| CPU consumed | 0.57 cores | **0.24 cores** | 2.4× less |
| peak RSS | 127 MB | 147 MB | +20 MB |
| **NPU throughput** | **12.5 inf/s** | **10.6 inf/s** | **~15% slower** |

**New finding — GPU compositing contends with the NPU for memory bandwidth.** When the PowerVR GPU is
active, the Vivante NPU runs ~15% slower (321→378 ms per 4-infer batch). Confirmed *not* thermal/ordering
by running the reverse order: GPU-mode NPU is always ~378 ms, CPU-mode NPU always ~321 ms, independent of
which ran first. The two accelerators share the LPDDR bus (and power/DVFS), so GPU work steals NPU
bandwidth. (The earlier yolov5 run didn't surface this; yolo11m's heavier per-infer memory traffic makes
it visible.)

**Design implication — the GPU-composite win is conditional on the bottleneck:**

- **NPU-bound** (heavy model, single NPU core = the ceiling): GPU compositing is a **net loss** — freed CPU
  doesn't raise FPS (NPU is the wall) and the GPU slows the NPU 15%. Prefer CPU compositing.
- **CPU-bound** (light model pipelined across workers, composite saturates the CPU): GPU compositing
  **wins** — offloads the composite, frees the cores the fast pipeline needs, NPU has bandwidth headroom.

So "move overlays to the GPU" is a **CPU-vs-memory-bandwidth trade on this shared-memory SoC**, not a
free win. With yolo11m it's a slight net loss; with yolo11s pipelined it should be a win. The proper test
is the pipelined full pipeline (blocked here by the Debian-SD GStreamer BSP packaging — the transport
plumbing, not the compute).
