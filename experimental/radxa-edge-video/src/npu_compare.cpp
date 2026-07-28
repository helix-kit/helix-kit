// Model-comparison NPU pipeline (headless/WebRTC): YOLOv5n vs YOLO11s, one awnn context per stream, single NPU core serialized by mtx_npu.
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <opencv2/opencv.hpp>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <csignal>
#include <pthread.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>
#include <time.h>
#include <vector>
#include <algorithm>
#include <deque>
#include <awnn_lib.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"
#include "vencoder.h"
extern "C" VeOpsS *GetVeOpsS(enum EVEOPSTYPE type);

#define NCAM 4
#define S 640
#define GW 1280
#define GH 720
#define CW 640
#define CH 360

// YOLOv5 decode (from vendor yolov5_post_process.cpp).
struct Object
{
    cv::Rect_<float> rect;
    int label;
    float prob;
};
static inline float sigmoid(float x) { return 1.f / (1.f + expf(-x)); }
static inline float desigmoid(float x) { return -logf(1.f / x - 1.f); }
static inline float inter_area(const Object &a, const Object &b)
{
    cv::Rect_<float> i = a.rect & b.rect;
    return i.area();
}
static void qsort_desc(std::vector<Object> &f, int l, int r)
{
    int i = l, j = r;
    float p = f[(l + r) / 2].prob;
    while (i <= j)
    {
        while (f[i].prob > p)
            i++;
        while (f[j].prob < p)
            j--;
        if (i <= j)
        {
            std::swap(f[i], f[j]);
            i++;
            j--;
        }
    }
    if (l < j)
        qsort_desc(f, l, j);
    if (i < r)
        qsort_desc(f, i, r);
}
static void qsort_desc(std::vector<Object> &f)
{
    if (!f.empty())
        qsort_desc(f, 0, (int)f.size() - 1);
}
static void nms(const std::vector<Object> &o, std::vector<int> &picked, float thr)
{
    picked.clear();
    int n = o.size();
    std::vector<float> areas(n);
    for (int i = 0; i < n; i++)
        areas[i] = o[i].rect.area();
    for (int i = 0; i < n; i++)
    {
        const Object &a = o[i];
        int keep = 1;
        for (size_t j = 0; j < picked.size(); j++)
        {
            const Object &b = o[picked[j]];
            float ia = inter_area(a, b), ua = areas[i] + areas[picked[j]] - ia;
            if (ia / ua > thr)
            {
                keep = 0;
                break;
            }
        }
        if (keep)
            picked.push_back(i);
    }
}
static void gen_proposals(int stride, const float *feat, float pth, std::vector<Object> &objs, int lc, int lr)
{
    static float anchors[18] = {10, 13, 16, 30, 33, 23, 30, 61, 62, 45, 59, 119, 116, 90, 156, 198, 373, 326};
    int anum = 3, fw = lc / stride, fh = lr / stride, cls = 80, ag = (stride == 8 ? 1 : stride == 16 ? 2
                                                                                                     : 3);
    float dth = desigmoid(pth);
    int fs = fw * fh, fsc5 = fs * (cls + 5);
    for (int h = 0; h < fh; h++)
    {
        int hfw = h * fw * (cls + 5);
        for (int w = 0; w < fw; w++)
        {
            int wc5 = w * (cls + 5);
            for (int a = 0; a < anum; a++)
            {
                int ci = 0;
                float cs = -FLT_MAX;
                int ai = a * fsc5 + hfw + wc5;
                const float *fp = &feat[ai + 4];
                for (int s = 0; s < cls; s++)
                    if (*(fp + s + 1) > cs)
                    {
                        ci = s;
                        cs = *(fp + s + 1);
                    }
                float bs = *fp, final = 0.f;
                if (bs >= dth && cs >= dth)
                    final = sigmoid(bs) * sigmoid(cs);
                if (final >= pth)
                {
                    int li = ai;
                    float dx = sigmoid(feat[li]), dy = sigmoid(feat[li + 1]), dw = sigmoid(feat[li + 2]), dh = sigmoid(feat[li + 3]);
                    float pcx = (dx * 2.f - 0.5f + w) * stride, pcy = (dy * 2.f - 0.5f + h) * stride;
                    float aw = anchors[(ag - 1) * 6 + a * 2], ah = anchors[(ag - 1) * 6 + a * 2 + 1];
                    float pw = dw * dw * 4.f * aw, ph = dh * dh * 4.f * ah;
                    Object o;
                    o.rect.x = pcx - pw * 0.5f;
                    o.rect.y = pcy - ph * 0.5f;
                    o.rect.width = pw;
                    o.rect.height = ph;
                    o.label = ci;
                    o.prob = final;
                    objs.push_back(o);
                }
            }
        }
    }
}
static const char *CLS[] = {"person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"};

