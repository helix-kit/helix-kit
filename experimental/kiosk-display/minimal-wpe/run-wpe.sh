#!/usr/bin/env bash
# Boot the minimal Ubuntu WPE/cog kiosk image in a Raspberry Pi Zero 2 W sized
# QEMU box: aarch64 Cortex-A53, 4 cores, 512 MiB. TCG (no KVM on x86).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="${HELIX_WPE_LAB:-${SCRIPT_DIR}/.lab}"
IMAGE="${LAB}/helix-kiosk-wpe.ext4"
KERNEL="${LAB}/vmlinuz"
INITRD="${LAB}/initrd.img"
SSH_PORT="${HELIX_WPE_SSH_PORT:-2224}"
MEM="${HELIX_WPE_MEM:-512}"
CPUS="${HELIX_WPE_CPUS:-4}"
DISPLAY_ARGS=(-display gtk,gl=off)

for arg in "$@"; do
  case "${arg}" in
    --build) "${SCRIPT_DIR}/build-ubuntu.sh" ;;
    --headless) DISPLAY_ARGS=(-display none) ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

for f in "${IMAGE}" "${KERNEL}" "${INITRD}"; do
  [[ -f "${f}" ]] || { echo "missing ${f} — run ./build-ubuntu.sh first" >&2; exit 1; }
done

exec qemu-system-aarch64 \
  -machine virt \
  -cpu cortex-a53 \
  -smp "${CPUS}" \
  -m "${MEM}" \
  -kernel "${KERNEL}" \
  -initrd "${INITRD}" \
  -append "console=ttyAMA0 root=/dev/vda rw" \
  -drive "file=${IMAGE},if=none,id=hd0,format=raw" \
  -device virtio-blk-pci,drive=hd0 \
  -netdev "user,id=net0,hostfwd=tcp::${SSH_PORT}-:22" \
  -device virtio-net-pci,netdev=net0 \
  -device virtio-gpu-pci \
  -device virtio-keyboard-pci \
  -device virtio-tablet-pci \
  -qmp "unix:${LAB}/qmp.sock,server,nowait" \
  -serial mon:stdio \
  "${DISPLAY_ARGS[@]}"
