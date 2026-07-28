// Minimal direct-DRM test: scan out an RGB (XRGB8888) framebuffer on the PRIMARY
// plane via drmModeSetCrtc (bypasses the broken kmssink). If this shows a clean
// 4-quadrant color pattern on the panel, the direct-DRM RGB path works and we
// integrate it into the detection pipeline. RGB primary avoids the NV12-overlay
// green-lines quirk entirely.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <drm.h>
#include <drm_mode.h>

// The USB-C DP-alt-mode port trains at only 2 DP lanes (USB3 shares the connector),
// so 2560x1440@60 (248MHz) never link-trains. Use the panel's EDID *preferred* mode
// 1920x1080@60 (148MHz), which fits the 2-lane budget.
static uint32_t crtc_id = 100, conn_id = 153;
static int W = 1920, H = 1080;
static drmModeModeInfo MODE = {
    .clock = 148500,
    .hdisplay = 1920, .hsync_start = 2008, .hsync_end = 2052, .htotal = 2200,
    .vdisplay = 1080, .vsync_start = 1084, .vsync_end = 1089, .vtotal = 1125,
    .vrefresh = 60, .flags = DRM_MODE_FLAG_NHSYNC | DRM_MODE_FLAG_NVSYNC,
    .name = "1920x1080",
};

int main(void) {
    int fd = open("/dev/dri/card0", O_RDWR | O_CLOEXEC);
    if (fd < 0) { perror("open card0"); return 1; }
    drmSetMaster(fd);
    struct drm_mode_create_dumb cd; memset(&cd, 0, sizeof(cd));
    cd.width = W; cd.height = H; cd.bpp = 32;
    if (ioctl(fd, DRM_IOCTL_MODE_CREATE_DUMB, &cd)) { perror("create_dumb"); return 1; }
    uint32_t fb = 0;
    if (drmModeAddFB(fd, W, H, 24, 32, cd.pitch, cd.handle, &fb)) { perror("AddFB"); return 1; }
    struct drm_mode_map_dumb md; memset(&md, 0, sizeof(md)); md.handle = cd.handle;
    ioctl(fd, DRM_IOCTL_MODE_MAP_DUMB, &md);
    uint8_t* map = mmap(0, cd.size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, md.offset);
    if (map == MAP_FAILED) { perror("mmap"); return 1; }

    // XRGB8888 word = 0x00RRGGBB:  red, green, blue, white quadrants
    uint32_t col[4] = { 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFFFF };
    for (int y = 0; y < H; y++) {
        uint32_t* row = (uint32_t*)(map + y * cd.pitch);
        for (int x = 0; x < W; x++)
            row[x] = col[(y < H/2 ? 0 : 2) + (x < W/2 ? 0 : 1)];
    }
    if (drmModeSetCrtc(fd, crtc_id, fb, 0, 0, &conn_id, 1, &MODE)) { perror("SetCrtc"); return 1; }
    printf("displayed 2560x1440 RGB test pattern on primary plane\n");
    sleep(60);
    return 0;
}
