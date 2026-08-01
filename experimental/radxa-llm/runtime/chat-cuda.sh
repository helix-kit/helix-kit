#!/bin/bash
# The same model on the laptop's GTX 1650, for the feel-comparison against chat.sh.
# Needs a CUDA build (this is NOT what build-aarch64.sh produces):
#   cmake -B build-cuda -S src -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON \
#         -DCMAKE_CUDA_ARCHITECTURES=75 -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF
#   cmake --build build-cuda -j"$(nproc)" --target llama-cli llama-bench
# The 1650 is the one Turing part with no tensor cores; llama.cpp says so at startup and
# suggests -DGGML_CUDA_FORCE_MMQ with Pascal archs. Untested here.
cd "${CUDA_BIN:-/tmp/llama-cross/build-cuda/bin}"
exec ./llama-cli \
  -m "${MODEL:-$HOME/models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf}" \
  -ngl 99 -c 12288 -cnv --temp 0.7 \
  -sys "You are a concise, helpful assistant running locally on a GTX 1650." \
  "$@"
