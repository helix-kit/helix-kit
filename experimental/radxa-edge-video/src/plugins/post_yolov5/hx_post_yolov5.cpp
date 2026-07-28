// SPDX-License-Identifier: AGPL-3.0-only
// postprocess plugin: YOLOv5 (anchor-based) decode -> detections in frame pixels.
// Ported from the DECODE half of npu_compare.cpp detect_draw + gen_proposals (:110-207);
// the drawing now lives in the overlay plugin. heads: out[0]=stride8, out[1]=16, out[2]=32,
// each [anchor*(h*w*85)] with 85 = 4 box + 1 obj + 80 cls.
// in = [ tensors(3 heads), frame ] ; out = detections.  params: { "conf": 0.4, "nms": 0.45 }
#include <vector>
#include "../helix_pipeline.h"
#include "../hx_json.h"
#include "../hx_detect_common.h"

#define S 640

struct helix_node_ctx {
    float conf = 0.4f, nms = 0.45f;
    std::vector<helix_det_t> dets;
};

static void gen_proposals(int stride, const float *feat, float pth, std::vector<hxd::Object> &objs, int lc, int lr) {
    static float anchors[18] = {10, 13, 16, 30, 33, 23, 30, 61, 62, 45, 59, 119, 116, 90, 156, 198, 373, 326};
    int anum = 3, fw = lc / stride, fh = lr / stride, cls = 80, ag = (stride == 8 ? 1 : stride == 16 ? 2 : 3);
    float dth = hxd::desigmoid(pth);
    int fs = fw * fh, fsc5 = fs * (cls + 5);
    for (int h = 0; h < fh; h++) {
        int hfw = h * fw * (cls + 5);
        for (int w = 0; w < fw; w++) {
            int wc5 = w * (cls + 5);
            for (int a = 0; a < anum; a++) {
                int ci = 0;
                float cs = -FLT_MAX;
                int ai = a * fsc5 + hfw + wc5;
                const float *fp = &feat[ai + 4];
                for (int s = 0; s < cls; s++)
                    if (*(fp + s + 1) > cs) { ci = s; cs = *(fp + s + 1); }
                float bs = *fp, final = 0.f;
                if (bs >= dth && cs >= dth) final = hxd::sigmoid(bs) * hxd::sigmoid(cs);
                if (final >= pth) {
                    int li = ai;
                    float dx = hxd::sigmoid(feat[li]), dy = hxd::sigmoid(feat[li + 1]), dw = hxd::sigmoid(feat[li + 2]), dh = hxd::sigmoid(feat[li + 3]);
                    float pcx = (dx * 2.f - 0.5f + w) * stride, pcy = (dy * 2.f - 0.5f + h) * stride;
                    float aw = anchors[(ag - 1) * 6 + a * 2], ah = anchors[(ag - 1) * 6 + a * 2 + 1];
                    float pw = dw * dw * 4.f * aw, ph = dh * dh * 4.f * ah;
                    hxd::Object o;
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

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->conf = (float)hxj::jnum(p, "conf", 0.4);
    c->nms = (float)hxj::jnum(p, "nms", 0.45);
    return c;
}
static void destroy(helix_node_ctx *c) { delete c; }

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 2 || in[0].type != HX_PKT_TENSORS || in[1].type != HX_PKT_FRAME) return -1;
    float **o = in[0].tensors.heads;
    int fw = in[1].frame.w, fh = in[1].frame.h;

    std::vector<hxd::Object> prop;
    gen_proposals(32, o[2], c->conf, prop, S, S);
    gen_proposals(16, o[1], c->conf, prop, S, S);
    gen_proposals(8, o[0], c->conf, prop, S, S);
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
    HELIX_ABI_VERSION, "postprocess", "hx_post_yolov5",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
