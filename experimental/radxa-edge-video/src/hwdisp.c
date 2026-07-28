// Cedar HW-decode H.264 -> scan out each NV12 frame on a DRM overlay plane.
// Zero-copy: the decoder's DMABUF fd is imported straight into the display.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <drm_fourcc.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"

extern VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

#include <sys/mman.h>
#include <sys/ioctl.h>
#include <drm.h>
#include <drm_mode.h>

static int drmfd;
static uint32_t crtc_id = 100, conn_id = 153, plane_id;
static int scr_w = 2560, scr_h = 1440;
static struct ScMemOpsS* g_memops;

// Hardcoded DP-1 2560x1440@60 timing (from modetest); used to force the link up
// even when the connector momentarily reports disconnected.
static drmModeModeInfo MODE_1440 = {
    .clock = 248870,
    .hdisplay = 2560, .hsync_start = 2608, .hsync_end = 2640, .htotal = 2720,
    .vdisplay = 1440, .vsync_start = 1443, .vsync_end = 1448, .vtotal = 1525,
    .vrefresh = 60, .flags = DRM_MODE_FLAG_PHSYNC | DRM_MODE_FLAG_NVSYNC,
    .name = "2560x1440",
};

static int drm_setup(void) {
    drmfd = open("/dev/dri/card0", O_RDWR | O_CLOEXEC);
    if (drmfd < 0) { perror("open card0"); return -1; }
    drmSetClientCap(drmfd, DRM_CLIENT_CAP_UNIVERSAL_PLANES, 1);
    drmSetMaster(drmfd);

    // find crtc index for the possible_crtcs bitmask
    drmModeRes* res = drmModeGetResources(drmfd);
    int crtc_idx = 0;
    for (int i = 0; i < res->count_crtcs; i++) if (res->crtcs[i] == crtc_id) crtc_idx = i;

    // create a dumb XRGB framebuffer (black) for the primary plane, force modeset
    struct drm_mode_create_dumb cd; memset(&cd, 0, sizeof(cd));
    cd.width = scr_w; cd.height = scr_h; cd.bpp = 32;
    if (ioctl(drmfd, DRM_IOCTL_MODE_CREATE_DUMB, &cd)) { perror("create_dumb"); return -1; }
    uint32_t fb = 0;
    if (drmModeAddFB(drmfd, scr_w, scr_h, 24, 32, cd.pitch, cd.handle, &fb)) { perror("AddFB"); return -1; }
    struct drm_mode_map_dumb md; memset(&md, 0, sizeof(md)); md.handle = cd.handle;
    ioctl(drmfd, DRM_IOCTL_MODE_MAP_DUMB, &md);
    void* map = mmap(0, cd.size, PROT_READ|PROT_WRITE, MAP_SHARED, drmfd, md.offset);
    if (map != MAP_FAILED) { memset(map, 0, cd.size); munmap(map, cd.size); }
    if (drmModeSetCrtc(drmfd, crtc_id, fb, 0, 0, &conn_id, 1, &MODE_1440)) {
        perror("SetCrtc"); return -1;
    }
    printf("modeset ok: crtc=%d conn=%d %dx%d\n", crtc_id, conn_id, scr_w, scr_h);

    // find an NV12-capable overlay plane bound to this crtc
    drmModePlaneRes* pr = drmModeGetPlaneResources(drmfd);
    for (uint32_t i = 0; i < pr->count_planes; i++) {
        drmModePlane* pl = drmModeGetPlane(drmfd, pr->planes[i]);
        if (!pl) continue;
        if (pl->possible_crtcs & (1 << crtc_idx)) {
            for (uint32_t f = 0; f < pl->count_formats; f++)
                if (pl->formats[f] == DRM_FORMAT_NV12 && pl->plane_id != 0) { plane_id = pl->plane_id; break; }
        }
        drmModeFreePlane(pl);
        if (plane_id) break;
    }
    printf("nv12 plane=%d\n", plane_id);
    return plane_id ? 0 : -1;
}

