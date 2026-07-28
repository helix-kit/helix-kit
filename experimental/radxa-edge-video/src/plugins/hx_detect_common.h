// SPDX-License-Identifier: AGPL-3.0-only
// Shared, header-only decode helpers for the YOLO postprocess plugins (sigmoid, sort, NMS,
// and the letterbox-inverse mapping from SxS model space back to original-frame pixels).
#ifndef HX_DETECT_COMMON_H
#define HX_DETECT_COMMON_H

#include <opencv2/opencv.hpp>
#include <vector>
#include <cmath>
#include <cfloat>

namespace hxd {

struct Object {
    cv::Rect_<float> rect;   // in SxS letterbox space
    int label;
    float prob;
};

static inline float sigmoid(float x) { return 1.f / (1.f + expf(-x)); }
static inline float desigmoid(float x) { return -logf(1.f / x - 1.f); }

static inline void qsort_desc(std::vector<Object> &f, int l, int r) {
    int i = l, j = r;
    float p = f[(l + r) / 2].prob;
    while (i <= j) {
        while (f[i].prob > p) i++;
        while (f[j].prob < p) j--;
        if (i <= j) { std::swap(f[i], f[j]); i++; j--; }
    }
    if (l < j) qsort_desc(f, l, j);
    if (i < r) qsort_desc(f, i, r);
}
static inline void qsort_desc(std::vector<Object> &f) {
    if (!f.empty()) qsort_desc(f, 0, (int)f.size() - 1);
}
static inline void nms(const std::vector<Object> &o, std::vector<int> &picked, float thr) {
    picked.clear();
    int n = (int)o.size();
    std::vector<float> areas(n);
    for (int i = 0; i < n; i++) areas[i] = o[i].rect.area();
    for (int i = 0; i < n; i++) {
        int keep = 1;
        for (size_t j = 0; j < picked.size(); j++) {
            cv::Rect_<float> I = o[i].rect & o[picked[j]].rect;
            float ia = I.area(), ua = areas[i] + areas[picked[j]] - ia;
            if (ia / ua > thr) { keep = 0; break; }
        }
        if (keep) picked.push_back(i);
    }
}

// Letterbox-inverse: map a coordinate from SxS model space back to the original frame.
struct LB {
    float rx, ry;
    int tw, th;
    float mx(float x) const { return (x - tw) * rx; }
    float my(float y) const { return (y - th) * ry; }
};
static inline LB lb_for(int fw, int fh, int S) {
    float sl = std::min(S * 1.f / fh, S * 1.f / fw);
    int rc = int(sl * fw), rr = int(sl * fh);
    LB l;
    l.tw = (S - rc) / 2;
    l.th = (S - rr) / 2;
    l.rx = (float)fw / rc;
    l.ry = (float)fh / rr;
    return l;
}
static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

} // namespace hxd

#endif // HX_DETECT_COMMON_H
