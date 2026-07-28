set -euo pipefail

mountpoint="artifacts/mnt"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ] && mountpoint -q "$mountpoint"; then
    sudo umount "$mountpoint"
  fi
}
trap cleanup EXIT

mkdir -p "$(dirname "$ROOTFS_IMAGE")"
mkdir -p "$mountpoint"

set -x
rm -f "$ROOTFS_IMAGE"
truncate -s "$ROOTFS_IMAGE_SIZE" "$ROOTFS_IMAGE"
mkfs.ext4 -F "$ROOTFS_IMAGE"
sudo mount -o loop "$ROOTFS_IMAGE" "$mountpoint"
mounted=1
sudo rsync -aHAX "$ROOTFS_TARGET/" "$mountpoint/"
sync
sudo umount "$mountpoint"
mounted=0
