#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# convert_nb.sh — a real, runnable instance of the doc-13 model-conversion flow, RADXA A733 NPU target.
#
#   pretrained ONNX  --(ACUITY/pegasus: import -> quantize -> export NBG)-->  .nb  (Vivante VIP9000 artifact)
#
# The NPU sibling of convert_trt.sh (which does the NVIDIA/TensorRT target). Same shape as doc-13:
# export to the ONNX interchange, run the accelerator's offline COMPILER to a hardware-specific
# ARTIFACT, then validate on the real device. The compiler here is ACUITY (`pegasus`), shipped in
# the vendor Docker image `ubuntu-npu:v2.0.10.2` (github.com/ZIFENG278/ai-sdk), which bakes in the
# toolkit at ACUITY_PATH=/usr/local/acuity_command_line_tools and the Vivante SDK at
# VIV_SDK=/root/Vivante_IDE/VivanteIDE5.11.0/cmdtools. No host ML install needed.
#
# It runs the SDK's own convert_export.sh, which does the four pegasus stages (import -> channel-mean
# patch -> quantize-with-calibration -> export NBG). The A733 is platform `t536`/`a733` (v3), which
# maps to optimize target VIP9000NANODI_PLUS_PID0X1000003B (baked into the .nb header).
#
# Usage:  ./convert_nb.sh <ai-sdk-dir> [model] [qtype] [platform]
#   <ai-sdk-dir>  path to the ZIFENG278 ai-sdk tree (has models/, machinfo/, viplite-tina/)
#   model         default yolov5s-sim   (must be ai-sdk/models/<model>/<model>.onnx + config)
#   qtype         default uint8         (uint8|int16|bf16|pcq)
#   platform      default t536          (A733; also a733/mr536)
#
# Output: ai-sdk/models/<model>/<model>_<qtype>.nb  — deploy under model/v3/ and run with the
# yolov5 example (awnn/VIPLite) on the board. See RESULTS.md for the real run + on-device detections.
set -euo pipefail
IMAGE="ubuntu-npu:v2.0.10.2"
AISDK="${1:?usage: convert_nb.sh <ai-sdk-dir> [model] [qtype] [platform]}"
MODEL="${2:-yolov5s-sim}"; QTYPE="${3:-uint8}"; PLATFORM="${4:-t536}"
AISDK="$(cd "$AISDK" && pwd)"
[[ -f "$AISDK/models/$MODEL/$MODEL.onnx" ]] || { echo "no $AISDK/models/$MODEL/$MODEL.onnx"; exit 1; }

echo "== convert $MODEL ($QTYPE, platform=$PLATFORM) via ACUITY in $IMAGE =="
docker run --rm -v "$AISDK":/ai-sdk -w "/ai-sdk/models/$MODEL" "$IMAGE" bash -lc "
  set -o pipefail
  export ACUITY_PATH=/usr/local/acuity_command_line_tools
  export VIV_SDK=/root/Vivante_IDE/VivanteIDE5.11.0/cmdtools
  ./convert_export.sh $MODEL $QTYPE $PLATFORM
"
NB="$AISDK/models/$MODEL/${MODEL}_${QTYPE}.nb"
echo "== artifact =="; ls -la "$NB" 2>/dev/null || { echo "no .nb produced"; exit 1; }
echo -n "== NBG header (expect magic VPMN + optimize PID) == "; xxd "$NB" | head -1
echo "== DONE — $NB (deploy to board model/v3/, run: yolov5 <nb> dog_640_640.jpg) =="
