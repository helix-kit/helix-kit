#!/usr/bin/env bash
# Stage 10 — bootstrap a minimal Debian trixie rootfs.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ -e "$ROOTFS/etc/os-release" ]; then
  log "rootfs already present at $ROOTFS — skipping debootstrap (rm -rf to force)"
  exit 0
fi

log "debootstrap --variant=minbase $AMI_SUITE -> $ROOTFS"
mkdir -p "$ROOTFS"
debootstrap --variant=minbase --arch="$AMI_ARCH" \
  --include=ca-certificates,curl \
  "$AMI_SUITE" "$ROOTFS" "$AMI_MIRROR"
