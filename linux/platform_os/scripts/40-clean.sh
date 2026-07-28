set -euo pipefail

set -x
sudo chroot "$ROOTFS_TARGET" apt clean
sudo rm -rf "$ROOTFS_TARGET/var/lib/apt/lists"
sudo rm -rf "$ROOTFS_TARGET/tmp/"*
sudo rm -rf "$ROOTFS_TARGET/var/tmp/"*
