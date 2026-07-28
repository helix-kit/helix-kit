// SPDX-License-Identifier: AGPL-3.0-only
// Helix edge-video pipeline HOST runtime.
//   helix_pipeline <config.json> [host_ip]
// Loads a JSON pipeline, dlopen()s the .so named for each node, checks the ABI, and drives
// the graph with the exact threading model ported from npu_compare.cpp (per-stream worker
// threads + single-NPU mutex + a compositor/sink outputter thread) — so performance is
// preserved while every stage is a runtime-swappable module. The config is the seam a future
// React graph editor will emit. `${HOST}` in the config is replaced by [host_ip] (default
// 192.168.1.35) so one config is portable across boards.
#include <gst/gst.h>
#include <opencv2/opencv.hpp>
#include <dlfcn.h>
#include <pthread.h>
#include <unistd.h>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <time.h>
#include "helix_pipeline.h"
#include "hx_json.h"

struct LoadedNode {
    void *handle = nullptr;
    const helix_node_vtable *vt = nullptr;
    helix_node_ctx *inst = nullptr;
    std::string module;
};
struct StreamNodes {
    LoadedNode source, preprocess, infer, postprocess, overlay;
    std::string label;
};

static std::vector<StreamNodes> g_streams;
static LoadedNode g_compositor, g_sink;

static volatile int running = 1, teardown_done = 0;
static pthread_mutex_t mtx_npu = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t mtx_latest = PTHREAD_MUTEX_INITIALIZER;
static std::vector<cv::Mat> latest;
static std::vector<int> g_updated;                  // 1 = cell has a new annotated frame since last output tick
static std::vector<long> g_inf, g_det, g_time_us;   // per-stream counters (stable addresses)
static bool g_serialize_infer = true;               // true = one infer at a time (single NPU); false = concurrent (GPU)

static double now_ms() {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}
static void on_sig(int) { running = 0; }

static std::string g_bindir = ".";
// Make a path absolute (relative -> cwd/path). Under sudo the loader runs in secure-execution
// mode and refuses cwd-relative dlopen paths, so every candidate must be absolute.
static std::string absolutize(const std::string &p) {
    if (!p.empty() && p[0] == '/') return p;
    char cwd[4096];
    if (getcwd(cwd, sizeof(cwd))) return std::string(cwd) + "/" + p;
    return p;
}
static void *dlopen_module(const std::string &module) {
    std::vector<std::string> dirs;
    if (const char *e = getenv("HELIX_PLUGIN_DIR")) dirs.push_back(e);
    dirs.push_back(g_bindir);
    dirs.push_back(".");
    for (auto &d : dirs) {
        std::string path = absolutize(d) + "/" + module + ".so";
        char canon[4096];
        if (realpath(path.c_str(), canon)) {   // clean, existing absolute path (sudo-safe)
            void *h = dlopen(canon, RTLD_NOW | RTLD_GLOBAL);
            if (h) return h;
            fprintf(stderr, "[host] dlopen %s: %s\n", canon, dlerror());
        }
    }
    // last resort: bare name via loader search path
    return dlopen((module + ".so").c_str(), RTLD_NOW | RTLD_GLOBAL);
}

// Load one node .so, verify ABI, instantiate with its params (as a JSON string).
static bool load_node(LoadedNode &n, const hxj::Value &spec, const char *want_kind) {
    n.module = hxj::jstr(spec, "module");
    if (n.module.empty()) { fprintf(stderr, "[host] node missing 'module' (kind %s)\n", want_kind); return false; }
    n.handle = dlopen_module(n.module);
    if (!n.handle) { fprintf(stderr, "[host] dlopen %s failed: %s\n", n.module.c_str(), dlerror()); return false; }
    auto entry = (helix_node_entry_fn)dlsym(n.handle, "helix_node_entry");
    if (!entry) { fprintf(stderr, "[host] %s: no helix_node_entry\n", n.module.c_str()); return false; }
    n.vt = entry();
    if (!n.vt || n.vt->abi_version != HELIX_ABI_VERSION) {
        fprintf(stderr, "[host] %s: ABI mismatch (got %d want %d)\n", n.module.c_str(), n.vt ? n.vt->abi_version : -1, HELIX_ABI_VERSION);
        return false;
    }
    if (want_kind && strcmp(n.vt->kind, want_kind) != 0)
        fprintf(stderr, "[host] warn: %s kind '%s' used as '%s'\n", n.module.c_str(), n.vt->kind, want_kind);
    const hxj::Value *params = spec.get("params");
    std::string pjson = params ? hxj::dump(*params) : std::string("{}");
    n.inst = n.vt->create(pjson.c_str());
    if (!n.inst) { fprintf(stderr, "[host] %s: create failed\n", n.module.c_str()); return false; }
    return true;
}
static void destroy_node(LoadedNode &n) {
    if (n.vt && n.inst) n.vt->destroy(n.inst);
    n.inst = nullptr;
}

