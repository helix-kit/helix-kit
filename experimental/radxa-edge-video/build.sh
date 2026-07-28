#!/bin/bash
# Build the Radxa edge-video programs ON the board (they link the vendor
# libcedarc + GStreamer app libs that only exist in the Allwinner BSP).
#
# Usage: copy src/ to the board and run this from inside it, e.g.
#   scp -r src build.sh radxa@<board>:/home/radxa/cedar/
#   ssh radxa@<board> 'cd /home/radxa/cedar && ./build.sh'
#
# Prereqs on the board (Allwinner A733 BSP, Debian bullseye):
#   - libcedarc headers in /usr/include (vdecoder.h, vencoder.h, veInterface.h,
#     memoryAdapter.h, sc_interface.h, typedef.h, vbasetype.h) and libs
#     (libvdecoder libvencoder libvideoengine libVE libMemAdapter libcdc_base).
#   - GStreamer 1.x + gst-plugins-{base,good,bad} + gst-libav + the vendor `omx`
#     plugin (omxh264dec/omxh264videoenc).
#   - GStreamer app headers. The distro's libgstreamer-plugins-base1.0-dev has a
#     version-pin conflict, so extract the .deb locally to ./gstdev and point -I
#     at it (see GSTDEV below); link the shared lib directly.
set -e
cd "$(dirname "$0")/src"

# libcedarc-only programs (no GStreamer)
CEDAR_LIBS="-lvdecoder -lvencoder -lvideoengine -lVE -lMemAdapter -lcdc_base"
gcc hwdec.c    -o hwdec    -I/usr/include $CEDAR_LIBS
gcc hwdisp.c   -o hwdisp   -I/usr/include $CEDAR_LIBS -ldrm
gcc veleak.c   -o veleak   -I/usr/include $CEDAR_LIBS
gcc encleak.c  -o encleak  -I/usr/include $CEDAR_LIBS
gcc encdump.c  -o encdump  -I/usr/include $CEDAR_LIBS

# GStreamer + libcedarc programs
GSTDEV="${GSTDEV:-./gstdev/usr/include/gstreamer-1.0}"
GSTAPP="${GSTAPP:-/usr/lib/aarch64-linux-gnu/libgstapp-1.0.so.0}"
GST_C="$(pkg-config --cflags gstreamer-1.0) -I$GSTDEV -I/usr/include"
GST_L="$(pkg-config --libs gstreamer-1.0) $GSTAPP $CEDAR_LIBS -lpthread"
for p in hwgst hwgrid hwgrid_safe hwgridhe hwgridhe_safe hwgrid_hybrid hwgrid_hybrid_opt; do
    gcc "$p.c" -o "$p" $GST_C $GST_L
    echo "built $p"
done

echo "done. recommended: ./hwgrid_hybrid_opt <laptop-ip>"
