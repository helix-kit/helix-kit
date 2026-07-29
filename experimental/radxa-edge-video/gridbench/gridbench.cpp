// SPDX-License-Identifier: AGPL-3.0-only
// gridbench — 4-stream detect+overlay+composite benchmark, CPU vs PowerVR-GPU compositing.
//
// The DeepStream-shaped loop without the GStreamer plumbing (blocked by BSP packaging):
//   4 frames (looped "cameras") -> letterbox 640 -> NPU yolov5 (real inference, all 4)
//   -> overlay detection boxes -> 2x2 composite into one grid.
// Two composite/overlay implementations, identical work, measured head to head:
//   --mode cpu : OpenCV (draw boxes at stream res, resize into quadrant)
//   --mode gpu : OpenCL zero-copy (CL_MEM_ALLOC_HOST_PTR). Kernel 1 = composite (one sample per
//                output pixel, memory-bound); kernel 2 = drawbox (one work-item/box, edge pixels
//                only). Frames uploaded once (steady-state; a real decoder writes the mapped
//                buffer directly, so per-frame handoff ~0 — see experimental/radxa-gpu).
// Reports fps, CPU-cores (getrusage), peak RSS, and isolated composite/overlay cost. The NPU
// load is identical in both modes, so the CPU-cores delta is the compositing the GPU offloaded.
// --dump writes grid.png + per-quadrant mean + green-pixel count for correctness.

#include <opencv2/opencv.hpp>
extern "C" {
#include <awnn_lib.h>
}
#define CL_TARGET_OPENCL_VERSION 300
#include <CL/cl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <string>
#include <ctime>
#include <sys/resource.h>

static double now_ms() { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }
static double cpu_s() { struct rusage r; getrusage(RUSAGE_SELF, &r); return r.ru_utime.tv_sec + r.ru_utime.tv_usec / 1e6 + r.ru_stime.tv_sec + r.ru_stime.tv_usec / 1e6; }

#define SW 1920
#define SH 1080
#define GW 1920
#define GH 1080
#define QW (GW/2)
#define QH (GH/2)
#define NBOX 25

struct Box { int x, y, w, h; };
static std::vector<Box> make_boxes(int stream) {
    std::vector<Box> b; unsigned s = 2654435761u * (stream + 1);
    for (int i = 0; i < NBOX; i++) {
        s = s * 1103515245u + 12345u; int x = (s >> 8) % (SW - 300);
        s = s * 1103515245u + 12345u; int y = (s >> 8) % (SH - 200);
        s = s * 1103515245u + 12345u; int w = 60 + (s >> 8) % 240;
        s = s * 1103515245u + 12345u; int h = 40 + (s >> 8) % 160;
        b.push_back({ x, y, w, h });
    }
    return b;
}
static void letterbox(const cv::Mat &bgr, unsigned char *out) {
    const int L = 640; cv::Mat img; cv::cvtColor(bgr, img, cv::COLOR_BGR2RGB);
    float sc = std::min(L * 1.f / img.rows, L * 1.f / img.cols);
    int rc = int(sc * img.cols), rr = int(sc * img.rows);
    cv::resize(img, img, cv::Size(rc, rr));
    cv::Mat canvas(L, L, CV_8UC3, cv::Scalar(0, 0, 0));
    img.copyTo(canvas(cv::Rect((L - rc) / 2, (L - rr) / 2, rc, rr)));
    for (int h = 0; h < L; h++) for (int w = 0; w < L; w++) for (int c = 0; c < 3; c++)
        out[c * L * L + h * L + w] = canvas.at<cv::Vec3b>(h, w)[c];
}

