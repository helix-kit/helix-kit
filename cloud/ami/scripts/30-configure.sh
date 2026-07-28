#!/usr/bin/env bash
# Stage 30 — lay down overlay config, wire the network + boot identity, enable base services.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

trap unbind_pseudo EXIT
bind_pseudo "$ROOTFS"

log "copying rootfs overlay"
cp -a "$OVERLAY/." "$ROOTFS/"

log "hostname + fstab"
echo "$AMI_HOSTNAME" > "$ROOTFS/etc/hostname"
cat > "$ROOTFS/etc/hosts" <<EOF
127.0.0.1 localhost
127.0.1.1 $AMI_HOSTNAME
::1 localhost ip6-localhost ip6-loopback
EOF
# Root fs is found by label (set in stage 40); discard = TRIM on the EBS-backed NVMe.
cat > "$ROOTFS/etc/fstab" <<EOF
LABEL=helix-root / ext4 defaults,discard 0 1
EOF

# DNS via systemd-resolved once booted.
ln -sf /run/systemd/resolve/stub-resolv.conf "$ROOTFS/etc/resolv.conf"

# No interactive/root password login; access is the cloud-init SSH key only.
in_chroot passwd -l root || true

log "enabling services"
in_chroot systemctl enable \
  systemd-networkd.service \
  systemd-networkd-wait-online.service \
  systemd-resolved.service \
  ssh.service \
  serial-getty@ttyS0.service \
  cloud-init.target \
  cloud-init-local.service \
  cloud-init-network.service \
  cloud-init-main.service \
  cloud-config.service \
  cloud-final.service \
  helix-swap.service
# The Helix stack units are generated + enabled by gen-units.py in stage 28, not here;
# helix-swap.service (zram + disk swap for the 1 GiB target) ships in the overlay.

chmod +x "$ROOTFS/opt/helix/bin/helix-swap.sh"

# Drop the machine-id so systemd regenerates a unique one per instance on first boot.
: > "$ROOTFS/etc/machine-id"
rm -f "$ROOTFS/var/lib/dbus/machine-id"