// Letterbox a BGR frame into a 640x640 CHW uint8 RGB buffer.
static void preprocess(const cv::Mat &bgr, unsigned char *out)
{
    cv::Mat img;
    cv::cvtColor(bgr, img, cv::COLOR_BGR2RGB);
    float sl = std::min(S * 1.f / img.rows, S * 1.f / img.cols);
    int rc = int(sl * img.cols), rr = int(sl * img.rows);
    cv::resize(img, img, cv::Size(rc, rr));
    cv::Mat canvas(S, S, CV_8UC3, cv::Scalar(0, 0, 0));
    int top = (S - rr) / 2, left = (S - rc) / 2;
    img.copyTo(canvas(cv::Rect(left, top, rc, rr)));
    for (int h = 0; h < S; h++)
        for (int w = 0; w < S; w++)
        {
            const cv::Vec3b &p = canvas.at<cv::Vec3b>(h, w);
            for (int c = 0; c < 3; c++)
                out[c * S * S + h * S + w] = p[c];
        }
}
// Decode outputs, NMS, map boxes back to the original frame, draw in place.
static int detect_draw(cv::Mat &bgr, float **output)
{
    std::vector<Object> prop;
    gen_proposals(32, output[2], 0.4f, prop, S, S);
    gen_proposals(16, output[1], 0.4f, prop, S, S);
    gen_proposals(8, output[0], 0.4f, prop, S, S);
    qsort_desc(prop);
    std::vector<int> picked;
    nms(prop, picked, 0.45f);
    float sl = std::min(S * 1.f / bgr.rows, S * 1.f / bgr.cols);
    int rc = int(sl * bgr.cols), rr = int(sl * bgr.rows), tw = (S - rc) / 2, th = (S - rr) / 2;
    float rx = (float)bgr.cols / rc, ry = (float)bgr.rows / rr;
    for (int idx : picked)
    {
        Object o = prop[idx];
        float x0 = (o.rect.x - tw) * rx, y0 = (o.rect.y - th) * ry, x1 = (o.rect.x + o.rect.width - tw) * rx, y1 = (o.rect.y + o.rect.height - th) * ry;
        x0 = std::max(0.f, std::min(x0, bgr.cols - 1.f));
        y0 = std::max(0.f, std::min(y0, bgr.rows - 1.f));
        x1 = std::max(0.f, std::min(x1, bgr.cols - 1.f));
        y1 = std::max(0.f, std::min(y1, bgr.rows - 1.f));
        cv::rectangle(bgr, cv::Point(x0, y0), cv::Point(x1, y1), cv::Scalar(0, 255, 0), 2);
        char t[128];
        snprintf(t, sizeof(t), "%s %.0f%%", CLS[o.label], o.prob * 100);
        cv::putText(bgr, t, cv::Point(x0, std::max(12.f, y0 - 4)), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 255, 0), 1);
    }
    return picked.size();
}

static double now_ms()
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

static gboolean bus_cb(GstBus *b, GstMessage *m, gpointer u)
{
    (void)b;
    (void)u;
    if (GST_MESSAGE_TYPE(m) == GST_MESSAGE_ERROR)
    {
        GError *e;
        gchar *d;
        gst_message_parse_error(m, &e, &d);
        fprintf(stderr, "GST-ERROR [%s]: %s | %s\n", GST_OBJECT_NAME(m->src), e->message, d ? d : "");
        g_error_free(e);
        g_free(d);
    }
    else if (GST_MESSAGE_TYPE(m) == GST_MESSAGE_WARNING)
    {
        GError *e;
        gchar *d;
        gst_message_parse_warning(m, &e, &d);
        fprintf(stderr, "GST-WARN [%s]: %s\n", GST_OBJECT_NAME(m->src), e->message);
        g_error_free(e);
        g_free(d);
    }
    return TRUE;
}

#define NWORK NCAM // one NPU worker per stream
static GstAppSink *sinks[NCAM];
static GstElement *pipes[NCAM];
static GstElement *disp;
static GstAppSrc *encsrc;

