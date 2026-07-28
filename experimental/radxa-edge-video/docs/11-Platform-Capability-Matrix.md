<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 11 — Platform capability matrix (video I/O + inference engines)

Date: 2026-07-26

A living inventory of every platform we can target with the cross-platform pipeline (docs/10, the
`hxc` compiler). For each box: the CPU, the fixed-function video codec engines (decode/encode, and
*how* to reach them), the inference accelerator (and its measured ceiling), and the pipeline
topologies each one enables. The point is to design the graph/compiler against the *union* of these
capabilities so no platform is left unable to run a pipeline optimally.

Method note: all codec numbers below are ffmpeg `-benchmark` on the **same 1080p H.264 clip**
(decode-only → `-f null`, or encode at 4 Mb/s), reported as **fps (× realtime)**. Comparable across
engines *on one box*; not a cross-box codec-quality benchmark. Inference numbers are YOLO11s@640.

---

## Platforms

### A. Radxa Cubie A7Z — Allwinner A733 (the edge target)

| block | capability |
| --- | --- |
| CPU | 8-core big.LITTLE ARM (A76+A55), 4 GB LPDDR |
| **NPU** | Vivante VIP9000, **3 TOPS INT8**, VIPLite/awnn — **~32 YOLO11s inf/s** (INT8, uint8 NBG), single core, ~2 W |
| **Video decode** | Cedar VE (H.264/H.265) — HW decode ~2% CPU via DMABUF; **ceiling 1080p** (4K fails, docs/06) |
| **Video encode** | Cedar VE via libcedarc/OMX (H.264) — safe-teardown/leak-free path (docs 05, radxa-edge-display) |
| **Display** | direct DRM/KMS (RGB primary plane), zero-copy Cedar→scanout |
| codec API | GStreamer `omxh264dec` (Cedar); no VAAPI/oneVPL |
| **role** | the deployment target; our **dlopen plugin host** (awnn + Cedar) is the only runtime here (no DeepStream) |

### B. Laptop "AMD" — Ryzen 5 5500U + GTX 1650 Mobile (the perf reference)

| block | capability |
| --- | --- |
| CPU | AMD Ryzen 5 5500U, 6c/12t (Zen2) |
| iGPU | Radeon Vega (VCN) — VAAPI codec available (not yet benchmarked) |
| **dGPU** | GTX 1650 Mobile (TU117, 4 GB, FP32, **no tensor cores**), driver 595 |
| **Inference** | **~90 YOLO11s@640 inf/s FP32** (GPU-compute-bound, docs/10 §7); INT8/TensorRT → ~180 |
| **NVDEC / NVENC** | present & used (DeepStream 60 fps on 4 RTSP, docs/10 §3) |
| codec API | DeepStream/GStreamer `nvv4l2*` / `nvurisrcbin`; ffmpeg cuda |
| **role** | where DeepStream + `hxc --target deepstream` are validated |

### C. Laptop "Intel" — i5-10300H + UHD Graphics + GTX 1650 (`192.168.1.4`, `vashni-agrahari-asus`)

**Same dGPU as B, but adds a second HW codec engine (Intel).** Ubuntu 26.04, 7 GB RAM, 2 render
nodes (`renderD128` = Intel iGPU, `renderD129` = NVIDIA).

| block | capability |
| --- | --- |
| CPU | Intel i5-10300H, 4c/8t, up to 4.5 GHz, **AVX2 + F16C + FMA + AES** (no AVX-512) |
| **Intel iGPU (Comet Lake UHD, Gen9.5)** | Quick Sync fixed-function block, driven via **VAAPI (iHD driver 26.1.2)** |
| — decode | H.264 (all profiles), **HEVC Main + Main10**, VP9 Profile0/2, VP8, MPEG2, VC1, JPEG |
| — encode | H.264 (Main/High/CBP, incl. **low-power VDEnc**), HEVC Main (8-bit), VP8, MPEG2, JPEG |
| — VideoProc | scale / color-convert / deinterlace / denoise (fixed-function) |
| — **no** | AV1 (pre-dates it), HEVC-10 encode, VP9 encode |
| **dGPU** | GTX 1650 (TU117, 4 GB), driver 595 — **NVDEC + NVENC both present & working** (verified) |

