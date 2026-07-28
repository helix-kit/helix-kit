// SPDX-License-Identifier: AGPL-3.0-only
// overlay plugin: draw detection boxes + class labels on the frame (in place).
// This is the DRAW half split out of detect_draw/yolo11_draw (npu_compare.cpp:193-205,
// :411-421) so "what's on the overlay" is independently swappable and the detections stay
// first-class. in = [ frame, detections ] ; draws in place, out = frame (pass-through).
// params: { "color": "green" | "orange" | "red" | "blue" | "cyan" | "yellow" }
#include <opencv2/opencv.hpp>
#include <cstdio>
#include <string>
#include "../helix_pipeline.h"
#include "../hx_json.h"

static const char *CLS[] = {"person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"};

static cv::Scalar color_by_name(const std::string &n) {
    if (n == "orange") return cv::Scalar(0, 165, 255);
    if (n == "red") return cv::Scalar(0, 0, 255);
    if (n == "blue") return cv::Scalar(255, 0, 0);
    if (n == "cyan") return cv::Scalar(255, 255, 0);
    if (n == "yellow") return cv::Scalar(0, 255, 255);
    return cv::Scalar(0, 255, 0); // green
}

struct helix_node_ctx {
    cv::Scalar color;
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->color = color_by_name(hxj::jstr(p, "color", "green"));
    return c;
}
static void destroy(helix_node_ctx *c) { delete c; }

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 2 || in[0].type != HX_PKT_FRAME || in[1].type != HX_PKT_DETS) return -1;
    const helix_frame_t &f = in[0].frame;
    cv::Mat bgr(f.h, f.w, CV_8UC3, f.data, f.stride);
    const helix_detections_t &ds = in[1].dets;
    for (int i = 0; i < ds.count; i++) {
        const helix_det_t &d = ds.dets[i];
        cv::rectangle(bgr, cv::Point(d.x, d.y), cv::Point(d.x + d.w, d.y + d.h), c->color, 2);
        const char *name = (d.cls >= 0 && d.cls < 80) ? CLS[d.cls] : "?";
        char t[128];
        snprintf(t, sizeof(t), "%s %.0f%%", name, d.score * 100);
        cv::putText(bgr, t, cv::Point(d.x, std::max(12.f, d.y - 4)), cv::FONT_HERSHEY_SIMPLEX, 0.5, c->color, 1);
    }
    if (out) out[0] = in[0];   // pass the frame through
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "overlay", "hx_overlay_boxes",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
