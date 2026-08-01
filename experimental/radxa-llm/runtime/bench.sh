#!/bin/bash
# llama.cpp benchmark harness for the Radxa Cubie A7Z. Run ON the board.
#
#   ./bench.sh              # threads + quants + flags
#   ./bench.sh quants       # one stage
#   LOG=~/my.log ./bench.sh flags
#
# The quiesce step is not optional hygiene — it is the measurement. With 961 MB of RAM,
# a leftover chat session or a second mmap'd model halves the numbers and inflates the
# error bars (results/bench-04-quant-sweep-contended.log is that mistake, kept as the
# counter-example to results/bench-05-quant-sweep-clean.log).
set -euo pipefail
BIN=${BIN:-$HOME/llama-x}
MODELS=${MODELS:-$HOME/models}
LOG=${LOG:-$HOME/bench.log}
STAGES=${*:-threads quants flags}

M4KM=$MODELS/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf
M40=$MODELS/Qwen2.5-0.5B-Instruct-Q4_0.gguf
M3KS=$MODELS/Qwen2.5-0.5B-Instruct-Q3_K_S.gguf

quiesce() {
  pgrep -x llama-cli >/dev/null && { echo "REFUSING: llama-cli is running (kill it first)" >&2; exit 1; }
  sudo -n systemctl stop sddm x11vnc cups bluetooth avahi-daemon udisks2 upower \
       accounts-daemon packagekit 2>/dev/null || true
  # the A76 cluster idles at a low OPP; without this the first reps measure the ramp
  for c in /sys/devices/system/cpu/cpu[0-9]*; do
    echo performance | sudo -n tee "$c/cpufreq/scaling_governor" >/dev/null 2>&1 || true
  done
  sync; echo 3 | sudo -n tee /proc/sys/vm/drop_caches >/dev/null 2>&1 || true
  sleep 3
}

run() {
  local label="$1"; shift
  quiesce
  echo "### $label" >> "$LOG"
  ( cd "$BIN" && env LD_LIBRARY_PATH="$PWD" ./llama-bench -p 64 -n 64 -r 3 "$@" ) \
    2>/dev/null | grep -E '^\| (qwen|llama|model)' >> "$LOG"
}

: > "$LOG"
echo "board: $(tr -d '\0' < /proc/device-tree/model 2>/dev/null)  free: $(free -m | awk '/^Mem:/{print $7}') MB" >> "$LOG"

for stage in $STAGES; do
  case "$stage" in
    threads)
      # The A733 is 2x A76 (cpu6-7) + 6x A55 (cpu0-5). Generation is memory-bound, so
      # it flatlines from 2 threads on; only prompt processing keeps scaling to 8.
      for t in 1 2 4 6 8; do run "threads=$t (Q4_K_M)" -m "$M4KM" -t "$t"; done
      ;;
    quants)
      # one model per run, cache dropped between: three 330 MB mmaps at once thrash.
      run "Q4_K_M" -m "$M4KM" -t 6
      run "Q4_0"   -m "$M40"  -t 6
      run "Q3_K_S" -m "$M3KS" -t 6
      ;;
    flags)
      run "Q4_0"                -m "$M40" -t 6
      run "Q4_0 + flash-attn"   -m "$M40" -t 6 -fa 1
      run "Q4_0 + fa + KV q8_0" -m "$M40" -t 6 -fa 1 -ctk q8_0 -ctv q8_0
      ;;
    *) echo "unknown stage: $stage" >&2; exit 2 ;;
  esac
done

echo "DONE" >> "$LOG"
cat "$LOG"
