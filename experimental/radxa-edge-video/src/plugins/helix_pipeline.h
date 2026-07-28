// SPDX-License-Identifier: AGPL-3.0-only
// Helix edge-video pipeline — stable C ABI for runtime-loaded (dlopen) stage plugins.
// A pipeline is a graph of NODES; each node is a .so exporting exactly one symbol:
//     extern "C" const helix_node_vtable* helix_node_entry(void);
// Only this boundary is C so .so's stay swappable without name-mangling/vtable hazards.
#ifndef HELIX_PIPELINE_H
#define HELIX_PIPELINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HELIX_ABI_VERSION 1

// pixel formats for helix_frame_t.format
enum { HX_FMT_BGR = 0, HX_FMT_RGB, HX_FMT_NV12, HX_FMT_GRAY };
// tensor element types for helix_tensor_t.dtype
enum { HX_DT_U8 = 0, HX_DT_F32 };
// helix_packet_t.type discriminant
enum { HX_PKT_NONE = 0, HX_PKT_FRAME, HX_PKT_TENSOR, HX_PKT_TENSORS, HX_PKT_DETS };

// A decoded image frame. `data` is borrowed (valid until the producing node's next call);
// data==NULL means "no frame this tick".
typedef struct {
    uint8_t *data;
    int w, h, stride, format;
    int64_t pts;
} helix_frame_t;

// A single dense tensor (e.g. the preprocessed model input).
typedef struct {
    void *data;
    int dtype;      // HX_DT_*
    int ndim;
    int dims[8];
    float scale;
    int zero_point;
} helix_tensor_t;

// The raw NPU output heads (float**), matching awnn_get_output_buffers(). `count` may be 0
// when the producer doesn't report it (postprocess plugins know their own head layout).
typedef struct {
    int count;
    float **heads;
} helix_tensors_t;

// One detection in ORIGINAL-FRAME pixel coordinates (letterbox-inverse already applied).
// kpts (optional) = nkpt*(x,y,conf) triples in frame pixels, for pose.
typedef struct {
    float x, y, w, h;
    int cls;
    float score;
    const float *kpts;
    int nkpt;
} helix_det_t;

typedef struct {
    int count;
    const helix_det_t *dets;   // borrowed (valid until the producing node's next call)
} helix_detections_t;

// Tagged payload carried along a graph edge.
typedef struct {
    int type;   // HX_PKT_*
    union {
        helix_frame_t frame;
        helix_tensor_t tensor;
        helix_tensors_t tensors;
        helix_detections_t dets;
    };
} helix_packet_t;

typedef struct helix_node_ctx helix_node_ctx;   // opaque per-instance plugin state

// One vtable per node .so (mirrors helix_transport_t). Unused fn pointers are NULL.
typedef struct {
    int abi_version;      // must equal HELIX_ABI_VERSION
    const char *kind;     // "source"|"preprocess"|"infer"|"postprocess"|"overlay"|"compositor"|"sink"
    const char *name;     // e.g. "hx_src_gst"

    helix_node_ctx *(*create)(const char *params_json);
    void (*destroy)(helix_node_ctx *);

    // Consume `n_in` input packets, produce one in `*out`. Returns 1 (produced), 0 (nothing
    // this call, e.g. a source with no frame ready), <0 on error.
    int (*process)(helix_node_ctx *, const helix_packet_t *in, int n_in, helix_packet_t *out);

    // INFER specialization (NULL for other kinds): the run_hw/finish split lets the host hold
    // the single-NPU mutex around infer_submit only, calling infer_collect outside the lock.
    int (*infer_submit)(helix_node_ctx *, const helix_packet_t *in);   // NPU HW run
    int (*infer_collect)(helix_node_ctx *, helix_packet_t *out);       // output -> fp32 heads
} helix_node_vtable;

typedef const helix_node_vtable *(*helix_node_entry_fn)(void);

#ifdef __cplusplus
}
#endif
#endif // HELIX_PIPELINE_H
