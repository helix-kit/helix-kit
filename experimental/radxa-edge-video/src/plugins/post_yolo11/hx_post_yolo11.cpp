// SPDX-License-Identifier: AGPL-3.0-only
// postprocess plugin: YOLO11 (anchor-free DFL) decode -> detections in frame pixels.
// Serves YOLO11s AND YOLO11m (same Detect head). Ported from the DECODE half of
// npu_compare.cpp yolo11_draw (:366-423); the drawing now lives in the overlay plugin.
// in = [ tensors(6 raw heads), frame(for dims) ] ; out = detections.
// heads: out[0..2] box[1,64,G,G] (4 sides x 16 DFL bins), out[3..5] cls[1,80,G,G], G=80/40/20.
// params: { "conf": 0.35, "nms": 0.45 }
#include <vector>
#include "../helix_pipeline.h"
#include "../hx_json.h"
#include "../hx_detect_common.h"

#define S 640

struct helix_node_ctx {
    float conf = 0.35f, nms = 0.45f;
    std::vector<helix_det_t> dets;   // borrowed by the consumer until the next call
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
    std::vector<hxd::Object> prop;
    for (int s = 0; s < 3; s++) {
        int G = GR[s], HW = G * G, st = ST[s];
        const float *box = o[0 + s];
        const float *cls = o[3 + s];
        for (int y = 0; y < G; y++)
            for (int x = 0; x < G; x++) {
                int cell = y * G + x;
                int bc = 0;
                float bs = cls[cell];
                for (int ci = 1; ci < 80; ci++) {
                    float v = cls[ci * HW + cell];
                    if (v > bs) { bs = v; bc = ci; }
                }
                float conf = hxd::sigmoid(bs);
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
                hxd::Object ob;
                ob.rect = cv::Rect_<float>((ax - dist[0]) * st, (ay - dist[1]) * st, (dist[0] + dist[2]) * st, (dist[1] + dist[3]) * st);
                ob.label = bc;
                ob.prob = conf;
                prop.push_back(ob);
            }
    }
    hxd::qsort_desc(prop);
    std::vector<int> picked;
    hxd::nms(prop, picked, c->nms);

    hxd::LB lb = hxd::lb_for(fw, fh, S);
    c->dets.clear();
    for (int idx : picked) {
        hxd::Object &ob = prop[idx];
        float x0 = hxd::clampf(lb.mx(ob.rect.x), 0, fw - 1.f);
        float y0 = hxd::clampf(lb.my(ob.rect.y), 0, fh - 1.f);
        float x1 = hxd::clampf(lb.mx(ob.rect.x + ob.rect.width), 0, fw - 1.f);
        float y1 = hxd::clampf(lb.my(ob.rect.y + ob.rect.height), 0, fh - 1.f);
        helix_det_t d{};
        d.x = x0; d.y = y0; d.w = x1 - x0; d.h = y1 - y0;
        d.cls = ob.label; d.score = ob.prob;
        d.kpts = nullptr; d.nkpt = 0;
        c->dets.push_back(d);
    }
    out->type = HX_PKT_DETS;
    out->dets.count = (int)c->dets.size();
    out->dets.dets = c->dets.data();
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "postprocess", "hx_post_yolo11",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
