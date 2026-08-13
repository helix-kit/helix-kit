#!/bin/bash
# Cross-build llama.cpp for the Radxa Cubie A7Z (Allwinner A733, Cortex-A76/A55) on the
# laptop, and emit a self-contained tarball for the board.
#
# Building natively on the board does NOT work: 1 GB of RAM cannot hold a -j2 C++ compile
# of ggml, and at -j1 it takes >25 min and still browns out the 500 mA-capped PD supply
# (see results/build-onboard-native-oom.log). Cross-compiling takes ~3 min here.
#
#   ./build-aarch64.sh                 # clone/reuse src, build, tarball
#   WORK=/tmp/llama-cross ./build-aarch64.sh
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
WORK=${WORK:-/tmp/llama-cross}
OUT=${OUT:-/tmp/llama-aarch64.tgz}

mkdir -p "$WORK"
cp Dockerfile toolchain-aarch64.cmake "$WORK/"

echo "==> cross image (one-time)"
docker build -q -t llama-cross:bullseye "$WORK" >/dev/null

if [ ! -d "$WORK/src" ]; then
  echo "==> cloning llama.cpp"
  git clone --quiet --depth 1 https://github.com/ggml-org/llama.cpp "$WORK/src"
fi
(cd "$WORK/src" && git log -1 --format='    at %h %s')

echo "==> configure + build (aarch64)"
docker run --rm -v "$WORK:/work" -w /work llama-cross:bullseye bash -c '
set -e
# the clone is owned by the host user; without this cmake/build-info git calls warn
git config --global --add safe.directory /work/src
cmake -B build -S src \
  -DCMAKE_TOOLCHAIN_FILE=/work/toolchain-aarch64.cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_CURL=OFF -DGGML_NATIVE=OFF \
  -DGGML_CPU_ARM_ARCH="armv8.2-a+dotprod+crypto" \
  -DHOST_CXX_COMPILER=/usr/bin/g++ \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF > /dev/null
cmake --build build -j"$(nproc)" --target llama-cli llama-bench 2>&1 | tail -3
'

# +dotprod is the whole point: it is what lets ggml repack Q4_0 into the ARM
# Q4_0_4_4/Q4_0_8_8 layouts. Without it Q4_0 loses its ~1.5x generation win.
echo "==> glibc floor (board has 2.31)"
docker run --rm -v "$WORK:/work" -w /work llama-cross:bullseye \
  bash -c 'aarch64-linux-gnu-objdump -T build/bin/llama-cli | grep -oE "GLIBC_[0-9]+\.[0-9]+" | sort -uV | tail -1'

echo "==> packing $OUT"
(cd "$WORK/build/bin" && tar czhf "$OUT" llama-cli llama-bench ./*.so ./*.so.* 2>/dev/null || true)
ls -lh "$OUT"
echo "next: $HERE/deploy.sh"
