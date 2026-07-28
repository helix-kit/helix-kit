set -euo pipefail

set -x
printf '%s\n' "$ROOTFS_HOSTNAME" | sudo tee "$ROOTFS_TARGET/etc/hostname" >/dev/null
sudo tee "$ROOTFS_TARGET/etc/hosts" >/dev/null <<EOF
127.0.0.1 localhost
127.0.1.1 $ROOTFS_HOSTNAME

::1 localhost ip6-localhost ip6-loopback
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
EOF
