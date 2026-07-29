#!/bin/bash
# Build the PowerVR GPU compute benchmark (run ON the board, after setup.sh).
set -euo pipefail
cd "$(dirname "$0")"
# -lOpenCL uses the registered ICD (setup.sh). If the ICD isn't set up, swap for
# -l:libPVROCL.so to link the PowerVR OpenCL driver directly.
gcc src/gpu_bench.c -O2 -o gpu_bench -lOpenCL -lm
echo "built ./gpu_bench  — run it to see device probe + correctness + benchmarks"