// COCO 17-keypoint skeleton limbs (pairs of keypoint indices).
static const int SKELETON[19][2] = {{15, 13}, {13, 11}, {16, 14}, {14, 12}, {11, 12}, {5, 11}, {6, 12}, {5, 6}, {5, 7}, {6, 8}, {7, 9}, {8, 10}, {1, 2}, {0, 1}, {0, 2}, {1, 3}, {2, 4}, {3, 5}, {4, 6}};
struct Pose
{
    cv::Rect_<float> rect;
    float prob;
    float kx[17], ky[17], kc[17];
};
// Model cut at the 9 raw conv heads so logits quantize cleanly as uint8 (post-decode tensors mix 0-640 coords with 0-1 conf and get crushed); full float decode here.
// out[0..2] box[1,64,G,G] (4 sides x16 DFL), out[3..5] cls[1,1,G,G], out[6..8] kpt[1,51,G,G]; G=80/40/20 at stride 8/16/32.
static int pose_draw(cv::Mat &bgr, float **out)
{
    const int GR[3] = {80, 40, 20}, ST[3] = {8, 16, 32};
    std::vector<Pose> props;
    for (int s = 0; s < 3; s++)
    {
        int G = GR[s], HW = G * G, st = ST[s];
        const float *box = out[0 + s];
        const float *cls = out[3 + s];
        const float *kpt = out[6 + s];
        for (int y = 0; y < G; y++)
            for (int x = 0; x < G; x++)
            {
                int cell = y * G + x;
                float conf = 1.f / (1.f + expf(-cls[cell]));
                if (conf < 0.35f)
                    continue;
                float dist[4]; // DFL: 4 sides x 16 bins -> expected value
                for (int side = 0; side < 4; side++)
                {
                    float e[16], mx = -1e9, sum = 0, d = 0;
                    for (int b = 0; b < 16; b++)
                    {
                        float v = box[(side * 16 + b) * HW + cell];
                        e[b] = v;
                        if (v > mx)
                            mx = v;
                    }
                    for (int b = 0; b < 16; b++)
                    {
                        e[b] = expf(e[b] - mx);
                        sum += e[b];
                    }
                    for (int b = 0; b < 16; b++)
                        d += b * (e[b] / sum);
                    dist[side] = d;
                }
                float ax = x + 0.5f, ay = y + 0.5f;
                float x1 = (ax - dist[0]) * st, y1 = (ay - dist[1]) * st, x2 = (ax + dist[2]) * st, y2 = (ay + dist[3]) * st;
                Pose p;
                p.rect = cv::Rect_<float>(x1, y1, x2 - x1, y2 - y1);
                p.prob = conf;
                for (int k = 0; k < 17; k++)
                { // kpt: (raw*2 + grid)*stride
                    p.kx[k] = (kpt[(3 * k) * HW + cell] * 2.f + x) * st;
                    p.ky[k] = (kpt[(3 * k + 1) * HW + cell] * 2.f + y) * st;
                    p.kc[k] = 1.f / (1.f + expf(-kpt[(3 * k + 2) * HW + cell]));
                }
                props.push_back(p);
            }
    }
    std::sort(props.begin(), props.end(), [](const Pose &a, const Pose &b)
              { return a.prob > b.prob; });
    std::vector<int> keep;
    for (size_t i = 0; i < props.size(); i++)
    {
        int ok = 1;
        for (int j : keep)
        {
            cv::Rect_<float> I = props[i].rect & props[j].rect;
            float ia = I.area();
            float ua = props[i].rect.area() + props[j].rect.area() - ia;
            if (ua > 0 && ia / ua > 0.45f)
            {
                ok = 0;
                break;
            }
        }
        if (ok)
            keep.push_back(i);
    }
    // letterbox inverse: 640-input coords -> original frame
    float sl = std::min(S * 1.f / bgr.rows, S * 1.f / bgr.cols);
    int rc = int(sl * bgr.cols), rr = int(sl * bgr.rows), tw = (S - rc) / 2, th = (S - rr) / 2;
    float rx = (float)bgr.cols / rc, ry = (float)bgr.rows / rr;
    auto MX = [&](float x)
    { return (x - tw) * rx; };
    auto MY = [&](float y)
    { return (y - th) * ry; };
    for (int idx : keep)
    {
        Pose &p = props[idx];
        cv::rectangle(bgr, cv::Point(MX(p.rect.x), MY(p.rect.y)),
                      cv::Point(MX(p.rect.x + p.rect.width), MY(p.rect.y + p.rect.height)), cv::Scalar(0, 200, 255), 2);
        for (auto &s : SKELETON)
        {
            if (p.kc[s[0]] > 0.5f && p.kc[s[1]] > 0.5f)
                cv::line(bgr, cv::Point(MX(p.kx[s[0]]), MY(p.ky[s[0]])),
                         cv::Point(MX(p.kx[s[1]]), MY(p.ky[s[1]])), cv::Scalar(255, 128, 0), 2);
        }
        for (int k = 0; k < 17; k++)
            if (p.kc[k] > 0.5f)
                cv::circle(bgr, cv::Point(MX(p.kx[k]), MY(p.ky[k])), 3, cv::Scalar(0, 0, 255), -1);
    }
    return (int)keep.size();
}

