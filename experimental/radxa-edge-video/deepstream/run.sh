#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Reproduce the PLAIN DeepStream 4-stream YOLO11s pipeline (no Helix components) that we used to
# benchmark against our own plugin pipeline. NVIDIA-recommended flow:
#   4x RTSP -> nvstreammux(batch=4) -> nvinfer(YOLO11s, TensorRT) -> nvmultistreamtiler(2x2)
#            -> nvdsosd -> RTSP-out sink (viewable), all zero-copy in GPU (NVMM) memory.
#
# Prereqs: docker + nvidia-container-toolkit + a recent NVIDIA driver (>=560 for DeepStream 7.1);
#          4 RTSP H.264 streams at rtsp://HOST:8554/stream1..4; a Python with `ultralytics`+`onnx`
#          (for the one-time ONNX export); ~25 GB disk for the DeepStream image.
# Usage:   WEIGHTS=/path/yolo11s.pt PY=/path/venv/bin/python HELIX_HOST=127.0.0.1 ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/edge-x86/DeepStream-Yolo}"
DS_IMAGE="${DS_IMAGE:-nvcr.io/nvidia/deepstream:7.1-samples-multiarch}"
HOST="${HELIX_HOST:-127.0.0.1}"
PY="${PY:-python3}"                       # must have ultralytics + onnx installed
WEIGHTS="${WEIGHTS:-yolo11s.pt}"

echo "== 1. DeepStream image =="
docker pull "$DS_IMAGE"

echo "== 2. DeepStream-Yolo (custom bbox parser + export scripts) =="
[ -d "$WORK/.git" ] || git clone --depth 1 https://github.com/marcoslucianops/DeepStream-Yolo "$WORK"

echo "== 3. Export YOLO11s -> DeepStream ONNX ([batch,8400,6]) + labels.txt =="
cp -n "$WEIGHTS" "$WORK/" 2>/dev/null || true
( cd "$WORK" && "$PY" utils/export_yolo11.py -w "$(basename "$WEIGHTS")" -s 640 --dynamic )

echo "== 4. Build the custom parser .so in the DeepStream container =="
# The samples image is CUDA-RUNTIME only: install nvcc/cudart-dev/crt for the build, and create the
# unversioned libcublas.so symlink (the -dev package has broken deps, but the runtime .so.12 exists).
docker run --rm --gpus all -v "$WORK":/w --entrypoint bash "$DS_IMAGE" -c '
  echo "Acquire::ForceIPv4 \"true\";" > /etc/apt/apt.conf.d/99ipv4
  apt-get update -qq && apt-get install -y -qq cuda-nvcc-12-6 cuda-cudart-dev-12-6 cuda-crt-12-6
  ln -sf /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcublas.so.12 /usr/local/cuda-12.6/lib64/libcublas.so
  cd /w/nvdsinfer_custom_impl_Yolo && CUDA_VER=12.6 make'

echo "== 5. Place configs into the working dir =="
cp "$HERE/config_infer_yolo11s.txt" "$HERE/ds_4stream_yolo.txt" "$WORK/"
[ "$HOST" = "127.0.0.1" ] || sed -i "s/127.0.0.1/$HOST/g" "$WORK/ds_4stream_yolo.txt"

echo "== 6. Run deepstream-app (builds the TensorRT engine on first run, ~1-2 min) =="
docker rm -f ds-yolo 2>/dev/null || true
docker run -d --name ds-yolo --gpus all --network host \
  -v "$WORK":/work -w /work --entrypoint deepstream-app \
  "$DS_IMAGE" -c ds_4stream_yolo.txt

cat <<EOF

DeepStream is up.
  FPS:   docker logs -f ds-yolo | grep PERF
  View:  rtsp://$HOST:8560/ds-test   (e.g. ffplay/vlc, or an OpenCV VideoCapture)
  Stop:  docker rm -f ds-yolo
EOF
