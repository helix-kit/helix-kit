set -euo pipefail

if sudo chroot "$ROOTFS_TARGET" id "$ROOTFS_USERNAME" >/dev/null 2>&1; then
  exit 0
fi

set -x
sudo chroot "$ROOTFS_TARGET" useradd --create-home --groups sudo --shell /bin/bash "$ROOTFS_USERNAME"
