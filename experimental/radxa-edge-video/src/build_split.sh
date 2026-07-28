#!/bin/bash
cd /home/radxa/npu/examples/yolov5 || exit 9
sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
VIP=../../viplite-tina/lib/aarch64-none-linux-gnu/v2.0
GSTDEV=/home/radxa/cedar/gstdev/usr/include/gstreamer-1.0
CF="$(pkg-config --cflags gstreamer-1.0 opencv4) -I$GSTDEV -I../libawnn_viplite -I../../ -I$VIP/inc -I/usr/include/libdrm"
echo "free before:"; free -m | awk '/Mem:/{print $7" MB avail"}'
g++ -c -O1 -DNPU_SW_VERSION=2 npu_grid_display.cpp -o /tmp/ngd.o $CF || { echo STEP1_FAIL; exit 1; }
gcc -c -O1 ../libawnn_viplite/awnn_lib.c -o /tmp/al.o $CF || { echo STEP2_FAIL; exit 2; }
gcc -c -O1 ../libawnn_viplite/awnn_quantize.c -o /tmp/aq.o $CF || { echo STEP3_FAIL; exit 3; }
g++ /tmp/ngd.o /tmp/al.o /tmp/aq.o -o npu_grid_display -L$VIP -Wl,-rpath-link,$VIP -lNBGlinker -lVIPhal -ldrm $(pkg-config --libs gstreamer-1.0 opencv4) /usr/lib/aarch64-linux-gnu/libgstapp-1.0.so.0 -lvdecoder -lvencoder -lvideoengine -lVE -lMemAdapter -lcdc_base -ljpeg -lm -lpthread || { echo LINK_FAIL; exit 4; }
echo BUILD_OK
