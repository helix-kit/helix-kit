// encleak.c — prove the Cedar H.264 encoder start/stop lifecycle leaks no dma_buf
// (repeats ITERS create/encode/teardown cycles, printing the dma_buf object count each).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"
#include "vencoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

#define ENC_W 1280
#define ENC_H 720
static struct ScMemOpsS* memops;
static VeOpsS* veOps;

static int dma_objects(void) {
    FILE* f = fopen("/sys/kernel/debug/dma_buf/bufinfo", "r");
    if (!f) return -1;
    char line[256]; int obj = -1, n;
    while (fgets(line, sizeof(line), f))
        if (sscanf(line, "Total %d objects", &n) == 1) obj = n;
    fclose(f);
    return obj;
}

int main(int argc, char** argv) {
    int ITERS = argc > 1 ? atoi(argv[1]) : 5;
    int FRAMES = argc > 2 ? atoi(argv[2]) : 20;

    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    int baseline = dma_objects();
    printf("baseline dma_buf objects = %d\n", baseline);

    for (int it = 0; it < ITERS; it++) {
        VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nEncoderFlag = 1; veCfg.memops = memops;
        void* veSelf = CdcVeInit(veOps, &veCfg);
        VideoEncoder* venc = VideoEncCreate(VENC_CODEC_H264);
        if (!venc) { printf("VideoEncCreate fail\n"); return 1; }
        int fps = 25, br = 4000000, ki = 50;
        VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
        VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
        VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
        VencBaseConfig cfg; memset(&cfg, 0, sizeof(cfg));
        cfg.nInputWidth = ENC_W; cfg.nInputHeight = ENC_H;
        cfg.nDstWidth = ENC_W; cfg.nDstHeight = ENC_H; cfg.nStride = ENC_W;
        cfg.eInputFormat = VENC_PIXEL_YUV420SP; cfg.bEncH264Nalu = 1;
        cfg.memops = memops; cfg.veOpsS = veOps; cfg.pVeOpsSelf = veSelf;
        if (VideoEncInit(venc, &cfg) != 0) { printf("VideoEncInit fail\n"); return 1; }
        VencAllocateBufferParam ap; memset(&ap, 0, sizeof(ap));
        ap.nBufferNum = 4; ap.nSizeY = ENC_W * ENC_H; ap.nSizeC = ENC_W * ENC_H / 2;
        AllocInputBuffer(venc, &ap);

        long long pts = 0;
        for (int f = 0; f < FRAMES; f++) {
            VencInputBuffer in; memset(&in, 0, sizeof(in));
            if (GetOneAllocInputBuffer(venc, &in) != 0) break;
            memset(in.pAddrVirY, 128, (size_t)ENC_W * ENC_H);          // gray luma
            memset(in.pAddrVirC, 128, (size_t)ENC_W * ENC_H / 2);      // neutral chroma
            in.nPts = pts; pts += 40000;
            FlushCacheAllocInputBuffer(venc, &in);
            AddOneInputBuffer(venc, &in);
            VideoEncodeOneFrame(venc);
            ReturnOneAllocInputBuffer(venc, &in);
            VencOutputBuffer ob; memset(&ob, 0, sizeof(ob));
            if (GetOneBitstreamFrame(venc, &ob) == 0) FreeOneBitStreamFrame(venc, &ob);
        }
        int active = dma_objects();
        ReleaseAllocInputBuffer(venc);
        VideoEncUnInit(venc);
        VideoEncDestroy(venc);
        CdcVeRelease(veOps, veSelf);
        int after = dma_objects();
        printf("iter %d: encoder+%d frames -> active=%d objs, after teardown=%d objs %s\n",
               it, FRAMES, active, after, after == baseline ? "(clean)" : "(!!! LEAK)");
    }

    CdcMemClose(memops);
    printf("final dma_buf objects = %d\n", dma_objects());
    return 0;
}
