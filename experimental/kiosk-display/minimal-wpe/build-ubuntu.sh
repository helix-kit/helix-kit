#!/usr/bin/env bash
# Build a minimal Ubuntu Jammy (22.04) aarch64 image that boots straight into a
# cog + WPE WebKit kiosk rendering directly on KMS (no Wayland compositor), and
# pack it as an ext4 disk image for QEMU virt.
#
# WPE WebKit is the embedded-targeted sibling of WebKitGTK; Alpine doesn't
# package cog/wpewebkit, so this variant uses Ubuntu (which does). Cross-built on
# an x86 host via qemu-user binfmt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LAB="${HELIX_WPE_LAB:-${SCRIPT_DIR}/.lab}"
UBUNTU_VER="${HELIX_UBUNTU_VER:-22.04}"
BASE_URL="https://cdimage.ubuntu.com/ubuntu-base/releases/${UBUNTU_VER}/release"
MIRROR="http://ports.ubuntu.com/ubuntu-ports"
SUITE="${HELIX_UBUNTU_SUITE:-jammy}"
ROOTFS="${LAB}/rootfs"
IMAGE="${LAB}/helix-kiosk-wpe.ext4"
IMAGE_SIZE="${HELIX_WPE_SIZE:-2560M}"
FRESH=0
SKIP_SITE=0

for arg in "$@"; do
  case "${arg}" in
    --fresh) FRESH=1 ;;
    --skip-site) SKIP_SITE=1 ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

PKGS="linux-image-virtual initramfs-tools systemd-sysv udev \
  cog libwpewebkit-1.0-3 wpewebkit-driver \
  libgl1-mesa-dri libegl-mesa0 libgles2 libgbm1 libinput10 \
  busybox-static dropbear-bin dropbear-run seatd fonts-dejavu-core iproute2 netbase"

mkdir -p "${LAB}"

# --- 1. base rootfs + package install (slow; cached unless --fresh) ----------
if [[ "${FRESH}" == "1" || ! -e "${ROOTFS}/usr/bin/cog" ]]; then
  echo "==> extracting Ubuntu ${UBUNTU_VER} aarch64 base"
  tarball="${LAB}/ubuntu-base-${SUITE}-arm64.tar.gz"
  if [[ ! -f "${tarball}" ]]; then
    fn=$(curl -s "${BASE_URL}/" | grep -oE "ubuntu-base-${UBUNTU_VER}[0-9.]*-base-arm64\.tar\.gz" | sort -u | tail -1)
    curl -fsSL -o "${tarball}" "${BASE_URL}/${fn}"
  fi
  sudo rm -rf "${ROOTFS}"
  mkdir -p "${ROOTFS}"
  sudo tar -xzf "${tarball}" -C "${ROOTFS}"
  sudo cp /usr/bin/qemu-aarch64-static "${ROOTFS}/usr/bin/"
  sudo cp /etc/resolv.conf "${ROOTFS}/etc/resolv.conf"

  # apt for a cross-arch chroot: trust the repo (no key dance) and keep the
  # verification/download steps running as root so qemu-user can exec helpers.
  sudo tee "${ROOTFS}/etc/apt/sources.list" >/dev/null <<EOF
deb [trusted=yes] ${MIRROR} ${SUITE} main universe
deb [trusted=yes] ${MIRROR} ${SUITE}-updates main universe
EOF
  sudo tee "${ROOTFS}/etc/apt/apt.conf.d/99build" >/dev/null <<'EOF'
APT::Sandbox::User "root";
Acquire::AllowInsecureRepositories "true";
APT::Get::AllowUnauthenticated "true";
EOF

  echo "==> installing WPE + cog stack (under emulation, be patient)"
  sudo chroot "${ROOTFS}" /bin/bash -eux <<CHROOT
export DEBIAN_FRONTEND=noninteractive
apt-get update
# shellcheck disable=SC2086
apt-get install -y -q --no-install-recommends ${PKGS}
CHROOT
fi

# --- 2. build + stage the React site -----------------------------------------
if [[ "${SKIP_SITE}" != "1" ]]; then
  echo "==> building React site"
  ( cd "${KIOSK_DIR}/site"
    [[ -d node_modules ]] || npm install
    npm run build )
fi
echo "==> staging site + overlay"
sudo rm -rf "${ROOTFS}/srv/www"
sudo mkdir -p "${ROOTFS}/srv/www"
sudo cp -a "${KIOSK_DIR}/site/dist/." "${ROOTFS}/srv/www/"
sudo cp -a "${SCRIPT_DIR}/overlay/." "${ROOTFS}/"
sudo chmod 0755 "${ROOTFS}/usr/local/bin/cog-session" "${ROOTFS}/usr/local/bin/kiosk-memreport"

# --- 3. configure inside the chroot ------------------------------------------
echo "==> configuring services"
sudo chroot "${ROOTFS}" /bin/bash -eux <<'CHROOT'
export DEBIAN_FRONTEND=noninteractive
echo "root:helix" | chpasswd
echo helix-kiosk-wpe > /etc/hostname
printf '/dev/vda / ext4 defaults 0 1\n' > /etc/fstab

# dropbear: generate host keys + allow root password login
mkdir -p /etc/dropbear
for t in rsa ecdsa ed25519; do
  key="/etc/dropbear/dropbear_${t}_host_key"
  [ -f "$key" ] || dropbearkey -t "$t" -f "$key" >/dev/null 2>&1 || true
done

systemctl enable systemd-networkd.service || true
systemctl enable seatd.service || true
systemctl enable dropbear.service 2>/dev/null || systemctl enable dropbear.socket 2>/dev/null || true
systemctl enable site-httpd.service cog-kiosk.service || true

# regenerate initramfs for the installed kernel
kver=$(ls /lib/modules | head -1)
update-initramfs -c -k "$kver"
CHROOT

# --- 4. export kernel + initramfs --------------------------------------------
echo "==> exporting kernel + initramfs"
kfile=$(sudo bash -c "ls ${ROOTFS}/boot/vmlinuz-* | head -1")
ifile=$(sudo bash -c "ls ${ROOTFS}/boot/initrd.img-* | head -1")
sudo cp "${kfile}" "${LAB}/vmlinuz"
sudo cp "${ifile}" "${LAB}/initrd.img"
sudo chown "$(id -u):$(id -g)" "${LAB}/vmlinuz" "${LAB}/initrd.img"

# --- 5. pack the ext4 rootfs image -------------------------------------------
echo "==> building ext4 image (${IMAGE_SIZE})"
rm -f "${IMAGE}"
truncate -s "${IMAGE_SIZE}" "${IMAGE}"
sudo /sbin/mkfs.ext4 -q -F -L helixwpe -d "${ROOTFS}" "${IMAGE}"
sudo chown "$(id -u):$(id -g)" "${IMAGE}"

echo
echo "Built minimal WPE kiosk image:"
echo "  rootfs:    ${ROOTFS}  ($(sudo du -sh "${ROOTFS}" | cut -f1))"
echo "  image:     ${IMAGE}   ($(du -h "${IMAGE}" | cut -f1))"
echo "  kernel:    ${LAB}/vmlinuz"
echo "  initramfs: ${LAB}/initrd.img"
