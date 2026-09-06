#!/bin/bash
# Pull the GGUF quants this lab benchmarks. Run ON the board (or the laptop — same files).
# Q4_0 is the one that matters; the others exist so the quant comparison is reproducible.
#
#   ./fetch-models.sh                 # Q4_0 Q4_K_M Q3_K_S
#   ./fetch-models.sh Q4_0            # just the winner
#   WITH_1B=1 ./fetch-models.sh       # also the 1B step-up candidate
set -euo pipefail
DEST=${DEST:-$HOME/models}
REPO=https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main
mkdir -p "$DEST" && cd "$DEST"

for q in "${@:-Q4_0 Q4_K_M Q3_K_S}"; do
  for qq in $q; do
    f="Qwen2.5-0.5B-Instruct-${qq}.gguf"
    if [ -f "$f" ]; then echo "  $qq: present ($(du -h "$f" | cut -f1))"; continue; fi
    # -C - so a brown-out mid-download resumes instead of restarting; it happened.
    curl -fsSL -C - --retry 3 -o "$f" "$REPO/$f" && echo "  $qq: $(du -h "$f" | cut -f1)"
  done
done

# 737 MB against ~760 MB free: fits, but only with the desktop stopped.
if [ "${WITH_1B:-0}" = "1" ]; then
  f=Llama-3.2-1B-Instruct-Q4_0.gguf
  [ -f "$f" ] || curl -fsSL -C - --retry 3 -o "$f" \
    "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/$f"
  echo "  Llama-3.2-1B Q4_0: $(du -h "$f" | cut -f1)"
fi

ls -lh "$DEST"/*.gguf
