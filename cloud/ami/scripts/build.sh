#!/usr/bin/env bash
# Orchestrate the minimal Helix cloud AMI build: run the numbered stages in order to
# produce a bootable raw disk at $OUT/helix-ami.raw. Runs inside the privileged builder
# container (invoked by `helix ami build`). Override a subset via STAGES="30-configure 40-disk".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

export OUT="${OUT:-/out}"
# Build the rootfs on the container's own fs, not the bind mount: debootstrap fails on
# the bind mount under qemu-user emulation. Only the finished raw image goes to /out.
export ROOTFS="${ROOTFS:-/rootfs}"
export IMAGE="${IMAGE:-$OUT/helix-ami.raw}"

export AMI_SUITE="${AMI_SUITE:-trixie}"
export AMI_ARCH="${AMI_ARCH:-amd64}"
export AMI_MIRROR="${AMI_MIRROR:-http://deb.debian.org/debian}"
# Build-time root partition size; cloud-init growpart expands it to fill the EBS volume on boot.
export AMI_IMAGE_SIZE="${AMI_IMAGE_SIZE:-4608}"   # MiB
export AMI_HOSTNAME="${AMI_HOSTNAME:-helix}"
export AMI_USER="${AMI_USER:-helix}"
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