// Display-owned NV12 dumb buffer we copy each decoded frame into (rules out any
// decoder-DMABUF format/coherency quirk).
static uint8_t* dumb_map; static uint32_t dumb_fb, dumb_pitch; static int dumb_w, dumb_h;
static void dumb_init(int w, int h) {
    struct drm_mode_create_dumb cd; memset(&cd, 0, sizeof(cd));
    cd.width = w; cd.height = h * 3 / 2; cd.bpp = 8;   // NV12 = h*1.5 rows of 1 byte
    ioctl(drmfd, DRM_IOCTL_MODE_CREATE_DUMB, &cd);
    dumb_pitch = cd.pitch; dumb_w = w; dumb_h = h;
    uint32_t handles[4] = { cd.handle, cd.handle, 0, 0 };
    uint32_t pitches[4] = { cd.pitch, cd.pitch, 0, 0 };
    uint32_t offsets[4] = { 0, cd.pitch * h, 0, 0 };
    drmModeAddFB2(drmfd, w, h, DRM_FORMAT_NV12, handles, pitches, offsets, &dumb_fb, 0);
    struct drm_mode_map_dumb md; memset(&md, 0, sizeof(md)); md.handle = cd.handle;
    ioctl(drmfd, DRM_IOCTL_MODE_MAP_DUMB, &md);
    dumb_map = mmap(0, cd.size, PROT_READ|PROT_WRITE, MAP_SHARED, drmfd, md.offset);
    fprintf(stderr, "dumb NV12 %dx%d pitch=%u\n", w, h, cd.pitch);
}
static uint32_t show_frame(VideoPicture* pic) {
    if (!dumb_map) dumb_init(pic->nWidth, pic->nHeight);
    // copy Y then UV (source stride = nLineStride) into the dumb buffer
    for (int y = 0; y < pic->nHeight; y++)
        memcpy(dumb_map + y * dumb_pitch, pic->pData0 + y * pic->nLineStride, pic->nWidth);
    uint8_t* uvdst = dumb_map + dumb_pitch * pic->nHeight;
    for (int y = 0; y < pic->nHeight / 2; y++)
        memcpy(uvdst + y * dumb_pitch, pic->pData1 + y * pic->nLineStride, pic->nWidth);
    int dx = (scr_w - pic->nWidth) / 2, dy = (scr_h - pic->nHeight) / 2;
    drmModeSetPlane(drmfd, plane_id, crtc_id, dumb_fb, 0,
                    dx, dy, pic->nWidth, pic->nHeight,
                    0, 0, pic->nWidth << 16, pic->nHeight << 16);
    return dumb_fb;
}

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "/tmp/norton.h264";
    FILE* f = fopen(path, "rb"); if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    char* data = malloc(sz); fread(data, 1, sz, f); fclose(f);

    if (drm_setup() != 0) return 1;
    drmSetMaster(drmfd);

    AddVDPlugin();
    struct ScMemOpsS* memops = MemAdapterGetOpsS(); CdcMemOpen(memops); g_memops = memops;
    VeOpsS* veOps = GetVeOpsS(VE_OPS_TYPE_NORMAL);
    VeConfig veCfg; memset(&veCfg, 0, sizeof(veCfg)); veCfg.nDecoderFlag = 1; veCfg.memops = memops;
    void* veSelf = CdcVeInit(veOps, &veCfg);
    VideoStreamInfo si; memset(&si, 0, sizeof(si)); si.eCodecFormat = VIDEO_CODEC_FORMAT_H264;
    VConfig vc; memset(&vc, 0, sizeof(vc));
    vc.eOutputPixelFormat = PIXEL_FORMAT_NV12; vc.nFrameBufferNum = 12; vc.bDispErrorFrame = 1;
    vc.memops = memops; vc.veOpsS = veOps; vc.pVeOpsSelf = veSelf;
    VideoDecoder* dec = CreateVideoDecoder();
    if (InitializeVideoDecoder(dec, &si, &vc) != 0) { printf("init fail\n"); return 1; }
    printf("decoder ready, streaming to display...\n");

    VideoPicture* prev = NULL; uint32_t prev_fb = 0;
    int shown = 0;
    long i0 = 0;
    while (i0 + 3 < sz && !(data[i0]==0&&data[i0+1]==0&&data[i0+2]==1)) i0++;
    struct timespec t0; clock_gettime(CLOCK_MONOTONIC, &t0);
   for (int loop = 0; loop < 100000; loop++) {
    long au_start = i0, pos = i0; int au_has_vcl = 0;
    while (pos + 3 < sz) {
        long nal = pos + 3; int t = data[nal] & 0x1F; int isVCL = (t >= 1 && t <= 5);
        if (nal > au_start + 3 && au_has_vcl) {
            long alen = pos - au_start;
            char *pB=0,*pR=0; int bS=0,rS=0;
            if (RequestVideoStreamBuffer(dec, alen, &pB,&bS,&pR,&rS,0)==0 && bS+rS>=alen) {
                long fp = alen<=bS?alen:bS; memcpy(pB, data+au_start, fp);
                if (alen>bS && pR) memcpy(pR, data+au_start+bS, alen-bS);
                CdcMemFlushCache(memops, pB, fp);
                VideoStreamDataInfo di; memset(&di,0,sizeof(di));
                di.pData=pB; di.nLength=alen; di.bIsFirstPart=1; di.bIsLastPart=1; di.bValid=1;
                SubmitVideoStreamData(dec, &di, 0);
            }
            DecodeVideoStream(dec, 0, 0, 0, 0);
            VideoPicture* pic;
            while ((pic = RequestPicture(dec, 0)) != NULL) {
                show_frame(pic);       // copies the frame out, so we can return it now
                shown++;
                ReturnPicture(dec, pic);
                struct timespec ts = { 0, 33000000 }; nanosleep(&ts, NULL);
            }
            au_start = pos; au_has_vcl = 0;
        }
        au_has_vcl |= isVCL;
        long p = nal + 1;
        while (p + 3 < sz && !(data[p]==0&&data[p+1]==0&&data[p+2]==1)) p++;
        pos = (p + 3 < sz) ? p : sz;
    }
    {   struct timespec tt; clock_gettime(CLOCK_MONOTONIC, &tt);
        double s = (tt.tv_sec - t0.tv_sec) + (tt.tv_nsec - t0.tv_nsec)/1e9;
        printf("loop %d: displayed %d frames, %.1f fps effective\n", loop, shown, s>0?shown/s:0);
    }
   }
    return 0;
}