// YOLO11 anchor-free DFL decode, cut at the 6 raw conv heads (post-decode tensors quantize badly): out[0..2] box[1,64,G,G], out[3..5] cls[1,80,G,G], G=80/40/20 at stride 8/16/32.
static int yolo11_draw(cv::Mat &bgr, float **out)
{
    const int GR[3] = {80, 40, 20}, ST[3] = {8, 16, 32};
    std::vector<Object> prop;
    for (int s = 0; s < 3; s++)
    {
        int G = GR[s], HW = G * G, st = ST[s];
        const float *box = out[0 + s];
        const float *cls = out[3 + s];
        for (int y = 0; y < G; y++)
            for (int x = 0; x < G; x++)
            {
                int cell = y * G + x;
                int bc = 0;
                float bs = cls[cell];
                for (int c = 1; c < 80; c++)
                {
                    float v = cls[c * HW + cell];
                    if (v > bs) { bs = v; bc = c; }
                }
                float conf = 1.f / (1.f + expf(-bs));
                if (conf < 0.35f) continue;
                float dist[4];
                for (int side = 0; side < 4; side++)
                {
                    float e[16], mx = -1e9f, sum = 0, d = 0;
                    for (int b = 0; b < 16; b++) { float v = box[(side * 16 + b) * HW + cell]; e[b] = v; if (v > mx) mx = v; }
                    for (int b = 0; b < 16; b++) { e[b] = expf(e[b] - mx); sum += e[b]; }
                    for (int b = 0; b < 16; b++) d += b * (e[b] / sum);
                    dist[side] = d;
                }
                float ax = x + 0.5f, ay = y + 0.5f;
                Object o;
                o.rect = cv::Rect_<float>((ax - dist[0]) * st, (ay - dist[1]) * st, (dist[0] + dist[2]) * st, (dist[1] + dist[3]) * st);
                o.label = bc;
                o.prob = conf;
                prop.push_back(o);
            }
    }
    qsort_desc(prop);
    std::vector<int> picked;
    nms(prop, picked, 0.45f);
    float sl = std::min(S * 1.f / bgr.rows, S * 1.f / bgr.cols);
    int rc = int(sl * bgr.cols), rr = int(sl * bgr.rows), tw = (S - rc) / 2, th = (S - rr) / 2;
    float rx = (float)bgr.cols / rc, ry = (float)bgr.rows / rr;
    for (int idx : picked)
    {
        Object o = prop[idx];
        float x0 = (o.rect.x - tw) * rx, y0 = (o.rect.y - th) * ry, x1 = (o.rect.x + o.rect.width - tw) * rx, y1 = (o.rect.y + o.rect.height - th) * ry;
        x0 = std::max(0.f, std::min(x0, bgr.cols - 1.f)); y0 = std::max(0.f, std::min(y0, bgr.rows - 1.f));
        x1 = std::max(0.f, std::min(x1, bgr.cols - 1.f)); y1 = std::max(0.f, std::min(y1, bgr.rows - 1.f));
        cv::rectangle(bgr, cv::Point(x0, y0), cv::Point(x1, y1), cv::Scalar(0, 165, 255), 2);
        char t[128];
        snprintf(t, sizeof(t), "%s %.0f%%", CLS[o.label], o.prob * 100);
        cv::putText(bgr, t, cv::Point(x0, std::max(12.f, y0 - 4)), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 165, 255), 1);
    }
    return picked.size();
}

struct Model
{
    const char *name;
    const char *nb;
    void (*pre)(const cv::Mat &, unsigned char *);
    int (*post)(cv::Mat &, float **);
};
static Model MODELS[] = {
    {"5n", "model/v3/yolov5.nb", preprocess, detect_draw},
    {"11s", "/home/radxa/lab/yolo11s.nb", preprocess, yolo11_draw},
    {"11m", "/home/radxa/lab/yolo11m.nb", preprocess, yolo11_draw},
};
#define NMODEL ((int)(sizeof(MODELS) / sizeof(MODELS[0])))
// Which model each stream runs; overridden by argv[2].
static int STREAM_MODEL[NCAM] = {0, 1, 0, 1};

static volatile int running = 1, teardown_done = 0;
static void on_sig(int s)
{
    (void)s;
    running = 0;
}
// Each worker owns one awnn context (never reloads networks); the single NPU core is time-shared across all workers.
static Awnn_Context_t *ctxs[NWORK];
static pthread_mutex_t mtx_npu = PTHREAD_MUTEX_INITIALIZER;    // serialize the single NPU core
static pthread_mutex_t mtx_latest = PTHREAD_MUTEX_INITIALIZER; // guard the annotated cells
static cv::Mat latest[NCAM];
static int updated[NCAM] = {0};
static volatile long g_inf_m[8] = {0}, g_det_m[8] = {0};
static long g_time_us[8] = {0}; // per-model inference time (us): NPU HW + fp32 copy, excl. lock-wait
static int nstream_m[8] = {0};

// Cedar libcedarc HW H.264 encoder.
static struct ScMemOpsS *memops;
static VeOpsS *veOps;
static VideoEncoder *venc;
static void *encVe;
static unsigned char g_hdr[256];
static int g_hdrlen = 0;

