set -euo pipefail
shopt -s nullglob

boot="$ROOTFS_TARGET/boot"
kernels=("$boot"/vmlinuz-*)
initrds=("$boot"/initrd.img-*)

if [ "${#kernels[@]}" -eq 0 ]; then
  echo "No kernel found in rootfs/boot" >&2
  exit 1
fi

if [ "${#initrds[@]}" -eq 0 ]; then
  echo "No initrd found in rootfs/boot" >&2
  exit 1
fi

kernel="${kernels[-1]}"
initrd="${initrds[-1]}"

set -x
qemu-system-x86_64 \
  -m "$QEMU_MEMORY" \
  -kernel "$kernel" \
  -initrd "$initrd" \
  -append "root=/dev/sda rw console=ttyS0" \
  -drive "file=$ROOTFS_IMAGE,format=raw,if=ide" \
  -nographic
