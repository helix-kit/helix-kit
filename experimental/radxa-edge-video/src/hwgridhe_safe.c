// 4x Cedar HW decode -> compositor 2x2 -> tee -> [kmssink] + [Cedar HW encode -> RTMP].
// Both decode AND encode run on the Allwinner VE (Cedar); CPU only composites/muxes.
// SAFE lifecycle: SIGINT/SIGTERM -> graceful teardown of ALL VE contexts (4 decoders
// + 1 encoder), so a normal stop frees every dma_buf and leaves NO D-state. A watchdog
// force-exits if teardown wedges. Reports dma_buf count at stop.
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

static gboolean bus_cb(GstBus* bus, GstMessage* msg, gpointer tag) {
    (void)bus;
    if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) {
        GError* e; gchar* d; gst_message_parse_error(msg, &e, &d);
        g_printerr("PIPELINE ERROR [%s]: %s | %s\n", (char*)tag, e->message, d ? d : "");
        g_error_free(e); g_free(d);
    }
    return TRUE;
}

#define NCAM 4
#define ENC_W 1280
#define ENC_H 720
static GstAppSink* sinks[NCAM];
static GstAppSrc*  srcs[NCAM];
static VideoDecoder* decs[NCAM];
static void* decVe[NCAM];
static GstElement* srcpipes[NCAM];
static GstElement* disp;
static GstElement* encpipe;
static struct ScMemOpsS* memops;
static VeOpsS* veOps;
static GstAppSink* encsink;
static GstAppSrc*  encsrc;
static VideoEncoder* venc;
static void* encVe;
static unsigned char g_hdr[256]; static int g_hdrlen = 0;  // annexb SPS+PPS
static GMainLoop* loop;
static pthread_t th[NCAM], et;
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

static VideoDecoder* make_decoder(int i) {
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nDecoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    decVe[i] = veSelf;
    VideoStreamInfo si; memset(&si, 0, sizeof(si)); si.eCodecFormat = VIDEO_CODEC_FORMAT_H264;
    VConfig vc; memset(&vc, 0, sizeof(vc));
    vc.eOutputPixelFormat = PIXEL_FORMAT_NV12; vc.nFrameBufferNum = 8; vc.bDispErrorFrame = 1;
    vc.memops = memops; vc.veOpsS = veOps; vc.pVeOpsSelf = veSelf;
    VideoDecoder* d = CreateVideoDecoder();
    if (InitializeVideoDecoder(d, &si, &vc) != 0) return NULL;
    return d;
}

