// encdump.c — inspect the RAW Cedar H.264 encoder output format (no conversion).
// Encodes synthetic NV12 frames and dumps, for the first few frames, the byte
// sizes and the first 16 bytes of the bitstream, plus the SPS/PPS header before
// and after the first encode. Answers: is the output annexb (00000001 start
// codes) or length-prefixed AVC? Writes the raw concatenated stream to a file.
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

static void hexn(const char* tag, const unsigned char* p, int n, int max) {
    printf("%s", tag);
    for (int i = 0; i < n && i < max; i++) printf(" %02x", p[i]);
    printf("\n");
}
#define hex16(t,p,n) hexn(t,p,n,16)

int main(int argc, char** argv) {
    int FRAMES = argc > 1 ? atoi(argv[1]) : 12;
    int NALU   = argc > 2 ? atoi(argv[2]) : 1;   // bEncH264Nalu toggle
    struct ScMemOpsS* memops;
    VeOpsS* veOps;
    AddVDPlugin();
    memops = MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);

    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nEncoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    VideoEncoder* venc = VideoEncCreate(VENC_CODEC_H264);
    int fps = 25, br = 4000000, ki = 30;
    VideoEncSetParameter(venc, VENC_IndexParamFramerate, &fps);
    VideoEncSetParameter(venc, VENC_IndexParamBitrate, &br);
    VideoEncSetParameter(venc, VENC_IndexParamMaxKeyInterval, &ki);
    VencBaseConfig cfg; memset(&cfg, 0, sizeof(cfg));
    cfg.nInputWidth = ENC_W; cfg.nInputHeight = ENC_H;
    cfg.nDstWidth = ENC_W; cfg.nDstHeight = ENC_H; cfg.nStride = ENC_W;
    cfg.eInputFormat = VENC_PIXEL_YUV420SP; cfg.bEncH264Nalu = NALU;
    printf("=== bEncH264Nalu=%d ===\n", NALU);
    cfg.memops = memops; cfg.veOpsS = veOps; cfg.pVeOpsSelf = veSelf;
    if (VideoEncInit(venc, &cfg) != 0) { printf("VideoEncInit fail\n"); return 1; }
    VencAllocateBufferParam ap; memset(&ap, 0, sizeof(ap));
    ap.nBufferNum = 4; ap.nSizeY = ENC_W * ENC_H; ap.nSizeC = ENC_W * ENC_H / 2;
    AllocInputBuffer(venc, &ap);

    VencHeaderData hd0; memset(&hd0, 0, sizeof(hd0));
    int r0 = VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd0);
    printf("SPS/PPS BEFORE encode: rc=%d len=%d\n", r0, hd0.nLength);
    if (hd0.nLength > 0) hexn("  hdr(raw):", hd0.pBuffer, hd0.nLength, 64);
    if (hd0.nLength > 0 && hd0.pBuffer) {
        CdcMemFlushCache(memops, hd0.pBuffer, hd0.nLength);
        hexn("  hdr(flushed):", hd0.pBuffer, hd0.nLength, 64);
    }

    FILE* raw = fopen("/tmp/enc_raw.h264", "wb");
    long long pts = 0;
    for (int f = 0; f < FRAMES; f++) {
        VencInputBuffer in; memset(&in, 0, sizeof(in));
        if (GetOneAllocInputBuffer(venc, &in) != 0) { printf("GetInBuf fail f=%d\n", f); break; }
        // gradient luma so frames aren't degenerate; neutral chroma
        for (int y = 0; y < ENC_H; y++)
            memset((unsigned char*)in.pAddrVirY + y * ENC_W, (y + f * 4) & 0xff, ENC_W);
        memset(in.pAddrVirC, 128, (size_t)ENC_W * ENC_H / 2);
        in.nPts = pts; pts += 40000;
        FlushCacheAllocInputBuffer(venc, &in);
        AddOneInputBuffer(venc, &in);
        int erc = VideoEncodeOneFrame(venc);
        AlreadyUsedInputBuffer(venc, &in);   // <-- canonical recycle step (was missing)
        ReturnOneAllocInputBuffer(venc, &in);
        // drain ALL bitstream units produced by this encode
        int unit = 0;
        for (;;) {
            VencOutputBuffer ob; memset(&ob, 0, sizeof(ob));
            int brc = GetOneBitstreamFrame(venc, &ob);
            if (brc != 0) { if (f < 5 && unit == 0) printf("frame %d: encRc=%d NO bitstream (brc=%d)\n", f, erc, brc); break; }
            if (f < 5)
                printf("frame %d unit %d: encRc=%d nSize0=%d nSize1=%d flag=%d\n",
                       f, unit, erc, ob.nSize0, ob.nSize1, ob.nFlag);
            if (f < 5 && ob.nSize0 >= 8) hex16("  data0:", (unsigned char*)ob.pData0, ob.nSize0);
            if (raw) {
                if (ob.nSize0) fwrite(ob.pData0, 1, ob.nSize0, raw);
                if (ob.nSize1) fwrite(ob.pData1, 1, ob.nSize1, raw);
            }
            FreeOneBitStreamFrame(venc, &ob);
            unit++;
        }
        if (f == 1) {
            VencHeaderData hd1; memset(&hd1, 0, sizeof(hd1));
            int r1 = VideoEncGetParameter(venc, VENC_IndexParamH264SPSPPS, &hd1);
            printf("SPS/PPS AFTER encode: rc=%d len=%d\n", r1, hd1.nLength);
            if (hd1.nLength > 0) hexn("  hdr:", hd1.pBuffer, hd1.nLength, 64);
        }
    }
    if (raw) fclose(raw);
    ReleaseAllocInputBuffer(venc); VideoEncUnInit(venc); VideoEncDestroy(venc); CdcVeRelease(veOps, veSelf);
    CdcMemClose(memops);
    printf("wrote /tmp/enc_raw.h264\n");
    return 0;
}