static const char *K =
"__kernel void composite(__global const uchar4*s0,__global const uchar4*s1,__global const uchar4*s2,__global const uchar4*s3,"
"__global uchar4*g,int SWi,int SHi,int GWi,int GHi){"
" int gx=get_global_id(0),gy=get_global_id(1); if(gx>=GWi||gy>=GHi)return;"
" int qx=gx>=GWi/2, qy=gy>=GHi/2; int q=qy*2+qx;"
" int lx=gx-qx*(GWi/2), ly=gy-qy*(GHi/2);"
" int sx=lx*SWi/(GWi/2), sy=ly*SHi/(GHi/2);"
" __global const uchar4*s=(q==0)?s0:(q==1)?s1:(q==2)?s2:s3;"
" g[gy*GWi+gx]=s[sy*SWi+sx]; }\n"
"__kernel void drawbox(__global const int4*boxes,__global const int*qof,__global uchar4*g,"
"int SWi,int SHi,int GWi,int GHi){"
" int i=get_global_id(0); int4 b=boxes[i]; int q=qof[i];"
" int ox=(q&1)*(GWi/2), oy=(q>>1)*(GHi/2);"
" float rx=(float)(GWi/2)/SWi, ry=(float)(GHi/2)/SHi;"
" int x0=ox+(int)(b.x*rx), y0=oy+(int)(b.y*ry), x1=ox+(int)((b.x+b.z)*rx), y1=oy+(int)((b.y+b.w)*ry);"
" for(int x=x0;x<=x1;x++){ if(x>=0&&x<GWi){ if(y0>=0&&y0<GHi)g[y0*GWi+x]=(uchar4)(0,255,0,255); if(y1>=0&&y1<GHi)g[y1*GWi+x]=(uchar4)(0,255,0,255);} }"
" for(int y=y0;y<=y1;y++){ if(y>=0&&y<GHi){ if(x0>=0&&x0<GWi)g[y*GWi+x0]=(uchar4)(0,255,0,255); if(x1>=0&&x1<GWi)g[y*GWi+x1]=(uchar4)(0,255,0,255);} } }";

struct Gpu {
    cl_context ctx; cl_command_queue q; cl_kernel kc, kb;
    cl_mem s[4], boxbuf, qofbuf, grid; unsigned char *smap[4], *gmap; int totalboxes;
};
static cl_mem mkbuf(cl_context c, cl_mem_flags f, size_t n, cl_int *e) { return clCreateBuffer(c, f | CL_MEM_ALLOC_HOST_PTR, n, 0, e); }

