set -euo pipefail
shopt -s nullglob

mounted=()

mount_runtime_fs() {
  for name in dev proc sys run; do
    mountpoint="$ROOTFS_TARGET/$name"
    sudo mkdir -p "$mountpoint"

    if mountpoint -q "$mountpoint"; then
      continue
    fi

    sudo mount --bind "/$name" "$mountpoint"
    mounted+=("$mountpoint")
  done
}

cleanup() {
  for ((idx=${#mounted[@]}-1; idx>=0; idx--)); do
    mountpoint="${mounted[$idx]}"
    if mountpoint -q "$mountpoint"; then
      sudo umount "$mountpoint"
    fi
  done
}
trap cleanup EXIT

packages=(
  systemd-sysv
  linux-image-generic
  initramfs-tools
  sudo
  openssh-server
  iproute2
  iputils-ping
  ca-certificates
  curl
  vim-tiny
)

mount_runtime_fs

set -x
sudo chroot "$ROOTFS_TARGET" apt update
sudo chroot "$ROOTFS_TARGET" apt install -y "${packages[@]}"
set +x

for path in "$ROOTFS_TARGET"/boot/vmlinuz-* "$ROOTFS_TARGET"/boot/initrd.img-*; do
  set -x
  sudo chmod 644 "$path"
  set +x
done
