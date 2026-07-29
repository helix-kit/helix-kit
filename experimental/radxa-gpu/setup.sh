#!/bin/bash
# Enable the PowerVR GPU compute APIs on the Radxa A733 (run ON the board).
# The img-bxm package ships the DDK userspace (libPVROCL / libVK_IMG); they just need
# ICD registration. Idempotent.
set -euo pipefail

echo "== OpenCL headers + ICD loader =="
sudo apt-get install -y -q opencl-headers ocl-icd-opencl-dev

echo "== register PowerVR OpenCL ICD =="
sudo mkdir -p /etc/OpenCL/vendors
echo /usr/lib/libPVROCL.so | sudo tee /etc/OpenCL/vendors/pvr.icd >/dev/null

echo "== register PowerVR Vulkan ICD =="
VKLIB=$(ls /usr/lib/libVK_IMG.so* 2>/dev/null | head -1)
if [ -n "$VKLIB" ]; then
  sudo mkdir -p /usr/share/vulkan/icd.d
  printf '{ "file_format_version": "1.0.0", "ICD": { "library_path": "%s", "api_version": "1.2.0" } }\n' "$VKLIB" \
    | sudo tee /usr/share/vulkan/icd.d/pvr_icd.aarch64.json >/dev/null
fi

echo "== verify =="
clinfo 2>/dev/null | grep -iE 'Number of platforms|Platform Name|Device Name' | head -3 || true
echo "OpenCL/Vulkan enabled. Build with ./build.sh"
