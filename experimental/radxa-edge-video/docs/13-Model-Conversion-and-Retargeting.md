<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 13 — Model conversion & retargeting: the manual flow, and productizing "bring your own model"

Date: 2026-07-29
Tracks: **HELIX-149** (FEAT). Related: HELIX-123 (graph compiler / model resolver), HELIX-76
(release/artifact/OTA control plane), HELIX-17 (custom firmware build service).

How Helix takes a trained model and makes it run on a *specific* accelerator, why that's a
per-vendor offline compile, exactly how we did it by hand for the Radxa A733 NPU, and how it
becomes a self-serve "upload your model → get a deployable artifact for your board" service.

---

## 1. The universal shape

An edge accelerator (NPU, Hailo, TensorRT) **cannot run a framework model directly** — it runs a
vendor-specific, pre-compiled, usually-quantized binary. So every path is the same shape:

```
   PyTorch / TF / Keras / Darknet
             │  export
             ▼
          ONNX  ◀── the interchange format (also the x86 runtime format)
             │
   ┌─────────┼───────────────┬────────────────┐
   │ ACUITY  │ trtexec       │ Hailo DFC      │  (per-accelerator offline COMPILER)
   ▼         ▼               ▼                ▼
  .nb       .engine         .hef           .onnx      (per-accelerator ARTIFACT)
 (Vivante   (NVIDIA         (Hailo)        (x86 CPU/GPU — ONNX Runtime, no compile)
  VIP9000)   TensorRT)
```

| Target | Compiler | Artifact | Quantize? | Runtime element |
| --- | --- | --- | --- | --- |
| **Radxa A733 NPU** (Vivante VIP9000) | **ACUITY** (`pegasus`) | **`.nb`** (NBG) | yes — int8/uint8/int16/bf16 + calibration | `hx_infer_awnn` (VIPLite/awnn) |
| **NVIDIA dGPU / Jetson** | `trtexec` (TensorRT) | `.engine` | optional INT8 | `nvinfer` (DeepStream) |
| **RPi + Hailo** | Hailo Dataflow Compiler | `.hef` | INT8 | `hailonet` |
| **x86 CPU/GPU** | *none* | `.onnx` | no (FP32/FP16) | `hx_infer_ort` (ONNX Runtime) |

Only the NPU / TensorRT / Hailo require an **offline compile**. x86 runs the ONNX artifact as-is
(`src/plugins/infer_ort/hx_infer_ort.cpp` loads `yolo11s_cut.onnx` straight through ONNX Runtime,
CUDA→CPU EP order). This is why "portable" means **ship the ONNX**; the board-specific step is the
compile.

---

## 2. The NPU manual flow (Vivante VIP9000 → `.nb`, via ACUITY / pegasus)

The vendor toolkit is **ACUITY** (CLI `pegasus`), from the "Radxa Cubie NPU ai-sdk"
(`github.com/ZIFENG278/ai-sdk`), run in Docker `ubuntu-npu:v2.0.10.2` (which bakes in both: ACUITY
at `ACUITY_PATH=/usr/local/acuity_command_line_tools` and the Vivante SDK at
`VIV_SDK=/root/Vivante_IDE/VivanteIDE5.11.0/cmdtools`). The worked example in the SDK is
`ai-sdk/models/yolov5s-sim/` (the `.onnx` + all config + `convert_export.sh`).

> **This flow was run for real** (HELIX-149): `yolov5s-sim.onnx → yolov5s-sim_uint8.nb` (5.3 MB,
> A733/v3), deployed to the board and verified on the real VIP9000 NPU — correct dog/truck/bicycle
> detections, 19.9 ms `vip_run_network`. Runnable script + numbers:
> `model-convert-demo/convert_nb.sh` and `RESULTS.md`.

**One command:**

```sh
export ACUITY_PATH=<acuity>/bin  VIV_SDK=<VivanteIDE>/cmdtools
./convert_export.sh yolov5s-sim uint8 t527     # <model> <uint8|int16|bf16|pcq> <platform>
```

It runs four stages (each also a standalone `pegasus_*.sh` under `ai-sdk/models/`):

