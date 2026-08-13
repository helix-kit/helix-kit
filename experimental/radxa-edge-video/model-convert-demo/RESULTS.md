<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Model conversion demo — results (HELIX-149)

Two real, runnable instances of the doc-13 flow (`13-Model-Conversion-and-Retargeting.md`), each
targeting a different accelerator, both run end-to-end on this laptop:

- **Radxa A733 NPU** (`ONNX → ACUITY → .nb`) — script [`convert_nb.sh`](./convert_nb.sh). **The
  headline result: the laptop-built `.nb` was deployed to the real A733 NPU and produces correct
  detections.** See [§ NPU target](#npu-target-radxa-a733--converted-nb-runs-on-the-real-npu).
- **NVIDIA GTX 1650** (`ONNX → trtexec → .engine`) — script [`convert_trt.sh`](./convert_trt.sh).
  See [§ NVIDIA target](#nvidia-target-gtx-1650).

---

## NPU target (Radxa A733) — converted `.nb` runs on the real NPU

The **primary** demo: the actual Helix edge target. Pretrained **yolov5s** ONNX → ACUITY/`pegasus`
(in the vendor `ubuntu-npu:v2.0.10.2` image, which bakes in the toolkit) → uint8-quantized `.nb`
compiled for `VIP9000NANODI_PLUS_PID0X1000003B` (A733/v3) → **deployed to the board and run on the
Vivante VIP9000 NPU**.

- **Converted:** `yolov5s-sim.onnx` (29 MB) → `yolov5s-sim_uint8.nb` (**5.3 MB** NBG), uint8
  `asymmetric_affine`, calibrated on the SDK's 6 COCO images. Header magic `VPMN`, optimize PID
  `0x1000003B` baked in.
- **Ran on-device** (Radxa Cubie A7Z, `sun60iw2`, kernel `5.15.147-7-a733`, VIPLite driver
  `2.0.3.2`, `/dev/vipcore`) against the classic `dog_640_640.jpg`, alongside the SDK's prebuilt
  `yolov5.nb` as a reference:

| detection | prebuilt `yolov5.nb` | **laptop-built `.nb`** |
| --- | --- | --- |
| dog | 82%, `[112,233,257,609]` | **82%, `[112,243,257,601]`** |
| truck | 69%, `[390,83,576,194]` | **64%, `[391,83,575,194]`** |
| bicycle | 47%, `[84,144,469,469]` | **46%, `[84,144,469,469]`** |
| NPU `vip_run_network` | 26.5 ms | **19.9 ms** |

Same three objects, near-identical boxes; three correct YOLOv5 output heads
(`85×80×80×3`, `85×40×40×3`, `85×20×20×3`). The small confidence deltas are calibration/quantization
variance between two independent quantize runs — the model is functionally identical. **This closes
the loop the doc describes: a pretrained model, offline-compiled on a workstation, produces correct
detections on the real accelerator.**

Reproduce: `./convert_nb.sh <ai-sdk-dir> yolov5s-sim uint8 t536`, then deploy the `.nb` and run
`yolov5 <nb> dog_640_640.jpg` on the board.

### YOLO11 on the NPU — the head-cut case (reproduced + on-device verified)

yolov5 converts whole; **YOLO11 needs a head-cut first** (anchor-free DFL head mixes box coords +
class scores into one output → can't share an int8 scale). Full write-up in doc-13 §2.1.

- **Cut** (`DeepStream-Yolo/utils/export_yolo11.py`, `Detect.forward = forward_split`) →
  `yolo11s_cut.onnx`: input `images[1,3,640,640]` → 6 raw heads (`cv2.{0,1,2}` box[64],
  `cv3.{0,1,2}` cls[80] @ 80/40/20). DFL decode + NMS then run in software (`hx_post_yolo11`).
- **Convert** (same flow, only the 6 output names differ — see `yolo11s.inputs_outputs.txt`):
  `./convert_nb.sh ~/ai-sdk yolo11s uint8 t536` → **`yolo11s_uint8.nb` (6.85 MB)**, `VPMN` + PID
  `0x1000003B` (A733/v3), uint8 `asymmetric_affine`, COCO-calibrated. ACUITY import clean
  (Error 0 / Warning 0). Log: `work/yolo11s_convert.log`.
- **On-device (real A733 NPU):** fresh `.nb` = **6,846,288 B** vs the known-good board `yolo11s.nb`
  **6,841,888 B** (~4 KB calibration variance). Swapped into the live `helix_pipeline` (real DFL
  decoder): loads (`load_param 0.80 ms`), **~41 ms/inf, AGG 31.5 inf/s** (≈ known-good ~33),
  balanced detections on all 4 streams. Recipe → header-valid → device-valid → detects.

Reproduce: register `ai-sdk/models/yolo11s/` (cut ONNX + `yolo11s.inputs_outputs.txt` + reuse
yolov5's `dataset.txt`/`images/`/`channel_mean_value.txt`), then
`./convert_nb.sh <ai-sdk-dir> yolo11s uint8 t536`.

---

## NVIDIA target (GTX 1650)

A real, runnable instance of the doc-13 flow, **NVIDIA target**, run on this laptop's **GTX 1650**
via the already-present NVIDIA DeepStream 7.1 image (TensorRT + `trtexec`). No host ML install.
Script: [`convert_trt.sh`](./convert_trt.sh).

```
pretrained ONNX  ──(trtexec: offline compile + FP16 quantize)──▶  .engine   (hardware artifact)
```
Same shape as the Radxa NPU path (`ONNX → ACUITY → .nb`): export to ONNX interchange → run the
accelerator's offline compiler → validate fidelity → measure. Only the compiler + artifact differ
per target.

## What was converted
- **Model:** MobileNetV2-12 (ImageNet-pretrained classifier, real weights), from the ONNX model zoo — 14 MB `.onnx`.
- **Compiler:** TensorRT 10 `trtexec`, on an NVIDIA GTX 1650, CUDA 12.6.
- **Steps:** fetch ONNX → build FP32 engine (baseline) → build FP16 engine (quantized) → benchmark both (300 runs) → fidelity (FP32-engine vs FP16-engine output on a fixed input).

## Results
| | **FP32 engine** | **FP16 engine (quantized)** | delta |
| --- | --- | --- | --- |
| artifact size | 14.9 MB | **9.5 MB** | −36% |
| throughput | 1051 qps | **1176 qps** | **1.12×** |
| GPU latency (median) | 0.949 ms | **0.847 ms** | −11% |

**Fidelity (FP16 vs FP32):** `max-abs-diff = 2.15e-2`, **`cosine-sim = 0.999993`**, **top-1 class agrees**. So the quantized artifact is numerically faithful — the exact float-vs-quant check the doc calls for (the NPU path uses ACUITY's `compute_tensor_similarity` for the same purpose).

## Notes
- The **FP16 speedup is modest** because the **GTX 1650 (Turing)** has weak FP16 throughput and MobileNetV2 is light/memory-bound; on a tensor-core GPU (Jetson Orin, dGPU) or with INT8 the gain is larger. The point here is the **flow**, proven end-to-end with a real model + a real deployable artifact + a fidelity gate.
- The **Radxa NPU target (`ONNX → ACUITY → .nb`)** was also run for real (see the NPU section above) using the vendor Docker toolkit `ubuntu-npu:v2.0.10.2` (ACUITY/`pegasus` baked in) — that image is exactly what the HELIX-149 build-service phase containerizes. `trtexec` is the NVIDIA analogue of `pegasus export`.
- Reproduce (TensorRT): `./convert_trt.sh [ONNX_URL_or_path] [input_name] [N,C,H,W]`. Artifacts land in `work/`.
- Reproduce (NPU): `./convert_nb.sh <ai-sdk-dir> yolov5s-sim uint8 t536`; deploy the `.nb` + run `yolov5 <nb> dog_640_640.jpg` on the board.
