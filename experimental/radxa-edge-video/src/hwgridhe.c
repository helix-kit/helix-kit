// 4x Cedar HW decode -> compositor 2x2 -> tee -> [kmssink] + [Cedar HW encode -> RTMP].
// Both decode AND encode run on the Allwinner VE (Cedar); CPU only composites/muxes.
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
#include "vencoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

static gboolean bus_cb(GstBus* bus, GstMessage* msg, gpointer tag) {
    if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) {
        GError* e; gchar* d; gst_message_parse_error(msg, &e, &d);
        g_printerr("PIPELINE ERROR [%s]: %s | %s\n", (char*)tag, e->message, d ? d : "");
        g_error_free(e); g_free(d);
    } else if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_WARNING) {
        GError* e; gchar* d; gst_message_parse_warning(msg, &e, &d);
        g_printerr("PIPELINE WARN [%s]: %s\n", (char*)tag, e->message);
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
static struct ScMemOpsS* memops;
static GstAppSink* encsink;
static GstAppSrc*  encsrc;
static VideoEncoder* venc;
static volatile int running = 1;
static unsigned char g_hdr[512]; static int g_hdrlen = 0;

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

static int make_encoder(VeOpsS* veOps) {
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nEncoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    venc = VideoEncCreate(VENC_CODEC_H264);
    if (!venc) { g_printerr("VideoEncCreate fail\n"); return -1; }
    int fps = 25, br = 4000000, ki = 50;
    VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg; memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = ENC_W; cfg.nInputHeight = ENC_H;
    cfg.nDstWidth = ENC_W; cfg.nDstHeight = ENC_H; cfg.nStride = ENC_W;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP; // NV12
    cfg.bEncH264Nalu = 1;                   // annexb byte-stream
    cfg.memops = memops; cfg.veOpsS = veOps; cfg.pVeOpsSelf = veSelf;
    if (VideoEncInit(venc, &cfg) != 0) { g_printerr("VideoEncInit fail\n"); return -1; }
    VencAllocateBufferParam ap; memset(&ap, 0, sizeof(ap));
    ap.nBufferNum = 4; ap.nSizeY = ENC_W * ENC_H; ap.nSizeC = ENC_W * ENC_H / 2;
    AllocInputBuffer(venc, &ap);
    VencHeaderData hd; memset(&hd, 0, sizeof(hd));
    if (VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd) == 0 && hd.nLength > 0 && hd.nLength <= (int)sizeof(g_hdr)) {
        memcpy(g_hdr, hd.pBuffer, hd.nLength); g_hdrlen = hd.nLength;
    }
    g_print("Cedar H.264 encoder ready (%dx%d), SPS/PPS=%d bytes\n", ENC_W, ENC_H, g_hdrlen);
    return 0;
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

// avcC (mp4 SPS/PPS record) -> annexb SPS/PPS. Returns bytes written.
static int avcc_to_annexb(const unsigned char* a, int alen, unsigned char* out) {
    if (alen < 7) return 0;
    int p = 5, op = 0;
    int nSPS = a[p++] & 0x1f;
    for (int i = 0; i < nSPS && p + 2 <= alen; i++) {
        int l = (a[p] << 8) | a[p + 1]; p += 2;
        if (p + l > alen) break;
        out[op++]=0;out[op++]=0;out[op++]=0;out[op++]=1;
        memcpy(out + op, a + p, l); op += l; p += l;
    }
    if (p >= alen) return op;
    int nPPS = a[p++];
    for (int i = 0; i < nPPS && p + 2 <= alen; i++) {
        int l = (a[p] << 8) | a[p + 1]; p += 2;
        if (p + l > alen) break;
        out[op++]=0;out[op++]=0;out[op++]=0;out[op++]=1;
        memcpy(out + op, a + p, l); op += l; p += l;
    }
    return op;
}
// length-prefixed AVC -> annexb, in place into out (must be >= len). Returns bytes.
static int avc_to_annexb(const unsigned char* in, int len, unsigned char* out) {
    int ip = 0, op = 0;
    while (ip + 4 <= len) {
        int nl = (in[ip]<<24)|(in[ip+1]<<16)|(in[ip+2]<<8)|in[ip+3]; ip += 4;
        if (nl < 0 || ip + nl > len) break;
        out[op++]=0;out[op++]=0;out[op++]=0;out[op++]=1;
        memcpy(out + op, in + ip, nl); op += nl; ip += nl;
    }
    return op;
}

static void* encode_thread(void* arg) {
    long long pts = 0; int n = 0;
    static unsigned char annexb_hdr[512]; static int annexb_hdrlen = 0; static int hdr_sent = 0;
    unsigned char* framebuf = malloc(4 * 1024 * 1024);
    unsigned char* outbuf = malloc(4 * 1024 * 1024 + 64);
    while (running) {
        GstSample* s = gst_app_sink_pull_sample(encsink);
        if (!s) break;
        GstBuffer* b = gst_sample_get_buffer(s);
        GstMapInfo m;
        if (gst_buffer_map(b, &m, GST_MAP_READ)) {
            VencInputBuffer in; memset(&in, 0, sizeof(in));
            int gib = GetOneAllocInputBuffer(venc, &in);
            if (n < 5) g_printerr("ENC iter %d: sample sz=%zu GetInBuf=%d virY=%p virC=%p\n", n, m.size, gib, in.pAddrVirY, in.pAddrVirC);
            if (gib == 0) {
                // NV12 1280x720 tight: Y then UV
                memcpy(in.pAddrVirY, m.data, (size_t)ENC_W * ENC_H);
                memcpy(in.pAddrVirC, m.data + (size_t)ENC_W * ENC_H, (size_t)ENC_W * ENC_H / 2);
                in.nPts = pts; pts += 40000; // ~25fps in us
                FlushCacheAllocInputBuffer(venc, &in);
                AddOneInputBuffer(venc, &in);
                gst_buffer_unmap(b, &m);
                gst_sample_unref(s);
                int enc_rc = VideoEncodeOneFrame(venc);
                ReturnOneAllocInputBuffer(venc, &in);
                VencOutputBuffer ob; memset(&ob, 0, sizeof(ob));
                int bs_rc = GetOneBitstreamFrame(venc, &ob);
                (void)enc_rc;
                // real SPS/PPS is only valid once encoding has started
                if (!annexb_hdrlen) {
                    VencHeaderData hd; memset(&hd, 0, sizeof(hd));
                    if (VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd) == 0 && hd.nLength > 7)
                        annexb_hdrlen = avcc_to_annexb(hd.pBuffer, hd.nLength, annexb_hdr);
                }
                if (bs_rc == 0) {
                    int total = ob.nSize0 + ob.nSize1;
                    if (total > 0 && total <= 4 * 1024 * 1024) {
                        memcpy(framebuf, ob.pData0, ob.nSize0);
                        if (ob.nSize1) memcpy(framebuf + ob.nSize0, ob.pData1, ob.nSize1);
                        int alen = avc_to_annexb(framebuf, total, outbuf);
                        gsize extra = (!hdr_sent && annexb_hdrlen > 0) ? annexb_hdrlen : 0;
                        if (n == 0) g_printerr("ENC: frame total=%d annexb=%d hdr=%d\n", total, alen, annexb_hdrlen);
                        static FILE* dump = NULL; static long dn = 0;
                        if (!dump) dump = fopen("/home/radxa/cedar/enc.h264", "wb");
                        if (dump && dn < 3000000) {
                            if (extra) fwrite(annexb_hdr, 1, annexb_hdrlen, dump);
                            fwrite(outbuf, 1, alen, dump); dn += alen; fflush(dump);
                        }
                        GstBuffer* hb = gst_buffer_new_allocate(NULL, extra + alen, NULL);
                        if (extra) { gst_buffer_fill(hb, 0, annexb_hdr, annexb_hdrlen); hdr_sent = 1; }
                        gst_buffer_fill(hb, extra, outbuf, alen);
                        gst_app_src_push_buffer(encsrc, hb);
                    }
                    FreeOneBitStreamFrame(venc, &ob);
                }
                n++;
                continue;
            }
            gst_buffer_unmap(b, &m);
        }
        gst_sample_unref(s);
    }
    gst_app_src_end_of_stream(encsrc);
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
        if (!decs[i]) { g_printerr("decoder %d fail\n", i); return 1; }
    }
    if (make_encoder(veOps) != 0) return 1;

    GError* err = NULL;
    GstElement* disp = gst_parse_launch(
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

    // encoded-H264 -> RTMP publish (MediaMTX -> WebRTC)
    char encdesc[512];
    snprintf(encdesc, sizeof(encdesc),
        "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
        "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
        "queue ! mpegtsmux alignment=7 ! udpsink host=%s port=5001 sync=false", host);
    GstElement* encpipe = gst_parse_launch(encdesc, &err);
    if (!encpipe) { g_printerr("enc parse: %s\n", err ? err->message : "?"); return 1; }
    encsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(encpipe), "encsrc"));
    GstCaps* h264caps = gst_caps_new_simple("video/x-h264",
        "stream-format", G_TYPE_STRING, "byte-stream", "alignment", G_TYPE_STRING, "au", NULL);
    gst_app_src_set_caps(encsrc, h264caps);
    gst_caps_unref(h264caps);
    g_object_set(encsrc, "block", FALSE, "max-bytes", (guint64)4000000,
                 "leaky-type", 2 /*downstream*/, NULL);

    for (int i = 0; i < NCAM; i++) {
        char d[512];
        snprintf(d, sizeof(d),
            "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=200 ! "
            "rtph264depay ! h264parse config-interval=-1 ! "
            "video/x-h264,stream-format=byte-stream,alignment=au ! "
            "appsink name=s%d emit-signals=false sync=false max-buffers=8 drop=false", host, i + 1, i);
        GstElement* sp = gst_parse_launch(d, &err);
        if (!sp) { g_printerr("src %d parse fail\n", i); return 1; }
        char sn[8]; snprintf(sn, sizeof(sn), "s%d", i);
        sinks[i] = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(sp), sn));
        gst_element_set_state(sp, GST_STATE_PLAYING);
    }
    gst_bus_add_watch(gst_element_get_bus(encpipe), bus_cb, (gpointer)"enc");
    gst_bus_add_watch(gst_element_get_bus(disp), bus_cb, (gpointer)"disp");
    gst_element_set_state(encpipe, GST_STATE_PLAYING);
    gst_element_set_state(disp, GST_STATE_PLAYING);
    g_print("2x2 HW grid + HW encode PLAYING (rtmp://%s:1935/grid)\n", host);

    pthread_t th[NCAM], et;
    for (int i = 0; i < NCAM; i++) pthread_create(&th[i], NULL, decode_thread, (void*)(intptr_t)i);
    pthread_create(&et, NULL, encode_thread, NULL);
    g_main_loop_run(g_main_loop_new(NULL, FALSE));
    return 0;
}
