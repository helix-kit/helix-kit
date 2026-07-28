// SPDX-License-Identifier: AGPL-3.0-only
// preprocess plugin: BGR frame -> letterboxed SxS CHW uint8 RGB tensor.
// Ported verbatim from npu_compare.cpp:161 preprocess().  params: { "size": 640 }
#include <opencv2/opencv.hpp>
#include <cstdlib>
#include "../helix_pipeline.h"
#include "../hx_json.h"

struct helix_node_ctx {
    int S = 640;
    unsigned char *buf = nullptr;   // SxSx3 CHW uint8, borrowed by the consumer until next call
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->S = hxj::jint(p, "size", 640);
    c->buf = (unsigned char *)malloc((size_t)c->S * c->S * 3);
    return c;
}
static void destroy(helix_node_ctx *c) {
    if (!c) return;
    free(c->buf);
    delete c;
}

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 1 || in[0].type != HX_PKT_FRAME) return -1;
    const helix_frame_t &f = in[0].frame;
    int S = c->S;
    cv::Mat bgr(f.h, f.w, CV_8UC3, f.data, f.stride);
    cv::Mat img;
    cv::cvtColor(bgr, img, cv::COLOR_BGR2RGB);
    float sl = std::min(S * 1.f / img.rows, S * 1.f / img.cols);
    int rc = int(sl * img.cols), rr = int(sl * img.rows);
    cv::resize(img, img, cv::Size(rc, rr));
    cv::Mat canvas(S, S, CV_8UC3, cv::Scalar(0, 0, 0));
    int top = (S - rr) / 2, left = (S - rc) / 2;
    img.copyTo(canvas(cv::Rect(left, top, rc, rr)));
    unsigned char *o = c->buf;
    for (int h = 0; h < S; h++)
        for (int w = 0; w < S; w++) {
            const cv::Vec3b &pix = canvas.at<cv::Vec3b>(h, w);
            for (int ch = 0; ch < 3; ch++) o[ch * S * S + h * S + w] = pix[ch];
        }
    out->type = HX_PKT_TENSOR;
    out->tensor.data = c->buf;
    out->tensor.dtype = HX_DT_U8;
    out->tensor.ndim = 4;
    out->tensor.dims[0] = 1; out->tensor.dims[1] = 3; out->tensor.dims[2] = S; out->tensor.dims[3] = S;
    out->tensor.scale = 1.f;
    out->tensor.zero_point = 0;
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "preprocess", "hx_pre_letterbox",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
