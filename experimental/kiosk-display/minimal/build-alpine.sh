#!/usr/bin/env bash
# Build a minimal Alpine (musl) aarch64 rootfs that boots straight into a
# cage + WebKitGTK kiosk, and package it as an ext4 disk image for QEMU virt.
#
# Cross-built on an x86_64 host via qemu-user binfmt (the aarch64 chroot runs
# apk/mkinitfs under emulation). Requires: qemu-aarch64-static registered in
# binfmt_misc, sudo, mkfs.ext4, curl, and node/npm for the site build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LAB="${HELIX_KIOSK_MIN_LAB:-${SCRIPT_DIR}/.lab}"
ALPINE_VER="${HELIX_ALPINE_VER:-3.22.5}"
ALPINE_BRANCH="v${ALPINE_VER%.*}"
MIRROR="https://dl-cdn.alpinelinux.org/alpine"
ROOTFS="${LAB}/rootfs"
IMAGE="${LAB}/helix-kiosk-min.ext4"
IMAGE_SIZE="${HELIX_KIOSK_MIN_SIZE:-1536M}"
FRESH=0
SKIP_SITE=0

for arg in "$@"; do
  case "${arg}" in
    --fresh) FRESH=1 ;;
    --skip-site) SKIP_SITE=1 ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

PKGS="alpine-base linux-virt mkinitfs \
  cage seatd mesa-dri-gallium mesa-egl mesa-gbm \
  webkit2gtk-4.1 gtk+3.0 py3-gobject3 python3 \
  eudev libinput ttf-dejavu darkhttpd \
  dropbear dropbear-scp openrc busybox grim"

mkdir -p "${LAB}"

# --- 1. base rootfs (slow apk step; cached unless --fresh) --------------------
if [[ "${FRESH}" == "1" || ! -d "${ROOTFS}" ]]; then
  echo "==> extracting Alpine ${ALPINE_VER} aarch64 minirootfs"
  tarball="${LAB}/alpine-minirootfs-${ALPINE_VER}-aarch64.tar.gz"
  [[ -f "${tarball}" ]] || curl -fsSL -o "${tarball}" \
    "${MIRROR}/${ALPINE_BRANCH}/releases/aarch64/alpine-minirootfs-${ALPINE_VER}-aarch64.tar.gz"
  sudo rm -rf "${ROOTFS}"
  mkdir -p "${ROOTFS}"
  sudo tar -xzf "${tarball}" -C "${ROOTFS}"
  sudo cp /usr/bin/qemu-aarch64-static "${ROOTFS}/usr/bin/"
  sudo cp /etc/resolv.conf "${ROOTFS}/etc/resolv.conf"
  printf '%s/%s/main\n%s/%s/community\n' "${MIRROR}" "${ALPINE_BRANCH}" "${MIRROR}" "${ALPINE_BRANCH}" \
    | sudo tee "${ROOTFS}/etc/apk/repositories" >/dev/null
  echo "==> installing kiosk stack (under emulation, be patient)"
  sudo chroot "${ROOTFS}" /sbin/apk update
  # shellcheck disable=SC2086
  sudo chroot "${ROOTFS}" /sbin/apk add ${PKGS}
fi

# --- 2. build + stage the React site -----------------------------------------
if [[ "${SKIP_SITE}" != "1" ]]; then
  echo "==> building React site"
  ( cd "${KIOSK_DIR}/site"
    [[ -d node_modules ]] || npm install
    npm run build )
fi
echo "==> staging site + shell + overlay"
sudo rm -rf "${ROOTFS}/srv/www"
sudo mkdir -p "${ROOTFS}/srv/www"
sudo cp -a "${KIOSK_DIR}/site/dist/." "${ROOTFS}/srv/www/"
sudo install -m 0755 "${KIOSK_DIR}/shell/kiosk-shell.py" "${ROOTFS}/usr/local/bin/kiosk-shell.py"

# --- 3. overlay (init, services, network, mkinitfs conf) ---------------------
sudo cp -a "${SCRIPT_DIR}/overlay/." "${ROOTFS}/"
sudo chmod 0755 "${ROOTFS}/usr/local/bin/kiosk-session" \
  "${ROOTFS}/usr/local/bin/kiosk-memreport" \
  "${ROOTFS}/etc/init.d/kiosk" "${ROOTFS}/etc/init.d/site-httpd"

# --- 4. configure inside the chroot ------------------------------------------
echo "==> configuring services"
sudo chroot "${ROOTFS}" /bin/sh -eux <<'CHROOT'
# ensure late-added packages are present even when reusing a cached rootfs
apk add --quiet --no-progress darkhttpd seatd

echo "root:helix" | chpasswd
echo helix-kiosk > /etc/hostname
grep -q '^ttyAMA0$' /etc/securetty || echo ttyAMA0 >> /etc/securetty

# runlevels
for s in devfs dmesg udev udev-trigger hwdrivers; do rc-update add "$s" sysinit || true; done
for s in modules sysctl hostname bootmisc networking seatd; do rc-update add "$s" boot || true; done
for s in dropbear site-httpd kiosk; do rc-update add "$s" default || true; done

# let dropbear accept root password login
mkdir -p /etc/dropbear

# regenerate the initramfs for the installed -virt kernel
kver=$(ls /lib/modules | head -1)
mkinitfs "$kver"
CHROOT

# --- 5. export kernel + initramfs for -kernel boot ---------------------------
echo "==> exporting kernel + initramfs"
sudo cp "${ROOTFS}/boot/vmlinuz-virt" "${LAB}/vmlinuz-virt"
sudo cp "${ROOTFS}/boot/initramfs-virt" "${LAB}/initramfs-virt"
sudo chown "$(id -u):$(id -g)" "${LAB}/vmlinuz-virt" "${LAB}/initramfs-virt"

# --- 6. pack the ext4 rootfs image -------------------------------------------
echo "==> building ext4 image (${IMAGE_SIZE})"
rm -f "${IMAGE}"
truncate -s "${IMAGE_SIZE}" "${IMAGE}"
# sudo so it can read root-owned files (e.g. /etc/shadow) and preserve ownership.
sudo /sbin/mkfs.ext4 -q -F -L helixkiosk -d "${ROOTFS}" "${IMAGE}"
sudo chown "$(id -u):$(id -g)" "${IMAGE}"

echo
echo "Built minimal kiosk image:"
echo "  rootfs:    ${ROOTFS}  ($(sudo du -sh "${ROOTFS}" | cut -f1))"
echo "  image:     ${IMAGE}   ($(du -h "${IMAGE}" | cut -f1))"
echo "  kernel:    ${LAB}/vmlinuz-virt"
echo "  initramfs: ${LAB}/initramfs-virt"
