// SPDX-License-Identifier: AGPL-3.0-only
// sink plugin (x86 / portable): BGR grid frame -> GStreamer encoder -> RTMP.
// The portable counterpart to hx_sink_cedar_rtmp — no Cedar VE. The encoder element is a param,
// so it adapts: x264enc (CPU, always), nvh264enc (NVIDIA NVENC), vaapih264enc (AMD/Intel VAAPI).
// in = [ grid_frame ] ; terminal.
// params: { "url": "rtmp://host:1935/detgrid", "width":1280, "height":720, "fps":25,
//           "bitrate":4000, "encoder":"x264enc tune=zerolatency speed-preset=veryfast" }
#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <cstdio>
#include <cstring>
#include <string>
#include "../helix_pipeline.h"
#include "../hx_json.h"

struct helix_node_ctx {
    int W = 1280, H = 720;
    GstElement *pipe = nullptr;
    GstAppSrc *src = nullptr;
    long long pts = 0;
    long long dur = 0;
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string url = hxj::jstr(p, "url");
    if (url.empty()) { fprintf(stderr, "[hx_sink_gst] missing 'url'\n"); return nullptr; }
    auto *c = new helix_node_ctx();
    c->W = hxj::jint(p, "width", 1280);
    c->H = hxj::jint(p, "height", 720);
    int fps = hxj::jint(p, "fps", 25);
    int br = hxj::jint(p, "bitrate", 4000);
    std::string enc = hxj::jstr(p, "encoder", "x264enc tune=zerolatency speed-preset=veryfast");
    c->dur = (long long)(1e9 / (fps > 0 ? fps : 25));

    char d[1024];
    snprintf(d, sizeof(d),
             "appsrc name=src is-live=true format=time do-timestamp=true ! "
             "video/x-raw,format=BGR,width=%d,height=%d,framerate=%d/1 ! videoconvert ! "
             "%s bitrate=%d ! h264parse config-interval=1 ! flvmux streamable=true ! "
             "rtmpsink location=%s",
             c->W, c->H, fps, enc.c_str(), br, url.c_str());
    GError *e = nullptr;
    c->pipe = gst_parse_launch(d, &e);
    if (!c->pipe) { fprintf(stderr, "[hx_sink_gst] pipe: %s\n", e ? e->message : "?"); delete c; return nullptr; }
    c->src = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(c->pipe), "src"));
    GstCaps *caps = gst_caps_new_simple("video/x-raw", "format", G_TYPE_STRING, "BGR",
                                        "width", G_TYPE_INT, c->W, "height", G_TYPE_INT, c->H,
                                        "framerate", GST_TYPE_FRACTION, fps, 1, NULL);
    gst_app_src_set_caps(c->src, caps);
    gst_caps_unref(caps);
    g_object_set(c->src, "block", FALSE, "max-bytes", (guint64)(c->W * c->H * 3 * 4), "leaky-type", 2, NULL);
    gst_element_set_state(c->pipe, GST_STATE_PLAYING);
    fprintf(stderr, "[hx_sink_gst] %dx%d [%s] -> %s\n", c->W, c->H, enc.c_str(), url.c_str());
    return c;
}
static void destroy(helix_node_ctx *c) {
    if (!c) return;
    if (c->src) gst_app_src_end_of_stream(c->src);
    if (c->pipe) gst_element_set_state(c->pipe, GST_STATE_NULL);
    if (c->pipe) gst_object_unref(c->pipe);
    delete c;
}

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *) {
    if (n_in < 1 || in[0].type != HX_PKT_FRAME) return -1;
    const helix_frame_t &f = in[0].frame;
    if (f.w != c->W || f.h != c->H) return -1;
    size_t sz = (size_t)f.w * f.h * 3;
    GstBuffer *b = gst_buffer_new_allocate(NULL, sz, NULL);
    // copy row by row to honour any stride padding
    GstMapInfo m;
    if (gst_buffer_map(b, &m, GST_MAP_WRITE)) {
        for (int y = 0; y < f.h; y++) memcpy(m.data + (size_t)y * f.w * 3, f.data + (size_t)y * f.stride, (size_t)f.w * 3);
        gst_buffer_unmap(b, &m);
    }
    GST_BUFFER_PTS(b) = c->pts;
    GST_BUFFER_DURATION(b) = c->dur;
    c->pts += c->dur;
    gst_app_src_push_buffer(c->src, b);
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "sink", "hx_sink_gst",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