static int make_encoder()
{
    VeConfig vc;
    memset(&vc, 0, sizeof(vc));
    vc.nEncoderFlag = 1;
    vc.memops = memops;
    encVe = CdcVeInit(veOps, &vc);
    venc = VideoEncCreate(VENC_CODEC_H264);
    if (!venc)
        return -1;
    int fps = 25, br = 4000000, ki = 30;
    VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = GW;
    cfg.nInputHeight = GH;
    cfg.nDstWidth = GW;
    cfg.nDstHeight = GH;
    cfg.nStride = GW;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP;
    cfg.bEncH264Nalu = 0;
    cfg.memops = memops;
    cfg.veOpsS = veOps;
    cfg.pVeOpsSelf = encVe;
    if (VideoEncInit(venc, &cfg) != 0)
        return -1;
    VencAllocateBufferParam ap;
    memset(&ap, 0, sizeof(ap));
    ap.nBufferNum = 4;
    ap.nSizeY = GW * GH;
    ap.nSizeC = GW * GH / 2;
    AllocInputBuffer(venc, &ap);
    VencHeaderData hd;
    memset(&hd, 0, sizeof(hd));
    if (VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd) == 0 && hd.nLength > 0 && hd.nLength <= (int)sizeof(g_hdr))
    {
        memcpy(g_hdr, hd.pBuffer, hd.nLength);
        g_hdrlen = hd.nLength;
    }
    return g_hdrlen > 0 ? 0 : -1;
}
// BGR grid -> tightly packed NV12 (Y plane + interleaved UV).
static void bgr_to_nv12(const cv::Mat &bgr, unsigned char *nv12)
{
    cv::Mat i420;
    cv::cvtColor(bgr, i420, cv::COLOR_BGR2YUV_I420);
    int w = bgr.cols, h = bgr.rows;
    memcpy(nv12, i420.data, (size_t)w * h);
    unsigned char *U = i420.data + (size_t)w * h;
    unsigned char *V = U + (size_t)(w / 2) * (h / 2);
    unsigned char *UV = nv12 + (size_t)w * h;
    int n = (w / 2) * (h / 2);
    for (int i = 0; i < n; i++)
    {
        UV[2 * i] = U[i];
        UV[2 * i + 1] = V[i];
    }
}
// Encode one NV12 frame on the VE -> push annexb (SPS prepended on keyframes) to encsrc.
static void encode_push(unsigned char *nv12)
{
    VencInputBuffer in;
    memset(&in, 0, sizeof(in));
    if (GetOneAllocInputBuffer(venc, &in) != 0)
        return;
    memcpy(in.pAddrVirY, nv12, (size_t)GW * GH);
    memcpy(in.pAddrVirC, nv12 + (size_t)GW * GH, (size_t)GW * GH / 2);
    static long long pts = 0;
    in.nPts = pts;
    pts += 40000;
    FlushCacheAllocInputBuffer(venc, &in);
    AddOneInputBuffer(venc, &in);
    VideoEncodeOneFrame(venc);
    AlreadyUsedInputBuffer(venc, &in);
    ReturnOneAllocInputBuffer(venc, &in);
    for (;;)
    {
        VencOutputBuffer ob;
        memset(&ob, 0, sizeof(ob));
        if (GetOneBitstreamFrame(venc, &ob) != 0)
            break;
        int total = ob.nSize0 + ob.nSize1;
        int key = (ob.nFlag & VENC_BUFFERFLAG_KEYFRAME) ? 1 : 0;
        if (total > 0)
        {
            gsize extra = (key && g_hdrlen > 0) ? g_hdrlen : 0;
            GstBuffer *hb = gst_buffer_new_allocate(NULL, extra + total, NULL);
            if (extra)
                gst_buffer_fill(hb, 0, g_hdr, g_hdrlen);
            gst_buffer_fill(hb, extra, ob.pData0, ob.nSize0);
            if (ob.nSize1)
                gst_buffer_fill(hb, extra + ob.nSize0, ob.pData1, ob.nSize1);
            gst_app_src_push_buffer(encsrc, hb);
        }
        FreeOneBitStreamFrame(venc, &ob);
    }
}
static void *watchdog(void *a)
{
    int s = (int)(intptr_t)a;
    for (int i = 0; i < s * 10; i++)
    {
        if (teardown_done)
            return NULL;
        usleep(100000);
    }
    fprintf(stderr, "[WATCHDOG] teardown hung >%ds — _exit; power cycle may be needed\n", s);
    _exit(3);
}

// Pull a frame, preprocess, run inference (NPU serialized by mtx_npu), decode+draw, publish the annotated cell.
static void *worker(void *arg)
{
    int wid = (int)(intptr_t)arg;
    int i = wid;
    int model = STREAM_MODEL[i];
    Model &M = MODELS[model];
    unsigned char *in = (unsigned char *)malloc(S * S * 3);
    while (running)
    {
        GstSample *s = gst_app_sink_try_pull_sample(sinks[i], 5 * GST_MSECOND);
        if (!s)
            continue;
        GstBuffer *b = gst_sample_get_buffer(s);
        GstCaps *c = gst_sample_get_caps(s);
        GstStructure *st = gst_caps_get_structure(c, 0);
        int W = 0, H = 0;
        gst_structure_get_int(st, "width", &W);
        gst_structure_get_int(st, "height", &H);
        GstMapInfo m;
        if (W > 0 && H > 0 && gst_buffer_map(b, &m, GST_MAP_READ))
        {
            cv::Mat bgr(H, W, CV_8UC3, m.data, W * 3);
            M.pre(bgr, in);
            cv::Mat frame = bgr.clone();
            gst_buffer_unmap(b, &m);
            void *ib[] = {in};
            pthread_mutex_lock(&mtx_npu);
            double t_run = now_ms();
            awnn_set_input_buffers(ctxs[wid], ib);
            awnn_run_hw(ctxs[wid]); // NPU HW run only — lock held just for this
            double hw = now_ms() - t_run;
            pthread_mutex_unlock(&mtx_npu);
            // fp32 copy outside the NPU lock: under the lock serializes the core badly (28 vs 32 inf/s).
            double t_fin = now_ms();
            awnn_finish(ctxs[wid]);
            double fin = now_ms() - t_fin;
            __sync_add_and_fetch(&g_time_us[model], (long)((hw + fin) * 1000.0));
            float **out = awnn_get_output_buffers(ctxs[wid]);
            int n = M.post(frame, out);
            // Decoder emits macroblock-padded frames (e.g. 1080p -> 1920x1088); trim the margin so cells composite seam-free.
            cv::Rect roi(0, 0, frame.cols - (frame.cols > 16 ? 16 : 0), frame.rows - (frame.rows > 16 ? 16 : 0));
            pthread_mutex_lock(&mtx_latest);
            cv::resize(frame(roi), latest[i], cv::Size(CW, CH));
            updated[i] = 1;
            pthread_mutex_unlock(&mtx_latest);
            __sync_add_and_fetch(&g_inf_m[model], 1);
            __sync_add_and_fetch(&g_det_m[model], n);
        }
        gst_sample_unref(s);
    }
    free(in);
    return NULL;
}
// Compositor + Cedar HW encoder thread, runs at ~30fps regardless of detection rate.
static void *outputter(void *arg)
{
    (void)arg;
    unsigned char *nv12 = (unsigned char *)malloc(GW * GH * 3 / 2);
    cv::Mat grid(GH, GW, CV_8UC3, cv::Scalar(20, 20, 20));
    while (running)
    {
        pthread_mutex_lock(&mtx_latest);
        for (int i = 0; i < NCAM; i++)
            if (updated[i] && !latest[i].empty())
            {
                int cx = (i % 2) * CW, cy = (i / 2) * CH;
                latest[i].copyTo(grid(cv::Rect(cx, cy, CW, CH)));
                updated[i] = 0;
            }
        pthread_mutex_unlock(&mtx_latest);
        bgr_to_nv12(grid, nv12);
        encode_push(nv12);
        usleep(33000); // ~30 fps
    }
    free(nv12);
    return NULL;
}

