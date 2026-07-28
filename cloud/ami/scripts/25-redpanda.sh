#!/usr/bin/env bash
# Stage 25 — install redpanda from its apt repo (same source as the appliance,
# cloud/appliance/Dockerfile). The .deb creates the `redpanda` user/group and
# installs /usr/bin/rpk; the systemd unit is laid down in stage 30.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

trap unbind_pseudo EXIT
bind_pseudo "$ROOTFS"
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"

export DEBIAN_FRONTEND=noninteractive

log "adding redpanda apt repo"
in_chroot bash -c "curl -fsSL '$REDPANDA_REPO_SETUP' | bash"

log "installing redpanda"
in_chroot apt-get install -y --no-install-recommends redpanda

in_chroot apt-get clean
rm -rf "$ROOTFS/var/lib/apt/lists"/*
