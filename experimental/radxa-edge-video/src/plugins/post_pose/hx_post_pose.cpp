// SPDX-License-Identifier: AGPL-3.0-only
// Postprocess plugin: YOLOv8-pose decode -> person detections + 17 keypoints, in frame pixels.
// heads: out[0..2] box[1,64,G,G], out[3..5] cls[1,1,G,G], out[6..8] kpt[1,51,G,G]
// (17*(x,y,vis)), G=80/40/20 at stride 8/16/32. in = [ tensors(9 heads), frame ] ; out = dets.
#include <vector>
#include <algorithm>
#include "../helix_pipeline.h"
#include "../hx_json.h"
#include "../hx_detect_common.h"

#define S 640

struct Pose {
    cv::Rect_<float> rect;
    float prob;
    float kx[17], ky[17], kc[17];
};

struct helix_node_ctx {
    float conf = 0.35f, nms = 0.45f;
    std::vector<helix_det_t> dets;
    std::vector<float> kpt_storage;   // count * 51, keeps det.kpts pointers valid
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->conf = (float)hxj::jnum(p, "conf", 0.35);
    c->nms = (float)hxj::jnum(p, "nms", 0.45);
    return c;
}
static void destroy(helix_node_ctx *c) { delete c; }

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 2 || in[0].type != HX_PKT_TENSORS || in[1].type != HX_PKT_FRAME) return -1;
    float **o = in[0].tensors.heads;
    int fw = in[1].frame.w, fh = in[1].frame.h;

    const int GR[3] = {80, 40, 20}, ST[3] = {8, 16, 32};
    std::vector<Pose> props;
    for (int s = 0; s < 3; s++) {
        int G = GR[s], HW = G * G, st = ST[s];
        const float *box = o[0 + s];
        const float *cls = o[3 + s];
        const float *kpt = o[6 + s];
        for (int y = 0; y < G; y++)
            for (int x = 0; x < G; x++) {
                int cell = y * G + x;
                float conf = hxd::sigmoid(cls[cell]);
                if (conf < c->conf) continue;
                float dist[4];
                for (int side = 0; side < 4; side++) {
                    float e[16], mx = -1e9f, sum = 0, d = 0;
                    for (int b = 0; b < 16; b++) { float v = box[(side * 16 + b) * HW + cell]; e[b] = v; if (v > mx) mx = v; }
                    for (int b = 0; b < 16; b++) { e[b] = expf(e[b] - mx); sum += e[b]; }
                    for (int b = 0; b < 16; b++) d += b * (e[b] / sum);
                    dist[side] = d;
                }
                float ax = x + 0.5f, ay = y + 0.5f;
                Pose p;
                p.rect = cv::Rect_<float>((ax - dist[0]) * st, (ay - dist[1]) * st, (dist[0] + dist[2]) * st, (dist[1] + dist[3]) * st);
                p.prob = conf;
                for (int k = 0; k < 17; k++) {
                    p.kx[k] = (kpt[(3 * k) * HW + cell] * 2.f + x) * st;
                    p.ky[k] = (kpt[(3 * k + 1) * HW + cell] * 2.f + y) * st;
                    p.kc[k] = hxd::sigmoid(kpt[(3 * k + 2) * HW + cell]);
                }
                props.push_back(p);
            }
    }
    std::sort(props.begin(), props.end(), [](const Pose &a, const Pose &b) { return a.prob > b.prob; });
    std::vector<int> keep;
    for (size_t i = 0; i < props.size(); i++) {
        int ok = 1;
        for (int j : keep) {
            cv::Rect_<float> I = props[i].rect & props[j].rect;
            float ia = I.area(), ua = props[i].rect.area() + props[j].rect.area() - ia;
            if (ua > 0 && ia / ua > c->nms) { ok = 0; break; }
        }
        if (ok) keep.push_back((int)i);
    }

    hxd::LB lb = hxd::lb_for(fw, fh, S);
    c->dets.clear();
    c->kpt_storage.assign(keep.size() * 51, 0.f);
    for (size_t n = 0; n < keep.size(); n++) {
        Pose &p = props[keep[n]];
        float *ks = &c->kpt_storage[n * 51];
        for (int k = 0; k < 17; k++) {
            ks[k * 3 + 0] = lb.mx(p.kx[k]);
            ks[k * 3 + 1] = lb.my(p.ky[k]);
            ks[k * 3 + 2] = p.kc[k];
        }
        float x0 = lb.mx(p.rect.x), y0 = lb.my(p.rect.y);
        float x1 = lb.mx(p.rect.x + p.rect.width), y1 = lb.my(p.rect.y + p.rect.height);
        helix_det_t d{};
        d.x = x0; d.y = y0; d.w = x1 - x0; d.h = y1 - y0;
        d.cls = 0; d.score = p.prob;   // pose = person only
        d.kpts = ks; d.nkpt = 17;
        c->dets.push_back(d);
    }
    out->type = HX_PKT_DETS;
    out->dets.count = (int)c->dets.size();
    out->dets.dets = c->dets.data();
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "postprocess", "hx_post_pose",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
