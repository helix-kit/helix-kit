// SPDX-License-Identifier: AGPL-3.0-only
// overlay plugin: draw person box + 17-keypoint skeleton (in place).
// DRAW half split out of pose_draw (npu_compare.cpp:344-358). Consumes detections whose
// kpts = 17*(x,y,conf) in frame pixels. in = [ frame, detections ] ; out = frame.
#include <opencv2/opencv.hpp>
#include "../helix_pipeline.h"
#include "../hx_json.h"

// COCO 17-keypoint skeleton limbs (pairs of keypoint indices).
static const int SKELETON[19][2] = {{15,13},{13,11},{16,14},{14,12},{11,12},{5,11},{6,12},{5,6},{5,7},{6,8},{7,9},{8,10},{1,2},{0,1},{0,2},{1,3},{2,4},{3,5},{4,6}};

struct helix_node_ctx { int _unused; };

static helix_node_ctx *create(const char *) { return new helix_node_ctx(); }
static void destroy(helix_node_ctx *c) { delete c; }

static int process(helix_node_ctx *, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 2 || in[0].type != HX_PKT_FRAME || in[1].type != HX_PKT_DETS) return -1;
    const helix_frame_t &f = in[0].frame;
    cv::Mat bgr(f.h, f.w, CV_8UC3, f.data, f.stride);
    const helix_detections_t &ds = in[1].dets;
    for (int i = 0; i < ds.count; i++) {
        const helix_det_t &d = ds.dets[i];
        cv::rectangle(bgr, cv::Point(d.x, d.y), cv::Point(d.x + d.w, d.y + d.h), cv::Scalar(0, 200, 255), 2);
        if (!d.kpts || d.nkpt < 17) continue;
        const float *k = d.kpts;   // 17*(x,y,conf)
        for (auto &s : SKELETON)
            if (k[s[0] * 3 + 2] > 0.5f && k[s[1] * 3 + 2] > 0.5f)
                cv::line(bgr, cv::Point(k[s[0] * 3], k[s[0] * 3 + 1]),
                         cv::Point(k[s[1] * 3], k[s[1] * 3 + 1]), cv::Scalar(255, 128, 0), 2);
        for (int j = 0; j < 17; j++)
            if (k[j * 3 + 2] > 0.5f)
                cv::circle(bgr, cv::Point(k[j * 3], k[j * 3 + 1]), 3, cv::Scalar(0, 0, 255), -1);
    }
    if (out) out[0] = in[0];
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "overlay", "hx_overlay_pose",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
