#!/usr/bin/env bash
# Stage 40 — lay the rootfs onto a partitioned, GRUB-installed raw disk image.
# amd64 boots legacy-BIOS (p1 = 1MiB BIOS boot EF02); arm64 boots UEFI (p1 = 64MiB ESP);
# p2 is the ext4 root in both. cloud-init growpart expands root on first boot.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MNT="${MNT:-/mnt-img}"   # container-local mountpoint (see build.sh: rootfs is not on /out)
LOOP=""

cleanup() {
  set +e
  mountpoint -q "$MNT/boot/efi" && umount "$MNT/boot/efi"
  mountpoint -q "$MNT" && umount -R "$MNT"
  [ -n "$LOOP" ] && losetup -d "$LOOP"
}
trap cleanup EXIT

log "creating ${AMI_IMAGE_SIZE}MiB raw image at $IMAGE"
rm -f "$IMAGE"
truncate -s "${AMI_IMAGE_SIZE}M" "$IMAGE"

sgdisk --zap-all "$IMAGE"
case "$AMI_ARCH" in
  amd64)
    log "partitioning (GPT: BIOS-boot + root)"
    sgdisk -n1:0:+1M -t1:EF02 -c1:bios-boot "$IMAGE"
    ;;
  arm64)
    log "partitioning (GPT: EFI System Partition + root)"
    sgdisk -n1:0:+64M -t1:EF00 -c1:esp "$IMAGE"
    ;;
  *) die "unsupported AMI_ARCH: $AMI_ARCH" ;;
esac
sgdisk -n2:0:0 -t2:8300 -c2:helix-root "$IMAGE"

LOOP="$(losetup -f --show -P "$IMAGE")"
log "loop device: $LOOP"
# Give the kernel a moment to materialise the partition nodes.
udevadm settle 2>/dev/null || sleep 1
[ -e "${LOOP}p2" ] || die "partition node ${LOOP}p2 did not appear"

# ^orphan_file,^metadata_csum_seed keep the fs readable by GRUB's ext driver.
log "mkfs.ext4 root (label helix-root)"
mkfs.ext4 -q -L helix-root -O ^orphan_file,^metadata_csum_seed "${LOOP}p2"

mkdir -p "$MNT"
mount "${LOOP}p2" "$MNT"

log "rsync rootfs -> root partition"
rsync -aHAX --numeric-ids "$ROOTFS/" "$MNT/"

for d in dev dev/pts proc sys; do mount --bind "/$d" "$MNT/$d"; done

case "$AMI_ARCH" in
  amd64)
    log "installing GRUB (i386-pc / legacy BIOS)"
    grub-install --target=i386-pc --boot-directory="$MNT/boot" \
      --modules="part_gpt ext2" "$LOOP"
    ;;
  arm64)
    log "mkfs.vfat ESP + installing GRUB (arm64-efi, removable path)"
    mkfs.vfat -F32 -n ESP "${LOOP}p1"
    mkdir -p "$MNT/boot/efi"
    mount "${LOOP}p1" "$MNT/boot/efi"
    # --removable puts GRUB at \EFI\BOOT\BOOTAA64.EFI (the only path EC2 firmware
    # finds without an NVRAM entry); --no-nvram since a build chroot has no NVRAM.
    grub-install --target=arm64-efi \
      --efi-directory="$MNT/boot/efi" \
      --boot-directory="$MNT/boot" \
      --modules="part_gpt ext2" \
      --removable --no-nvram
    ;;
esac

KVER="$(basename "$(ls "$MNT"/boot/vmlinuz-* | sort -V | tail -1)" | sed 's/^vmlinuz-//')"
log "grub.cfg for kernel $KVER"
mkdir -p "$MNT/boot/grub"
cat > "$MNT/boot/grub/grub.cfg" <<EOF
set timeout=1
set default=0
insmod part_gpt
insmod ext2
menuentry 'Helix Cloud' {
  search --no-floppy --label helix-root --set=root
  linux /boot/vmlinuz-$KVER root=LABEL=helix-root ro console=tty0 console=ttyS0,115200 net.ifnames=0
  initrd /boot/initrd.img-$KVER
}
EOF

sync
[ "$AMI_ARCH" = "arm64" ] && umount "$MNT/boot/efi"
for d in sys proc dev/pts dev; do umount "$MNT/$d"; done