static int make_encoder(void) {
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nEncoderFlag = 1; veCfg.memops = memops;
    encVe = CdcVeInit(veOps, &veCfg);
    venc = VideoEncCreate(VENC_CODEC_H264);
    if (!venc) { g_printerr("VideoEncCreate fail\n"); return -1; }
    int fps = 25, br = 4000000, ki = 50;
    VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg; memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = ENC_W; cfg.nInputHeight = ENC_H;
    cfg.nDstWidth = ENC_W; cfg.nDstHeight = ENC_H; cfg.nStride = ENC_W;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP;
    cfg.bEncH264Nalu = 0;   // 0 => annexb bitstream AND valid annexb SPS/PPS via GetParameter
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

static void* decode_thread(void* arg) {
    int i = (int)(intptr_t)arg;
    VideoDecoder* dec = decs[i];
    while (running) {
        GstSample* sample = gst_app_sink_pull_sample(sinks[i]);
        if (!sample) break;
        GstBuffer* buf = gst_sample_get_buffer(sample);
        GstMapInfo map;
        if (gst_buffer_map(buf, &map, GST_MAP_READ)) {
            char *pB = 0, *pR = 0; int bS = 0, rS = 0;
            if (RequestVideoStreamBuffer(dec, map.size, &pB, &bS, &pR, &rS, 0) == 0 && (bS + rS) >= (int)map.size) {
                gsize f = map.size <= (gsize)bS ? map.size : (gsize)bS;
                memcpy(pB, map.data, f);
                if (map.size > (gsize)bS && pR) memcpy(pR, map.data + bS, map.size - bS);
                CdcMemFlushCache(memops, pB, f);
                VideoStreamDataInfo di; memset(&di, 0, sizeof(di));
                di.pData = pB; di.nLength = map.size; di.bIsFirstPart = 1; di.bIsLastPart = 1; di.bValid = 1;
                SubmitVideoStreamData(dec, &di, 0);
            }
            gst_buffer_unmap(buf, &map);
        }
        gst_sample_unref(sample);
        DecodeVideoStream(dec, 0, 0, 0, 0);
        VideoPicture* pic;
        while ((pic = RequestPicture(dec, 0)) != NULL) {
            int w = pic->nWidth, h = pic->nHeight, s = pic->nLineStride;
            CdcMemFlushCache(memops, pic->pData0, (gsize)s * h);
            if (pic->pData1) CdcMemFlushCache(memops, pic->pData1, (gsize)s * h / 2);
            GstBuffer* out = gst_buffer_new_allocate(NULL, (gsize)w * h * 3 / 2, NULL);
            GstMapInfo m; gst_buffer_map(out, &m, GST_MAP_WRITE);
            for (int y = 0; y < h; y++) memcpy(m.data + y * w, pic->pData0 + y * s, w);
            guint8* uv = m.data + (gsize)w * h;
            for (int y = 0; y < h / 2; y++) memcpy(uv + y * w, pic->pData1 + y * s, w);
            gst_buffer_unmap(out, &m);
            if (running) gst_app_src_push_buffer(srcs[i], out);
            else gst_buffer_unref(out);
            ReturnPicture(dec, pic);
        }
    }
    return NULL;
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
                AlreadyUsedInputBuffer(venc, &in);   // recycle input buffer (fixes 4-frame stall)
                ReturnOneAllocInputBuffer(venc, &in);
                // Drain all bitstream units. Output is already annexb (bEncH264Nalu=0);
                // prepend SPS/PPS on keyframes so late WebRTC joiners can decode.
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
    fprintf(stderr, "\n[WATCHDOG] teardown hung >%ds (VE wedged?) — forcing _exit; a physical power cycle may be needed\n", secs);
    _exit(3);
}

static void teardown(void) {
    fprintf(stderr, "[teardown] begin; dma_buf objects = %d\n", dma_objects());
    running = 0;
    pthread_t wd; pthread_create(&wd, NULL, watchdog, (void*)(intptr_t)15); pthread_detach(wd);
    for (int i = 0; i < NCAM; i++) if (srcpipes[i]) gst_element_set_state(srcpipes[i], GST_STATE_NULL);
    for (int i = 0; i < NCAM; i++) pthread_join(th[i], NULL);
    if (disp) gst_element_set_state(disp, GST_STATE_NULL);  // flush encsink -> encode thread exits
    pthread_join(et, NULL);
    // All VE-touching threads gone -> release Cedar contexts.
    for (int i = 0; i < NCAM; i++) if (decs[i]) { DestroyVideoDecoder(decs[i]); decs[i] = NULL; }
    for (int i = 0; i < NCAM; i++) if (decVe[i]) { CdcVeRelease(veOps, decVe[i]); decVe[i] = NULL; }
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
    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    fprintf(stderr, "[start] dma_buf objects = %d\n", dma_objects());
    for (int i = 0; i < NCAM; i++) {
        decs[i] = make_decoder(i);
        if (!decs[i]) { g_printerr("decoder %d fail\n", i); return 1; }
    }
    if (make_encoder() != 0) return 1;

    GError* err = NULL;
    disp = gst_parse_launch(
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
        " appsrc name=a0 is-live=true format=time do-timestamp=true ! queue ! mix.sink_0 "
        " appsrc name=a1 is-live=true format=time do-timestamp=true ! queue ! mix.sink_1 "
        " appsrc name=a2 is-live=true format=time do-timestamp=true ! queue ! mix.sink_2 "
        " appsrc name=a3 is-live=true format=time do-timestamp=true ! queue ! mix.sink_3 ", &err);
    if (!disp) { g_printerr("disp parse: %s\n", err ? err->message : "?"); return 1; }
    encsink = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(disp), "encsink"));

    GstCaps* nv12 = gst_caps_new_simple("video/x-raw", "format", G_TYPE_STRING, "NV12",
        "width", G_TYPE_INT, 720, "height", G_TYPE_INT, 544, "framerate", GST_TYPE_FRACTION, 25, 1, NULL);
    for (int i = 0; i < NCAM; i++) {
        char n[8]; snprintf(n, sizeof(n), "a%d", i);
        srcs[i] = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(disp), n));
        gst_app_src_set_caps(srcs[i], nv12);
    }
    gst_caps_unref(nv12);

    char encdesc[512];
    snprintf(encdesc, sizeof(encdesc),
        "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
        "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
        "queue ! flvmux streamable=true ! rtmpsink name=rtmpout", host);
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

    for (int i = 0; i < NCAM; i++) {
        char d[512];
        snprintf(d, sizeof(d),
            "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=200 ! "
            "rtph264depay ! h264parse config-interval=-1 ! "
            "video/x-h264,stream-format=byte-stream,alignment=au ! "
            "appsink name=s%d emit-signals=false sync=false max-buffers=8 drop=false", host, i + 1, i);
        srcpipes[i] = gst_parse_launch(d, &err);
        if (!srcpipes[i]) { g_printerr("src %d parse fail\n", i); return 1; }
        char sn[8]; snprintf(sn, sizeof(sn), "s%d", i);
        sinks[i] = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(srcpipes[i]), sn));
        gst_element_set_state(srcpipes[i], GST_STATE_PLAYING);
    }
    gst_bus_add_watch(gst_element_get_bus(encpipe), bus_cb, (gpointer)"enc");
    gst_bus_add_watch(gst_element_get_bus(disp), bus_cb, (gpointer)"disp");
    gst_element_set_state(encpipe, GST_STATE_PLAYING);
    gst_element_set_state(disp, GST_STATE_PLAYING);
    g_print("2x2 HW grid + HW encode PLAYING (rtmp://%s:1935/grid) — SIGTERM to stop cleanly\n", host);

    for (int i = 0; i < NCAM; i++) pthread_create(&th[i], NULL, decode_thread, (void*)(intptr_t)i);
    pthread_create(&et, NULL, encode_thread, NULL);
    g_unix_signal_add(SIGINT, on_signal, NULL);
    g_unix_signal_add(SIGTERM, on_signal, NULL);
    loop = g_main_loop_new(NULL, FALSE);
    g_main_loop_run(loop);
    teardown();
    g_print("[exit] clean\n");
    return 0;
}
