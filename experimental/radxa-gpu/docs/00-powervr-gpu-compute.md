<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 00 — PowerVR BXM-4-64 GPU compute on the Allwinner A733

Date: 2026-07-29

## The GPU and its driver stack

Device-tree `gpu@1800000` is `img,gpu` — an **Imagination PowerVR B-Series BXM-4-64 MC1**
(1 cluster, 600 MHz), *not* Mali. Kernel driver `pvrsrvkm`, RGX firmware `36.56.104.183`,
render node `/dev/dri/renderD128`. The `radxa` user is already in the `render` group.

The `xserver-xorg-img-bxm` package ships the **complete Imagination DDK userspace**, which
had simply never been registered:

- `libGLESv2_PVR_MESA.so` — OpenGL ES **3.2** (worked out of the box)
- `libPVROCL.so` — OpenCL **3.0**
- `libVK_IMG.so` — Vulkan **1.3**
- support libs in `/usr/lib` + `/usr/local/lib` (`pvr_dri.so`, `libsrv_um`, `libusc`, …)

## Enabling OpenCL / Vulkan (the gotchas)

- **OpenCL:** `clinfo` reported 0 platforms because **`/etc/OpenCL/vendors/` did not exist**
  — every attempt to write the `.icd` there silently no-op'd. Fix: `sudo mkdir -p
  /etc/OpenCL/vendors && echo /usr/lib/libPVROCL.so | sudo tee
  /etc/OpenCL/vendors/pvr.icd`. `libPVROCL` exports `clIcdGetPlatformIDsKHR`, so it works
  with the standard ICD loader (`-lOpenCL`); direct `-l:libPVROCL.so` also works.
- **Vulkan:** default ICDs are only `llvmpipe` (CPU). Register the IMG ICD json in
  `/usr/share/vulkan/icd.d/` (or `VK_ICD_FILENAMES`) → `vulkaninfo` reports
  `PowerVR B-Series BXM-4-64 MC1`, Vulkan 1.3, INTEGRATED_GPU.

`setup.sh` does all of the above idempotently.

## Benchmark methodology (`src/gpu_bench.c`)

Kernel time via `CL_QUEUE_PROFILING_ENABLE` events (`COMMAND_START/END`), best-of-20 after
warmup. CPU reference is single-thread `-O2` (the board has 8 cores, so multiply CPU
numbers by up to ~8 for a "GPU vs whole CPU" view). Every kernel's output is verified
against the CPU reference (bit-exact for int-clean paths, relative tol for float).

**Correctness trap found & fixed:** an `a = a*b + c` linear-recurrence FLOPS kernel with
`-cl-fast-relaxed-math` was *algebraically collapsed* by the compiler → a bogus 2178
GFLOP/s / 2273×. Replaced with a **nonlinear** map `a = 0.49·a² + c` across 4 independent
lanes (no closed form ⇒ the loop must actually run) for a true peak.

## Results (reproducible; representative run)

```
device: PowerVR B-Series BXM-4-64  OpenCL 3.0 / OpenCL C 1.2  1 CU @ 600 MHz  local 4 KB  maxWG 512  fp16=yes fp64=no

[1] vecadd  4M    GPU-kernel 30.8 ms (1.6 GB/s)  CPU 16.9 ms (3.0 GB/s)  kernel 0.55x   maxerr 0
    copies:  H2D 22.7 + D2H 39.2 ms  => GPU total 92.7 ms  REAL 0.18x   (copy tax)
[2] flops32 1M×1024  GPU 501 ms (25.7 GFLOP/s)  CPU 3872 ms (3.3 GFLOP/s)  7.7x   maxrel 0
[2b] flops16        GPU 233 ms (55.2 GFLOP/s)  = 2.15x fp32
[3] matmul 512²  GPU 567 ms (0.47 GFLOP/s)  CPU 937 ms (0.29 GFLOP/s)  1.7x   maxrel 0
[4] zero-copy vecadd  map/unmap handoff 0.72 ms  (vs 74 ms explicit copies)  bad 0
```

## Findings

- **Real peak ~26 GFLOP/s FP32, ~55 GFLOP/s FP16** (FP16 = 2.15× — use it). Small GPU.
- **Memory-bound work loses**: the GPU's effective global-memory bandwidth (~1.6 GB/s) is
  *below* a single CPU core (~3 GB/s). `vecadd` kernel-only is 0.55×.
- **The copy tax is real but avoidable.** Explicit `WriteBuffer`/`ReadBuffer` cost ~74 ms
  for 48 MB (~0.65 GB/s) → memory-bound offload is 0.18× (5× slower), reproducing the old
  "5.7× slower" result. **Zero-copy** (`CL_MEM_ALLOC_HOST_PTR` + map on the unified DRAM)
  drops the handoff to **0.72 ms**. So the killer was the copy API, not the GPU.
- **Compute-bound work wins ~7.7× (FP32)** and correctness is bit-exact. Naive `matmul`
  only ~1.7× because it's bandwidth-bound and the **4 KB local memory** is too small for
  useful tiling.

## Verdict / next

Use the GPU only for **compute-heavy, FP16-friendly, zero-copy** work; leave inference on
the NPU and codec on Cedar. Best fit = a **zero-copy GLES/OpenCL pipeline stage** (import
Cedar's DMABUF frame as EGLImage/host-ptr, do per-pixel shading/effects/compositing, output
to KMS) replacing the CPU overlay/composite stages — the same dlopen `.so` seam as the
NPU/Cedar stages. Next step: build that stage and measure it against the CPU compositor.
