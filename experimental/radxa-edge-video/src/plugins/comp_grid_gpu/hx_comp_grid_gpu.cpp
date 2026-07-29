// SPDX-License-Identifier: AGPL-3.0-only
// GPU compositor plugin: N annotated BGR cell frames -> one cols x rows grid frame, composited on
// the PowerVR GPU via OpenCL (zero-copy, CL_MEM_ALLOC_HOST_PTR on the unified DRAM). Drop-in
// replacement for hx_comp_grid (same JSON params) — swap the module in the config, no host recompile.
// Boxes are already drawn per-stream upstream by hx_overlay_boxes, so this stage only downscales +
// composites (the dominant CPU cost per ../../gridbench). Persistent grid: a cell with no fresh frame
// (data==NULL) keeps its last content (its source buffer is not overwritten).
#include <CL/cl.h>
#include <cstdio>
#include <cstring>
#include <opencv2/opencv.hpp>
#include "../helix_pipeline.h"
#include "../hx_json.h"

// One work-item per output pixel: nearest-neighbour downscale of the owning quadrant's source cell.
// BGR (3 bytes/pixel), stride assumed packed (w*3) in the mapped source buffers.
static const char *K =
"__kernel void composite_bgr(__global const uchar*s0,__global const uchar*s1,"
"__global const uchar*s2,__global const uchar*s3,__global uchar*g,"
"int SWi,int SHi,int GWi,int GHi,int COLS,int ROWS){"
" int gx=get_global_id(0),gy=get_global_id(1); if(gx>=GWi||gy>=GHi)return;"
" int cw=GWi/COLS, ch=GHi/ROWS; int cx=gx/cw, cy=gy/ch; int q=cy*COLS+cx;"
" int lx=gx-cx*cw, ly=gy-cy*ch;"
" int sx=lx*SWi/cw, sy=ly*SHi/ch;"
" __global const uchar*s=(q==0)?s0:(q==1)?s1:(q==2)?s2:s3;"
" int si=(sy*SWi+sx)*3, gi=(gy*GWi+gx)*3;"
" g[gi]=s[si]; g[gi+1]=s[si+1]; g[gi+2]=s[si+2]; }";

struct helix_node_ctx {
    int cols = 2, rows = 2, gw = 1280, gh = 720;
    int sw = 0, sh = 0;                 // cell size, learned from the first frame
    cl_context ctx = nullptr;
    cl_command_queue q = nullptr;
    cl_kernel k = nullptr;
    cl_mem src[4] = {nullptr, nullptr, nullptr, nullptr};
    unsigned char *smap[4] = {nullptr, nullptr, nullptr, nullptr};
    cl_mem grid = nullptr;
    unsigned char *gmap = nullptr;      // mapped grid output (BGR) -> handed straight to the sink
    cv::Mat fallback;                   // CPU fallback grid if OpenCL init fails
    bool gpu_ok = false;
};

static cl_mem hostbuf(cl_context c, cl_mem_flags f, size_t n, void **map, cl_command_queue q, cl_int *e) {
    cl_mem m = clCreateBuffer(c, f | CL_MEM_ALLOC_HOST_PTR, n, nullptr, e);
    if (*e != CL_SUCCESS) return nullptr;
    cl_map_flags mf = (f & CL_MEM_WRITE_ONLY) ? CL_MAP_READ : CL_MAP_WRITE;
    *map = clEnqueueMapBuffer(q, m, CL_TRUE, mf, 0, n, 0, nullptr, nullptr, e);   // map once, keep mapped (unified DRAM -> coherent)
    return m;
}

static helix_node_ctx *create(const char *params_json) {
    hxj::Value p = hxj::parse(params_json ? params_json : "{}");
    auto *c = new helix_node_ctx();
    c->cols = hxj::jint(p, "cols", 2);
    c->rows = hxj::jint(p, "rows", 2);
    c->gw = hxj::jint(p, "grid_w", 1280);
    c->gh = hxj::jint(p, "grid_h", 720);
    c->fallback = cv::Mat(c->gh, c->gw, CV_8UC3, cv::Scalar(20, 20, 20));

    cl_platform_id plat; cl_device_id dev; cl_int e;
    if (clGetPlatformIDs(1, &plat, nullptr) != CL_SUCCESS ||
        clGetDeviceIDs(plat, CL_DEVICE_TYPE_GPU, 1, &dev, nullptr) != CL_SUCCESS) {
        fprintf(stderr, "[hx_comp_grid_gpu] no OpenCL GPU device -> CPU fallback\n"); return c;
    }
    c->ctx = clCreateContext(nullptr, 1, &dev, nullptr, nullptr, &e);
    c->q = clCreateCommandQueue(c->ctx, dev, 0, &e);
    cl_program pr = clCreateProgramWithSource(c->ctx, 1, &K, nullptr, &e);
    if (clBuildProgram(pr, 1, &dev, "", nullptr, nullptr) != CL_SUCCESS) {
        size_t n; clGetProgramBuildInfo(pr, dev, CL_PROGRAM_BUILD_LOG, 0, nullptr, &n);
        std::string log(n, 0); clGetProgramBuildInfo(pr, dev, CL_PROGRAM_BUILD_LOG, n, &log[0], nullptr);
        fprintf(stderr, "[hx_comp_grid_gpu] build failed:\n%s\n-> CPU fallback\n", log.c_str()); return c;
    }
    c->k = clCreateKernel(pr, "composite_bgr", &e);
    size_t gsz = (size_t)c->gw * c->gh * 3;
    c->grid = hostbuf(c->ctx, CL_MEM_WRITE_ONLY, gsz, (void **)&c->gmap, c->q, &e);
    if (e != CL_SUCCESS || !c->gmap) { fprintf(stderr, "[hx_comp_grid_gpu] grid alloc failed -> CPU fallback\n"); return c; }
    c->gpu_ok = true;
    fprintf(stderr, "[hx_comp_grid_gpu] OpenCL compositor ready (grid %dx%d, %dx%d)\n", c->gw, c->gh, c->cols, c->rows);
    return c;
}

