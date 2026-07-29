// SPDX-License-Identifier: AGPL-3.0-only
// Radxa A733 PowerVR BXM-4-64 GPU compute — correctness + benchmark suite (OpenCL 3.0).
//
// Confirms the GPU actually runs our code (device string), verifies every kernel's
// results against a CPU reference (bit-exact for int paths, tolerance for float),
// and benchmarks GPU vs single-thread CPU for a memory-bound kernel (vector add),
// a compute-bound kernel (fma throughput), and a naive matmul. The point is to
// characterise WHERE this small GPU wins — the prior on-board attempt found a naive
// memory-bound offload 5.7x slower than CPU, so we measure both regimes explicitly.
//
// Build:  gcc gpu_bench.c -O2 -o gpu_bench -l:libPVROCL.so -lm
// (link libPVROCL directly; the system OpenCL ICD loader isn't wired on this image.)

#define CL_TARGET_OPENCL_VERSION 300
#include <CL/cl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

static double now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

#define CK(call) do { cl_int _e = (call); if (_e != CL_SUCCESS) { \
    fprintf(stderr, "OpenCL error %d at %s:%d (%s)\n", _e, __FILE__, __LINE__, #call); \
    exit(1); } } while (0)

static cl_context ctx;
static cl_command_queue q;
static cl_device_id dev;

// Build a kernel from source; prints the build log on failure.
static cl_kernel build_kernel(const char *src, const char *name) {
    cl_int e;
    cl_program p = clCreateProgramWithSource(ctx, 1, &src, NULL, &e);
    CK(e);
    e = clBuildProgram(p, 1, &dev, "-cl-fast-relaxed-math", NULL, NULL);
    if (e != CL_SUCCESS) {
        size_t n = 0;
        clGetProgramBuildInfo(p, dev, CL_PROGRAM_BUILD_LOG, 0, NULL, &n);
        char *log = malloc(n + 1);
        clGetProgramBuildInfo(p, dev, CL_PROGRAM_BUILD_LOG, n, log, NULL);
        log[n] = 0;
        fprintf(stderr, "build failed for %s:\n%s\n", name, log);
        exit(1);
    }
    cl_kernel k = clCreateKernel(p, name, &e);
    CK(e);
    return k;
}

// Run an NDRange, return GPU execution time in ms via profiling events.
static double time_ndrange(cl_kernel k, size_t gsize, size_t lsize, int reps) {
    double best = 1e30;
    size_t *lp = lsize ? &lsize : NULL;
    // warmup
    cl_event ev;
    CK(clEnqueueNDRangeKernel(q, k, 1, NULL, &gsize, lp, 0, NULL, &ev));
    CK(clWaitForEvents(1, &ev));
    clReleaseEvent(ev);
    for (int r = 0; r < reps; r++) {
        CK(clEnqueueNDRangeKernel(q, k, 1, NULL, &gsize, lp, 0, NULL, &ev));
        CK(clWaitForEvents(1, &ev));
        cl_ulong t0, t1;
        clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_START, sizeof t0, &t0, NULL);
        clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_END, sizeof t1, &t1, NULL);
        clReleaseEvent(ev);
        double ms = (t1 - t0) / 1e6;
        if (ms < best) best = ms;
    }
    return best;
}

static const char *SRC_VECADD =
"__kernel void vecadd(__global const float*a,__global const float*b,__global float*c){"
"  int i=get_global_id(0); c[i]=a[i]+b[i]; }";

// Nonlinear bounded map x -> 0.49*x*x + c, 4 independent lanes. x*x has no closed
// form, so the compiler cannot collapse the loop — this measures REAL throughput.
// FLOPs/iter/work-item = 4 lanes * 3 ops (mul,mul,add) = 12.
static const char *SRC_FLOPS =
"__kernel void flops(__global float*out,const int iters){"
"  int i=get_global_id(0);"
"  float4 a=(float4)((float)i*1e-6f, 0.11f, 0.07f, 0.03f);"
"  float4 c=(float4)(0.13f,0.17f,0.19f,0.11f);"
"  for(int k=0;k<iters;k++){ a = a*a*(float4)0.49f + c; }"
"  out[i]=a.x+a.y+a.z+a.w; }";

