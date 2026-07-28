<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Plain DeepStream 4-stream pipeline (x86 baseline / comparison)

This is a **pure NVIDIA DeepStream** pipeline — **no Helix components** — used to sanity-check our
own plugin pipeline (`../src/plugins`, ONNX-Runtime based) against NVIDIA's reference flow on the
same GTX 1650 laptop. Everything here is stock `deepstream-app` + config files.

```
4x RTSP ─► nvstreammux (batch=4) ─► nvinfer (TensorRT) ─► nvmultistreamtiler (2x2)
        ─► nvdsosd ─► RTSP-out sink        (all zero-copy in GPU / NVMM memory)
```

## Files

- **`run.sh`** — one script that does the whole flow: pull the DeepStream image, clone
  `DeepStream-Yolo` (the custom YOLO bbox parser + ONNX export), export YOLO11s, build the parser in
  the container, drop the configs in, and launch `deepstream-app`.
- **`config_infer_yolo11s.txt`** — the `nvinfer` config for YOLO11s (FP32, letterbox, 80 classes,
  custom `NvDsInferParseYolo` parser).
- **`ds_4stream_yolo.txt`** — the `deepstream-app` config: 4 RTSP sources → `nvstreammux` batch-4 →
  `nvinfer` (YOLO11s) → 2×2 tiler → OSD → RTSP-out sink (viewable). Perf measurement on.
- **`ds_4stream_resnet.txt`** — the same but using DeepStream's shipped sample detector
  (resnet18-trafficcamnet, INT8) via the stock `config_infer_primary.txt` — the "plain simple
  nvidia-recommended" flow with zero extra setup.

## Run

```sh
# resnet sample (no build needed — just needs the image + 4 RTSP streams):
docker run -d --name ds-app --gpus all --network host \
  -v $PWD/ds_4stream_resnet.txt:/ds.txt:ro \
  nvcr.io/nvidia/deepstream:7.1-samples-multiarch deepstream-app -c /ds.txt
docker logs -f ds-app | grep PERF

# YOLO11s (apples-to-apples with our pipeline):
WEIGHTS=/path/to/yolo11s.pt PY=/path/to/venv/bin/python ./run.sh
docker logs -f ds-yolo | grep PERF          # FPS per source
# view: rtsp://127.0.0.1:8560/ds-test
```

## Gotchas hit while building the YOLO parser

- The DeepStream **samples** image is CUDA-*runtime* only — building the custom parser needs
  `nvcc` + headers, so `run.sh` `apt-get install`s `cuda-nvcc-12-6 cuda-cudart-dev-12-6 cuda-crt-12-6`.
- `libcublas-dev-12-6` has **broken deps** and won't install; but the runtime `libcublas.so.12` is
  present, so we just create the unversioned `libcublas.so` symlink the linker wants.
- This host's IPv6 route to the apt/registry CDN is flaky → force IPv4 (`Acquire::ForceIPv4`).
- On this **GTX 1650 Mobile (TU117)** NVENC only accepts the new-style presets `p1..p7` (the RTSP-out
  sink uses the DeepStream encoder, which handles this internally).

## Result (4× 768×432 @ ~15 fps streams, GTX 1650 Mobile, driver 595)

Measured live (`nvidia-smi` + `deepstream-app` PERF + `docker stats`):

| | Our plugin pipeline (ONNX-RT) | **DeepStream, same YOLO11s FP32** |
| --- | --- | --- |
| throughput | 45 inf/s (**drops ~25% of frames**) | **60 fps — real-time, every frame** |
| est. max (uncapped) | 45/s | **~90/s** (60 fps at only 66% GPU) |
| **CPU** | **170%** | **18%** (~9× less) |
| GPU compute | 79% | 66% |
| **NVDEC** | idle | **used** |
| **NVENC** | idle | **used** |
| VRAM | 833 MB | 420 MB |

**Conclusion.** With the identical model, DeepStream is decisively better: it keeps up with all
frames in real-time, uses ~9× less CPU, and actually uses the NVDEC/NVENC engines — because it does
the GPU-resident, **batched-TensorRT, zero-copy (NVMM)** pipeline properly end to end. Our hand-rolled
`cv::cuda` GPU-resident attempt (`../src/plugins/infer_ort_gpu`) was *counterproductive* by
comparison (per-frame upload/sync, un-batched ORT, CPU decode/encode). **Takeaway: on x86/NVIDIA,
use DeepStream / TensorRT — don't hand-roll it.** Our plugin architecture's value is portability and
the Radxa A733 **NPU** path; DeepStream is the answer for a pure NVIDIA box. See `../docs/09` for the
full optimization arc.
