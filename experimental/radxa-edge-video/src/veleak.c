// veleak.c — prove the Cedar decoder start/stop lifecycle leaks NO dma_buf.
// Creates N decoders, feeds them a file, decodes a few frames, then tears down
// cleanly (DestroyVideoDecoder + CdcVeRelease per decoder, CdcMemClose) and
// repeats ITERS times inside ONE process, printing the dma_buf object count each
// cycle. If teardown is leak-free the count returns to baseline every iteration.
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

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

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

// Decode up to `frames` access units from an annexb buffer on decoder `dec`.
static void feed_some(VideoDecoder* dec, const char* data, long sz, int frames) {
    long i = 0;
    while (i + 3 < sz && !(data[i]==0&&data[i+1]==0&&data[i+2]==1)) i++;
    long au_start = i, pos = i; int au_has_vcl = 0, decoded = 0;
    while (pos + 3 < sz && decoded < frames) {
        long nal = pos + 3; int t = data[nal] & 0x1F; int isVCL = (t >= 1 && t <= 5);
        if (nal > au_start + 3 && au_has_vcl) {
            long alen = pos - au_start;
            char *pB=0,*pR=0; int bS=0,rS=0;
            if (RequestVideoStreamBuffer(dec, alen, &pB,&bS,&pR,&rS,0)==0 && bS+rS>=alen) {
                long f = alen<=bS?alen:bS; memcpy(pB, data+au_start, f);
                if (alen>bS && pR) memcpy(pR, data+au_start+bS, alen-bS);
                CdcMemFlushCache(memops, pB, f);
                VideoStreamDataInfo di; memset(&di,0,sizeof(di));
                di.pData=pB; di.nLength=alen; di.bIsFirstPart=1; di.bIsLastPart=1; di.bValid=1;
                SubmitVideoStreamData(dec, &di, 0);
            }
            DecodeVideoStream(dec, 0, 0, 0, 0);
            VideoPicture* pic;
            while ((pic = RequestPicture(dec, 0)) != NULL) { decoded++; ReturnPicture(dec, pic); }
            au_start = pos; au_has_vcl = 0;
        }
        au_has_vcl |= isVCL;
        long p = nal + 1;
        while (p + 3 < sz && !(data[p]==0&&data[p+1]==0&&data[p+2]==1)) p++;
        pos = (p + 3 < sz) ? p : sz;
    }
}

int main(int argc, char** argv) {
    int N     = argc > 1 ? atoi(argv[1]) : 4;
    int ITERS = argc > 2 ? atoi(argv[2]) : 5;
    const char* path = argc > 3 ? argv[3] : "/home/radxa/cedar/norton.h264";

    FILE* f = fopen(path, "rb"); if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    char* data = malloc(sz); if (fread(data,1,sz,f)!=(size_t)sz){} fclose(f);

    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    int baseline = dma_objects();
    printf("baseline dma_buf objects (mem open) = %d\n", baseline);

    for (int it = 0; it < ITERS; it++) {
        VideoDecoder* decs[16]; void* ve[16];
        for (int i = 0; i < N; i++) {
            VeConfig veCfg; memset(&veCfg,0,sizeof(veCfg)); veCfg.nDecoderFlag=1; veCfg.memops=memops;
            ve[i] = CdcVeInit(veOps, &veCfg);
            VideoStreamInfo si; memset(&si,0,sizeof(si)); si.eCodecFormat=VIDEO_CODEC_FORMAT_H264;
            VConfig vc; memset(&vc,0,sizeof(vc));
            vc.eOutputPixelFormat=PIXEL_FORMAT_NV12; vc.nFrameBufferNum=8; vc.bDispErrorFrame=1;
            vc.memops=memops; vc.veOpsS=veOps; vc.pVeOpsSelf=ve[i];
            decs[i] = CreateVideoDecoder();
            if (InitializeVideoDecoder(decs[i], &si, &vc) != 0) { printf("init %d fail\n", i); return 1; }
        }
        for (int i = 0; i < N; i++) feed_some(decs[i], data, sz, 30);
        int active = dma_objects();
        // clean teardown: destroy decoder, then release its VE context
        for (int i = 0; i < N; i++) { DestroyVideoDecoder(decs[i]); CdcVeRelease(veOps, ve[i]); }
        int after = dma_objects();
        printf("iter %d: %d decoders -> active=%d objs, after teardown=%d objs %s\n",
               it, N, active, after, after == baseline ? "(clean)" : "(!!! LEAK)");
    }

    CdcMemClose(memops);
    printf("final dma_buf objects (mem closed) = %d\n", dma_objects());
    return 0;
}
