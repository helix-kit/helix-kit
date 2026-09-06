#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# convert_trt.sh — a real, runnable instance of the doc-13 model-conversion flow, NVIDIA target.
#
#   pretrained ONNX  --(TensorRT trtexec: offline compile + FP16 quantize)-->  .engine
#
# Same shape as the Radxa NPU path (ONNX -> ACUITY -> .nb): export to the ONNX interchange, run the
# accelerator's offline COMPILER to a hardware-specific ARTIFACT, then validate fidelity + measure.
# Runs on any NVIDIA GPU via the already-present DeepStream image (TensorRT + trtexec) — no host ML
# install needed. Fidelity = FP32-engine vs FP16-engine output on a fixed input (the quantization
# error), computed with numpy; no tensorrt-python / onnxruntime required.
#
# Usage:  ./convert_trt.sh [ONNX_URL_or_path] [INPUT_NAME] [N,C,H,W]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; WORK="$HERE/work"; mkdir -p "$WORK"
IMAGE="nvcr.io/nvidia/deepstream:7.1-samples-multiarch"
MODEL_SRC="${1:-https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx}"
IN_NAME="${2:-input}"; IN_SHAPE="${3:-1,3,224,224}"
ONNX="$WORK/model.onnx"

echo "== [1/4] fetch pretrained ONNX =="
if [[ -f "$MODEL_SRC" ]]; then cp "$MODEL_SRC" "$ONNX"; else curl -fsSL "$MODEL_SRC" -o "$ONNX"; fi
echo "  model: $(du -h "$ONNX" | cut -f1)   $MODEL_SRC"

docker run --rm --gpus all -v "$WORK":/work -w /work -e IN_NAME="$IN_NAME" -e IN_SHAPE="$IN_SHAPE" "$IMAGE" bash -lc '
set -uo pipefail
TRTEXEC=/usr/src/tensorrt/bin/trtexec
echo "== GPU =="; nvidia-smi --query-gpu=name --format=csv,noheader
$TRTEXEC 2>/dev/null | head -1 || true; $TRTEXEC --help 2>&1 | grep -m1 -i "TensorRT.v" || true
pip install -q numpy 2>/dev/null || true

bench() {  # $1=label  $2..=extra trtexec flags
  local label="$1"; shift
  $TRTEXEC --onnx=/work/model.onnx --saveEngine=/work/model_$label.engine "$@" \
     --iterations=300 --avgRuns=300 --noDataTransfers 2>&1 \
     | grep -iE "GPU Compute Time:|Throughput:|Latency:|Engine build" | sed "s/^/  [$label] /"
}
echo "== [2/4] compile ONNX -> FP32 engine (baseline) + benchmark =="; bench fp32
echo "== [3/4] compile ONNX -> FP16 engine (quantized) + benchmark =="; bench fp16 --fp16

echo "== [4/4] fidelity: FP32-engine vs FP16-engine on a fixed input =="
python3 - <<PY
import numpy as np
np.random.seed(0)
n,c,h,w=[int(x) for x in "${IN_SHAPE}".split(",")]
np.random.rand(n,c,h,w).astype(np.float32).tofile("/work/input.dat")
print("  fixed input:", (n,c,h,w))
PY
for L in fp32 fp16; do
  $TRTEXEC --loadEngine=/work/model_$L.engine --loadInputs=${IN_NAME}:/work/input.dat \
     --exportOutput=/work/out_$L.json --iterations=1 --warmUp=0 >/dev/null 2>&1 || echo "  ($L output export failed)"
done
python3 - <<PY
import json,numpy as np
def load(p):
    d=json.load(open(p)); t=d[0] if isinstance(d,list) else d
    return np.array(t["values"],dtype=np.float32)
try:
    a=load("/work/out_fp32.json"); b=load("/work/out_fp16.json")
    mad=float(np.max(np.abs(a-b))); cos=float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-9))
    print(f"  outputs={a.size}  max-abs-diff={mad:.4e}  cosine-sim={cos:.6f}  top1-agree={int(a.argmax()==b.argmax())}")
except Exception as e:
    print("  fidelity compare skipped:", e)
PY
echo "== artifacts =="; ls -la /work/*.engine 2>/dev/null | awk "{printf \"  %6s  %s\n\", \$5, \$9}"
' 2>&1 | tee "$WORK/RESULTS.txt"
echo; echo "== DONE — artifacts + log in $WORK =="
