// SPDX-License-Identifier: AGPL-3.0-only
/*
 * nbbench — time a raw NBG on the VIP9000 NPU and print the precision it actually runs at.
 *
 * Loads an .nb through VIPLite (no decode, no pre/post-process), reports the declared
 * input/output tensor formats and the per-inference wall cost over N iterations. Used to
 * compare the uint8 (NN_ASYMMETRIC_INT8) and float16 (NN_FP16_ALU) paths on the same model.
 *
 *   gcc -O2 -I<viplite>/inc nbbench.c -L<viplite> -lVIPhal -lNBGlinker -lm -o nbbench
 *   sudo LD_LIBRARY_PATH=<viplite> ./nbbench model.nb 100
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "vip_lite.h"

static const char *format_name(vip_enum f)
{
    switch (f) {
    case VIP_BUFFER_FORMAT_FP32:   return "fp32";
    case VIP_BUFFER_FORMAT_FP16:   return "fp16";
    case VIP_BUFFER_FORMAT_UINT8:  return "uint8";
    case VIP_BUFFER_FORMAT_INT8:   return "int8";
    case VIP_BUFFER_FORMAT_UINT16: return "uint16";
    case VIP_BUFFER_FORMAT_INT16:  return "int16";
    case VIP_BUFFER_FORMAT_INT32:  return "int32";
    case VIP_BUFFER_FORMAT_UINT32: return "uint32";
    case VIP_BUFFER_FORMAT_BFP16:  return "bf16";
    default:                       return "?";
    }
}

static const char *quant_name(vip_enum q)
{
    switch (q) {
    case VIP_BUFFER_QUANTIZE_DYNAMIC_FIXED_POINT: return "dfp";
    case VIP_BUFFER_QUANTIZE_TF_ASYMM:            return "asymm";
    case VIP_BUFFER_QUANTIZE_NONE:                return "none";
    default:                                      return "?";
    }
}

static double now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static int cmp_double(const void *a, const void *b)
{
    double x = *(const double *)a, y = *(const double *)b;
    return (x > y) - (x < y);
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s <model.nb> [iterations]\n", argv[0]);
        return 1;
    }
    const char *nbg = argv[1];
    int iters = (argc > 2) ? atoi(argv[2]) : 100;

    vip_status_e status = vip_init();
    if (status != VIP_SUCCESS) {
        fprintf(stderr, "vip_init failed: %d\n", status);
        return 1;
    }
    printf("VIPLite version=0x%08x\n", vip_get_version());

    vip_uint32_t cid = 0;
    vip_query_hardware(VIP_QUERY_HW_PROP_CID, sizeof(cid), &cid);
    printf("hardware cid=0x%x\n", cid);

    vip_network network = VIP_NULL;
    status = vip_create_network(nbg, 0, VIP_CREATE_NETWORK_FROM_FILE, &network);
    if (status != VIP_SUCCESS) {
        fprintf(stderr, "vip_create_network(%s) failed: %d\n", nbg, status);
        return 1;
    }

    vip_uint32_t in_count = 0, out_count = 0;
    vip_query_network(network, VIP_NETWORK_PROP_INPUT_COUNT, &in_count);
    vip_query_network(network, VIP_NETWORK_PROP_OUTPUT_COUNT, &out_count);

    vip_buffer *inputs = calloc(in_count, sizeof(vip_buffer));
    vip_buffer *outputs = calloc(out_count, sizeof(vip_buffer));

    for (vip_uint32_t i = 0; i < in_count; i++) {
        vip_buffer_create_params_t p;
        memset(&p, 0, sizeof(p));
        p.memory_type = VIP_BUFFER_MEMORY_TYPE_DEFAULT;
        vip_query_input(network, i, VIP_BUFFER_PROP_DATA_FORMAT, &p.data_format);
        vip_query_input(network, i, VIP_BUFFER_PROP_NUM_OF_DIMENSION, &p.num_of_dims);
        vip_query_input(network, i, VIP_BUFFER_PROP_SIZES_OF_DIMENSION, p.sizes);
        vip_query_input(network, i, VIP_BUFFER_PROP_QUANT_FORMAT, &p.quant_format);

        status = vip_create_buffer(&p, 0, &inputs[i]);
        if (status != VIP_SUCCESS) {
            fprintf(stderr, "vip_create_buffer(input %u) failed: %d\n", i, status);
            return 1;
        }
        printf("input  %u: format=%-6s quant=%-6s dims=%u [", i,
               format_name(p.data_format), quant_name(p.quant_format), p.num_of_dims);
        for (vip_uint32_t d = 0; d < p.num_of_dims; d++)
            printf("%u%s", p.sizes[d], d + 1 < p.num_of_dims ? "," : "");
        printf("] bytes=%u\n", vip_get_buffer_size(inputs[i]));

        /* Mid-scale constant: valid bit pattern for every format we benchmark. */
        void *logical = vip_map_buffer(inputs[i]);
        if (logical)
            memset(logical, 0x38, vip_get_buffer_size(inputs[i]));
        vip_unmap_buffer(inputs[i]);
    }

    for (vip_uint32_t i = 0; i < out_count; i++) {
        vip_buffer_create_params_t p;
        memset(&p, 0, sizeof(p));
        p.memory_type = VIP_BUFFER_MEMORY_TYPE_DEFAULT;
        vip_query_output(network, i, VIP_BUFFER_PROP_DATA_FORMAT, &p.data_format);
        vip_query_output(network, i, VIP_BUFFER_PROP_NUM_OF_DIMENSION, &p.num_of_dims);
        vip_query_output(network, i, VIP_BUFFER_PROP_SIZES_OF_DIMENSION, p.sizes);
        vip_query_output(network, i, VIP_BUFFER_PROP_QUANT_FORMAT, &p.quant_format);

        status = vip_create_buffer(&p, 0, &outputs[i]);
        if (status != VIP_SUCCESS) {
            fprintf(stderr, "vip_create_buffer(output %u) failed: %d\n", i, status);
            return 1;
        }
        printf("output %u: format=%-6s quant=%-6s dims=%u [", i,
               format_name(p.data_format), quant_name(p.quant_format), p.num_of_dims);
        for (vip_uint32_t d = 0; d < p.num_of_dims; d++)
            printf("%u%s", p.sizes[d], d + 1 < p.num_of_dims ? "," : "");
        printf("] bytes=%u\n", vip_get_buffer_size(outputs[i]));
    }

    vip_uint32_t pool = 0;
    vip_query_network(network, VIP_NETWORK_PROP_MEMORY_POOL_SIZE, &pool);
    printf("memory pool=%u bytes\n", pool);

    double t0 = now_ms();
    status = vip_prepare_network(network);
    printf("vip_prepare_network: %.1f ms (status=%d)\n", now_ms() - t0, status);
    if (status != VIP_SUCCESS)
        return 1;

    /* I/O binding is only valid after prepare. */
    for (vip_uint32_t i = 0; i < in_count; i++)
        vip_set_input(network, i, inputs[i]);
    for (vip_uint32_t i = 0; i < out_count; i++)
        vip_set_output(network, i, outputs[i]);

    for (int i = 0; i < 3; i++)
        vip_run_network(network);

    double *samples = calloc(iters, sizeof(double));
    double total = 0;
    for (int i = 0; i < iters; i++) {
        double t = now_ms();
        status = vip_run_network(network);
        samples[i] = now_ms() - t;
        total += samples[i];
        if (status != VIP_SUCCESS) {
            fprintf(stderr, "vip_run_network failed at iter %d: %d\n", i, status);
            return 1;
        }
    }
    qsort(samples, iters, sizeof(double), cmp_double);

    double mean = total / iters;
    printf("\n%s: %d runs  min=%.2f ms  p50=%.2f ms  mean=%.2f ms  max=%.2f ms  => %.2f inf/s\n",
           nbg, iters, samples[0], samples[iters / 2], mean, samples[iters - 1], 1000.0 / mean);

    for (vip_uint32_t i = 0; i < in_count; i++)
        vip_destroy_buffer(inputs[i]);
    for (vip_uint32_t i = 0; i < out_count; i++)
        vip_destroy_buffer(outputs[i]);
    vip_destroy_network(network);
    vip_destroy();
    return 0;
}
