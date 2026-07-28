#!/usr/bin/env bash
# Boot the minimal Alpine kiosk image in a QEMU box sized like a Raspberry Pi
# Zero 2 W: aarch64 Cortex-A53, 4 cores, 512 MiB. No KVM on an x86 host, so
# this runs under TCG (slow, but the memory figures are what we're after).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="${HELIX_KIOSK_MIN_LAB:-${SCRIPT_DIR}/.lab}"
IMAGE="${LAB}/helix-kiosk-min.ext4"
KERNEL="${LAB}/vmlinuz-virt"
INITRD="${LAB}/initramfs-virt"
SSH_PORT="${HELIX_KIOSK_MIN_SSH_PORT:-2223}"
MEM="${HELIX_KIOSK_MIN_MEM:-512}"
CPUS="${HELIX_KIOSK_MIN_CPUS:-4}"
DISPLAY_ARGS=(-display gtk,gl=off)

for arg in "$@"; do
  case "${arg}" in
    --build) "${SCRIPT_DIR}/build-alpine.sh" ;;
    --headless) DISPLAY_ARGS=(-display none) ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

for f in "${IMAGE}" "${KERNEL}" "${INITRD}"; do
  [[ -f "${f}" ]] || { echo "missing ${f} — run ./build-alpine.sh first" >&2; exit 1; }
done

exec qemu-system-aarch64 \
  -machine virt \
  -cpu cortex-a53 \
  -smp "${CPUS}" \
  -m "${MEM}" \
  -kernel "${KERNEL}" \
  -initrd "${INITRD}" \
  -append "console=ttyAMA0 root=/dev/vda rootfstype=ext4 rw" \
  -drive "file=${IMAGE},if=none,id=hd0,format=raw" \
  -device virtio-blk-pci,drive=hd0 \
  -netdev "user,id=net0,hostfwd=tcp::${SSH_PORT}-:22" \
  -device virtio-net-pci,netdev=net0 \
  -device virtio-gpu-pci \
  -device virtio-keyboard-pci \
  -device virtio-tablet-pci \
  -serial mon:stdio \
  "${DISPLAY_ARGS[@]}"
