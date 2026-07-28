#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Detect the available accelerators and generate the pipeline config for them, then run the host.
# This is the "adapts to the resources available" step: NVIDIA -> ORT CUDA; else CPU. Video
# decode uses decodebin (auto: NVDEC/VAAPI/software); encode uses x264 (cheap; GPU is for infer).
set -e
HOST="${HELIX_HOST:-127.0.0.1}"
MODEL="${HELIX_MODEL:-/models/yolo11s_cut.onnx}"

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
    echo "[entrypoint] NVIDIA GPU: $GPU  -> ONNX Runtime CUDA"
    PROVIDERS='["CUDA","CPU"]'
elif [ -e /dev/dri/renderD128 ]; then
    echo "[entrypoint] no NVIDIA GPU; DRI render node present -> CPU inference (AMD/Intel iGPU has no ORT EP here)"
    PROVIDERS='["CPU"]'
else
    echo "[entrypoint] no GPU detected -> CPU inference"
    PROVIDERS='["CPU"]'
fi
DECODER="${HELIX_DECODER:-decodebin}"                                   # auto-picks NVDEC/VAAPI/software
ENCODER="${HELIX_ENCODER:-x264enc tune=zerolatency speed-preset=veryfast}"

TEMPLATE="${HELIX_TEMPLATE:-configs/x86.template.json}"
echo "[entrypoint] TEMPLATE=$TEMPLATE HOST=$HOST MODEL=$MODEL PROVIDERS=$PROVIDERS DECODER='$DECODER' ENCODER='$ENCODER'"

# fill the template (leave ${HOST} for the host binary to substitute)
sed -e "s|\${MODEL}|$MODEL|g" \
    -e "s|\${PROVIDERS}|$PROVIDERS|g" \
    -e "s|\${DECODER}|$DECODER|g" \
    -e "s|\${ENCODER}|$ENCODER|g" \
    "/pipeline/$TEMPLATE" > /tmp/config.json

cd /pipeline
exec ./helix_pipeline /tmp/config.json "$HOST"