1. **Import** (`pegasus import <fmt> --model … --output-model NAME.json --output-data NAME.data`).
   Format auto-detected by extension — **Caffe, TensorFlow, PyTorch, Keras, ONNX, TFLite,
   Darknet** all accepted. Then `pegasus generate inputmeta` → `NAME_inputmeta.yml` and
   `pegasus generate postprocess-file` → `NAME_postprocess_file.yml`.
2. **Channel-mean patch** (`awnet_normalize.py` / `pegasus_channel_mean`) — writes mean+scale into
   `inputmeta.yml` from `channel_mean_value.txt` (yolov5 = `0 0 0 0.00392157`, i.e. ÷255).
3. **Quantize** (`pegasus quantize --with-input-meta … --compute-entropy --rebuild --quantizer <Q>
   --qtype <T>`). **Calibration data** = the image list in `dataset.txt` (6 COCO images for
   yolov5), referenced by `inputmeta.yml`. Quantizer per qtype:
   | qtype | quantizer | note |
   | --- | --- | --- |
   | `uint8` | `asymmetric_affine` | **default** — normalization baked into scale/zero_point |
   | `int16` | `dynamic_fixed_point` | |
   | `pcq` | `perchannel_symmetric_affine` (qtype int8) | |
   | `bf16` | `qbfloat16` | |
   `pegasus_quantize_hybird.sh` adds `--hybrid`; `inference_compare.sh` runs a float-vs-quant
   `compute_tensor_similarity` to validate fidelity before you trust the `.nb`.
4. **Export → NBG** (`pegasus export ovxlib --dtype quantized --model-quantize NAME_<q>.quantize
   --pack-nbg-unify --optimize <VSIMULATOR_CONFIG> --viv-sdk $VIV_SDK …`). Output lands at
   `wksp/NAME_<q>_nbg_unify/network_binary.nb`; `copy_nbg` renames it to `NAME_<q>.nb`.

### Board / DDK targeting (the `v1|v2|v3` thing)

The per-board target is `VSIMULATOR_CONFIG`, set by `pegasus_setup.sh v1|v2|v3` (or
`convert_platform_to_optimize` in `convert_export.sh`):

| tier | `VSIMULATOR_CONFIG` | boards |
| --- | --- | --- |
| v1 | `VIP9000PICO_PID0XEE` | r853 / v85x |
| v2 | `VIP9000NANOSI_PLUS_PID0X10000016` | t527 / mr527 / ai985 |
| **v3** | **`VIP9000NANODI_PLUS_PID0X1000003B`** | **A733** (t536 / mr536) |

The **A733 is `v3`**, `NPU_SW_VERSION=v2.0`, runtime **VIPLite 2.0** (`libNBGlinker.so` +
`libVIPhal.so`; high-level API is **awnn**), models deployed under `model/v3/`. To target the
VIPLite driver specifically, replace `--pack-nbg-unify` with **`--pack-nbg-viplite`**.

### Gotchas the pipeline must own

- **`int16` input-format trap (the big one).** The quantize `qtype` also sets the model's *input
  tensor* dtype. Quantize `int16` → the `.nb` expects **int16** input; feeding raw **uint8** bytes
  = garbage. This silently collapsed FaceNet *and* MobileFaceNet embeddings identically (docs 00
  §10, 06). **Default `uint8` (asymmetric_affine, normalization in scale/zero_point) and feed raw
  uint8.** Always read the expected input from `nbg_meta.json` before blaming the model.
- **Op-support / architecture surgery.** An accelerator supports a subset of ops; unsupported ops
  either fail to compile or silently fall back to CPU. Sometimes the fix is to **swap the model
  for an accelerator-friendly architecture** — we did exactly this (FaceNet wouldn't produce a
  usable NPU embedding → **MobileFaceNet**). This is why "bring your own model" is not just a
  format transcode; it may require a preflight op-support check and re-architecting.
- **Mixed-range output crush.** A single output tensor mixing box coords (0–640) and confidences
  (0–1) can't share one integer scale — cut the model before the mix and do the final math in
  software (why we ship "cut-N-heads" ONNX variants).
