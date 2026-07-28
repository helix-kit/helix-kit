#!/usr/bin/env bash
# Launch the Helix kiosk VM in QEMU. Ported from a prior production system's qemu-display lab.
#
# The whole repo is shared into the guest over 9p (mount tag "helix") at
# /home/helix/helix, so the built site and the kiosk shell are served straight
# from the working tree — no rebuild of the VM image needed to iterate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAB_ROOT="${HELIX_KIOSK_LAB_ROOT:-${SCRIPT_DIR}/.lab}"
VM_IMAGE="${HELIX_KIOSK_VM_IMAGE:-${LAB_ROOT}/helix-kiosk.qcow2}"
SEED_ISO="${HELIX_KIOSK_SEED_ISO:-${LAB_ROOT}/helix-kiosk-seed.iso}"
SSH_PORT="${HELIX_KIOSK_SSH_PORT:-2222}"
PREPARE_ARGS=()
QEMU_ACCEL_ARGS=(-enable-kvm -cpu host)
QEMU_DISPLAY_ARGS=(-display gtk,gl=on)
QEMU_SERIAL_ARGS=(-serial mon:stdio)

for arg in "$@"; do
  case "${arg}" in
    --fresh) PREPARE_ARGS+=(--fresh) ;;
    --skip-site) PREPARE_ARGS+=(--skip-site) ;;
    --no-kvm) QEMU_ACCEL_ARGS=(-cpu max) ;;
    --stdio)
      QEMU_DISPLAY_ARGS=(-display none)
      QEMU_SERIAL_ARGS=(-nographic)
      ;;
    --serial-stdio) QEMU_SERIAL_ARGS=(-serial mon:stdio) ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

"${SCRIPT_DIR}/prepare-kiosk.sh" "${PREPARE_ARGS[@]}"

exec qemu-system-x86_64 \
  "${QEMU_ACCEL_ARGS[@]}" \
  -m "${HELIX_KIOSK_MEMORY:-4096}" \
  -smp "${HELIX_KIOSK_CPUS:-4}" \
  -drive "file=${VM_IMAGE},if=virtio,format=qcow2" \
  -drive "file=${SEED_ISO},if=virtio,media=cdrom" \
  -netdev "user,id=net0,hostfwd=tcp::${SSH_PORT}-:22" \
  -device virtio-net-pci,netdev=net0 \
  -virtfs "local,path=${REPO_ROOT},mount_tag=helix,security_model=mapped-xattr" \
  -device virtio-vga \
  "${QEMU_SERIAL_ARGS[@]}" \
  "${QEMU_DISPLAY_ARGS[@]}"
