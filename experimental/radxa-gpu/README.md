<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Radxa A733 GPU compute (experimental)

The third accelerator on the **Radxa Cubie A7Z (Allwinner A733)**. Prior labs used the
**NPU** (Vivante VIP9000, inference) and **Cedar VE** (H.264 codec). The **GPU** had been
written off as "display scanout only" — a single earlier OpenCL image-preprocess attempt
was 5.7× slower than CPU and abandoned. This lab re-opens it and characterises it
properly. A practice board — nothing here is wired into the main Helix build.

## What the GPU actually is

**Imagination PowerVR B-Series BXM-4-64 MC1** (`img,gpu` / `pvrsrvkm`, RGX fw 36.56) — a
small 1-cluster mobile GPU @ 600 MHz. The `img-bxm` package already ships the **full
Imagination DDK userspace** — it was just unregistered. All three HW APIs work:

| API | lib | status | how to enable |
| --- | --- | --- | --- |
| **OpenGL ES 3.2** | `libGLESv2_PVR_MESA` | worked out of the box | — |
| **OpenCL 3.0** | `libPVROCL` | **enabled here** | create `/etc/OpenCL/vendors/pvr.icd` → `/usr/lib/libPVROCL.so` (the dir was missing) |
| **Vulkan 1.3** | `libVK_IMG` | **enabled here** | ICD json → `/usr/lib/libVK_IMG.so` (or `VK_ICD_FILENAMES`) |

## Measured results (OpenCL, all bit-exact vs CPU reference)

Real peak: **~26 GFLOP/s FP32, ~55 GFLOP/s FP16** (2.15× — the BXM does 2× FP16).

| workload | GPU vs 1-thread CPU | note |
| --- | --- | --- |
| `flops32` compute-bound | **7.6×** (26 GFLOP/s) | GPU wins on arithmetic-heavy work |
| `flops16` FP16 | **~15×** (55 GFLOP/s) | prefer FP16 |
| `matmul 512` naive | 1.9× | mem-bound (4 KB local mem kills tiling) |
| `vecadd` mem-bound, kernel-only | **0.5–0.67×** | GPU *loses* — its 1.6 GB/s < CPU 3.2 GB/s |
| `vecadd` incl. explicit copies | **0.20×** (5× slower) | **the copy tax** — reproduces the old result |
| `vecadd` **zero-copy** (mapped) | handoff **0.77 ms vs 74 ms** | copy tax is *avoidable* |

## How to actually use it (the verdict)

1. **Always zero-copy.** `CL_MEM_ALLOC_HOST_PTR` + `clEnqueueMapBuffer` (unified DRAM) →
   0.77 ms handoff, not 74 ms. Explicit `clEnqueueWriteBuffer`/`ReadBuffer` is what made
   the prior attempt lose. Same for GLES/Vulkan: import DMABUF/EGLImage, never copy.
2. **Only offload compute-heavy, high-arithmetic-intensity work.** Memory-bound ops lose
   to the CPU (the GPU's memory bandwidth is *below* one CPU core). This is a ~26/55
   GFLOP/s GPU — not a compute monster, but real for the right kernel.
3. **Prefer FP16** (2× throughput, supported).
4. **Leave inference on the NPU** (~32 YOLO11s inf/s) and **codec on Cedar**. The GPU's
   niche is: zero-copy per-pixel *shading/effects/compositing* in the video pipeline, and
   FP16 compute-bound kernels the NPU can't express — slotting in as another zero-copy
   stage `.so`, exactly like the NPU/Cedar stages.

## Layout / run

```
setup.sh   # register OpenCL + Vulkan ICDs, install CL headers (run on the board)
build.sh   # gcc gpu_bench.c -O2 -o gpu_bench -lOpenCL -lm
src/gpu_bench.c   # device probe + correctness + benchmark suite (OpenCL 3.0)
docs/00-powervr-gpu-compute.md   # full lab notes + methodology
```

Deploy: `scp -r experimental/radxa-gpu radxa@<board>:~/gpu-lab && ssh … 'cd ~/gpu-lab && ./setup.sh && ./build.sh && ./src/gpu_bench'`

## Status

- [x] Identify GPU (PowerVR BXM-4-64) + enable OpenCL 3.0 / Vulkan 1.3 (ICD registration)
- [x] Correctness (bit-exact) + benchmark: mem-bound, compute-bound, FP16, matmul, zero-copy
- [x] Verdict: zero-copy + compute-bound + FP16; copy tax is avoidable on unified memory
- [ ] Next: a zero-copy GLES/OpenCL pipeline stage (DMABUF in → shader effect → out) vs the CPU overlay/composite stages
