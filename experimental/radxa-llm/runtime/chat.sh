#!/bin/bash
# Interactive chat on the Radxa Cubie A7Z. Run ON the board.
#   Q4_0 quant: ARM-repacked (dotprod) -> ~24 t/s vs ~17.7 for Q4_K_M
#   6 threads and 12k context were both measured as optimal on this board
cd "${BIN:-$HOME/llama-x}"
exec env LD_LIBRARY_PATH="$PWD" ./llama-cli \
  -m "${MODEL:-$HOME/models/Qwen2.5-0.5B-Instruct-Q4_0.gguf}" \
  -t 6 -c 12288 --temp 0.7 -cnv \
  -sys "You are a concise, helpful assistant running locally on a Radxa Cubie A7Z single-board computer." \
  "$@"
