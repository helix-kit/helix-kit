# SPDX-License-Identifier: AGPL-3.0-only
# On-board build of the Helix edge-video plugin pipeline (host + swappable .so stages).
# Mirrors src/build_split.sh flags. Build ON the board (aarch64):
#   scp -r src/plugins radxa@BOARD:/home/radxa/npu/examples/yolov5/plugins && make -C .../plugins
# Paths default to the board layout; override on the make line if different, e.g.
#   make NPU_ROOT=/home/radxa/npu GSTDEV=/home/radxa/cedar/gstdev/usr/include/gstreamer-1.0
NPU_ROOT ?= /home/radxa/npu
VIP      ?= $(NPU_ROOT)/viplite-tina/lib/aarch64-none-linux-gnu/v2.0
LIBAWNN  ?= $(NPU_ROOT)/examples/libawnn_viplite
GSTDEV   ?= /home/radxa/cedar/gstdev/usr/include/gstreamer-1.0
GSTAPP   ?= /usr/lib/aarch64-linux-gnu/libgstapp-1.0.so.0

CXX      ?= g++
CC       ?= gcc
OPT      ?= -O1          # -O2 OOM-kills cc1plus on the 1GB board (see docs/01, docs/05)

PKG_GST  := $(shell pkg-config --cflags gstreamer-1.0)
PKG_CV   := $(shell pkg-config --cflags opencv4)
LGST     := $(shell pkg-config --libs gstreamer-1.0)
LCV      := $(shell pkg-config --libs opencv4)

GST_INC  := $(PKG_GST) -I$(GSTDEV)
AWNN_INC := -I$(LIBAWNN) -I$(VIP)/inc -I$(NPU_ROOT)   # NPU_ROOT for repo-root log/log.h (build_split's -I../../)
SO       := $(OPT) -fPIC -I. -shared
CEDAR_L  := -lvdecoder -lvencoder -lvideoengine -lVE -lMemAdapter -lcdc_base

PLUGINS := hx_src_gst.so hx_pre_letterbox.so hx_infer_awnn.so \
           hx_post_yolov5.so hx_post_yolo11.so hx_post_pose.so \
           hx_overlay_boxes.so hx_overlay_pose.so hx_comp_grid.so hx_sink_cedar_rtmp.so

HDR := helix_pipeline.h hx_json.h

all: helix_pipeline $(PLUGINS)

# ---- host runtime (opencv + gstreamer + dlopen) ----
helix_pipeline: helix_pipeline.cpp $(HDR)
	$(CXX) $(OPT) -I. $(PKG_CV) $(GST_INC) helix_pipeline.cpp -o $@ $(LGST) $(LCV) -ldl -lpthread

# ---- source: gstreamer + appsink (libgstapp) ----
hx_src_gst.so: src_gst/hx_src_gst.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $(GST_INC) $< -o $@ $(LGST) $(GSTAPP)

# ---- preprocess / postprocess / overlay / compositor: opencv only ----
hx_pre_letterbox.so: pre_letterbox/hx_pre_letterbox.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_post_yolov5.so: post_yolov5/hx_post_yolov5.cpp $(HDR) hx_detect_common.h
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_post_yolo11.so: post_yolo11/hx_post_yolo11.cpp $(HDR) hx_detect_common.h
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_post_pose.so: post_pose/hx_post_pose.cpp $(HDR) hx_detect_common.h
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_overlay_boxes.so: overlay_boxes/hx_overlay_boxes.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_overlay_pose.so: overlay_pose/hx_overlay_pose.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)
hx_comp_grid.so: comp_grid/hx_comp_grid.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $< -o $@ $(LCV)

# ---- infer: awnn/VIPLite. Compile the vendor awnn .c into the .so; bake RPATH so the VIP
#      libs resolve at runtime without LD_LIBRARY_PATH (RPATH, not RUNPATH — applies to the
#      transitive libVIPhal deps; see the RUNPATH/RPATH note in the memory/docs). ----
hx_infer_awnn.so: infer_awnn/hx_infer_awnn.cpp $(HDR)
	$(CC)  $(OPT) -fPIC $(AWNN_INC) -c $(LIBAWNN)/awnn_lib.c      -o /tmp/hx_awnn_lib.o
	$(CC)  $(OPT) -fPIC $(AWNN_INC) -c $(LIBAWNN)/awnn_quantize.c -o /tmp/hx_awnn_q.o
	$(CXX) $(SO) -DNPU_SW_VERSION=2 $(AWNN_INC) infer_awnn/hx_infer_awnn.cpp /tmp/hx_awnn_lib.o /tmp/hx_awnn_q.o -o $@ \
	    -L$(VIP) -Wl,-rpath-link,$(VIP) -Wl,-rpath,$(VIP) -Wl,--disable-new-dtags -lNBGlinker -lVIPhal -lpthread

# ---- sink: cedar libcedarc HW encoder + gstreamer ----
hx_sink_cedar_rtmp.so: sink_cedar_rtmp/hx_sink_cedar_rtmp.cpp $(HDR)
	$(CXX) $(SO) $(PKG_CV) $(GST_INC) -I/usr/include $< -o $@ $(LGST) $(GSTAPP) $(LCV) $(CEDAR_L)

clean:
	rm -f helix_pipeline $(PLUGINS) /tmp/hx_awnn_*.o

.PHONY: all clean
