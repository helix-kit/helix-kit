#!/usr/bin/env bash
# Stage 20 — install the minimal package set: systemd, the Debian cloud kernel (ena +
# nvme for Nitro), systemd-networkd/resolved, openssh, and cloud-init. No snapd/Docker.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

trap unbind_pseudo EXIT
bind_pseudo "$ROOTFS"

# DNS for apt inside the chroot; replaced by a resolved stub symlink in stage 30.
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"

export DEBIAN_FRONTEND=noninteractive

# arm64 EC2 (Graviton) is UEFI-only: grub-efi-arm64, not amd64's legacy-BIOS grub-pc.
case "$AMI_ARCH" in
  amd64) KERNEL_PKG=linux-image-cloud-amd64; GRUB_PKG=grub-pc ;;
  arm64) KERNEL_PKG=linux-image-cloud-arm64; GRUB_PKG=grub-efi-arm64 ;;
  *) die "unsupported AMI_ARCH: $AMI_ARCH" ;;
esac

packages=(
  systemd-sysv
  systemd-resolved
  udev
  dbus
  iproute2
  "$KERNEL_PKG"
  initramfs-tools
  "$GRUB_PKG"
  openssh-server
  cloud-init
  cloud-guest-utils
  sudo
  ca-certificates
  curl
  less
  vim-tiny
)

# Ensure the initramfs carries the NVMe + ENA drivers for the Nitro root volume and network.
mkdir -p "$ROOTFS/etc/initramfs-tools"
printf '%s\n' nvme ena > "$ROOTFS/etc/initramfs-tools/modules"

log "apt update + install (${#packages[@]} packages)"
in_chroot apt-get update
in_chroot apt-get install -y --no-install-recommends "${packages[@]}"

log "regenerating initramfs"
in_chroot update-initramfs -u

in_chroot apt-get clean
rm -rf "$ROOTFS/var/lib/apt/lists"/*
