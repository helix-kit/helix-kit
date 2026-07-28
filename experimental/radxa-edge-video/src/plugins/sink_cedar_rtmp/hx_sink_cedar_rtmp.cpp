// SPDX-License-Identifier: AGPL-3.0-only
// sink plugin: BGR grid frame -> Cedar libcedarc H.264 encode -> RTMP (MediaMTX -> WebRTC).
// Ports make_encoder/bgr_to_nv12/encode_push (npu_compare.cpp:471-569) + the RTMP appsrc
// pipeline (:851-855) into a self-contained node. in = [ grid_frame ] ; terminal.
// params: { "url": "rtmp://host:1935/detgrid", "width": 1280, "height": 720,
//           "fps": 25, "bitrate": 4000000, "keyint": 30 }
#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <opencv2/opencv.hpp>
#include <cstdio>
#include <cstring>
#include <string>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"
#include "vencoder.h"
#include "../helix_pipeline.h"
#include "../hx_json.h"
extern "C" VeOpsS *GetVeOpsS(enum EVEOPSTYPE type);

struct helix_node_ctx {
    int W = 1280, H = 720;
    struct ScMemOpsS *memops = nullptr;
    VeOpsS *veOps = nullptr;
    VideoEncoder *venc = nullptr;
    void *encVe = nullptr;
    unsigned char hdr[256];
    int hdrlen = 0;
    unsigned char *nv12 = nullptr;
    long long pts = 0;
    GstElement *pipe = nullptr;
    GstAppSrc *encsrc = nullptr;
};

static gboolean bus_cb(GstBus *, GstMessage *m, gpointer) {
    if (GST_MESSAGE_TYPE(m) == GST_MESSAGE_ERROR) {
        GError *e; gchar *d;
        gst_message_parse_error(m, &e, &d);
        fprintf(stderr, "[hx_sink] GST-ERROR [%s]: %s | %s\n", GST_OBJECT_NAME(m->src), e->message, d ? d : "");
        g_error_free(e); g_free(d);
    }
    return TRUE;
}

