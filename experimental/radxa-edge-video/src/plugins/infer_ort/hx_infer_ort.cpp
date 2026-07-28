// SPDX-License-Identifier: AGPL-3.0-only
// Infer plugin (x86): ONNX Runtime — the portable counterpart to hx_infer_awnn. Loads the
// cut-6-heads ONNX and picks the execution provider at runtime from what's installed (CUDA
// else CPU). Emits the same 6 raw heads as the awnn path, so hx_post_yolo11 consumes it unchanged.
#include <onnxruntime_cxx_api.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <map>
#include <memory>
#include <mutex>
#include "../helix_pipeline.h"
#include "../hx_json.h"

// One process-global env, and one Ort::Session shared across all streams that use the same model
// (Run is thread-safe): a single GPU memory arena, no per-session OOM on a 4 GB card.
static Ort::Env &genv() {
    static Ort::Env e(ORT_LOGGING_LEVEL_WARNING, "hx_ort");
    return e;
}
static std::mutex g_smtx;
static std::map<std::string, std::shared_ptr<Ort::Session>> g_sessions;
static std::map<std::string, std::string> g_sess_provider;

struct helix_node_ctx {
    std::shared_ptr<Ort::Session> session;   // shared across streams with the same model
    Ort::MemoryInfo mem{Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault)};
    std::string in_name;
    std::vector<std::string> out_names;
    std::vector<const char *> in_p, out_p;
    int S = 640;
    std::vector<float> in_f;                 // 1*3*S*S float32 NCHW, /255 RGB (per stream)
    std::vector<Ort::Value> outs;            // last run outputs (per stream, own the CPU tensors)
    std::vector<float *> heads;              // pointers into outs, returned to postprocess
    std::string provider;
};

static bool provider_available(const char *name) {
    auto v = Ort::GetAvailableProviders();
    return std::find(v.begin(), v.end(), name) != v.end();
}

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string model = hxj::jstr(p, "model");
    if (model.empty()) { fprintf(stderr, "[hx_infer_ort] missing 'model'\n"); return nullptr; }
    auto *c = new helix_node_ctx();
    c->S = hxj::jint(p, "size", 640);

    // Requested providers (in preference order); default CUDA then CPU.
    std::vector<std::string> want;
    if (const hxj::Value *pr = p.get("providers"))
        for (size_t i = 0; i < pr->size(); i++) want.push_back(pr->at(i)->as_str());
    if (want.empty()) { want = {"CUDA", "CPU"}; }

    bool share = hxj::jbool(p, "share_session", true);
    int cap_mb = hxj::jint(p, "gpu_mem_mb", 0);   // 0 = no cap
    // share_session=false -> a private session per stream (true overlap, but N arenas need VRAM).
    std::unique_lock<std::mutex> lk(g_smtx);
    std::string key = share ? model : (model + "#" + std::to_string((uintptr_t)c));
    auto it = g_sessions.find(key);
    if (it == g_sessions.end()) {
        Ort::SessionOptions so;
        so.SetIntraOpNumThreads(2);
        so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        c->provider = "CPU";
        for (auto &w : want) {
            if (w == "CUDA" && provider_available("CUDAExecutionProvider")) {
                OrtCUDAProviderOptions cu;
                memset(&cu, 0, sizeof(cu));
                cu.device_id = 0;
                cu.arena_extend_strategy = 1;   // kSameAsRequested (lean; no huge power-of-two grab)
                if (cap_mb > 0) cu.gpu_mem_limit = (size_t)cap_mb * 1024 * 1024;
                so.AppendExecutionProvider_CUDA(cu);
                c->provider = "CUDA";
                break;
            }
            if (w == "TensorRT" && provider_available("TensorrtExecutionProvider")) {
                OrtTensorRTProviderOptions trt;
                memset(&trt, 0, sizeof(trt));
                trt.device_id = 0;
                trt.trt_fp16_enable = 1;
                so.AppendExecutionProvider_TensorRT(trt);
                c->provider = "TensorRT";
                break;
            }
        }
        std::shared_ptr<Ort::Session> sess;
        try {
            sess = std::make_shared<Ort::Session>(genv(), model.c_str(), so);
        } catch (const Ort::Exception &e) {
            fprintf(stderr, "[hx_infer_ort] %s session failed (%s); CPU fallback\n", c->provider.c_str(), e.what());
            Ort::SessionOptions cpu;
            cpu.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
            sess = std::make_shared<Ort::Session>(genv(), model.c_str(), cpu);
            c->provider = "CPU";
        }
        g_sessions[key] = sess;
        g_sess_provider[key] = c->provider;
        fprintf(stderr, "[hx_infer_ort] loaded %s, provider=%s (%s)\n", model.c_str(), c->provider.c_str(), share ? "shared" : "private");
    } else {
        c->provider = g_sess_provider[key];
    }
    c->session = g_sessions[key];

    Ort::AllocatorWithDefaultOptions alloc;
    c->in_name = c->session->GetInputNameAllocated(0, alloc).get();
    c->in_p.push_back(c->in_name.c_str());
    size_t no = c->session->GetOutputCount();
    for (size_t i = 0; i < no; i++) c->out_names.push_back(c->session->GetOutputNameAllocated(i, alloc).get());
    for (auto &n : c->out_names) c->out_p.push_back(n.c_str());
    c->in_f.resize((size_t)3 * c->S * c->S);
    c->heads.resize(no);
    return c;
}
static void destroy(helix_node_ctx *c) { delete c; }

// Input = uint8 CHW RGB (from hx_pre_letterbox) -> f32/255.
static int infer_submit(helix_node_ctx *c, const helix_packet_t *in) {
    if (!in || in->type != HX_PKT_TENSOR) return -1;
    const unsigned char *u = (const unsigned char *)in->tensor.data;
    size_t n = (size_t)3 * c->S * c->S;
    for (size_t i = 0; i < n; i++) c->in_f[i] = u[i] * (1.0f / 255.0f);
    int64_t shape[4] = {1, 3, c->S, c->S};
    Ort::Value input = Ort::Value::CreateTensor<float>(c->mem, c->in_f.data(), n, shape, 4);
    c->outs = c->session->Run(Ort::RunOptions{nullptr}, c->in_p.data(), &input, 1, c->out_p.data(), c->out_p.size());
    return 1;
}
static int infer_collect(helix_node_ctx *c, helix_packet_t *out) {
    for (size_t i = 0; i < c->outs.size(); i++) c->heads[i] = c->outs[i].GetTensorMutableData<float>();
    out->type = HX_PKT_TENSORS;
    out->tensors.heads = c->heads.data();
    out->tensors.count = (int)c->heads.size();
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "infer", "hx_infer_ort",
    create, destroy, nullptr, infer_submit, infer_collect,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
