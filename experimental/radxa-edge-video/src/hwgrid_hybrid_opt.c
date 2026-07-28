// HYBRID 2x2 HW grid: portable GStreamer decode + Cedar libcedarc HW encode.
//   4x [rtspsrc ! omxh264dec (vendor OMX, clean, DMABuf)] -> compositor 2x2 ->
//   tee -> { kmssink display, appsink -> Cedar libcedarc H.264 encode -> RTMP }.
// Decode/composite/display are 100% stock GStreamer (swap omxh264dec for
// nvv4l2decoder/v4l2h264dec on Jetson/RPi). Only the ENCODE is Cedar-specific,
// because the vendor omxh264videoenc is broken (emits no SPS). The libcedarc
// encoder produces a valid annexb stream (bEncH264Nalu=0) with SPS/PPS.
// SIGINT/SIGTERM -> graceful teardown (stop pipeline, join encode thread,
// release the encoder VE context, CdcMemClose); watchdog force-exits if wedged.
#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <gst/app/gstappsink.h>
#include <glib-unix.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <pthread.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"
#include "vencoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

#define ENC_W 1280
#define ENC_H 720
static struct ScMemOpsS* memops;
static VeOpsS* veOps;
static GstElement* disp;      // decode + composite + display + encsink (all GStreamer)
static GstElement* encpipe;   // appsrc -> h264parse -> flvmux -> rtmpsink
static GstAppSink* encsink;
static GstAppSrc*  encsrc;
static VideoEncoder* venc;
static void* encVe;
static unsigned char g_hdr[256]; static int g_hdrlen = 0;
static GMainLoop* loop;
static pthread_t et;
static volatile int running = 1;
static volatile int teardown_done = 0;

static int dma_objects(void) {
    FILE* f = fopen("/sys/kernel/debug/dma_buf/bufinfo", "r");
    if (!f) return -1;
    char line[256]; int obj = -1, n;
    while (fgets(line, sizeof(line), f))
        if (sscanf(line, "Total %d objects", &n) == 1) obj = n;
    fclose(f);
    return obj;
}

static gboolean bus_cb(GstBus* bus, GstMessage* msg, gpointer tag) {
    (void)bus;
    if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) {
        GError* e; gchar* d; gst_message_parse_error(msg, &e, &d);
        g_printerr("PIPELINE ERROR [%s]: %s | %s\n", (char*)tag, e->message, d ? d : "");
        g_error_free(e); g_free(d);
    }
    return TRUE;
}

static int make_encoder(void) {
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nEncoderFlag = 1; veCfg.memops = memops;
    encVe = CdcVeInit(veOps, &veCfg);
    venc = VideoEncCreate(VENC_CODEC_H264);
    if (!venc) { g_printerr("VideoEncCreate fail\n"); return -1; }
    int fps = 25, br = 4000000, ki = 30;
    VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg; memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = ENC_W; cfg.nInputHeight = ENC_H;
    cfg.nDstWidth = ENC_W; cfg.nDstHeight = ENC_H; cfg.nStride = ENC_W;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP;
    cfg.bEncH264Nalu = 0;   // annexb bitstream + valid SPS/PPS via GetParameter
    cfg.memops = memops; cfg.veOpsS = veOps; cfg.pVeOpsSelf = encVe;
    if (VideoEncInit(venc, &cfg) != 0) { g_printerr("VideoEncInit fail\n"); return -1; }
    VencAllocateBufferParam ap; memset(&ap, 0, sizeof(ap));
    ap.nBufferNum = 4; ap.nSizeY = ENC_W * ENC_H; ap.nSizeC = ENC_W * ENC_H / 2;
    AllocInputBuffer(venc, &ap);
    VencHeaderData hd; memset(&hd, 0, sizeof(hd));
    if (VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd) == 0 &&
        hd.nLength > 0 && hd.nLength <= (int)sizeof(g_hdr)) {
        memcpy(g_hdr, hd.pBuffer, hd.nLength); g_hdrlen = hd.nLength;
    }
    g_print("Cedar H.264 encoder ready (%dx%d), SPS/PPS=%d bytes\n", ENC_W, ENC_H, g_hdrlen);
    return g_hdrlen > 0 ? 0 : -1;
}