// On-demand overlaid single-camera clip recorder: x264 encodes REC_CAM's annotated cell into a bounded in-memory GOP ring; SIGUSR1 saves the last REC_RING_SEC seconds.
#define REC_CAM 3
#define REC_FPS 10
#define REC_RING_SEC 30 // pre-roll depth (~190KB/s @640x360)
struct RecAU
{
    std::vector<unsigned char> data;
    bool key;
};
static std::deque<RecAU> rec_ring;
static size_t rec_bytes = 0;
static pthread_mutex_t mtx_ring = PTHREAD_MUTEX_INITIALIZER;
static GstAppSrc *recsrc = NULL;
static GstElement *recpipe = NULL;
static volatile int rec_trigger = 0;
static int rec_seq = 0;

// Store each encoded H.264 AU in the ring, evict GOPs beyond the window.
static GstFlowReturn rec_on_sample(GstAppSink *sk, gpointer)
{
    GstSample *s = gst_app_sink_pull_sample(sk);
    if (!s)
        return GST_FLOW_OK;
    GstBuffer *b = gst_sample_get_buffer(s);
    GstMapInfo m;
    bool key = !GST_BUFFER_FLAG_IS_SET(b, GST_BUFFER_FLAG_DELTA_UNIT);
    if (gst_buffer_map(b, &m, GST_MAP_READ))
    {
        pthread_mutex_lock(&mtx_ring);
        rec_ring.push_back({std::vector<unsigned char>(m.data, m.data + m.size), key});
        rec_bytes += m.size;
        size_t cap = (size_t)REC_FPS * REC_RING_SEC;
        while (rec_ring.size() > cap)
        {
            rec_bytes -= rec_ring.front().data.size();
            rec_ring.pop_front();
        }
        while (!rec_ring.empty() && !rec_ring.front().key)
        { // ring must start at a keyframe
            rec_bytes -= rec_ring.front().data.size();
            rec_ring.pop_front();
        }
        pthread_mutex_unlock(&mtx_ring);
        gst_buffer_unmap(b, &m);
    }
    gst_sample_unref(s);
    return GST_FLOW_OK;
}
static void *recorder(void *arg)
{
    (void)arg;
    cv::Mat frame(CH, CW, CV_8UC3, cv::Scalar(0, 0, 0));
    long long pts = 0, dt = 1000000000LL / REC_FPS;
    while (running)
    {
        pthread_mutex_lock(&mtx_latest);
        if (REC_CAM < NCAM && !latest[REC_CAM].empty())
            latest[REC_CAM].copyTo(frame);
        pthread_mutex_unlock(&mtx_latest);
        size_t sz = (size_t)frame.total() * frame.elemSize();
        GstBuffer *b = gst_buffer_new_allocate(NULL, sz, NULL);
        gst_buffer_fill(b, 0, frame.data, sz);
        GST_BUFFER_PTS(b) = pts;
        GST_BUFFER_DURATION(b) = dt;
        pts += dt;
        gst_app_src_push_buffer(recsrc, b);
        usleep(1000000 / REC_FPS);
    }
    return NULL;
}
// Save the ring (oldest keyframe -> now) as a raw AnnexB H.264 elementary stream.
static void rec_dump_clip()
{
    pthread_mutex_lock(&mtx_ring);
    std::vector<RecAU> snap(rec_ring.begin(), rec_ring.end());
    size_t rb = rec_bytes;
    pthread_mutex_unlock(&mtx_ring);
    if (snap.empty())
    {
        fprintf(stderr, "[REC] ring empty, nothing to save\n");
        return;
    }
    int seq = rec_seq++;
    char h264[160];
    snprintf(h264, sizeof(h264), "/home/radxa/clips/overlay_cam%d_%03d.h264", REC_CAM, seq);
    // Elementary stream (not mp4): on-board gst mp4mux won't finalize from stored AUs on this board. Remux client-side.
    FILE *f = fopen(h264, "wb");
    size_t bytes = 0;
    if (f)
    {
        for (auto &au : snap)
        {
            fwrite(au.data.data(), 1, au.data.size(), f);
            bytes += au.data.size();
        }
        fclose(f);
    }
    fprintf(stderr, "[REC] saved %zu frames (%.1fs, %zu KB) -> %s\n",
            snap.size(), snap.size() / (double)REC_FPS, bytes / 1024, h264);
}
static void on_usr1(int s)
{
    (void)s;
    rec_trigger = 1;
}

