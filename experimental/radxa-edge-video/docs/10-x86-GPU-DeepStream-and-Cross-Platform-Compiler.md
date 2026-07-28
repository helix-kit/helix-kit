<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 10 — x86/GPU port, DeepStream, and a cross-platform pipeline compiler

Date: 2026-07-26

Capstone/synthesis doc. It ties together the whole arc that started from the Radxa plugin pipeline
(docs/08): porting it to an x86 GPU, trying to max the GPU out, comparing against NVIDIA DeepStream,
understanding *why* DeepStream wins, and landing on the architecture that actually delivers the
original goal — **define a pipeline once, run it optimally on any platform** — with a working
prototype. Reads on top of docs 06–09 and the `deepstream/` + `graph-compiler/` READMEs.

Test rig: AMD Ryzen 5 5500U laptop + **NVIDIA GTX 1650 Mobile (4 GB, TU117, driver 595)**, 4× RTSP
H.264 streams (768×432 @ ~15 fps), same complex scenes as docs/07.

---

## 1. The x86 port (docs/09)

The plugin architecture (docs/08) ported cleanly to x86 in Docker: **host + ABI + preprocess +
postprocess + overlay + compositor compile from identical source**; only 3 stages got x86 variants
(`hx_infer_ort` = ONNX Runtime CUDA/CPU, `hx_src_gst` = a `decoder` param, `hx_sink_gst` = gst
encode). A detection entrypoint picks CUDA vs CPU. First run: **28→45 inf/s** on the GTX 1650.

## 2. Maxing the GPU — a measured campaign (and a counterintuitive result)