static void* encode_thread(void* arg) {
    (void)arg;
    long long pts = 0;
    unsigned char* framebuf = malloc(4 * 1024 * 1024);
    while (running) {
        GstSample* s = gst_app_sink_pull_sample(encsink);
        if (!s) break;
        GstBuffer* b = gst_sample_get_buffer(s);
        GstMapInfo m;
        if (gst_buffer_map(b, &m, GST_MAP_READ)) {
            VencInputBuffer in; memset(&in, 0, sizeof(in));
            if (GetOneAllocInputBuffer(venc, &in) == 0) {
                memcpy(in.pAddrVirY, m.data, (size_t)ENC_W * ENC_H);
                memcpy(in.pAddrVirC, m.data + (size_t)ENC_W * ENC_H, (size_t)ENC_W * ENC_H / 2);
                in.nPts = pts; pts += 40000;
                FlushCacheAllocInputBuffer(venc, &in);
                AddOneInputBuffer(venc, &in);
                gst_buffer_unmap(b, &m);
                gst_sample_unref(s);
                VideoEncodeOneFrame(venc);
                AlreadyUsedInputBuffer(venc, &in);
                ReturnOneAllocInputBuffer(venc, &in);
                for (;;) {
                    VencOutputBuffer ob; memset(&ob, 0, sizeof(ob));
                    if (GetOneBitstreamFrame(venc, &ob) != 0) break;
                    int total = ob.nSize0 + ob.nSize1;
                    int key = (ob.nFlag & VENC_BUFFERFLAG_KEYFRAME) ? 1 : 0;
                    if (total > 0 && total <= 4 * 1024 * 1024) {
                        memcpy(framebuf, ob.pData0, ob.nSize0);
                        if (ob.nSize1) memcpy(framebuf + ob.nSize0, ob.pData1, ob.nSize1);
                        gsize extra = (key && g_hdrlen > 0) ? g_hdrlen : 0;
                        GstBuffer* hb = gst_buffer_new_allocate(NULL, extra + total, NULL);
                        if (extra) gst_buffer_fill(hb, 0, g_hdr, g_hdrlen);
                        gst_buffer_fill(hb, extra, framebuf, total);
                        if (running) gst_app_src_push_buffer(encsrc, hb);
                        else gst_buffer_unref(hb);
                    }
                    FreeOneBitStreamFrame(venc, &ob);
                }
                continue;
            }
            gst_buffer_unmap(b, &m);
        }
        gst_sample_unref(s);
    }
    free(framebuf);
    return NULL;
}

static void* watchdog(void* arg) {
    int secs = (int)(intptr_t)arg;
    for (int i = 0; i < secs * 10; i++) { if (teardown_done) return NULL; usleep(100000); }
    fprintf(stderr, "\n[WATCHDOG] teardown hung >%ds — forcing _exit; a physical power cycle may be needed\n", secs);
    _exit(3);
}

static void teardown(void) {
    fprintf(stderr, "[teardown] begin; dma_buf objects = %d\n", dma_objects());
    running = 0;
    pthread_t wd; pthread_create(&wd, NULL, watchdog, (void*)(intptr_t)15); pthread_detach(wd);
    if (disp) gst_element_set_state(disp, GST_STATE_NULL);  // stops OMX decode + flushes encsink
    pthread_join(et, NULL);
    if (venc) { ReleaseAllocInputBuffer(venc); VideoEncUnInit(venc); VideoEncDestroy(venc); venc = NULL; }
    if (encVe) { CdcVeRelease(veOps, encVe); encVe = NULL; }
    if (encpipe) gst_element_set_state(encpipe, GST_STATE_NULL);
    if (memops) CdcMemClose(memops);
    teardown_done = 1;
    fprintf(stderr, "[teardown] complete; dma_buf objects = %d\n", dma_objects());
}

static gboolean on_signal(gpointer u) {
    (void)u; fprintf(stderr, "\n[signal] stopping...\n");
    if (loop) g_main_loop_quit(loop);
    return G_SOURCE_REMOVE;
}

