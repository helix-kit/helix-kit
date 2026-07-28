// Bridge: GStreamer pulls RTSP H.264 -> Cedar HW decode -> GStreamer displays.
//   rtspsrc ! rtph264depay ! h264parse(au,byte-stream) ! appsink
//     -> [decode thread: Cedar libvdecoder] ->
//   appsrc(NV12) ! videoscale ! kmssink   (clean NV12 display, no green lines)
#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <gst/app/gstappsink.h>
#include <stdio.h>
#include <string.h>
#include <pthread.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

static GstAppSink* appsink;
static GstAppSrc*  appsrc;
static VideoDecoder* dec;
static struct ScMemOpsS* memops;
static int caps_set = 0;
static volatile int running = 1;

static void push_pictures(void) {
    VideoPicture* pic;
    while ((pic = RequestPicture(dec, 0)) != NULL) {
        int w = pic->nWidth, h = pic->nHeight, s = pic->nLineStride;
        if (!caps_set) {
            GstCaps* c = gst_caps_new_simple("video/x-raw",
                "format", G_TYPE_STRING, "NV12",
                "width", G_TYPE_INT, w, "height", G_TYPE_INT, h,
                "framerate", GST_TYPE_FRACTION, 25, 1, NULL);
            gst_app_src_set_caps(appsrc, c);
            gst_caps_unref(c);
            caps_set = 1;
        }
        // pData0 (Y) and pData1 (UV) are SEPARATE virtual mappings — flush each
        // plane's own range so both are read fresh (a single contiguous flush
        // from pData0 misses the UV plane -> stale chroma -> green lines).
        CdcMemFlushCache(memops, pic->pData0, (gsize)s * h);
        if (pic->pData1) CdcMemFlushCache(memops, pic->pData1, (gsize)s * h / 2);
        // copy the decoded frame into a tight NV12 GstBuffer (stride==width here)
        GstBuffer* out = gst_buffer_new_allocate(NULL, (gsize)w * h * 3 / 2, NULL);
        GstMapInfo m;
        gst_buffer_map(out, &m, GST_MAP_WRITE);
        for (int y = 0; y < h; y++) memcpy(m.data + y * w, pic->pData0 + y * s, w);
        guint8* uv = m.data + (gsize)w * h;
        for (int y = 0; y < h / 2; y++) memcpy(uv + y * w, pic->pData1 + y * s, w);
        gst_buffer_unmap(out, &m);
        gst_app_src_push_buffer(appsrc, out); // takes ownership
        ReturnPicture(dec, pic);
    }
}

static void* decode_thread(void* arg) {
    while (running) {
        GstSample* sample = gst_app_sink_pull_sample(appsink);
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
        push_pictures();
    }
    gst_app_src_end_of_stream(appsrc);
    return NULL;
}

int main(int argc, char** argv) {
    const char* host = argc > 1 ? argv[1] : "192.168.1.35";
    gst_init(&argc, &argv);

    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    VeOpsS* veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nDecoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    VideoStreamInfo si; memset(&si, 0, sizeof(si)); si.eCodecFormat = VIDEO_CODEC_FORMAT_H264;
    VConfig vc; memset(&vc, 0, sizeof(vc));
    vc.eOutputPixelFormat = PIXEL_FORMAT_NV12; vc.nFrameBufferNum = 12; vc.bDispErrorFrame = 1;
    vc.memops = memops; vc.veOpsS = veOps; vc.pVeOpsSelf = veSelf;
    dec = CreateVideoDecoder();
    if (InitializeVideoDecoder(dec, &si, &vc) != 0) { g_printerr("cedar init fail\n"); return 1; }

    char srcdesc[512];
    snprintf(srcdesc, sizeof(srcdesc),
        "rtspsrc location=rtsp://%s:8554/stream1 protocols=tcp latency=200 ! "
        "rtph264depay ! h264parse config-interval=-1 ! "
        "video/x-h264,stream-format=byte-stream,alignment=au ! "
        "appsink name=s emit-signals=false sync=false max-buffers=8 drop=false", host);
    GError* err = NULL;
    GstElement* srcpipe = gst_parse_launch(srcdesc, &err);
    if (!srcpipe) { g_printerr("srcpipe: %s\n", err ? err->message : "?"); return 1; }
    appsink = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(srcpipe), "s"));

    GstElement* disppipe = gst_parse_launch(
        "appsrc name=a is-live=true format=time do-timestamp=true ! queue max-size-buffers=4 leaky=downstream ! "
        "videoscale ! videoconvert ! video/x-raw,format=NV12,width=1920,height=1080 ! "
        "kmssink driver-name=sunxi-drm connector-id=153 force-modesetting=true", &err);
    if (!disppipe) { g_printerr("disppipe: %s\n", err ? err->message : "?"); return 1; }
    appsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(disppipe), "a"));

    gst_element_set_state(disppipe, GST_STATE_PLAYING);
    gst_element_set_state(srcpipe, GST_STATE_PLAYING);
    g_print("pipelines PLAYING, decoding...\n");

    pthread_t th; pthread_create(&th, NULL, decode_thread, NULL);
    GMainLoop* loop = g_main_loop_new(NULL, FALSE);
    g_main_loop_run(loop);
    return 0;
}
