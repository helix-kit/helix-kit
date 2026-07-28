// SPDX-License-Identifier: AGPL-3.0-only
// source plugin: rtspsrc -> <decoder> -> BGR appsink -> helix_frame_t.
// Cross-platform: the H.264 decoder element is a param, so the SAME plugin serves the Radxa
// Cedar path (omxh264dec) and x86 (decodebin / avdec_h264 / nvh264dec / vaapih264dec).
// Ported from npu_compare.cpp:821-826 (pipeline string) + :595 (appsink pull).
// params: { "url": "rtsp://host:8554/streamN", "latency": 100, "fps": 8, "decoder": "omxh264dec" }
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <cstdio>
#include <cstring>
#include "../helix_pipeline.h"
#include "../hx_json.h"

struct helix_node_ctx {
    GstElement *pipe = nullptr;
    GstAppSink *sink = nullptr;
    GstSample *held = nullptr;   // current sample, kept mapped until the next pull
    GstMapInfo map{};
    bool mapped = false;
};

static void release_held(helix_node_ctx *c) {
    if (c->mapped) { gst_buffer_unmap(gst_sample_get_buffer(c->held), &c->map); c->mapped = false; }
    if (c->held) { gst_sample_unref(c->held); c->held = nullptr; }
}

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string url = hxj::jstr(p, "url");
    int latency = hxj::jint(p, "latency", 100);
    int fps = hxj::jint(p, "fps", 8);
    std::string dec = hxj::jstr(p, "decoder", "omxh264dec");   // omxh264dec (Cedar) | decodebin | avdec_h264 | nvh264dec ...
    if (url.empty()) { fprintf(stderr, "[hx_src_gst] missing 'url'\n"); return nullptr; }

    char d[768];
    snprintf(d, sizeof(d),
             "rtspsrc location=%s protocols=tcp latency=%d ! rtph264depay ! h264parse ! "
             "%s ! videorate drop-only=true ! video/x-raw,framerate=%d/1 ! "
             "videoconvert ! video/x-raw,format=BGR ! "
             "appsink name=s max-buffers=1 drop=true sync=false",
             url.c_str(), latency, dec.c_str(), fps);
    GError *e = nullptr;
    GstElement *pipe = gst_parse_launch(d, &e);
    if (!pipe) { fprintf(stderr, "[hx_src_gst] pipe: %s\n", e ? e->message : "?"); return nullptr; }
    auto *c = new helix_node_ctx();
    c->pipe = pipe;
    c->sink = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(pipe), "s"));
    gst_element_set_state(pipe, GST_STATE_PLAYING);
    return c;
}

static void destroy(helix_node_ctx *c) {
    if (!c) return;
    release_held(c);
    if (c->pipe) gst_element_set_state(c->pipe, GST_STATE_NULL);
    if (c->pipe) gst_object_unref(c->pipe);
    delete c;
}

// produce one BGR frame (borrowed until the next call). 0 = no frame ready.
static int process(helix_node_ctx *c, const helix_packet_t *, int, helix_packet_t *out) {
    release_held(c);
    GstSample *s = gst_app_sink_try_pull_sample(c->sink, 5 * GST_MSECOND);
    if (!s) return 0;
    GstBuffer *b = gst_sample_get_buffer(s);
    GstCaps *caps = gst_sample_get_caps(s);
    GstStructure *st = gst_caps_get_structure(caps, 0);
    int W = 0, H = 0;
    gst_structure_get_int(st, "width", &W);
    gst_structure_get_int(st, "height", &H);
    if (W <= 0 || H <= 0 || !gst_buffer_map(b, &c->map, GST_MAP_READ)) { gst_sample_unref(s); return 0; }
    c->held = s;
    c->mapped = true;
    out->type = HX_PKT_FRAME;
    out->frame.data = c->map.data;
    out->frame.w = W;
    out->frame.h = H;
    out->frame.stride = W * 3;
    out->frame.format = HX_FMT_BGR;
    out->frame.pts = 0;
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "source", "hx_src_gst",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
