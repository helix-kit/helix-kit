<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 09 — Porting the pipeline to x86 / Docker (GPU-adaptive)

Date: 2026-07-26

## Why

The whole point of the plugin architecture (doc 08) was portability. This ports the exact same
pipeline off the Radxa A733 (awnn NPU + Cedar VE) onto an **x86 laptop in a Docker container that
adapts to the available accelerators** — proving the ABI/host/portable-plugins carry across
platforms with only the hardware-specific stages swapped.

## What ports unchanged vs what's new

Same `helix_pipeline.h` (ABI), `helix_pipeline.cpp` (host), `hx_json.h`, and — compiled from
**identical source** on both platforms — `hx_pre_letterbox`, `hx_post_{yolov5,yolo11,pose}`,
`hx_overlay_{boxes,pose}`, `hx_comp_grid`. Only **three** stages get x86 variants:

| stage | Radxa | x86 |
| --- | --- | --- |
| source | `hx_src_gst` (`omxh264dec`) | `hx_src_gst` (**same plugin**, `decoder` param → `decodebin`) |
| infer | `hx_infer_awnn` (VIPLite NPU, `.nb`) | **`hx_infer_ort`** (ONNX Runtime, `.onnx`, EP = CUDA→CPU) |
| sink | `hx_sink_cedar_rtmp` (Cedar VE) | **`hx_sink_gst`** (gst `x264enc`/nvenc/vaapi → RTMP) |

`hx_infer_ort` loads the **cut-6-heads ONNX** (`yolo11s_cut.onnx`, exported with
`onnx.utils.extract_model` on the same `cv2.*`/`cv3.*` heads used for the NBG), converts the uint8
CHW tensor from `hx_pre_letterbox` to f32/255, runs the session, and emits the same 6 raw heads — so
**`hx_post_yolo11` is reused byte-for-byte**.

## Container

`Dockerfile.x86` (base `nvidia/cuda:12.4.1-cudnn-runtime`): OpenCV + GStreamer (base/good/bad/ugly/
libav) + ONNX Runtime GPU 1.19.2 (C++), builds via `Makefile.x86`. `docker-entrypoint.sh` **detects
the hardware** (NVIDIA `nvidia-smi` → `providers:["CUDA","CPU"]`; else CPU), fills
`configs/x86.template.json`, and runs the host. Model swap / EP choice / decoder / encoder are all
config, no rebuild — the "adapts to available resources" story.

```sh
docker build -f Dockerfile.x86 -t helix-pipeline-x86 .
docker run -d --name helix-x86 --gpus all --network host -v $PWD/models:/models helix-pipeline-x86
# watch: http://127.0.0.1:8889/detgrid
```

## Result (this laptop: AMD Ryzen 5 5500U + NVIDIA GTX 1650 Mobile 4 GB)

- Entrypoint auto-selected **ONNX Runtime CUDA** on the GTX 1650; all 4 infer nodes loaded the ONNX
  on CUDA. Chain: `hx_src_gst → hx_pre_letterbox → hx_infer_ort → hx_post_yolo11 → hx_overlay_boxes`.
- **AGG 41.6 inf/s** (10.4/stream, ~22 ms/inference) — *higher* than the board's 31.7 — at **693 MB
  VRAM / ~80 % GPU**. Same annotated grid on `/detgrid`, dense correct detections on the same
  complex scenes.
- Headroom untapped: the host still serializes GPU access via `mtx_npu`, uses FP32, and CPU-x264
  encode. FP16/TensorRT (the EP is one param away), removing the mutex for GPU infer (allow parallel
  CUDA streams), and NVENC would push this much higher.

## Gotchas

- Host Python is 3.14 — too new for the NVIDIA/ORT-GPU wheels; the container (controlled Python +
  CUDA) is the right env, and Docker GPU passthrough (`--gpus all`, nvidia-container-toolkit CDI)
  works out of the box.
- The config template's `_note` must not contain the `${...}` substitution tokens — sed replacing
  `${PROVIDERS}` with `["CUDA","CPU"]` injects quotes that break the JSON string.
- `--network host` lets the container reach the host-published RTSP (`:8554`) and RTMP (`:1935`).
- AMD Vega iGPU here has no ROCm, so it is a video (VAAPI) engine, not an ORT EP — inference falls
  back to CPU on an AMD-only box (still correct, just slower).