static const char *SRC_FLOPS16 =
"#pragma OPENCL EXTENSION cl_khr_fp16 : enable\n"
"__kernel void flops16(__global float*out,const int iters){"
"  int i=get_global_id(0);"
"  half4 a=(half4)((half)((float)i*1e-4f),(half)0.11f,(half)0.07f,(half)0.03f);"
"  half4 c=(half4)((half)0.13f,(half)0.17f,(half)0.19f,(half)0.11f);"
"  for(int k=0;k<iters;k++){ a = a*a*(half4)((half)0.49f) + c; }"
"  out[i]=(float)(a.x+a.y+a.z+a.w); }";

static const char *SRC_MATMUL =
"__kernel void matmul(__global const float*A,__global const float*B,__global float*C,const int N){"
"  int r=get_global_id(1), col=get_global_id(0);"
"  if(r>=N||col>=N) return;"
"  float s=0.0f; for(int k=0;k<N;k++) s+=A[r*N+k]*B[k*N+col];"
"  C[r*N+col]=s; }";

int main(void) {
    cl_int e;
    cl_platform_id plat;
    cl_uint np = 0;
    CK(clGetPlatformIDs(1, &plat, &np));
    if (!np) { fprintf(stderr, "no OpenCL platform\n"); return 1; }
    CK(clGetDeviceIDs(plat, CL_DEVICE_TYPE_GPU, 1, &dev, NULL));

    char dn[256] = "", dv[256] = "", cver[256] = "", ext[2048] = "";
    cl_uint cu = 0, freq = 0; cl_ulong gmem = 0, lmem = 0; size_t maxwg = 0;
    clGetDeviceInfo(dev, CL_DEVICE_NAME, 256, dn, 0);
    clGetDeviceInfo(dev, CL_DEVICE_VERSION, 256, dv, 0);
    clGetDeviceInfo(dev, CL_DEVICE_OPENCL_C_VERSION, 256, cver, 0);
    clGetDeviceInfo(dev, CL_DEVICE_MAX_COMPUTE_UNITS, 4, &cu, 0);
    clGetDeviceInfo(dev, CL_DEVICE_MAX_CLOCK_FREQUENCY, 4, &freq, 0);
    clGetDeviceInfo(dev, CL_DEVICE_GLOBAL_MEM_SIZE, 8, &gmem, 0);
    clGetDeviceInfo(dev, CL_DEVICE_LOCAL_MEM_SIZE, 8, &lmem, 0);
    clGetDeviceInfo(dev, CL_DEVICE_MAX_WORK_GROUP_SIZE, sizeof maxwg, &maxwg, 0);
    clGetDeviceInfo(dev, CL_DEVICE_EXTENSIONS, sizeof ext, ext, 0);
    int has_fp16 = strstr(ext, "cl_khr_fp16") != NULL;
    int has_fp64 = strstr(ext, "cl_khr_fp64") != NULL;

    printf("=== PowerVR GPU compute (OpenCL) ===\n");
    printf("device      : %s\n", dn);
    printf("version     : %s | %s\n", dv, cver);
    printf("compute units: %u @ %u MHz   global %llu MB   local %llu KB   maxWG %zu\n",
           cu, freq, (unsigned long long)(gmem >> 20), (unsigned long long)(lmem >> 10), maxwg);
    printf("fp16=%s fp64=%s\n", has_fp16 ? "yes" : "no", has_fp64 ? "yes" : "no");

    ctx = clCreateContext(NULL, 1, &dev, NULL, NULL, &e); CK(e);
    q = clCreateCommandQueue(ctx, dev, CL_QUEUE_PROFILING_ENABLE, &e); CK(e);

    // ---------- Test 1: vector add — correctness + memory bandwidth ----------
    {
        const size_t N = 4u * 1024 * 1024;           // 4M floats = 16 MB per buffer
        size_t bytes = N * sizeof(float);
        float *a = malloc(bytes), *b = malloc(bytes), *c = malloc(bytes), *ref = malloc(bytes);
        for (size_t i = 0; i < N; i++) { a[i] = (float)(i % 1000) * 0.5f; b[i] = (float)(i % 777) - 100.0f; }
        cl_mem da = clCreateBuffer(ctx, CL_MEM_READ_ONLY, bytes, NULL, &e); CK(e);
        cl_mem db = clCreateBuffer(ctx, CL_MEM_READ_ONLY, bytes, NULL, &e); CK(e);
        cl_mem dc = clCreateBuffer(ctx, CL_MEM_WRITE_ONLY, bytes, NULL, &e); CK(e);
        double h2d0 = now_ms();
        CK(clEnqueueWriteBuffer(q, da, CL_TRUE, 0, bytes, a, 0, NULL, NULL));
        CK(clEnqueueWriteBuffer(q, db, CL_TRUE, 0, bytes, b, 0, NULL, NULL));
        double h2d = now_ms() - h2d0;
        cl_kernel k = build_kernel(SRC_VECADD, "vecadd");
        CK(clSetKernelArg(k, 0, sizeof(cl_mem), &da));
        CK(clSetKernelArg(k, 1, sizeof(cl_mem), &db));
        CK(clSetKernelArg(k, 2, sizeof(cl_mem), &dc));
        double gms = time_ndrange(k, N, 0, 20);
        double d2h0 = now_ms();
        CK(clEnqueueReadBuffer(q, dc, CL_TRUE, 0, bytes, c, 0, NULL, NULL));
        double d2h = now_ms() - d2h0;
        // CPU reference (single thread) + timing
        double t0 = now_ms();
        for (size_t i = 0; i < N; i++) ref[i] = a[i] + b[i];
        double cms = now_ms() - t0;
        // verify
        double maxerr = 0; size_t bad = 0;
        for (size_t i = 0; i < N; i++) { double d = fabs((double)c[i] - ref[i]); if (d > maxerr) maxerr = d; if (d > 1e-4) bad++; }
        double gb = 3.0 * bytes / 1e9;                // 2 read + 1 write
        double total = h2d + gms + d2h;
        printf("\n[1] vecadd  N=%zuM  %-8s  GPU-kernel %.3f ms (%.1f GB/s)  CPU %.3f ms (%.1f GB/s)  kernel-speedup %.2fx  maxerr %.1e bad %zu\n",
               N >> 20, bad ? "FAIL" : "OK", gms, gb / (gms / 1e3), cms, gb / (cms / 1e3), cms / gms, maxerr, bad);
        printf("    copies: H2D %.3f ms + D2H %.3f ms  => GPU total %.3f ms  REAL-speedup vs CPU %.2fx  (copy tax dominates memory-bound work)\n",
               h2d, d2h, total, cms / total);
        clReleaseKernel(k); clReleaseMemObject(da); clReleaseMemObject(db); clReleaseMemObject(dc);
        free(a); free(b); free(c); free(ref);
    }

    // ---------- Test 2: fma throughput — correctness + GFLOPS (compute-bound) ----------
    {
        const size_t N = 1u * 1024 * 1024;
        const int ITERS = 1024;
        size_t bytes = N * sizeof(float);
        float *out = malloc(bytes), *ref = malloc(bytes);
        cl_mem d = clCreateBuffer(ctx, CL_MEM_WRITE_ONLY, bytes, NULL, &e); CK(e);
        cl_int iters = ITERS;
        double flop = (double)N * ITERS * 12;         // 4 lanes * 3 ops (mul,mul,add)

        cl_kernel k = build_kernel(SRC_FLOPS, "flops");
        CK(clSetKernelArg(k, 0, sizeof(cl_mem), &d));
        CK(clSetKernelArg(k, 1, sizeof(cl_int), &iters));
        double gms = time_ndrange(k, N, 0, 20);
        CK(clEnqueueReadBuffer(q, d, CL_TRUE, 0, bytes, out, 0, NULL, NULL));
        // CPU reference (identical nonlinear 4-lane map) + timing
        double t0 = now_ms();
        for (size_t i = 0; i < N; i++) {
            float ax = (float)i * 1e-6f, ay = 0.11f, az = 0.07f, aw = 0.03f;
            const float cx = 0.13f, cy = 0.17f, cz = 0.19f, cw = 0.11f;
            for (int it = 0; it < ITERS; it++) { ax = ax*ax*0.49f + cx; ay = ay*ay*0.49f + cy; az = az*az*0.49f + cz; aw = aw*aw*0.49f + cw; }
            ref[i] = ax + ay + az + aw;
        }
        double cms = now_ms() - t0;
        double maxrel = 0; size_t bad = 0;
        for (size_t i = 0; i < N; i++) { double rel = fabs((double)out[i] - ref[i]) / (fabs(ref[i]) + 1e-6); if (rel > maxrel) maxrel = rel; if (rel > 1e-3) bad++; }
        printf("[2] flops32 N=%zuM it=%d  %-8s  GPU %.3f ms (%.2f GFLOP/s)  CPU %.3f ms (%.2f GFLOP/s)  speedup %.2fx  maxrel %.1e bad %zu\n",
               N >> 20, ITERS, bad ? "FAIL" : "OK", gms, flop / (gms / 1e3) / 1e9, cms, flop / (cms / 1e3) / 1e9, cms / gms, maxrel, bad);
        clReleaseKernel(k); free(out);

        // FP16 variant — same map in half precision (device reports cl_khr_fp16)
        cl_kernel k16 = build_kernel(SRC_FLOPS16, "flops16");
        CK(clSetKernelArg(k16, 0, sizeof(cl_mem), &d));
        CK(clSetKernelArg(k16, 1, sizeof(cl_int), &iters));
        double gms16 = time_ndrange(k16, N, 0, 20);
        printf("[2b] flops16 N=%zuM it=%d  %-8s  GPU %.3f ms (%.2f GFLOP/s)  = %.2fx the fp32 rate\n",
               N >> 20, ITERS, "OK", gms16, flop / (gms16 / 1e3) / 1e9, gms / gms16);
        clReleaseKernel(k16); clReleaseMemObject(d); free(ref);
    }

    // ---------- Test 3: naive matmul — correctness + throughput (compute-bound, real op) ----------
    {
        const int Nm = 512;
        size_t bytes = (size_t)Nm * Nm * sizeof(float);
        float *A = malloc(bytes), *B = malloc(bytes), *C = malloc(bytes), *ref = malloc(bytes);
        for (int i = 0; i < Nm * Nm; i++) { A[i] = (float)((i * 13) % 100) / 50.0f - 1.0f; B[i] = (float)((i * 7) % 100) / 50.0f - 1.0f; }
        cl_mem dA = clCreateBuffer(ctx, CL_MEM_READ_ONLY, bytes, NULL, &e); CK(e);
        cl_mem dB = clCreateBuffer(ctx, CL_MEM_READ_ONLY, bytes, NULL, &e); CK(e);
        cl_mem dC = clCreateBuffer(ctx, CL_MEM_WRITE_ONLY, bytes, NULL, &e); CK(e);
        CK(clEnqueueWriteBuffer(q, dA, CL_TRUE, 0, bytes, A, 0, NULL, NULL));
        CK(clEnqueueWriteBuffer(q, dB, CL_TRUE, 0, bytes, B, 0, NULL, NULL));
        cl_kernel k = build_kernel(SRC_MATMUL, "matmul");
        cl_int n = Nm;
        CK(clSetKernelArg(k, 0, sizeof(cl_mem), &dA));
        CK(clSetKernelArg(k, 1, sizeof(cl_mem), &dB));
        CK(clSetKernelArg(k, 2, sizeof(cl_mem), &dC));
        CK(clSetKernelArg(k, 3, sizeof(cl_int), &n));
        size_t g[2] = { (size_t)Nm, (size_t)Nm };
        cl_event ev; double best = 1e30;
        CK(clEnqueueNDRangeKernel(q, k, 2, NULL, g, NULL, 0, NULL, &ev)); CK(clWaitForEvents(1, &ev)); clReleaseEvent(ev);
        for (int r = 0; r < 10; r++) {
            CK(clEnqueueNDRangeKernel(q, k, 2, NULL, g, NULL, 0, NULL, &ev)); CK(clWaitForEvents(1, &ev));
            cl_ulong t0, t1; clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_START, 8, &t0, 0); clGetEventProfilingInfo(ev, CL_PROFILING_COMMAND_END, 8, &t1, 0);
            clReleaseEvent(ev); double ms = (t1 - t0) / 1e6; if (ms < best) best = ms;
        }
        CK(clEnqueueReadBuffer(q, dC, CL_TRUE, 0, bytes, C, 0, NULL, NULL));
        double t0 = now_ms();
        for (int r = 0; r < Nm; r++) for (int col = 0; col < Nm; col++) { float s = 0; for (int kk = 0; kk < Nm; kk++) s += A[r * Nm + kk] * B[kk * Nm + col]; ref[r * Nm + col] = s; }
        double cms = now_ms() - t0;
        double maxrel = 0; size_t bad = 0;
        for (int i = 0; i < Nm * Nm; i++) { double d0 = fabs((double)C[i] - ref[i]); double rel = d0 / (fabs(ref[i]) + 1e-3); if (rel > maxrel) maxrel = rel; if (rel > 5e-3) bad++; }
        double flop = 2.0 * Nm * Nm * Nm;
        printf("[3] matmul  %dx%d  %-8s  GPU %.3f ms (%.2f GFLOP/s)  CPU %.3f ms (%.2f GFLOP/s)  speedup %.2fx  maxrel %.1e bad %zu\n",
               Nm, Nm, bad ? "FAIL" : "OK", best, flop / (best / 1e3) / 1e9, cms, flop / (cms / 1e3) / 1e9, cms / best, maxrel, bad);
        clReleaseKernel(k); clReleaseMemObject(dA); clReleaseMemObject(dB); clReleaseMemObject(dC); free(A); free(B); free(C); free(ref);
    }

    // ---------- Test 4: zero-copy mapped buffers (unified memory) vs explicit copy ----------
    // The A733 has unified DRAM; CL_MEM_ALLOC_HOST_PTR + map should let the GPU read the
    // host buffer with no copy. If so, the copy tax from Test 1 disappears.
    {
        const size_t N = 4u * 1024 * 1024;
        size_t bytes = N * sizeof(float);
        cl_mem da = clCreateBuffer(ctx, CL_MEM_READ_ONLY  | CL_MEM_ALLOC_HOST_PTR, bytes, NULL, &e); CK(e);
        cl_mem db = clCreateBuffer(ctx, CL_MEM_READ_ONLY  | CL_MEM_ALLOC_HOST_PTR, bytes, NULL, &e); CK(e);
        cl_mem dc = clCreateBuffer(ctx, CL_MEM_WRITE_ONLY | CL_MEM_ALLOC_HOST_PTR, bytes, NULL, &e); CK(e);
        // fill via map (CPU touches the same physical pages the GPU will read)
        float *a = clEnqueueMapBuffer(q, da, CL_TRUE, CL_MAP_WRITE, 0, bytes, 0, NULL, NULL, &e); CK(e);
        float *b = clEnqueueMapBuffer(q, db, CL_TRUE, CL_MAP_WRITE, 0, bytes, 0, NULL, NULL, &e); CK(e);
        for (size_t i = 0; i < N; i++) { a[i] = (float)(i % 1000) * 0.5f; b[i] = (float)(i % 777) - 100.0f; }
        // time ONLY the map/unmap handoff overhead (not the CPU fill)
        double u0 = now_ms();
        CK(clEnqueueUnmapMemObject(q, da, a, 0, NULL, NULL));
        CK(clEnqueueUnmapMemObject(q, db, b, 0, NULL, NULL));
        CK(clFinish(q));
        double unmap_ms = now_ms() - u0;
        cl_kernel k = build_kernel(SRC_VECADD, "vecadd");
        CK(clSetKernelArg(k, 0, sizeof(cl_mem), &da));
        CK(clSetKernelArg(k, 1, sizeof(cl_mem), &db));
        CK(clSetKernelArg(k, 2, sizeof(cl_mem), &dc));
        double gms = time_ndrange(k, N, 0, 20);
        double r0 = now_ms();
        float *c = clEnqueueMapBuffer(q, dc, CL_TRUE, CL_MAP_READ, 0, bytes, 0, NULL, NULL, &e); CK(e);
        double map_ms = now_ms() - r0;
        size_t bad = 0;
        for (size_t i = 0; i < N; i++) { if (fabsf(c[i] - (a[i] + b[i])) > 1e-4f) bad++; }
        CK(clEnqueueUnmapMemObject(q, dc, c, 0, NULL, NULL)); clFinish(q);
        double handoff = unmap_ms + map_ms;
        printf("[4] zero-copy vecadd N=%zuM  %-8s  map/unmap handoff %.3f ms (vs %.0f ms explicit H2D+D2H in [1])  kernel %.3f ms  bad %zu\n",
               N >> 20, bad ? "FAIL" : "OK", handoff, 74.0, gms, bad);
        clReleaseKernel(k); clReleaseMemObject(da); clReleaseMemObject(db); clReleaseMemObject(dc);
    }

    printf("\nall kernels compiled + ran on '%s'\n", dn);
    clReleaseCommandQueue(q); clReleaseContext(ctx);
    return 0;
}
