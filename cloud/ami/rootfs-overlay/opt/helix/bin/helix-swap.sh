#!/bin/sh
# Set up swap for a memory-constrained host: a compressed zram device (primary,
# high priority — cold pages compress in RAM instead of hitting slow EBS) plus a
# disk swapfile for overflow. Driven by helix-swap.service. Idempotent.
#
# Sizes are overridable via /etc/helix/site.env (HELIX_ZRAM_SIZE, HELIX_SWAP_SIZE).
set -eu

[ -f /etc/helix/site.env ] && . /etc/helix/site.env || true
ZRAM_SIZE="${HELIX_ZRAM_SIZE:-768M}"
SWAP_SIZE="${HELIX_SWAP_SIZE:-2G}"
SWAPFILE=/swapfile

# --- disk swapfile (overflow, low priority) ---------------------------------
if [ ! -f "$SWAPFILE" ]; then
  fallocate -l "$SWAP_SIZE" "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE" >/dev/null
fi
swapon --show=NAME --noheadings | grep -qx "$SWAPFILE" || swapon -p -2 "$SWAPFILE"

# --- zram (primary, compressed, in-RAM) -------------------------------------
if [ ! -e /dev/zram0 ]; then
  modprobe zram num_devices=1 || true
fi
if [ -e /dev/zram0 ] && ! swapon --show=NAME --noheadings | grep -qx /dev/zram0; then
  # comp_algorithm/disksize are write-once until reset; reset first to be safe.
  echo 1 > /sys/block/zram0/reset 2>/dev/null || true
  echo lz4 > /sys/block/zram0/comp_algorithm 2>/dev/null || true
  echo "$ZRAM_SIZE" > /sys/block/zram0/disksize
  mkswap /dev/zram0 >/dev/null
  swapon -p 100 /dev/zram0
fi

sysctl -w vm.swappiness=60 >/dev/null 2>&1 || true
swapon --show