int main(int argc, char **argv)
{
    const char *host = argc > 1 ? argv[1] : "192.168.1.35";
    const char *layout = argc > 2 ? argv[2] : "mixed"; // mixed | all11 | all5 | all11m | smix
    if (!strcmp(layout, "all11"))
        for (int i = 0; i < NCAM; i++) STREAM_MODEL[i] = 1;
    else if (!strcmp(layout, "all5"))
        for (int i = 0; i < NCAM; i++) STREAM_MODEL[i] = 0;
    else if (!strcmp(layout, "all11m"))
        for (int i = 0; i < NCAM; i++) STREAM_MODEL[i] = 2;
    else if (!strcmp(layout, "smix")) // 11s vs 11m side-by-side
        { int mm[NCAM] = {1, 2, 1, 2}; for (int i = 0; i < NCAM; i++) STREAM_MODEL[i] = mm[i]; }
    else
        { int mm[NCAM] = {0, 1, 0, 1}; for (int i = 0; i < NCAM; i++) STREAM_MODEL[i] = mm[i]; }
    for (int i = 0; i < NCAM; i++) nstream_m[STREAM_MODEL[i]]++;
    fprintf(stderr, "layout=%s\n", layout);
    gst_init(&argc, &argv);
    signal(SIGINT, on_sig);
    signal(SIGTERM, on_sig);
    signal(SIGUSR1, on_usr1);
    awnn_init();
    for (int w = 0; w < NWORK; w++)
    {
        ctxs[w] = awnn_create(MODELS[STREAM_MODEL[w]].nb);
        fprintf(stderr, "worker %d -> stream %d model '%s'\n", w, w, MODELS[STREAM_MODEL[w]].name);
    }
    for (int i = 0; i < NCAM; i++)
        fprintf(stderr, "stream %d -> model '%s'\n", i, MODELS[STREAM_MODEL[i]].name);

    for (int i = 0; i < NCAM; i++)
    {
        char d[512];
        GError *e = NULL;
        // videorate caps videoconvert to 8 fps/stream so we don't color-convert frames the workers would drop.
        snprintf(d, sizeof(d),
                 "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=100 ! rtph264depay ! h264parse ! "
                 "omxh264dec ! videorate drop-only=true ! video/x-raw,framerate=8/1 ! "
                 "videoconvert ! video/x-raw,format=BGR ! "
                 "appsink name=s%d max-buffers=1 drop=true sync=false",
                 host, i + 1, i);
        pipes[i] = gst_parse_launch(d, &e);
        if (!pipes[i])
        {
            fprintf(stderr, "pipe %d: %s\n", i, e ? e->message : "?");
            return 1;
        }
        char n[8];
        snprintf(n, sizeof(n), "s%d", i);
        sinks[i] = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(pipes[i]), n));
        gst_element_set_state(pipes[i], GST_STATE_PLAYING);
    }

    memops = MemAdapterGetOpsS();
    CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    if (make_encoder() != 0)
    {
        fprintf(stderr, "encoder init fail\n");
        return 1;
    }
    fprintf(stderr, "Cedar HW encoder ready, SPS/PPS=%d bytes; %d NPU workers\n", g_hdrlen, NWORK);
    GError *e = NULL;
    char od[1024];
    snprintf(od, sizeof(od),
             "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
             "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
             "flvmux streamable=true ! rtmpsink location=rtmp://%s:1935/detgrid",
             host);
    disp = gst_parse_launch(od, &e);
    if (!disp)
    {
        fprintf(stderr, "disp: %s\n", e ? e->message : "?");
        return 1;
    }
    encsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(disp), "encsrc"));
    gst_bus_add_watch(gst_element_get_bus(disp), bus_cb, NULL);
    GstCaps *hc = gst_caps_new_simple("video/x-h264", "stream-format", G_TYPE_STRING, "byte-stream",
                                      "alignment", G_TYPE_STRING, "au", NULL);
    gst_app_src_set_caps(encsrc, hc);
    gst_caps_unref(hc);
    g_object_set(encsrc, "block", FALSE, "max-bytes", (guint64)4000000, "leaky-type", 2, NULL);
    gst_element_set_state(disp, GST_STATE_PLAYING);

    // Clip recorder off by default (x264 CPU load would skew the throughput comparison); set REC=1 to enable.
    if (getenv("REC") && system("mkdir -p /home/radxa/clips") != 0)
    {
    }
    if (getenv("REC"))
    {
        GError *re = NULL;
        char rd[512];
        snprintf(rd, sizeof(rd),
                 "appsrc name=recsrc is-live=true format=time do-timestamp=false ! "
                 "video/x-raw,format=BGR,width=%d,height=%d,framerate=%d/1 ! videoconvert ! "
                 "x264enc tune=zerolatency speed-preset=ultrafast bitrate=1500 key-int-max=%d ! "
                 // config-interval=-1 repeats SPS/PPS before every keyframe so any ring start is muxable
                 "h264parse config-interval=-1 ! video/x-h264,stream-format=byte-stream,alignment=au ! "
                 "appsink name=recsink",
                 CW, CH, REC_FPS, REC_FPS * 2);
        recpipe = gst_parse_launch(rd, &re);
        if (recpipe)
        {
            recsrc = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(recpipe), "recsrc"));
            GstCaps *rc = gst_caps_new_simple("video/x-raw", "format", G_TYPE_STRING, "BGR",
                                              "width", G_TYPE_INT, CW, "height", G_TYPE_INT, CH, "framerate", GST_TYPE_FRACTION, REC_FPS, 1, NULL);
            gst_app_src_set_caps(recsrc, rc);
            gst_caps_unref(rc);
            g_object_set(recsrc, "block", TRUE, "max-bytes", (guint64)(CW * CH * 3 * 4), NULL);
            GstAppSink *rs = GST_APP_SINK(gst_bin_get_by_name(GST_BIN(recpipe), "recsink"));
            GstAppSinkCallbacks cbs;
            memset(&cbs, 0, sizeof(cbs));
            cbs.new_sample = rec_on_sample;
            gst_app_sink_set_callbacks(rs, &cbs, NULL, NULL);
            gst_element_set_state(recpipe, GST_STATE_PLAYING);
            fprintf(stderr, "overlay recorder: cam%d %dx%d @%dfps, %ds ring -> SIGUSR1 saves clip\n",
                    REC_CAM, CW, CH, REC_FPS, REC_RING_SEC);
        }
        else
            fprintf(stderr, "recorder pipe fail: %s\n", re ? re->message : "?");
    }

    fprintf(stderr, "warming up streams...\n");
    usleep(1500000);

    pthread_t wk[NWORK], op, rt;
    for (int w = 0; w < NWORK; w++)
        pthread_create(&wk[w], NULL, worker, (void *)(intptr_t)w);
    pthread_create(&op, NULL, outputter, NULL);
    if (recpipe)
        pthread_create(&rt, NULL, recorder, NULL);

    double t0 = now_ms(), tlast = t0;
    while (running)
    {
        usleep(200000);
        double t = now_ms();
        if (rec_trigger)
        {
            rec_trigger = 0;
            rec_dump_clip();
        }
        if (t - tlast >= 2000)
        {
            double el = (t - t0) / 1000.0;
            long tot = 0;
            fprintf(stderr, "[%.0fs]", el);
            for (int m = 0; m < NMODEL; m++)
            {
                if (nstream_m[m] == 0) continue;
                tot += g_inf_m[m];
                double ms = g_inf_m[m] ? g_time_us[m] / 1000.0 / g_inf_m[m] : 0;
                // g_inf_m[m] is the combined rate of nstream_m[m] streams on this model.
                fprintf(stderr, " %s[%dstr]=%.1f inf/s (%.1f/str) @%.1fms %ld det",
                        MODELS[m].name, nstream_m[m], g_inf_m[m] / el, g_inf_m[m] / el / nstream_m[m], ms, g_det_m[m]);
            }
            fprintf(stderr, " | AGG=%.1f inf/s\n", tot / el);
            tlast = t;
        }
    }

    fprintf(stderr, "stopping (graceful VE teardown)...\n");
    pthread_t wd;
    pthread_create(&wd, NULL, watchdog, (void *)(intptr_t)15);
    pthread_detach(wd);
    for (int w = 0; w < NWORK; w++)
        pthread_join(wk[w], NULL);
    pthread_join(op, NULL);
    if (recpipe)
    {
        pthread_join(rt, NULL);
        gst_element_set_state(recpipe, GST_STATE_NULL);
    }
    for (int i = 0; i < NCAM; i++)
        if (pipes[i])
            gst_element_set_state(pipes[i], GST_STATE_NULL);
    if (disp)
        gst_element_set_state(disp, GST_STATE_NULL);
    if (venc)
    {
        ReleaseAllocInputBuffer(venc);
        VideoEncUnInit(venc);
        VideoEncDestroy(venc);
        venc = NULL;
    }
    if (encVe)
    {
        CdcVeRelease(veOps, encVe);
        encVe = NULL;
    }
    if (memops)
        CdcMemClose(memops);
    for (int w = 0; w < NWORK; w++)
        if (ctxs[w])
            awnn_destroy(ctxs[w]);
    awnn_uninit();
    teardown_done = 1;
    fprintf(stderr, "[exit] clean\n");
    return 0;
}
