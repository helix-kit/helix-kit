#!/usr/bin/env bash
# Build the dummy React site and the QEMU kiosk artifacts (qcow2 overlay +
# cloud-init seed ISO). Ported from a prior production system's qemu-display lab.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAB_ROOT="${HELIX_KIOSK_LAB_ROOT:-${SCRIPT_DIR}/.lab}"
BASE_IMAGE="${HELIX_KIOSK_BASE_IMAGE:-${LAB_ROOT}/noble-server-cloudimg-amd64.img}"
VM_IMAGE="${HELIX_KIOSK_VM_IMAGE:-${LAB_ROOT}/helix-kiosk.qcow2}"
SEED_ISO="${HELIX_KIOSK_SEED_ISO:-${LAB_ROOT}/helix-kiosk-seed.iso}"
CLOUD_IMAGE_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
FRESH=0
SKIP_SITE=0

for arg in "$@"; do
  case "${arg}" in
    --fresh) FRESH=1 ;;
    --skip-site) SKIP_SITE=1 ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

mkdir -p "${LAB_ROOT}"

if [[ "${SKIP_SITE}" != "1" ]]; then
  echo "==> building dummy React site"
  pushd "${SCRIPT_DIR}/site" >/dev/null
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run build
  popd >/dev/null
fi

if [[ ! -f "${BASE_IMAGE}" ]]; then
  echo "==> downloading Ubuntu Noble cloud image"
  curl -L -o "${BASE_IMAGE}" "${CLOUD_IMAGE_URL}"
fi

if [[ "${FRESH}" == "1" ]]; then
  rm -f "${VM_IMAGE}"
fi

if [[ ! -f "${VM_IMAGE}" ]]; then
  echo "==> creating qcow2 overlay"
  qemu-img create -f qcow2 -F qcow2 -b "${BASE_IMAGE}" "${VM_IMAGE}" 24G
fi

echo "==> building cloud-init seed"
cloud-localds "${SEED_ISO}" "${SCRIPT_DIR}/cloud-init/user-data" "${SCRIPT_DIR}/cloud-init/meta-data"

cat <<EOF
Prepared Helix kiosk lab:
  repo: ${REPO_ROOT}
  base: ${BASE_IMAGE}
  disk: ${VM_IMAGE}
  seed: ${SEED_ISO}
EOF