int main(int argc, char** argv) {
    const char* host = argc > 1 ? argv[1] : "192.168.1.35";
    gst_init(&argc, &argv);
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    fprintf(stderr, "[start] dma_buf objects = %d\n", dma_objects());
    if (make_encoder() != 0) return 1;

    // Decode + composite + display + encsink: all stock GStreamer (omxh264dec).
    GError* err = NULL;
    char desc[2560];
    snprintf(desc, sizeof(desc),
        "compositor name=mix background=black "
        " sink_0::xpos=0 sink_0::ypos=0 sink_0::width=640 sink_0::height=360 "
        " sink_1::xpos=640 sink_1::ypos=0 sink_1::width=640 sink_1::height=360 "
        " sink_2::xpos=0 sink_2::ypos=360 sink_2::width=640 sink_2::height=360 "
        " sink_3::xpos=640 sink_3::ypos=360 sink_3::width=640 sink_3::height=360 "
        " ! video/x-raw,format=NV12,width=1280,height=720 ! tee name=t "
        " t. ! queue ! videoscale ! video/x-raw,width=1920,height=1080 ! "
        "     kmssink driver-name=sunxi-drm connector-id=153 force-modesetting=true "
        " t. ! queue leaky=downstream max-size-buffers=3 ! "
        "     appsink name=encsink emit-signals=false sync=false max-buffers=4 drop=true "
        " rtspsrc location=rtsp://%s:8554/stream1 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! queue ! mix.sink_0 "
        " rtspsrc location=rtsp://%s:8554/stream2 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! queue ! mix.sink_1 "
        " rtspsrc location=rtsp://%s:8554/stream3 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! queue ! mix.sink_2 "
        " rtspsrc location=rtsp://%s:8554/stream4 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! queue ! mix.sink_3 ",
        host, host, host, host);
    disp = gst_parse_launch(desc, &err);
    if (!disp) { g_printerr("disp parse: %s\n", err ? err->message : "?"); return 1; }
    encsink = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(disp), "encsink"));

    // Encoded annexb -> RTMP publish (MediaMTX -> WebRTC).
    char encdesc[512];
    snprintf(encdesc, sizeof(encdesc),
        "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
        "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
        "flvmux streamable=true ! rtmpsink name=rtmpout", host);
    encpipe = gst_parse_launch(encdesc, &err);
    if (!encpipe) { g_printerr("enc parse: %s\n", err ? err->message : "?"); return 1; }
    encsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(encpipe), "encsrc"));
    { GstElement* rtmp = gst_bin_get_by_name(GST_BIN(encpipe), "rtmpout");
      char loc[256]; snprintf(loc, sizeof(loc), "rtmp://%s:1935/grid", host);
      if (rtmp) g_object_set(rtmp, "location", loc, NULL); }
    GstCaps* h264caps = gst_caps_new_simple("video/x-h264",
        "stream-format", G_TYPE_STRING, "byte-stream", "alignment", G_TYPE_STRING, "au", NULL);
    gst_app_src_set_caps(encsrc, h264caps);
    gst_caps_unref(h264caps);
    g_object_set(encsrc, "block", FALSE, "max-bytes", (guint64)4000000, "leaky-type", 2, NULL);

    gst_bus_add_watch(gst_element_get_bus(disp), bus_cb, (gpointer)"disp");
    gst_bus_add_watch(gst_element_get_bus(encpipe), bus_cb, (gpointer)"enc");
    gst_element_set_state(encpipe, GST_STATE_PLAYING);
    gst_element_set_state(disp, GST_STATE_PLAYING);
    g_print("HYBRID grid PLAYING: OMX decode + Cedar encode (rtmp://%s:1935/grid) — SIGTERM to stop\n", host);

    pthread_create(&et, NULL, encode_thread, NULL);
    g_unix_signal_add(SIGINT, on_signal, NULL);
    g_unix_signal_add(SIGTERM, on_signal, NULL);
    loop = g_main_loop_new(NULL, FALSE);
    g_main_loop_run(loop);
    teardown();
    g_print("[exit] clean\n");
    return 0;
}
