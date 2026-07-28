// SPDX-License-Identifier: AGPL-3.0-only
// compositor plugin: N annotated cell frames -> one cols x rows grid frame.
// Ported from the composite half of npu_compare.cpp outputter (:651-658). Keeps a persistent
// grid so cells with no fresh frame (data==NULL) retain their last content.
// in = [ frame0, frame1, ... frameN ] ; out = grid frame (borrowed until next call).
// params: { "cols": 2, "rows": 2, "grid_w": 1280, "grid_h": 720 }
#include <opencv2/opencv.hpp>
#include "../helix_pipeline.h"
#include "../hx_json.h"

struct helix_node_ctx {
    int cols = 2, rows = 2, gw = 1280, gh = 720;
    cv::Mat grid;
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->cols = hxj::jint(p, "cols", 2);
    c->rows = hxj::jint(p, "rows", 2);
    c->gw = hxj::jint(p, "grid_w", 1280);
    c->gh = hxj::jint(p, "grid_h", 720);
    c->grid = cv::Mat(c->gh, c->gw, CV_8UC3, cv::Scalar(20, 20, 20));
    return c;
}
static void destroy(helix_node_ctx *c) { delete c; }

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    int cw = c->gw / c->cols, ch = c->gh / c->rows;
    int cells = c->cols * c->rows;
    for (int i = 0; i < n_in && i < cells; i++) {
        if (in[i].type != HX_PKT_FRAME || !in[i].frame.data) continue;
        const helix_frame_t &f = in[i].frame;
        cv::Mat src(f.h, f.w, CV_8UC3, f.data, f.stride);
        int cx = (i % c->cols) * cw, cy = (i / c->cols) * ch;
        cv::resize(src, c->grid(cv::Rect(cx, cy, cw, ch)), cv::Size(cw, ch));
    }
    out->type = HX_PKT_FRAME;
    out->frame.data = c->grid.data;
    out->frame.w = c->gw;
    out->frame.h = c->gh;
    out->frame.stride = (int)c->grid.step;
    out->frame.format = HX_FMT_BGR;
    out->frame.pts = 0;
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "compositor", "hx_comp_grid",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
