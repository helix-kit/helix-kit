#!/usr/bin/env bash
# =============================================================================
# build.sh — orchestrate the minimal Helix cloud AMI build.
#
# Runs INSIDE the privileged builder container (cloud/ami/Dockerfile.builder),
# invoked by `helix ami build`. Produces a bootable raw disk image at
# $OUT/helix-ami.raw by running the numbered stages in order:
#
#   10-debootstrap  minimal Debian trixie rootfs (--variant=minbase)
#   20-packages     systemd, cloud kernel, networkd, ssh, cloud-init, grub
#   25-redpanda     redpanda from its apt repo (matches cloud/appliance)
#   28-appliance    the full Helix stack as native units, from cloud/appliance
#                   (postgres, mosquitto, node, caddy, openfga, step-ca, bundles;
#                   Inngest/Redis excluded) via the shared gen-units.py
#   30-configure    networkd + cloud-init, enable base services
#   40-disk         partition, mkfs, rsync rootfs, install GRUB (legacy BIOS)
#
# All stages read their configuration from the environment (defaults below).
# Override a stage subset with STAGES="30-configure 40-disk" for iteration.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

export OUT="${OUT:-/out}"
# The rootfs is built on the CONTAINER's own filesystem, not on the bind-mounted
# /out. debootstrap fails on the bind mount when the builder runs emulated under
# qemu-user (arm64 on an x86 host) — it cannot lay down the base system there —
# but works fine on the container's overlayfs. Only the finished raw image is
# written out to /out, which is all the host actually needs.
export ROOTFS="${ROOTFS:-/rootfs}"
export IMAGE="${IMAGE:-$OUT/helix-ami.raw}"

export AMI_SUITE="${AMI_SUITE:-trixie}"
export AMI_ARCH="${AMI_ARCH:-amd64}"
export AMI_MIRROR="${AMI_MIRROR:-http://deb.debian.org/debian}"
# Root partition size at build time. cloud-init growpart expands it to fill the
# whole EBS volume on first boot, so keep this only as large as the installed
# system needs.
export AMI_IMAGE_SIZE="${AMI_IMAGE_SIZE:-4608}"   # MiB (full stack + bundles; growpart expands on boot)
export AMI_HOSTNAME="${AMI_HOSTNAME:-helix}"
export AMI_USER="${AMI_USER:-helix}"
# Redpanda apt bootstrap (same tokened repo the appliance uses).
export REDPANDA_REPO_SETUP="${REDPANDA_REPO_SETUP:-https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.deb.sh}"

export OVERLAY="$(cd "$HERE/.." && pwd)/rootfs-overlay"

export REPO="${REPO:-/repo}"   # repo root bind-mounted into the builder

STAGES="${STAGES:-10-debootstrap 20-packages 25-redpanda 28-appliance 30-configure 40-disk}"

[ "$(id -u)" -eq 0 ] || die "build.sh must run as root (inside the builder container)"

mkdir -p "$OUT"

for stage in $STAGES; do
  printf '\n\033[1;35m========== %s ==========\033[0m\n' "$stage" >&2
  bash "$HERE/$stage.sh"
done

printf '\n\033[1;32m[ami] done: %s\033[0m\n' "$IMAGE" >&2
ls -lh "$IMAGE" >&2
