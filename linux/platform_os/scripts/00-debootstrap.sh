set -euo pipefail

mkdir -p "$ROOTFS_TARGET"

set -x
sudo debootstrap --arch="$ROOTFS_ARCH" "$ROOTFS_SUITE" "$ROOTFS_TARGET" "$ROOTFS_MIRROR"