- **Preprocessing must be bit-identical** to the vendor recipe (letterbox → BGR→RGB → HWC→CHW
  uint8) or a correct `.nb` still produces wrong boxes (doc 01 §3).
- Already-quantized TFLite keeps its qtype (renamed `NAME_<q>.quantize`); don't re-quantize.
- Prebuilt `.nb` ship in the SDK for stock COCO models — ACUITY is only needed for **custom
  classes / custom models** (i.e. exactly the BYO case).

### 2.1 Worked example: YOLO11 (the head-cut case) — run for real, verified on-device

yolov5s-sim converts *whole* (it's anchor-based: each of its 3 heads is a self-contained 85-channel
tensor). **YOLO11 does not** — it is anchor-free with a **DFL** head: the final `Detect` layer
softmax→conv-decodes the 16-bin box distribution and **concatenates box coords (0–640 px) with class
scores (0–1)** into one output. That mixed-range tensor hits the "mixed-range output crush" gotcha
(one int8 scale can't span both). So YOLO11 needs one extra step yolov5 doesn't: **cut the head
before the mix.** This was run end-to-end for real (HELIX-149).

**Step A — cut (produces the 6-raw-head ONNX).** Export Ultralytics YOLO11 with the detect head in
split mode (`DeepStream-Yolo/utils/export_yolo11.py` sets `Detect.forward = forward_split`), which
emits the raw conv heads instead of the decoded/concatenated output. Result `yolo11s_cut.onnx`:

```
input:  images  [1,3,640,640]
outputs (6 raw heads, no DFL decode in-graph):
  /model.23/cv2.{0,1,2}/…/Conv_output_0   box[64]  @ 80×80 / 40×40 / 20×20   (stride 8/16/32)
  /model.23/cv3.{0,1,2}/…/Conv_output_0   cls[80]  @ 80×80 / 40×40 / 20×20
```

The DFL decode (box[64]→4 via softmax·arange) + NMS then live **in software**, on-device, in
`src/plugins/post_yolo11/hx_post_yolo11.cpp` — not on the NPU. (Same cut is why the x86 path loads
`yolo11s_cut.onnx` straight through ONNX Runtime.)

**Step B — register + convert (identical to the yolov5 flow).** Drop the cut ONNX into an ACUITY
model dir and run the same script — the *only* yolo11-specific inputs are the 6 output-node names:

```sh
# ai-sdk/models/yolo11s/  ← copy yolov5s-sim's convert_export.sh, dataset.txt, images/,
#   channel_mean_value.txt (0 0 0 0.00392157 → uint8, ÷255); drop in yolo11s_cut.onnx as yolo11s.onnx
cat inputs_outputs.txt   # --inputs images --input-size-list '3,640,640' \
                         # --outputs '/model.23/cv2.0/…/Conv_output_0 …(all 6 heads)…'
./convert_nb.sh ~/ai-sdk yolo11s uint8 t536      # import → quantize(uint8, COCO calib) → export NBG (v3)
# → yolo11s_uint8.nb  (6.85 MB, VPMN + optimize PID 0x1000003B = A733/v3)
```

**Step C — on-device verification (real A733 NPU).** The freshly-built `.nb` is **6,846,288 B** —
within ~4 KB of the known-good `~/lab/yolo11s.nb` (6,841,888 B; the ~4 KB is calibration variance).
Swapped it into the live `helix_pipeline` (whose `hx_post_yolo11` is the real DFL decoder): loads on
the NPU (`load_param 0.80 ms`), runs at **~41 ms/inf, AGG 31.5 inf/s** (matches the known-good ~33),
and **produces balanced detections across all 4 streams** — a bad quantization/channel order would
give ~0. Recipe reproduced → header-valid artifact → device-valid → detects. Log:
`model-convert-demo/work/yolo11s_convert.log`.

> **The yolo11 delta in one line:** it's the yolov5 flow **plus a pre-cut** (`forward_split` → 6 raw
> heads) so the DFL/mixed-range decode happens in software, not on the NPU. Everything downstream
> (uint8/`asymmetric_affine`, COCO calibration, `--pack-nbg-unify`, v3/`0x1000003B`) is identical.

