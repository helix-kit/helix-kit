// SPDX-License-Identifier: AGPL-3.0-only
// GPU-RESIDENT infer plugin (x86): fuses preprocess + inference on the GPU. Frame (BGR) is
// uploaded once, then cv::cuda does letterbox + BGR->RGB + /255 + HWC->CHW and ORT runs with
// IoBinding on the GPU input buffer (no host preprocess). Pair with hx_pre_passthrough. Emits
// the same 6 heads as the awnn / CPU-ORT paths, so downstream plugins are reused unchanged.
#include <onnxruntime_cxx_api.h>
#include <opencv2/opencv.hpp>
#include <opencv2/core/cuda.hpp>
#include <opencv2/cudawarping.hpp>
#include <opencv2/cudaimgproc.hpp>
#include <opencv2/cudaarithm.hpp>   // cv::cuda::split
#include <cuda_runtime.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <mutex>
#include "../helix_pipeline.h"
#include "../hx_json.h"

static Ort::Env &genv() { static Ort::Env e(ORT_LOGGING_LEVEL_WARNING, "hx_ortg"); return e; }
static std::mutex g_smtx;
static std::map<std::string, std::shared_ptr<Ort::Session>> g_sessions;

struct helix_node_ctx {
    std::shared_ptr<Ort::Session> session;
    int S = 640, dev = 0;
    std::string in_name;
    std::vector<std::string> out_names;
    std::vector<const char *> out_p;
    // GPU work buffers (per stream) + the CHW float input on device
    cv::cuda::GpuMat g_bgr, g_rgb, g_resized, g_canvas, g_float;
    float *d_input = nullptr;                 // device buffer, 3*S*S floats (CHW)
    Ort::MemoryInfo cuda_mem{nullptr};
    std::vector<Ort::Value> outs;             // CPU outputs (own the tensors)
    std::vector<float *> heads;
};

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    std::string model = hxj::jstr(p, "model");
    if (model.empty()) { fprintf(stderr, "[hx_infer_ort_gpu] missing 'model'\n"); return nullptr; }
    auto *c = new helix_node_ctx();
    c->S = hxj::jint(p, "size", 640);
    c->dev = hxj::jint(p, "device", 0);

    std::unique_lock<std::mutex> lk(g_smtx);
    auto it = g_sessions.find(model);
    if (it == g_sessions.end()) {
        Ort::SessionOptions so;
        so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        OrtCUDAProviderOptions cu;
        memset(&cu, 0, sizeof(cu));
        cu.device_id = c->dev;
        cu.arena_extend_strategy = 1;
        so.AppendExecutionProvider_CUDA(cu);
        auto sess = std::make_shared<Ort::Session>(genv(), model.c_str(), so);
        g_sessions[model] = sess;
        fprintf(stderr, "[hx_infer_ort_gpu] loaded %s on CUDA:%d (shared, GPU-resident preproc)\n", model.c_str(), c->dev);
    }
    c->session = g_sessions[model];

    Ort::AllocatorWithDefaultOptions alloc;
    c->in_name = c->session->GetInputNameAllocated(0, alloc).get();
    size_t no = c->session->GetOutputCount();
    for (size_t i = 0; i < no; i++) c->out_names.push_back(c->session->GetOutputNameAllocated(i, alloc).get());
    for (auto &n : c->out_names) c->out_p.push_back(n.c_str());
    c->heads.resize(no);

    cudaSetDevice(c->dev);
    cudaMalloc((void **)&c->d_input, (size_t)3 * c->S * c->S * sizeof(float));
    c->cuda_mem = Ort::MemoryInfo("Cuda", OrtDeviceAllocator, c->dev, OrtMemTypeDefault);
    c->g_canvas = cv::cuda::GpuMat(c->S, c->S, CV_8UC3);
    return c;
}
static void destroy(helix_node_ctx *c) {
    if (!c) return;
    if (c->d_input) cudaFree(c->d_input);
    delete c;
}

// GPU preprocess + ORT IoBinding run. `in` is a FRAME (BGR), forwarded by hx_pre_passthrough.
static int infer_submit(helix_node_ctx *c, const helix_packet_t *in) {
    if (!in || in->type != HX_PKT_FRAME) return -1;
    const helix_frame_t &f = in->frame;
    int S = c->S;
    cudaSetDevice(c->dev);
    // upload BGR (the only H2D of the frame) then do everything on the GPU
    cv::Mat host_bgr(f.h, f.w, CV_8UC3, f.data, f.stride);
    c->g_bgr.upload(host_bgr);
    cv::cuda::cvtColor(c->g_bgr, c->g_rgb, cv::COLOR_BGR2RGB);
    float sl = std::min(S * 1.f / f.h, S * 1.f / f.w);
    int rc = int(sl * f.w), rr = int(sl * f.h), left = (S - rc) / 2, top = (S - rr) / 2;
    cv::cuda::resize(c->g_rgb, c->g_resized, cv::Size(rc, rr));
    c->g_canvas.setTo(cv::Scalar(0, 0, 0));
    c->g_resized.copyTo(c->g_canvas(cv::Rect(left, top, rc, rr)));
    c->g_canvas.convertTo(c->g_float, CV_32FC3, 1.0 / 255.0);   // HWC float RGB, normalized
    // HWC -> CHW straight into the contiguous device input buffer (split writes each plane)
    cv::cuda::GpuMat chans[3];
    for (int ch = 0; ch < 3; ch++)
        chans[ch] = cv::cuda::GpuMat(S, S, CV_32F, c->d_input + (size_t)ch * S * S, S * sizeof(float));
    cv::cuda::split(c->g_float, chans);
    cudaDeviceSynchronize();   // ensure cv::cuda work is done before ORT reads d_input

    int64_t shape[4] = {1, 3, S, S};
    Ort::Value input = Ort::Value::CreateTensor<float>(c->cuda_mem, c->d_input, (size_t)3 * S * S, shape, 4);
    Ort::IoBinding binding(*c->session);
    binding.BindInput(c->in_name.c_str(), input);
    Ort::MemoryInfo cpu = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    for (auto &n : c->out_names) binding.BindOutput(n.c_str(), cpu);   // heads to CPU for postprocess
    c->session->Run(Ort::RunOptions{nullptr}, binding);
    c->outs = binding.GetOutputValues();
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
    HELIX_ABI_VERSION, "infer", "hx_infer_ort_gpu",
    create, destroy, nullptr, infer_submit, infer_collect,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