static void destroy(helix_node_ctx *c) { delete c; }

// CPU fallback identical to hx_comp_grid, used only if OpenCL init failed.
static int cpu_composite(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    int cw = c->gw / c->cols, ch = c->gh / c->rows, cells = c->cols * c->rows;
    for (int i = 0; i < n_in && i < cells; i++) {
        if (in[i].type != HX_PKT_FRAME || !in[i].frame.data) continue;
        const helix_frame_t &f = in[i].frame;
        cv::Mat s(f.h, f.w, CV_8UC3, f.data, f.stride);
        cv::resize(s, c->fallback(cv::Rect((i % c->cols) * cw, (i / c->cols) * ch, cw, ch)), cv::Size(cw, ch));
    }
    out->type = HX_PKT_FRAME;
    out->frame = {c->fallback.data, c->gw, c->gh, (int)c->fallback.step, HX_FMT_BGR, 0};
    return 1;
}

static int process(helix_node_ctx *c, const helix_packet_t *in, int n_in, helix_packet_t *out) {
    if (!c->gpu_ok) return cpu_composite(c, in, n_in, out);
    int cells = c->cols * c->rows;

    // Learn cell size from the first frame; allocate the 4 source buffers (mapped, zero-copy) once.
    if (c->sw == 0) {
        for (int i = 0; i < n_in && i < cells; i++)
            if (in[i].type == HX_PKT_FRAME && in[i].frame.data) { c->sw = in[i].frame.w; c->sh = in[i].frame.h; break; }
        if (c->sw == 0) return 0;                       // nothing to composite yet
        cl_int e; size_t ssz = (size_t)c->sw * c->sh * 3;
        for (int i = 0; i < cells; i++) {
            c->src[i] = hostbuf(c->ctx, CL_MEM_READ_ONLY, ssz, (void **)&c->smap[i], c->q, &e);
            memset(c->smap[i], 20, ssz);                // dark until a cell delivers its first frame
        }
        clSetKernelArg(c->k, 0, sizeof(cl_mem), &c->src[0]); clSetKernelArg(c->k, 1, sizeof(cl_mem), &c->src[1]);
        clSetKernelArg(c->k, 2, sizeof(cl_mem), &c->src[2]); clSetKernelArg(c->k, 3, sizeof(cl_mem), &c->src[3]);
        clSetKernelArg(c->k, 4, sizeof(cl_mem), &c->grid);
        clSetKernelArg(c->k, 5, sizeof(int), &c->sw); clSetKernelArg(c->k, 6, sizeof(int), &c->sh);
        clSetKernelArg(c->k, 7, sizeof(int), &c->gw); clSetKernelArg(c->k, 8, sizeof(int), &c->gh);
        clSetKernelArg(c->k, 9, sizeof(int), &c->cols); clSetKernelArg(c->k, 10, sizeof(int), &c->rows);
    }

    // Copy fresh cells into their mapped source buffers (a cell with no new frame keeps its last content).
    for (int i = 0; i < n_in && i < cells; i++) {
        if (in[i].type != HX_PKT_FRAME || !in[i].frame.data) continue;
        const helix_frame_t &f = in[i].frame;
        if (f.w != c->sw || f.h != c->sh) continue;     // size mismatch: skip (all streams share resolution)
        size_t row = (size_t)c->sw * 3;
        if ((size_t)f.stride == row) memcpy(c->smap[i], f.data, row * c->sh);
        else for (int y = 0; y < c->sh; y++) memcpy(c->smap[i] + y * row, f.data + (size_t)y * f.stride, row);
    }

    size_t gs[2] = {(size_t)c->gw, (size_t)c->gh};
    clEnqueueNDRangeKernel(c->q, c->k, 2, nullptr, gs, nullptr, 0, nullptr, nullptr);
    clFinish(c->q);                                     // grid is CL_MEM_ALLOC_HOST_PTR + mapped -> gmap is coherent, no read-back

    out->type = HX_PKT_FRAME;
    out->frame = {c->gmap, c->gw, c->gh, c->gw * 3, HX_FMT_BGR, 0};
    return 1;
}

static const helix_node_vtable VT = {
    HELIX_ABI_VERSION, "compositor", "hx_comp_grid_gpu",
    create, destroy, process, nullptr, nullptr,
};
extern "C" const helix_node_vtable *helix_node_entry(void) { return &VT; }