### Other accelerators (same shape, different compiler)

- **NVIDIA (dGPU/Jetson):** `trtexec --onnx=m.onnx --saveEngine=m.engine [--int8 --calib=…]` →
  `nvinfer`. Engines are hardware+TensorRT-version specific (rebuild per box).
- **Hailo (RPi):** Hailo DFC (parse → optimize/quantize with a calibration set → compile) → `.hef`
  → `hailonet`.

---

## 3. Where it plugs in — the cross-platform compiler

The graph compiler (`graph-compiler/hxc.py`, docs 10) compiles **one portable `graph.json`** to
each platform's native pipeline, picking the right runtime element **and model artifact** per node.
Today the model is a hardcoded id (`yolo11s`) resolved to a per-target file path; the missing piece
it explicitly calls out is a **"model artifact resolver"**: `yolo11s → {.engine, .hef, .nb}`. That
resolver *is* the service below — it turns a model id + target into the compiled artifact.

---

## 4. Productizing it — "bring your own model → deploy" (HELIX-149)

Goal: a user uploads a pretrained model, picks target board(s), and gets an OTA-deployable
artifact — **no new infrastructure pattern needed**, because it mirrors the ESP32 **custom
firmware build service** and rides the **kind-agnostic release/artifact control plane** (HELIX-76).

### The reuse map

| firmware build (exists) | model build (new, same shape) |
| --- | --- |
| `cloud/build-service/worker.py` (`GET /catalog`, `POST /build`, sha256 blob upload, `build_complete` callback) | ACUITY (then trtexec / Hailo DFC) build container, **same protocol** |
| `artifact_type` `esp32-firmware` + adapter | new `artifact_type` **`model-nbg`** + adapter |
| `web/.../releases/adapters/{index.ts,types.ts}` registry (`canonicalizeSelector`/`computeConfigHash`/`buildVariantManifest`/`resolveConsumerInstruction`) | new adapter, core code never branches on kind |
| `selector = {app, chip, features…}` | `selector = {platform, quantType}` (e.g. `{t536, uint8}`), `roles = {nb, meta}` |
| `build-dispatch.ts` (`requestBuild` dedupe by `configHash`, `fetchCatalog`, `dispatchBuild`) | **reused as-is** |
| `variant`/`variant_artifact`, `blob\|ref` storage, OTA `resolve.ts`/`ota.ts` | **reused as-is** — artifact keyed by `(model, platform, ddk-version, quantType)` |
| `web/.../firmware-builder/` catalog-driven UI + `builds/new` wizard | model-upload wizard (ONNX in, target + calibration set, artifact out) |

### Phases (in HELIX-149)

1. **Capture the manual flow** as a reproducible script + Dockerized ACUITY builder (A733/v3 first)
   — pin `ubuntu-npu:v2.0.10.2`, the `pegasus` stages, and the platform/qtype matrix. *(Done — see
   `model-convert-demo/convert_nb.sh`, which drives the SDK `convert_export.sh` inside the pinned
   image; verified on real hardware.)*
2. **`model-nbg` artifact_type + release adapter**; wire the build container to the release control
   plane (dedupe/callbacks/storage) — the model becomes a first-class release artifact.
3. **Upload-model wizard** (ONNX in, pick target board + quant type + calibration images, artifact
   out) mirroring firmware-builder; served by the builder's `/catalog`.
4. **Add TensorRT + Hailo builders** behind the same catalog/adapter surface; wire into the `hxc`
   model resolver so a `graph.json` deploy pulls the right artifact per target.
5. **Calibration-set management + fidelity gate** (`compute_tensor_similarity` float-vs-quant) +
   **op-support preflight** (reject / warn on unsupported ops before a long compile).

### Open questions
- Interchange floor: require ONNX in, or accept PyTorch/TF and export server-side?
- Calibration data: user-supplied set vs a stock per-task set vs synthetic.
- Where the heavy vendor SDKs run (ACUITY/DFC images are large, license-restricted) — a dedicated
  builder pool, on-demand.
- Model surgery (cut heads, op replacement) — manual recipe vs assisted.
