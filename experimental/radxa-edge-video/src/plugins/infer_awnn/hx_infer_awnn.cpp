// SPDX-License-Identifier: AGPL-3.0-only
// infer plugin: the awnn/VIPLite NPU runner. One instance == one awnn context (one .nb),
// so swapping the detection MODEL is just changing the "nb" param (no host recompile).
// Ported from npu_compare.cpp worker awnn calls (:614-625). Uses the run_hw/finish split:
//   infer_submit = set_input + awnn_run_hw   (host holds the single-NPU mutex here)
//   infer_collect = awnn_finish + awnn_get_output_buffers   (fp32 read-back, outside lock)
// params: { "nb": "/path/model.nb" }
#include <awnn_lib.h>
#include <pthread.h>
#include <cstdio>
#include <string>
#include "../helix_pipeline.h"
#include "../hx_json.h"

// awnn_init()/awnn_uninit() are process-global; ref-count across all infer instances.
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static int g_refs = 0;

struct helix_node_ctx {
    Awnn_Context_t *ctx = nullptr;
    std::string nb;
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string nb = hxj::jstr(p, "nb");
    if (nb.empty()) { fprintf(stderr, "[hx_infer_awnn] missing 'nb'\n"); return nullptr; }
    pthread_mutex_lock(&g_lock);
    if (g_refs == 0) awnn_init();
    g_refs++;
    pthread_mutex_unlock(&g_lock);
    Awnn_Context_t *ac = awnn_create(nb.c_str());
    if (!ac) {
        fprintf(stderr, "[hx_infer_awnn] awnn_create failed: %s\n", nb.c_str());
        pthread_mutex_lock(&g_lock);
        if (--g_refs == 0) awnn_uninit();
        pthread_mutex_unlock(&g_lock);
        return nullptr;
    }
    auto *c = new helix_node_ctx();
    c->ctx = ac;
    c->nb = nb;
    return c;
}
static void destroy(helix_node_ctx *c) {
    if (!c) return;
    if (c->ctx) awnn_destroy(c->ctx);
    pthread_mutex_lock(&g_lock);
    if (--g_refs == 0) awnn_uninit();
    pthread_mutex_unlock(&g_lock);
    delete c;
}

// NPU HW run (host holds mtx_npu around this call).
static int infer_submit(helix_node_ctx *c, const helix_packet_t *in) {
    if (!in || in->type != HX_PKT_TENSOR) return -1;
    void *ib[] = {in->tensor.data};
    awnn_set_input_buffers(c->ctx, ib);
    awnn_run_hw(c->ctx);
    return 1;
}
// fp32 output read-back (host calls this OUTSIDE the NPU lock).
static int infer_collect(helix_node_ctx *c, helix_packet_t *out) {
    awnn_finish(c->ctx);
    out->type = HX_PKT_TENSORS;
    out->tensors.heads = awnn_get_output_buffers(c->ctx);
    out->tensors.count = 0;   // postprocess knows its own head layout
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "infer", "hx_infer_awnn",
    create, destroy, nullptr, infer_submit, infer_collect,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