**Measured (1080p H.264, fps / ×realtime):**

| op | CPU (i5 8T) | Intel iGPU VAAPI | NVIDIA |
| --- | --- | --- | --- |
| H.264 **decode** | 572 / 38× | 289 / 19× | **750 / 50×** (NVDEC) |
| H.264 **encode** | — | 186 / 12× | **342 / 23×** (NVENC) |
| full HW transcode | — | 271 / 18× (0 CPU pixels) | — |

> CPU decode *beats* iGPU decode on this easy clip — expected. HW decode's value is **CPU offload +
> many-stream scaling**, not raw single-stream fps. The iGPU shines when the dGPU/CPU must be reserved
> for other work.

**Unique topology this box enables — a 3-engine split:**

```
Intel iGPU (VAAPI)          NVIDIA dGPU (CUDA)         Intel iGPU (VAAPI)
   decode  ───────────►  inference (100% dedicated) ──────────►  encode
```

Decode + encode on the **Intel iGPU**, inference on the **NVIDIA dGPU** → the GTX 1650 is entirely
free for inference (no NVDEC/NVENC session or SM contention). Not possible on a single-GPU edge box;
worth benchmarking whether it lifts the ~90 inf/s ceiling by freeing codec load off the dGPU.

## Cross-cutting lessons (so we don't trip on them again)

- **"Listed ≠ supported."** ffmpeg advertises `av1_qsv`/`av1_nvenc`/`av1_vaapi` on hardware with **no
  AV1 engine** (Comet Lake, TU117). Always *run* the codec, don't trust `-encoders`.
- **QSV ≠ VAAPI.** ffmpeg's `h264_qsv` needs the **oneVPL runtime** (`onevpl-intel-gpu`); with only
  the iHD VA driver it fails `MFX session: -9`. **VAAPI** (`-hwaccel vaapi -hwaccel_device renderD128`)
  works with just the driver and reaches the same silicon — prefer it unless oneVPL is installed.
- **GStreamer HW plugins are a separate install.** A bare box has 0 `va`/`nvcodec` elements; pipeline
  work needs `gstreamer1.0-vaapi` + `gstreamer1.0-plugins-bad` (Intel/NVIDIA) per platform.
- **Measure the raw metric, sum one column.** (See docs/10 §7 — the deepstream-app PERF double-count.)

## How each platform maps onto the `hxc` compiler backends (docs/10 §4)

| node role | Radxa A733 | Laptop (NVIDIA) | Laptop (Intel iGPU option) |
| --- | --- | --- | --- |
| decode | `omxh264dec` (Cedar) | `nvv4l2decoder`/NVDEC | `vah264dec` (VAAPI) |
| infer | `hxawnninfer` (NPU .nb) | `nvinfer` (TensorRT .engine) | `nvinfer` (dGPU) |
| encode | Cedar libcedarc | `nvv4l2h264enc`/NVENC | `vah264enc` (VAAPI) |
| host | dlopen plugin host | DeepStream / gst | DeepStream/gst + VAAPI split |

## Open follow-ups

- Benchmark the **Intel-decode + NVIDIA-infer + Intel-encode split** end-to-end (does freeing codec
  off the dGPU raise inference throughput?).
- Benchmark **Laptop-AMD iGPU (VCN/VAAPI)** codec for parity with the Intel numbers.
- Install `onevpl-intel-gpu` and compare **QSV vs VAAPI** efficiency on the Intel box.
- Multi-stream HW-decode scaling (where the iGPU's CPU-offload beats CPU decode).
