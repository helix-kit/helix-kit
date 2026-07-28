// Minimal Cedar (Allwinner VE) hardware H.264 decode via libvdecoder.
// Milestone 1: decode an annexb .h264 file, save the first decoded NV12 frame.
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

// Exported by libVE / libvideoengine but not declared in the public headers.
// Takes an EVEOPSTYPE (VE_OPS_TYPE_NORMAL for H.264).
extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "/tmp/test.h264";
    FILE* f = fopen(path, "rb");
    if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    char* data = malloc(sz);
    if (fread(data, 1, sz, f) != (size_t)sz) { printf("read short\n"); }
    fclose(f);
    printf("loaded %ld bytes from %s\n", sz, path);

    AddVDPlugin();
    struct ScMemOpsS* memops = MemAdapterGetOpsS();
    if (!memops) { printf("MemAdapterGetOpsS NULL\n"); return 1; }
    printf("memops=%p open=%d\n", (void*)memops, CdcMemOpen(memops));

    VeOpsS* veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    printf("veOps=%p\n", (void*)veOps);
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg));
    veCfg.nDecoderFlag = 1;
    veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    printf("veSelf=%p\n", veSelf);

    VideoStreamInfo si; memset(&si, 0, sizeof(si));
    si.eCodecFormat = VIDEO_CODEC_FORMAT_H264;

    VConfig vc; memset(&vc, 0, sizeof(vc));
    vc.eOutputPixelFormat = PIXEL_FORMAT_NV12;
    vc.nFrameBufferNum = 8;
    vc.bDispErrorFrame = 1;
    vc.memops = memops;
    vc.veOpsS = veOps;
    vc.pVeOpsSelf = veSelf;

    VideoDecoder* dec = CreateVideoDecoder();
    if (!dec) { printf("CreateVideoDecoder NULL\n"); return 1; }
    int r = InitializeVideoDecoder(dec, &si, &vc);
    printf("InitializeVideoDecoder=%d\n", r);
    if (r != 0) return 1;

    // --- feed one access unit per submit, decode as we go ---
    #define NAL_TYPE(p) ((p)[0] & 0x1F)
    int decoded = 0, saved = 0;
    long i = 0;
    // find first start code
    while (i + 3 < sz && !(data[i]==0&&data[i+1]==0&&data[i+2]==1)) i++;
    long au_start = i; int au_has_vcl = 0;
    long pos = i;
    while (pos + 3 < sz) {
        // at a start code (00 00 01); locate NAL header byte
        long nal = pos + 3;
        int t = data[nal] & 0x1F;
        int isVCL = (t >= 1 && t <= 5);
        if (nal > au_start + 3 && au_has_vcl) {
            // boundary: flush AU [au_start, pos)
            long alen = pos - au_start;
            char *pB=0,*pR=0; int bS=0,rS=0;
            if (RequestVideoStreamBuffer(dec, alen, &pB,&bS,&pR,&rS,0)==0 && bS+rS>=alen) {
                long f = alen<=bS?alen:bS;
                memcpy(pB, data+au_start, f);
                if (alen>bS && pR) memcpy(pR, data+au_start+bS, alen-bS);
                CdcMemFlushCache(memops, pB, f);
                VideoStreamDataInfo di; memset(&di,0,sizeof(di));
                di.pData=pB; di.nLength=alen; di.bIsFirstPart=1; di.bIsLastPart=1; di.bValid=1;
                SubmitVideoStreamData(dec, &di, 0);
            }
            int rc = DecodeVideoStream(dec, 0, 0, 0, 0);
            if (decoded < 3) printf("AU len=%ld decode=%d\n", pos-au_start, rc);
            VideoPicture* pic;
            while ((pic = RequestPicture(dec, 0)) != NULL) {
                decoded++;
                if (decoded == 80 && saved < 1) {
                    CdcMemFlushCache(memops, pic->pData0, (size_t)pic->nLineStride * pic->nHeight * 3 / 2);
                    printf("PIC #%d %dx%d stride=%d fmt=%d\n",
                           decoded, pic->nWidth, pic->nHeight, pic->nLineStride, pic->ePixelFormat);
                    FILE* o = fopen("/home/radxa/cedar/frame80.nv12", "wb");
                    if (o && pic->pData0) {
                        fwrite(pic->pData0, 1, (size_t)pic->nLineStride * pic->nHeight, o);
                        if (pic->pData1) fwrite(pic->pData1, 1, (size_t)pic->nLineStride * pic->nHeight / 2, o);
                        fclose(o); saved++;
                    }
                }
                ReturnPicture(dec, pic);
            }
            au_start = pos; au_has_vcl = 0;
        }
        au_has_vcl |= isVCL;
        // advance to next start code
        long p = nal + 1;
        while (p + 3 < sz && !(data[p]==0&&data[p+1]==0&&data[p+2]==1)) p++;
        pos = (p + 3 < sz) ? p : sz;
    }
    // flush remaining + EOS
    DecodeVideoStream(dec, 1, 0, 0, 0);
    { VideoPicture* pic; while ((pic = RequestPicture(dec, 0)) != NULL) { decoded++; ReturnPicture(dec, pic); } }
    printf("RESULT: decoded %d frames, saved %d\n", decoded, saved);
    DestroyVideoDecoder(dec);
    return 0;
}