static int make_encoder(helix_node_ctx *c, int fps, int br, int ki) {
    VeConfig vc;
    memset(&vc, 0, sizeof(vc));
    vc.nEncoderFlag = 1;
    vc.memops = c->memops;
    c->encVe = CdcVeInit(c->veOps, &vc);
    c->venc = VideoEncCreate(VENC_CODEC_H264);
    if (!c->venc) return -1;
    VideoEncSetParameter(c->venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(c->venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(c->venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = c->W; cfg.nInputHeight = c->H;
    cfg.nDstWidth = c->W; cfg.nDstHeight = c->H;
    cfg.nStride = c->W;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP;
    cfg.bEncH264Nalu = 0;
    cfg.memops = c->memops;
    cfg.veOpsS = c->veOps;
    cfg.pVeOpsSelf = c->encVe;
    if (VideoEncInit(c->venc, &cfg) != 0) return -1;
    VencAllocateBufferParam ap;
    memset(&ap, 0, sizeof(ap));
    ap.nBufferNum = 4;
    ap.nSizeY = c->W * c->H;
    ap.nSizeC = c->W * c->H / 2;
    AllocInputBuffer(c->venc, &ap);
    VencHeaderData hd;
    memset(&hd, 0, sizeof(hd));
    if (VideoEncGetParameter(c->venc, VENC_IndexParamH264SPSPPS, &hd) == 0 && hd.nLength > 0 && hd.nLength <= (int)sizeof(c->hdr)) {
        memcpy(c->hdr, hd.pBuffer, hd.nLength);
        c->hdrlen = hd.nLength;
    }
    return c->hdrlen > 0 ? 0 : -1;
}

static void bgr_to_nv12(const cv::Mat &bgr, unsigned char *nv12) {
    cv::Mat i420;
    cv::cvtColor(bgr, i420, cv::COLOR_BGR2YUV_I420);
    int w = bgr.cols, h = bgr.rows;
    memcpy(nv12, i420.data, (size_t)w * h);
    unsigned char *U = i420.data + (size_t)w * h;
    unsigned char *V = U + (size_t)(w / 2) * (h / 2);
    unsigned char *UV = nv12 + (size_t)w * h;
    int n = (w / 2) * (h / 2);
    for (int i = 0; i < n; i++) { UV[2 * i] = U[i]; UV[2 * i + 1] = V[i]; }
}

static void encode_push(helix_node_ctx *c, unsigned char *nv12) {
    VencInputBuffer in;
    memset(&in, 0, sizeof(in));
    if (GetOneAllocInputBuffer(c->venc, &in) != 0) return;
    memcpy(in.pAddrVirY, nv12, (size_t)c->W * c->H);
    memcpy(in.pAddrVirC, nv12 + (size_t)c->W * c->H, (size_t)c->W * c->H / 2);
    in.nPts = c->pts;
    c->pts += 40000;
    FlushCacheAllocInputBuffer(c->venc, &in);
    AddOneInputBuffer(c->venc, &in);
    VideoEncodeOneFrame(c->venc);
    AlreadyUsedInputBuffer(c->venc, &in);
    ReturnOneAllocInputBuffer(c->venc, &in);
    for (;;) {
        VencOutputBuffer ob;
        memset(&ob, 0, sizeof(ob));
        if (GetOneBitstreamFrame(c->venc, &ob) != 0) break;
        int total = ob.nSize0 + ob.nSize1;
        int key = (ob.nFlag & VENC_BUFFERFLAG_KEYFRAME) ? 1 : 0;
        if (total > 0) {
            gsize extra = (key && c->hdrlen > 0) ? c->hdrlen : 0;
            GstBuffer *hb = gst_buffer_new_allocate(NULL, extra + total, NULL);
            if (extra) gst_buffer_fill(hb, 0, c->hdr, c->hdrlen);
            gst_buffer_fill(hb, extra, ob.pData0, ob.nSize0);
            if (ob.nSize1) gst_buffer_fill(hb, extra + ob.nSize0, ob.pData1, ob.nSize1);
            gst_app_src_push_buffer(c->encsrc, hb);
        }
        FreeOneBitStreamFrame(c->venc, &ob);
    }
}

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string url = hxj::jstr(p, "url");
    if (url.empty()) { fprintf(stderr, "[hx_sink] missing 'url'\n"); return nullptr; }
    auto *c = new helix_node_ctx();
    c->W = hxj::jint(p, "width", 1280);
    c->H = hxj::jint(p, "height", 720);
    int fps = hxj::jint(p, "fps", 25), br = hxj::jint(p, "bitrate", 4000000), ki = hxj::jint(p, "keyint", 30);

    c->memops = MemAdapterGetOpsS();
    CdcMemOpen(c->memops);
    c->veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    if (make_encoder(c, fps, br, ki) != 0) {
        fprintf(stderr, "[hx_sink] encoder init fail\n");
        delete c;
        return nullptr;
    }
    c->nv12 = (unsigned char *)malloc((size_t)c->W * c->H * 3 / 2);

    char od[1024];
    snprintf(od, sizeof(od),
             "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
             "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
             "flvmux streamable=true ! rtmpsink location=%s",
             url.c_str());
    GError *e = nullptr;
    c->pipe = gst_parse_launch(od, &e);
    if (!c->pipe) { fprintf(stderr, "[hx_sink] pipe: %s\n", e ? e->message : "?"); delete c; return nullptr; }
    c->encsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(c->pipe), "encsrc"));
    gst_bus_add_watch(gst_element_get_bus(c->pipe), bus_cb, nullptr);
    GstCaps *hc = gst_caps_new_simple("video/x-h264", "stream-format", G_TYPE_STRING, "byte-stream",
                                      "alignment", G_TYPE_STRING, "au", NULL);
    gst_app_src_set_caps(c->encsrc, hc);
    gst_caps_unref(hc);
    g_object_set(c->encsrc, "block", FALSE, "max-bytes", (guint64)4000000, "leaky-type", 2, NULL);
    gst_element_set_state(c->pipe, GST_STATE_PLAYING);
    fprintf(stderr, "[hx_sink] Cedar HW encoder ready (%dx%d), SPS/PPS=%d bytes -> %s\n", c->W, c->H, c->hdrlen, url.c_str());
    return c;
}

static void destroy(helix_node_ctx *c) {
    if (!c) return;
    if (c->pipe) gst_element_set_state(c->pipe, GST_STATE_NULL);
    if (c->venc) { ReleaseAllocInputBuffer(c->venc); VideoEncUnInit(c->venc); VideoEncDestroy(c->venc); }
    if (c->encVe) CdcVeRelease(c->veOps, c->encVe);
    if (c->memops) CdcMemClose(c->memops);
    if (c->pipe) gst_object_unref(c->pipe);
    free(c->nv12);
    delete c;
}

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *) {
    if (n_in < 1 || in[0].type != HX_PKT_FRAME) return -1;
    const helix_frame_t &f = in[0].frame;
    if (f.w != c->W || f.h != c->H) return -1;   // encoder is fixed-size
    cv::Mat bgr(f.h, f.w, CV_8UC3, f.data, f.stride);
    bgr_to_nv12(bgr, c->nv12);
    encode_push(c, c->nv12);
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "sink", "hx_sink_cedar_rtmp",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
