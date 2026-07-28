// SPDX-License-Identifier: AGPL-3.0-only
// preprocess plugin: passthrough. Forwards the FRAME unchanged so a fused GPU infer node
// (hx_infer_ort_gpu) can do the preprocessing itself on the GPU. Keeps the host's fixed
// source->preprocess->infer topology intact.
#include "../helix_pipeline.h"

struct helix_node_ctx { int _; };
static helix_node_ctx *create(const char *) { return new helix_node_ctx(); }
static void destroy(helix_node_ctx *c) { delete c; }
static int process(helix_node_ctx *, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (n_in < 1) return -1;
    out[0] = in[0];   // forward the frame
    return 1;
}
static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "preprocess", "hx_pre_passthrough",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