// NPU worker: source -> preprocess -> {lock; infer_submit; unlock; infer_collect} ->
// postprocess -> overlay -> publish annotated frame. One per stream. Mirrors npu_compare worker.
static void *worker(void *arg) {
    int i = (int)(intptr_t)arg;
    StreamNodes &sn = g_streams[i];
    while (running) {
        helix_packet_t fpkt{};
        if (sn.source.vt->process(sn.source.inst, nullptr, 0, &fpkt) <= 0) continue;
        cv::Mat src(fpkt.frame.h, fpkt.frame.w, CV_8UC3, fpkt.frame.data, fpkt.frame.stride);
        cv::Mat work = src.clone();   // owns pixels: overlay draws here; survives source re-pull
        helix_packet_t wpkt{};
        wpkt.type = HX_PKT_FRAME;
        wpkt.frame = {work.data, work.cols, work.rows, (int)work.step, HX_FMT_BGR, 0};

        helix_packet_t tpkt{};
        if (sn.preprocess.vt->process(sn.preprocess.inst, &wpkt, 1, &tpkt) <= 0) continue;

        if (g_serialize_infer) pthread_mutex_lock(&mtx_npu);
        double t0 = now_ms();
        sn.infer.vt->infer_submit(sn.infer.inst, &tpkt);
        double hw = now_ms() - t0;
        if (g_serialize_infer) pthread_mutex_unlock(&mtx_npu);
        double t1 = now_ms();
        helix_packet_t otpkt{};
        sn.infer.vt->infer_collect(sn.infer.inst, &otpkt);
        double fin = now_ms() - t1;

        helix_packet_t pin[2] = {otpkt, wpkt};
        helix_packet_t dpkt{};
        if (sn.postprocess.vt->process(sn.postprocess.inst, pin, 2, &dpkt) <= 0) continue;

        helix_packet_t oin[2] = {wpkt, dpkt};
        helix_packet_t opkt{};
        sn.overlay.vt->process(sn.overlay.inst, oin, 2, &opkt);

        int tw = work.cols > 16 ? work.cols - 16 : work.cols;   // trim MB padding (matches monolith)
        int th = work.rows > 16 ? work.rows - 16 : work.rows;
        pthread_mutex_lock(&mtx_latest);
        work(cv::Rect(0, 0, tw, th)).copyTo(latest[i]);
        g_updated[i] = 1;
        pthread_mutex_unlock(&mtx_latest);
        __sync_add_and_fetch(&g_inf[i], 1);
        __sync_add_and_fetch(&g_det[i], dpkt.dets.count);
        __sync_add_and_fetch(&g_time_us[i], (long)((hw + fin) * 1000.0));
    }
    return nullptr;
}

// Compositor + sink thread: snapshot the annotated cells, compose the grid, encode+push. ~30fps.
static void *outputter(void *) {
    int N = (int)g_streams.size();
    std::vector<helix_packet_t> cells(N);
    while (running) {
        // Composite UNDER the lock (like the monolith's outputter) — the compositor reads each
        // fresh latest[] cell directly and resizes it into its persistent grid, so there is NO
        // snapshot copy. Only cells updated since the last tick are passed (others -> null ->
        // compositor keeps their last content). The slow part (encode) runs outside the lock.
        pthread_mutex_lock(&mtx_latest);
        for (int i = 0; i < N; i++) {
            cells[i].type = HX_PKT_FRAME;
            if (g_updated[i] && !latest[i].empty()) {
                cells[i].frame = {latest[i].data, latest[i].cols, latest[i].rows, (int)latest[i].step, HX_FMT_BGR, 0};
                g_updated[i] = 0;
            } else {
                cells[i].frame = {nullptr, 0, 0, 0, HX_FMT_BGR, 0};
            }
        }
        helix_packet_t grid{};
        int ok = g_compositor.vt->process(g_compositor.inst, cells.data(), N, &grid);
        pthread_mutex_unlock(&mtx_latest);
        if (ok > 0) g_sink.vt->process(g_sink.inst, &grid, 1, nullptr);
        usleep(33000);
    }
    return nullptr;
}
static void *watchdog(void *a) {
    int s = (int)(intptr_t)a;
    for (int i = 0; i < s * 10; i++) { if (teardown_done) return nullptr; usleep(100000); }
    fprintf(stderr, "[WATCHDOG] teardown hung >%ds — _exit\n", s);
    _exit(3);
}