| change | result | verdict |
| --- | --- | --- |
| baseline (infer serialized by the board's NPU mutex) | 41.6 inf/s @22 ms | mutex was an artificial cap |
| de-serialize → shared ORT session, concurrent Run | **45.4 inf/s** | +9%, the stable config |
| FP16 | 44.6 inf/s | **no gain** — TU117 has *no tensor cores* |
| 4 parallel private sessions | **CUDA OOM** | 4 GB can't hold 4 arenas |

**Ceiling ≈ 45 inf/s** for 4×YOLO11s@640 on this chip — GPU-*compute*-bound (80% SM), FP16 useless
(no tensor cores), no room for parallel sessions. The only levers that move it: INT8/TensorRT (~2×),
lower resolution, or a smaller model.

### The "use every GPU engine" audit — and why it made things *worse*

Audit (live): only **CUDA compute** was used; **NVDEC 0%, NVENC 0%, GPU-OpenCV absent** — decode
(CPU `avdec`), all image ops (CPU OpenCV), encode (CPU `x264`). Attempts to "use everything":

- **Bolt NVDEC/NVENC onto the CPU-memory pipeline** → **worse** (45→32 inf/s, CPU 170→269%). HW
  codecs on a CPU-centric dataflow *add* PCIe round-trips (GPU→CPU download after NVDEC, CPU→GPU
  upload for NVENC) instead of removing them. (NVENC on this TU117 also only accepts presets `p1..p7`.)
- **Full GPU-resident build** (`infer_ort_gpu`: `cv::cuda` letterbox + ORT **IoBinding** on a device
  buffer, CUDA-OpenCV image built from source, NVENC sink) → it **runs and detects correctly**, but
  is **still counterproductive**: 45 inf/s (unchanged) at **CPU 190→248% (worse)**. Per-frame upload +
  `cudaDeviceSynchronize` + 4-thread default-stream contention cost more than the trivial CPU letterbox
  of small frames.

**Finding: on a GPU-compute-bound workload with small frames and spare CPU cores, offloading the image
pipeline to the GPU is a *loss*. The CPU-decode + CPU-OpenCV + GPU-inference-only split is the optimum
here.** "Use every GPU engine" is *buildable* (we built it) but not beneficial for this workload; it
would only pay off with big frames (1080p/4K) or a differently-bound pipeline.

## 3. The DeepStream comparison (`deepstream/`)

Ran plain **NVIDIA DeepStream** (`deepstream-app`, no Helix code) — first the sample resnet detector,
then **YOLO11s FP32 (apples-to-apples)** via the DeepStream-Yolo custom parser.

| | our pipeline (ONNX-RT) | **DeepStream, same YOLO11s FP32** |
| --- | --- | --- |
| throughput | 45 inf/s (**drops ~25% of frames**) | **60 fps — real-time, every frame** |
| est. max (uncapped) | 45/s | **~90/s** (60 fps at only 66% GPU) |
| **CPU** | **170%** | **18%** (~9×) |
| GPU compute | 79% | 66% |
| NVDEC / NVENC | idle | **used** |
| VRAM | 833 MB | 420 MB |

**DeepStream wins decisively with the identical model** — all frames real-time, ~9× less CPU, uses
the codec ASICs, ~2× headroom.

### Why DeepStream is faster (the mechanism)

`deepstream-app` is just a reference program over a `.txt`; **DeepStream is a set of GStreamer
plugins** and is fully **C/C++-programmable** (like our host). The speed is one idea applied end to
end — **pixels are decoded into GPU memory (`NvBufSurface`/NVMM) and never leave it** until encode:

1. **Zero-copy NVMM** — NVDEC→mux→infer→tiler→OSD→NVENC all on the same GPU surface. No PCIe
   round-trips, no CPU touch of pixels. (Our pipeline round-trips every frame.) → most of 170%→18% CPU.
2. **Batching (`nvstreammux`)** — 4 streams → one `[4,…]` buffer → **one** TensorRT call (great SM
   occupancy). We ran 4 batch-1 ORT sessions. → most of 45→~90.
3. **TensorRT vs ORT** — layer fusion + per-GPU autotuned kernels + tight memory. → rest of throughput
   + 833→420 MB.
4. **HW codecs** — NVDEC/NVENC off the CPU (we used CPU avdec/x264).
5. **GPU preprocess/tiler/OSD**, detections ride as **metadata** (`NvDsBatchMeta`), tapped via **pad
   probes** without pulling pixels.

Our hand-rolled attempt was structurally CPU-frame-centric (the ABI passes a CPU pointer; per-stream,
not batched; ORT not TensorRT). You can't win this by optimizing one stage — the whole graph must keep
pixels on the GPU and batch. **Takeaway: on x86/NVIDIA, use DeepStream/TensorRT; don't hand-roll it.**

### Tapping outputs mid-pipeline (DeepStream supports it all)

Detections for post-processing (pad probe → `NvDsBatchMeta`), analytics (`nvdsanalytics`), event
messages (`nvmsgconv`+`nvmsgbroker` → Kafka/MQTT), **event-triggered recording** (Smart Record — the
native version of our REC ring buffer), multi-output (`tee`), raw tensors (`output-tensor-meta`),
tracking (`nvtracker`), cascaded models (SGIE). Maps ~1:1 to the "tap detections at any node + on-demand
clip" model we were designing.

## 4. The realization → the original goal, prototyped (`graph-compiler/`)

The original goal: **define a pipeline once (React editor), platform-agnostic components, run the same
pipeline optimally on DeepStream / Radxa NPU / RPi+Hailo / Jetson / …** without redefining it.

The key correction: our first plugin system abstracted at the **per-frame-data** layer (each stage a
`.so` over a CPU frame) — which *forced* CPU memory and fought the GPU. The right layer is the
**graph**: the portable artifact is the graph (semantic nodes + params); a **backend per platform
compiles it to that platform's native, zero-copy pipeline**. Most accelerators expose their engines as
**GStreamer elements** (DeepStream, Hailo, our Cedar path) — the common substrate — so a backend is
mostly "pick the platform's element per node."

**Prototype `hxc` (proven):** one `graph.json` →

| node | DeepStream | Hailo | Radxa A733 |
| --- | --- | --- | --- |
| detect | `nvinfer` + `.engine` | `hailonet` + `.hef` | `hxawnninfer` + `.nb` |
| decode/track/tile/overlay/sink | nv* | hailo* | Cedar + our plugins |

- `hxc run --target deepstream` **compiled the graph and ran it live**: ~60 fps, NVDEC+NVENC+TensorRT
  +nvtracker, 24% CPU (the graph's `track` node auto-wired `nvtracker`).
- `hxc compile --target radxa` **emits `src/plugins`' JSON config** — the exact format our dlopen NPU
  host already runs on the board. Full circle: one graph feeds both backends.
- `--target hailo` emits the native Hailo pipeline (for RPi+Hailo hardware).

**One graph → three native pipelines, one running now.** The hard question ("can one abstraction span
such different hardware?") is answered with a demo: yes.

## 5. Where our plugin architecture fits

- **x86 / NVIDIA / Jetson** → the backend is **DeepStream/TensorRT** (or Triton). Don't hand-roll.
- **Radxa A733 NPU** → our **dlopen plugin host** (awnn + Cedar) — there's no DeepStream there; this is
  where our architecture is the right and only answer.
- **RPi + Hailo** → GStreamer + `hailonet`.
- The **portable graph + per-platform backend compiler** (`hxc`) is the unifying layer that makes the
  React editor's "define once" real.

## 6. Roadmap to a real compiler (it's a real project)

1. **Model artifact resolver** — `yolo11s` → `.engine` (trtexec) / `.hef` (Hailo DFC) / `.nb` (ACUITY).
   All three done by hand this session; automate them.
2. **Richer graph** — arbitrary DAGs, `tee` branches (record + analytics + live), metadata probe taps.
3. **`hxawnninfer` as a GStreamer element** so the Radxa backend is also a pure gst graph.
4. **React editor emits `graph.json`**; `hxc` compiles + deploys per target.
5. Validate Hailo / Jetson backends on real hardware.

## 7. GPU capability limits — breadth, depth, and the NPU comparison

A dedicated stress campaign to find what the GTX 1650 (TU117, 4 GB, FP32, **no tensor cores**) can
actually sustain — not by resolution, but by pipeline *complexity*. All via DeepStream (the efficient
path; our own CPU-frame pipeline hits its own wall at ~45/s and can't reveal the GPU limit). Sources
are the 4 complex-scene clips looped as **file sources, uncapped**, so the GPU — not the 15 fps camera
rate — is the bottleneck. Model: YOLO11s @640, FP32.

### ⚠️ Measurement pitfall (corrected)

deepstream-app's PERF line prints **two** numbers per source: `22.00 (21.78)` = *instantaneous
(running-average)*. An early parser summed **both** columns across all 4 sources → reported ~176/184
when the true aggregate was ~88–92. **The real single-model ceiling is ~90 inf/s, not ~184.** The
independent `gst-launch` + `fpsdisplaysink` measurements (which report one number) had it right the
whole time and reconcile exactly with a corrected deepstream-app read. Physics agrees: YOLO11s@640
≈ 21 GFLOPs, GTX 1650 ≈ 2.9 TFLOPS FP32 → ~90 inf/s is ~65% FP32 utilization (sane); 184 would imply
130% (impossible). **Lesson: always inspect the raw metric line before summing.**

### Axis 1 — breadth (more streams / bigger batch)

| streams (batch) | aggregate inf/s | GPU util | VRAM |
| --- | --- | --- | --- |
| 4  | ~90 | **100%** | 382 MiB |
| 8  | ~90 | **100%** | 634 MiB |
| 16 | ~90 | 99% | 1144 MiB |
| 24 | ~92 | **100%** | 1655 MiB |
| 32 | ~92 | **100%** | 2169 MiB |

**Flat ~90 inf/s from batch-4 up** — GPU-compute-bound, 100% util the whole way. Batching more streams
adds **zero** throughput (already saturated at batch-4, no tensor cores); it only costs VRAM
(~69 MiB/stream). → **~6 cameras at full 15 fps** (90 ÷ 15); ~12 at every-2nd-frame, ~50 streams before
4 GB OOMs (decode/tile/record for the rest). FP16 gave no gain (no tensor cores); the only real levers
are INT8/TensorRT (~2×), lower res, or a smaller model.

### Axis 2 — depth, light (detector + tracker + per-object classifiers)

| stack per stream | throughput | VRAM |
| --- | --- | --- |
| YOLO11s detect | baseline | 382 MiB |
| + NvDCF tracker | −2% | 500 MiB |
| + tracker + 1 classifier (ResNet18, per object) | −2% | 548 MiB |
| + tracker + 2 classifiers | **−2%** | 584 MiB |

**Nearly free.** A ResNet18 classifier is ~1/50th the detector's cost and, with a tracker, runs
**per-object once** (not per-frame) — so it slots into the detector's leftover cycles. Cost scales with
*objects/frame*, not frame rate; dense scenes + no-tracker every-frame classification is the only way
light depth bites. VRAM ~50–120 MiB per small model.

### Axis 3 — depth, heavy (two full detector-scale nets, e.g. detect + pose)

Two full YOLO11s@640 chained (`nvinfer ! nvinfer`, both full-frame — deepstream-app's `[secondary-gie]`
**can't** do this, it silently drops a full-frame second GIE; needs an explicit two-`nvinfer`
`gst-launch` pipeline):

| config | frames/s (4 streams) | total inferences/s | GPU | VRAM |
| --- | --- | --- | --- | --- |
| 1 full net | 89 | 89 | 99% | 380 MiB |
| **2 full nets** (detect + pose-equiv) | **46** | 92 | 100% | 612 MiB |

**A second full model halves the frame rate** (89→46), reproduced identically in tiled *and* lean
(no-tiler) pipelines — removing the tiler bought nothing; it was never the bottleneck. Note the
**total inferences/s is conserved (~90)**: the GPU is a **fixed inference budget**, and a second model
*splits* it rather than adding capacity. **N full nets → 1/N frame rate; +~232 MiB VRAM per full model.**
→ detect+pose on 4 streams = **~11 fps/stream, below real-time**; hit 15 fps by dropping to ~2–3
streams, inferring pose every 2nd frame, or INT8/smaller.

### The unifying model

The GPU has one number — a **~90 inf/s (FP32) inference budget**, 100% saturated at batch-4. Everything
spends from that one pool: breadth (streams × detect-rate), light depth (rides in the slack ~free),
heavy depth (each full model takes an equal slice). You buy headroom with **INT8/TensorRT (~2×, → ~180)**
or a smaller/cheaper model — not with more batching (no tensor cores) or GPU-offloading the image path
(measured *counterproductive*, §2).

### Why the GPU is only ~3× the Radxa NPU despite ~16× the price

The A733 NPU does **~32 inf/s**; this GPU **~90** — only ~3× for a ₹3k board vs a ₹50k laptop. Because:

1. **Precision mismatch.** NPU = **INT8**, GPU number = **FP32** (~2× dearer). Normalize both to INT8
   (TensorRT) and the GPU → **~180 (~5–6×)** — matching the raw silicon ratio.
2. **Raw compute is close.** NPU **3 TOPS** INT8 vs GPU **~12 TOPS** INT8 (DP4A) = ~4×. The measured 3–5×
   tracks *compute*, not price. The NPU is a fixed-function INT8 conv engine — every TOPS spent on this;
   the GTX 1650 is an old, bottom-tier, **tensor-core-less** general GPU wasting most transistors here.
3. **Price ≠ AI silicon.** ₹50k is a whole laptop (CPU, 16 GB, GDDR6, screen, battery, margin); the GPU
   die is a slice, the NPU a tiny SoC block. You don't pay 16× for 16× the accelerator. For inf/₹, a
   dedicated edge accel wins: Hailo-8 26 TOPS (~₹6k), Jetson Orin Nano 40 TOPS.
4. **Power.** NPU ~16 inf/s/W (~2 W) vs GPU ~2 inf/s/W (~45 W) — **~8× better perf/W**; a 45 W GPU can't
   live on the Radxa's fan-less budget at all.
5. **What the ₹ buys is flexibility, not speed:** big/FP32 models (yolo11m/x, no quantization loss),
   batching, multi-model, point-TensorRT-at-ONNX dev velocity — the NPU forced lossy ACUITY uint8
   conversion and is already maxed. Per-₹ and per-watt, the little NPU is the *more* efficient engine.

**Repro:** `deepstream/` file-source configs + the `gst-launch` two-`nvinfer` recipe; measure with
`fpsdisplaysink` (`gst-launch -v`, read `average:`) or deepstream-app PERF (sum **one** column only).

## Artifacts in the repo

- `src/plugins/` — the portable plugin pipeline (board + x86 + GPU-resident variants) + Dockerfiles.
- `deepstream/` — the plain DeepStream reference (configs + `run.sh` + results).
- `graph-compiler/` — the `hxc` prototype (`graph.json` + `hxc.py` + README).
- `docs/06–09` — decode ceiling, 5n-vs-11s, plugin architecture, x86 port.