int main(int argc, char **argv) {
    std::string mode = "cpu", nb = "yolov5.nb"; int frames = 200; bool dump = false; std::vector<std::string> imgs;
    for (int i = 1; i < argc; i++) { std::string a = argv[i];
        if (a == "--mode") mode = argv[++i]; else if (a == "--frames") frames = atoi(argv[++i]); else if (a == "--nb") nb = argv[++i]; else if (a == "--dump") dump = true; else imgs.push_back(a); }
    if (imgs.empty()) { fprintf(stderr, "usage: %s --mode cpu|gpu [--frames N] --nb model [--dump] img...\n", argv[0]); return 1; }

    cv::Mat stream[4], rgba[4];
    for (int i = 0; i < 4; i++) { cv::Mat m = cv::imread(imgs[i % imgs.size()], cv::IMREAD_COLOR); if (m.empty()) { fprintf(stderr, "bad image\n"); return 1; } cv::resize(m, stream[i], cv::Size(SW, SH)); cv::cvtColor(stream[i], rgba[i], cv::COLOR_BGR2RGBA); }
    std::vector<Box> bx[4]; for (int i = 0; i < 4; i++) bx[i] = make_boxes(i);

    awnn_init(); Awnn_Context_t *ac = awnn_create(nb.c_str()); if (!ac) { fprintf(stderr, "awnn_create failed (%s)\n", nb.c_str()); return 1; }
    std::vector<unsigned char> lb[4]; for (int i = 0; i < 4; i++) { lb[i].resize(640 * 640 * 3); letterbox(stream[i], lb[i].data()); }

    Gpu G; cl_int e;
    if (mode == "gpu") {
        cl_platform_id p; cl_device_id d; clGetPlatformIDs(1, &p, 0); clGetDeviceIDs(p, CL_DEVICE_TYPE_GPU, 1, &d, 0);
        G.ctx = clCreateContext(0, 1, &d, 0, 0, &e); G.q = clCreateCommandQueue(G.ctx, d, 0, &e);
        cl_program pr = clCreateProgramWithSource(G.ctx, 1, &K, 0, &e);
        if (clBuildProgram(pr, 1, &d, "", 0, 0) != CL_SUCCESS) { size_t n; clGetProgramBuildInfo(pr, d, CL_PROGRAM_BUILD_LOG, 0, 0, &n); std::string l(n, 0); clGetProgramBuildInfo(pr, d, CL_PROGRAM_BUILD_LOG, n, &l[0], 0); fprintf(stderr, "build:\n%s\n", l.c_str()); return 1; }
        G.kc = clCreateKernel(pr, "composite", &e); G.kb = clCreateKernel(pr, "drawbox", &e);
        size_t sb = (size_t)SW * SH * 4;
        for (int i = 0; i < 4; i++) { G.s[i] = mkbuf(G.ctx, CL_MEM_READ_ONLY, sb, &e); G.smap[i] = (unsigned char *)clEnqueueMapBuffer(G.q, G.s[i], CL_TRUE, CL_MAP_WRITE, 0, sb, 0, 0, 0, &e); memcpy(G.smap[i], rgba[i].data, sb); }  // upload once
        G.totalboxes = 4 * NBOX;
        G.boxbuf = mkbuf(G.ctx, CL_MEM_READ_ONLY, G.totalboxes * sizeof(cl_int4), &e);
        G.qofbuf = mkbuf(G.ctx, CL_MEM_READ_ONLY, G.totalboxes * sizeof(int), &e);
        int *bm = (int *)clEnqueueMapBuffer(G.q, G.boxbuf, CL_TRUE, CL_MAP_WRITE, 0, G.totalboxes * sizeof(cl_int4), 0, 0, 0, &e);
        int *qm = (int *)clEnqueueMapBuffer(G.q, G.qofbuf, CL_TRUE, CL_MAP_WRITE, 0, G.totalboxes * sizeof(int), 0, 0, 0, &e);
        int o = 0; for (int st = 0; st < 4; st++) for (auto &b : bx[st]) { bm[o * 4] = b.x; bm[o * 4 + 1] = b.y; bm[o * 4 + 2] = b.w; bm[o * 4 + 3] = b.h; qm[o] = st; o++; }
        clEnqueueUnmapMemObject(G.q, G.boxbuf, bm, 0, 0, 0); clEnqueueUnmapMemObject(G.q, G.qofbuf, qm, 0, 0, 0);
        G.grid = mkbuf(G.ctx, CL_MEM_WRITE_ONLY, (size_t)GW * GH * 4, &e);
        int sw = SW, sh = SH, gw = GW, gh = GH;
        for (int i = 0; i < 4; i++) clSetKernelArg(G.kc, i, sizeof(cl_mem), &G.s[i]);
        clSetKernelArg(G.kc, 4, sizeof(cl_mem), &G.grid); clSetKernelArg(G.kc, 5, sizeof(int), &sw); clSetKernelArg(G.kc, 6, sizeof(int), &sh); clSetKernelArg(G.kc, 7, sizeof(int), &gw); clSetKernelArg(G.kc, 8, sizeof(int), &gh);
        clSetKernelArg(G.kb, 0, sizeof(cl_mem), &G.boxbuf); clSetKernelArg(G.kb, 1, sizeof(cl_mem), &G.qofbuf); clSetKernelArg(G.kb, 2, sizeof(cl_mem), &G.grid);
        clSetKernelArg(G.kb, 3, sizeof(int), &sw); clSetKernelArg(G.kb, 4, sizeof(int), &sh); clSetKernelArg(G.kb, 5, sizeof(int), &gw); clSetKernelArg(G.kb, 6, sizeof(int), &gh);
        clFinish(G.q);
    }
    cv::Mat gridcpu(GH, GW, CV_8UC3);

    printf("mode=%s frames=%d streams=%dx%d grid=%dx%d boxes/stream=%d\n", mode.c_str(), frames, SW, SH, GW, GH, NBOX);
    double npu_ms = 0, comp_ms = 0; int infers = 0;
    double c0 = cpu_s(), w0 = now_ms();
    for (int f = 0; f < frames; f++) {
        double t = now_ms();
        for (int s = 0; s < 4; s++) { void *ib[1] = { lb[s].data() }; awnn_set_input_buffers(ac, ib); awnn_run(ac); awnn_get_output_buffers(ac); infers++; }
        npu_ms += now_ms() - t;
        t = now_ms();
        if (mode == "cpu") {
            for (int s = 0; s < 4; s++) {
                cv::Mat annot = stream[s].clone();
                for (auto &b : bx[s]) cv::rectangle(annot, cv::Rect(b.x, b.y, b.w, b.h), cv::Scalar(0, 255, 0), 3);
                cv::Mat quad; cv::resize(annot, quad, cv::Size(QW, QH));
                quad.copyTo(gridcpu(cv::Rect((s % 2) * QW, (s / 2) * QH, QW, QH)));
            }
        } else {
            size_t gs[2] = { GW, GH }; size_t bs = G.totalboxes; cl_event ev;
            clEnqueueNDRangeKernel(G.q, G.kc, 2, 0, gs, 0, 0, 0, 0);
            clEnqueueNDRangeKernel(G.q, G.kb, 1, 0, &bs, 0, 0, 0, &ev);
            clWaitForEvents(1, &ev); clReleaseEvent(ev);
        }
        comp_ms += now_ms() - t;
    }
    double wall = (now_ms() - w0) / 1e3, cpu = cpu_s() - c0;
    struct rusage ru; getrusage(RUSAGE_SELF, &ru);
    printf("\n==== %s ====\n", mode.c_str());
    printf("wall %.2fs  frames %d  => %.1f composite-fps\n", wall, frames, frames / wall);
    printf("NPU: %d infers  %.2f ms/frame(4x)  %.1f inf/s\n", infers, npu_ms / frames, infers / (npu_ms / 1e3));
    printf("composite+overlay stage: %.2f ms/frame\n", comp_ms / frames);
    printf("CPU consumed: %.2f cpu-s over %.2f wall-s = %.2f cores\n", cpu, wall, cpu / wall);
    printf("peak RSS: %.0f MB\n", ru.ru_maxrss / 1024.0);

    if (dump) {   // correctness: save grid + per-quadrant mean + green-pixel count
        cv::Mat out;
        if (mode == "gpu") { G.gmap = (unsigned char *)clEnqueueMapBuffer(G.q, G.grid, CL_TRUE, CL_MAP_READ, 0, (size_t)GW * GH * 4, 0, 0, 0, &e); cv::Mat rg(GH, GW, CV_8UC4, G.gmap); cv::cvtColor(rg, out, cv::COLOR_RGBA2BGR); }
        else out = gridcpu;
        cv::imwrite("grid_" + mode + ".png", out);
        long green = 0; double qmean[4] = { 0, 0, 0, 0 };
        for (int q = 0; q < 4; q++) { cv::Scalar m = cv::mean(out(cv::Rect((q % 2) * QW, (q / 2) * QH, QW, QH))); qmean[q] = (m[0] + m[1] + m[2]) / 3; }
        for (int y = 0; y < GH; y++) for (int x = 0; x < GW; x++) { cv::Vec3b p = out.at<cv::Vec3b>(y, x); if (p[1] > 200 && p[0] < 80 && p[2] < 80) green++; }
        printf("dump: grid_%s.png  quad-means[%.0f %.0f %.0f %.0f]  green-box-pixels=%ld\n", mode.c_str(), qmean[0], qmean[1], qmean[2], qmean[3], green);
    }
    awnn_destroy(ac); awnn_uninit();
    return 0;
}
