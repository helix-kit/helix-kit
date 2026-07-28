// 4x Cedar HW decode -> 4 appsrc -> GStreamer compositor (2x2) -> tee ->
//   [kmssink display] + [x264enc -> mpegtsmux -> udpsink (stream)].
#include <gst/gst.h>
#include <gst/app/gstappsrc.h>
#include <gst/app/gstappsink.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <pthread.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

#define NCAM 4
static GstAppSink* sinks[NCAM];
static GstAppSrc*  srcs[NCAM];
static VideoDecoder* decs[NCAM];
static struct ScMemOpsS* memops;
static volatile int running = 1;

static VideoDecoder* make_decoder(VeOpsS* veOps) {
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nDecoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    VideoStreamInfo si; memset(&si, 0, sizeof(si)); si.eCodecFormat = VIDEO_CODEC_FORMAT_H264;
    VConfig vc; memset(&vc, 0, sizeof(vc));
    vc.eOutputPixelFormat = PIXEL_FORMAT_NV12; vc.nFrameBufferNum = 12; vc.bDispErrorFrame = 1;
    vc.memops = memops; vc.veOpsS = veOps; vc.pVeOpsSelf = veSelf;
    VideoDecoder* d = CreateVideoDecoder();
    if (InitializeVideoDecoder(d, &si, &vc) != 0) return NULL;
    return d;
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
            gst_app_src_push_buffer(srcs[i], out);
            ReturnPicture(dec, pic);
        }
    }
    gst_app_src_end_of_stream(srcs[i]);
    return NULL;
}

int main(int argc, char** argv) {
    const char* host = argc > 1 ? argv[1] : "192.168.1.35";
    gst_init(&argc, &argv);
    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    VeOpsS* veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    for (int i = 0; i < NCAM; i++) {
        decs[i] = make_decoder(veOps);
        if (!decs[i]) { g_printerr("decoder %d init fail\n", i); return 1; }
    }

    GError* err = NULL;
    char dispdesc[2048];
    snprintf(dispdesc, sizeof(dispdesc),
        "compositor name=mix background=black "
        " sink_0::xpos=0 sink_0::ypos=0 sink_0::width=640 sink_0::height=360 "
        " sink_1::xpos=640 sink_1::ypos=0 sink_1::width=640 sink_1::height=360 "
        " sink_2::xpos=0 sink_2::ypos=360 sink_2::width=640 sink_2::height=360 "
        " sink_3::xpos=640 sink_3::ypos=360 sink_3::width=640 sink_3::height=360 "
        " ! video/x-raw,format=NV12,width=1280,height=720 ! tee name=t "
        " t. ! queue ! videoscale ! video/x-raw,width=1920,height=1080 ! "
        "     kmssink driver-name=sunxi-drm connector-id=153 force-modesetting=true "
        " t. ! queue leaky=downstream max-size-buffers=3 ! videoconvert ! "
        "     x264enc tune=zerolatency speed-preset=ultrafast bitrate=4000 key-int-max=30 ! "
        "     h264parse ! flvmux streamable=true ! rtmpsink location=rtmp://%s:1935/grid "
        " appsrc name=a0 is-live=true format=time do-timestamp=true ! queue ! mix.sink_0 "
        " appsrc name=a1 is-live=true format=time do-timestamp=true ! queue ! mix.sink_1 "
        " appsrc name=a2 is-live=true format=time do-timestamp=true ! queue ! mix.sink_2 "
        " appsrc name=a3 is-live=true format=time do-timestamp=true ! queue ! mix.sink_3 ", host);
    GstElement* disp = gst_parse_launch(dispdesc, &err);
    if (!disp) { g_printerr("disp pipeline parse failed: %s\n", err ? err->message : "?"); return 1; }

    GstCaps* nv12 = gst_caps_new_simple("video/x-raw",
        "format", G_TYPE_STRING, "NV12", "width", G_TYPE_INT, 720, "height", G_TYPE_INT, 544,
        "framerate", GST_TYPE_FRACTION, 25, 1, NULL);
    for (int i = 0; i < NCAM; i++) {
        char n[8]; snprintf(n, sizeof(n), "a%d", i);
        srcs[i] = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(disp), n));
        gst_app_src_set_caps(srcs[i], nv12);
    }
    gst_caps_unref(nv12);

    for (int i = 0; i < NCAM; i++) {
        char d[512];
        snprintf(d, sizeof(d),
            "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=200 ! "
            "rtph264depay ! h264parse config-interval=-1 ! "
            "video/x-h264,stream-format=byte-stream,alignment=au ! "
            "appsink name=s%d emit-signals=false sync=false max-buffers=8 drop=false", host, i + 1, i);
        GstElement* sp = gst_parse_launch(d, &err);
        if (!sp) { g_printerr("src %d parse failed\n", i); return 1; }
        char sn[8]; snprintf(sn, sizeof(sn), "s%d", i);
        sinks[i] = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(sp), sn));
        gst_element_set_state(sp, GST_STATE_PLAYING);
    }
    gst_element_set_state(disp, GST_STATE_PLAYING);
    g_print("2x2 HW grid PLAYING (stream -> udp://%s:5000)\n", host);

    pthread_t th[NCAM];
    for (int i = 0; i < NCAM; i++) pthread_create(&th[i], NULL, decode_thread, (void*)(intptr_t)i);
    g_main_loop_run(g_main_loop_new(NULL, FALSE));
    return 0;
}