static std::string read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return "";
    std::string s;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) s.append(buf, n);
    fclose(f);
    return s;
}
static void replace_all(std::string &s, const std::string &from, const std::string &to) {
    size_t pos = 0;
    while ((pos = s.find(from, pos)) != std::string::npos) { s.replace(pos, from.size(), to); pos += to.size(); }
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <config.json> [host_ip]\n", argv[0]); return 2; }
    { std::string a0 = argv[0]; size_t p = a0.find_last_of('/'); if (p != std::string::npos) g_bindir = a0.substr(0, p); }
    const char *host_ip = argc > 2 ? argv[2] : (getenv("HELIX_HOST") ? getenv("HELIX_HOST") : "192.168.1.35");

    std::string cfg_text = read_file(argv[1]);
    if (cfg_text.empty()) { fprintf(stderr, "[host] cannot read config %s\n", argv[1]); return 2; }
    replace_all(cfg_text, "${HOST}", host_ip);
    bool ok = false;
    hxj::Value cfg = hxj::parse(cfg_text.c_str(), &ok);
    if (!ok) { fprintf(stderr, "[host] config parse error\n"); return 2; }

    gst_init(&argc, &argv);
    signal(SIGINT, on_sig);
    signal(SIGTERM, on_sig);

    const hxj::Value *streams = cfg.get("streams");
    if (!streams || streams->type != hxj::Value::Arr || streams->size() == 0) {
        fprintf(stderr, "[host] config needs a non-empty 'streams' array\n");
        return 2;
    }
    int N = (int)streams->size();
    g_streams.resize(N);
    latest.resize(N);
    g_updated.assign(N, 0);
    g_inf.assign(N, 0);
    g_det.assign(N, 0);
    g_time_us.assign(N, 0);

    for (int i = 0; i < N; i++) {
        const hxj::Value &s = *streams->at(i);
        StreamNodes &sn = g_streams[i];
        sn.label = hxj::jstr(s, "label", std::to_string(i).c_str());
        const hxj::Value *src = s.get("source"), *pre = s.get("preprocess"), *inf = s.get("infer"),
                         *post = s.get("postprocess"), *ovl = s.get("overlay");
        if (!src || !pre || !inf || !post || !ovl) { fprintf(stderr, "[host] stream %d missing a node\n", i); return 2; }
        if (!load_node(sn.source, *src, "source") || !load_node(sn.preprocess, *pre, "preprocess") ||
            !load_node(sn.infer, *inf, "infer") || !load_node(sn.postprocess, *post, "postprocess") ||
            !load_node(sn.overlay, *ovl, "overlay")) return 2;
        if (!sn.infer.vt->infer_submit || !sn.infer.vt->infer_collect) {
            fprintf(stderr, "[host] stream %d infer node '%s' has no submit/collect\n", i, sn.infer.module.c_str());
            return 2;
        }
        fprintf(stderr, "stream %d [%s]: %s -> %s -> %s -> %s -> %s\n", i, sn.label.c_str(),
                sn.source.module.c_str(), sn.preprocess.module.c_str(), sn.infer.module.c_str(),
                sn.postprocess.module.c_str(), sn.overlay.module.c_str());
    }
    const hxj::Value *comp = cfg.get("compositor"), *sink = cfg.get("sink");
    if (!comp || !sink) { fprintf(stderr, "[host] config needs 'compositor' and 'sink'\n"); return 2; }
    if (!load_node(g_compositor, *comp, "compositor") || !load_node(g_sink, *sink, "sink")) return 2;

    int warmup_ms = 1500;
    if (const hxj::Value *h = cfg.get("host")) {
        warmup_ms = hxj::jint(*h, "warmup_ms", 1500);
        g_serialize_infer = hxj::jbool(*h, "serialize_infer", true);   // set false for GPU (concurrent infer)
    }
    fprintf(stderr, "serialize_infer=%d\n", g_serialize_infer);
    fprintf(stderr, "warming up %d streams (%dms)...\n", N, warmup_ms);
    usleep(warmup_ms * 1000);

    std::vector<pthread_t> wk(N);
    pthread_t op;
    for (int i = 0; i < N; i++) pthread_create(&wk[i], nullptr, worker, (void *)(intptr_t)i);
    pthread_create(&op, nullptr, outputter, nullptr);

    double t0 = now_ms(), tlast = t0;
    while (running) {
        usleep(200000);
        double t = now_ms();
        if (t - tlast >= 2000) {
            double el = (t - t0) / 1000.0;
            long tot = 0;
            fprintf(stderr, "[%.0fs]", el);
            for (int i = 0; i < N; i++) {
                tot += g_inf[i];
                double ms = g_inf[i] ? g_time_us[i] / 1000.0 / g_inf[i] : 0;
                fprintf(stderr, " %s=%.1f/s@%.0fms(%ld)", g_streams[i].label.c_str(), g_inf[i] / el, ms, g_det[i]);
            }
            fprintf(stderr, " | AGG=%.1f inf/s\n", tot / el);
            tlast = t;
        }
    }

    fprintf(stderr, "stopping (graceful teardown)...\n");
    pthread_t wd;
    pthread_create(&wd, nullptr, watchdog, (void *)(intptr_t)15);
    pthread_detach(wd);
    for (int i = 0; i < N; i++) pthread_join(wk[i], nullptr);
    pthread_join(op, nullptr);
    // destroy in flow order: sources (stop decode), stages, then sink (VE teardown last)
    for (int i = 0; i < N; i++) {
        destroy_node(g_streams[i].source);
        destroy_node(g_streams[i].preprocess);
        destroy_node(g_streams[i].infer);
        destroy_node(g_streams[i].postprocess);
        destroy_node(g_streams[i].overlay);
    }
    destroy_node(g_compositor);
    destroy_node(g_sink);
    teardown_done = 1;
    fprintf(stderr, "[exit] clean\n");
    return 0;
}
