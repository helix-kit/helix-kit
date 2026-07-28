// 4-stream NPU object detection throughput test with direct-DRM local display.
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <opencv2/opencv.hpp>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <csignal>
#include <pthread.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>
#include <time.h>
#include <vector>
#include <algorithm>
#include <awnn_lib.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <drm.h>
#include <drm_mode.h>
#include "typedef.h"
#include "vbasetype.h"
#include "veInterface.h"
#include "memoryAdapter.h"
#include "sc_interface.h"
#include "vdecoder.h"
#include "vencoder.h"
extern "C" VeOpsS* GetVeOpsS(enum EVEOPSTYPE type);

#define NCAM 4
#define S 640            // model input side
#define GW 1280
#define GH 720
#define CW 640
#define CH 360
// USB-C DP-alt-mode trains only 2 DP lanes → 2560x1440@60 never link-trains (black).
// The panel's EDID-preferred mode 1920x1080@60 fits the 2-lane budget; use it.
#define DW 1920   // display width  (DP-alt-mode preferred mode)
#define DH 1080   // display height

// YOLOv5 decode (reused verbatim from vendor yolov5_post_process.cpp).
struct Object { cv::Rect_<float> rect; int label; float prob; };
static inline float sigmoid(float x){ return 1.f/(1.f+expf(-x)); }
static inline float desigmoid(float x){ return -logf(1.f/x-1.f); }
static inline float inter_area(const Object&a,const Object&b){ cv::Rect_<float> i=a.rect&b.rect; return i.area(); }
static void qsort_desc(std::vector<Object>&f,int l,int r){ int i=l,j=r; float p=f[(l+r)/2].prob;
    while(i<=j){ while(f[i].prob>p)i++; while(f[j].prob<p)j--; if(i<=j){std::swap(f[i],f[j]);i++;j--;} }
    if(l<j)qsort_desc(f,l,j); if(i<r)qsort_desc(f,i,r); }
static void qsort_desc(std::vector<Object>&f){ if(!f.empty())qsort_desc(f,0,(int)f.size()-1); }
static void nms(const std::vector<Object>&o,std::vector<int>&picked,float thr){ picked.clear();
    int n=o.size(); std::vector<float> areas(n); for(int i=0;i<n;i++)areas[i]=o[i].rect.area();
    for(int i=0;i<n;i++){ const Object&a=o[i]; int keep=1; for(size_t j=0;j<picked.size();j++){ const Object&b=o[picked[j]];
        float ia=inter_area(a,b),ua=areas[i]+areas[picked[j]]-ia; if(ia/ua>thr){keep=0;break;} } if(keep)picked.push_back(i); } }
static void gen_proposals(int stride,const float*feat,float pth,std::vector<Object>&objs,int lc,int lr){
    static float anchors[18]={10,13,16,30,33,23,30,61,62,45,59,119,116,90,156,198,373,326};
    int anum=3,fw=lc/stride,fh=lr/stride,cls=80,ag=(stride==8?1:stride==16?2:3);
    float dth=desigmoid(pth); int fs=fw*fh, fsc5=fs*(cls+5);
    for(int h=0;h<fh;h++){ int hfw=h*fw*(cls+5);
      for(int w=0;w<fw;w++){ int wc5=w*(cls+5);
        for(int a=0;a<anum;a++){ int ci=0; float cs=-FLT_MAX; int ai=a*fsc5+hfw+wc5; const float*fp=&feat[ai+4];
          for(int s=0;s<cls;s++) if(*(fp+s+1)>cs){ci=s;cs=*(fp+s+1);}
          float bs=*fp, final=0.f; if(bs>=dth&&cs>=dth) final=sigmoid(bs)*sigmoid(cs);
          if(final>=pth){ int li=ai; float dx=sigmoid(feat[li]),dy=sigmoid(feat[li+1]),dw=sigmoid(feat[li+2]),dh=sigmoid(feat[li+3]);
            float pcx=(dx*2.f-0.5f+w)*stride, pcy=(dy*2.f-0.5f+h)*stride;
            float aw=anchors[(ag-1)*6+a*2], ah=anchors[(ag-1)*6+a*2+1];
            float pw=dw*dw*4.f*aw, ph=dh*dh*4.f*ah;
            Object o; o.rect.x=pcx-pw*0.5f; o.rect.y=pcy-ph*0.5f; o.rect.width=pw; o.rect.height=ph; o.label=ci; o.prob=final; objs.push_back(o); } } } }
}
static const char* CLS[]={"person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"};

// letterbox a BGR frame into a 640x640 CHW uint8 RGB buffer (matches vendor preprocess)
static void preprocess(const cv::Mat& bgr, unsigned char* out){
    cv::Mat img; cv::cvtColor(bgr,img,cv::COLOR_BGR2RGB);
    float sl = std::min(S*1.f/img.rows, S*1.f/img.cols);
    int rc=int(sl*img.cols), rr=int(sl*img.rows);
    cv::resize(img,img,cv::Size(rc,rr));
    cv::Mat canvas(S,S,CV_8UC3,cv::Scalar(0,0,0));
    int top=(S-rr)/2, left=(S-rc)/2;
    img.copyTo(canvas(cv::Rect(left,top,rc,rr)));
    // HWC -> CHW
    for(int h=0;h<S;h++) for(int w=0;w<S;w++){ const cv::Vec3b&p=canvas.at<cv::Vec3b>(h,w);
        for(int c=0;c<3;c++) out[c*S*S+h*S+w]=p[c]; }
}
// decode outputs, NMS, map boxes back to the original frame size, draw in place
static int detect_draw(cv::Mat& bgr, float** output){
    std::vector<Object> prop;
    gen_proposals(32,output[2],0.4f,prop,S,S);
    gen_proposals(16,output[1],0.4f,prop,S,S);
    gen_proposals(8, output[0],0.4f,prop,S,S);
    qsort_desc(prop); std::vector<int> picked; nms(prop,picked,0.45f);
    float sl=std::min(S*1.f/bgr.rows,S*1.f/bgr.cols);
    int rc=int(sl*bgr.cols), rr=int(sl*bgr.rows), tw=(S-rc)/2, th=(S-rr)/2;
    float rx=(float)bgr.cols/rc, ry=(float)bgr.rows/rr;
    for(int idx:picked){ Object o=prop[idx];
        float x0=(o.rect.x-tw)*rx, y0=(o.rect.y-th)*ry, x1=(o.rect.x+o.rect.width-tw)*rx, y1=(o.rect.y+o.rect.height-th)*ry;
        x0=std::max(0.f,std::min(x0,bgr.cols-1.f)); y0=std::max(0.f,std::min(y0,bgr.rows-1.f));
        x1=std::max(0.f,std::min(x1,bgr.cols-1.f)); y1=std::max(0.f,std::min(y1,bgr.rows-1.f));
        cv::rectangle(bgr,cv::Point(x0,y0),cv::Point(x1,y1),cv::Scalar(0,255,0),2);
        char t[128]; snprintf(t,sizeof(t),"%s %.0f%%",CLS[o.label],o.prob*100);
        cv::putText(bgr,t,cv::Point(x0,std::max(12.f,y0-4)),cv::FONT_HERSHEY_SIMPLEX,0.5,cv::Scalar(0,255,0),1);
    }
    return picked.size();
}

static double now_ms(){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1000.0+t.tv_nsec/1e6; }

static gboolean bus_cb(GstBus* b, GstMessage* m, gpointer u){ (void)b;(void)u;
    if(GST_MESSAGE_TYPE(m)==GST_MESSAGE_ERROR){ GError*e;gchar*d; gst_message_parse_error(m,&e,&d);
        fprintf(stderr,"GST-ERROR [%s]: %s | %s\n",GST_OBJECT_NAME(m->src),e->message,d?d:""); g_error_free(e);g_free(d); }
    else if(GST_MESSAGE_TYPE(m)==GST_MESSAGE_WARNING){ GError*e;gchar*d; gst_message_parse_warning(m,&e,&d);
        fprintf(stderr,"GST-WARN [%s]: %s\n",GST_OBJECT_NAME(m->src),e->message); g_error_free(e);g_free(d); }
    return TRUE; }

#define NWORK 2                 // NPU worker threads, each with its own awnn context
static GstAppSink* sinks[NCAM];
static GstElement* pipes[NCAM];
static GstElement* disp;
static GstAppSrc*  encsrc;

// Direct-DRM standalone display: scans the grid to the panel via drmModeSetCrtc on a dumb
// XRGB8888 framebuffer, no compositor. 1920x1080 only (DP-alt-mode 2-lane budget).
struct DrmFb { uint32_t handle, fb, pitch; size_t size; uint8_t* map; };
static int drm_fd=-1, drm_bi=0, drm_ready=0;
static DrmFb drm_fb[2];
static const uint32_t DRM_CRTC=100, DRM_CONN=153;
static drmModeModeInfo DRM_MODE;   // filled in drm_init (C++ dislikes designated init here)
static int drm_init(void){
    memset(&DRM_MODE,0,sizeof(DRM_MODE));
    DRM_MODE.clock=148500;
    DRM_MODE.hdisplay=1920; DRM_MODE.hsync_start=2008; DRM_MODE.hsync_end=2052; DRM_MODE.htotal=2200;
    DRM_MODE.vdisplay=1080; DRM_MODE.vsync_start=1084; DRM_MODE.vsync_end=1089; DRM_MODE.vtotal=1125;
    DRM_MODE.vrefresh=60; DRM_MODE.flags=DRM_MODE_FLAG_NHSYNC|DRM_MODE_FLAG_NVSYNC;
    strcpy(DRM_MODE.name,"1920x1080");
    drm_fd=open("/dev/dri/card0",O_RDWR|O_CLOEXEC);
    if(drm_fd<0){ perror("drm open"); return -1; }
    drmSetMaster(drm_fd);
    for(int i=0;i<1;i++){
        struct drm_mode_create_dumb cd; memset(&cd,0,sizeof(cd));
        cd.width=DW; cd.height=DH; cd.bpp=32;
        if(ioctl(drm_fd,DRM_IOCTL_MODE_CREATE_DUMB,&cd)){ perror("create_dumb"); return -1; }
        if(drmModeAddFB(drm_fd,DW,DH,24,32,cd.pitch,cd.handle,&drm_fb[i].fb)){ perror("AddFB"); return -1; }
        struct drm_mode_map_dumb md; memset(&md,0,sizeof(md)); md.handle=cd.handle;
        ioctl(drm_fd,DRM_IOCTL_MODE_MAP_DUMB,&md);
        drm_fb[i].map=(uint8_t*)mmap(0,cd.size,PROT_READ|PROT_WRITE,MAP_SHARED,drm_fd,md.offset);
        if(drm_fb[i].map==MAP_FAILED){ perror("mmap"); return -1; }
        drm_fb[i].handle=cd.handle; drm_fb[i].pitch=cd.pitch; drm_fb[i].size=cd.size;
    }
    drm_ready=1; return 0;
}
// Draw a 1920x1080 BGR frame to the panel: BGR->XRGB8888 into the single scanout mmap,
// SetCrtc once to latch the mode. Single buffer avoids the tear a non-vsync 2-buffer swap made.
static void drm_show(const cv::Mat& bgr1080){
    if(!drm_ready) return;
    DrmFb& b=drm_fb[0];
    cv::Mat dst(DH,DW,CV_8UC4,b.map,b.pitch);   // XRGB8888 == cv BGRA byte order
    cv::cvtColor(bgr1080,dst,cv::COLOR_BGR2BGRA);
    if(!drm_bi){   // first frame: latch the mode
        if(drmModeSetCrtc(drm_fd,DRM_CRTC,b.fb,0,0,(uint32_t*)&DRM_CONN,1,&DRM_MODE))
            perror("SetCrtc");
        drm_bi=1;
    }
}
static volatile int running=1, teardown_done=0;
static void on_sig(int s){ (void)s; running=0; }
static Awnn_Context_t* ctxs[NWORK];
static pthread_mutex_t mtx_npu=PTHREAD_MUTEX_INITIALIZER;    // serialize the single NPU core
static pthread_mutex_t mtx_latest=PTHREAD_MUTEX_INITIALIZER; // guard the annotated cells
static pthread_mutex_t mtx_rr=PTHREAD_MUTEX_INITIALIZER;
static cv::Mat latest[NCAM]; static int updated[NCAM]={0};
static int rr=0;
static volatile long g_inf=0, g_det=0;

// Cedar libcedarc HW H.264 encoder (reused from hwgrid_hybrid).
static struct ScMemOpsS* memops; static VeOpsS* veOps;
static VideoEncoder* venc; static void* encVe;
static unsigned char g_hdr[256]; static int g_hdrlen=0;

static int make_encoder(){
    VeConfig vc; memset(&vc,0,sizeof(vc)); vc.nEncoderFlag=1; vc.memops=memops;
    encVe=CdcVeInit(veOps,&vc);
    venc=VideoEncCreate(VENC_CODEC_H264); if(!venc) return -1;
    int fps=25,br=4000000,ki=30;
    VideoEncSetParameter(venc,VENC_IndexParamFramerate,&fps);
    VideoEncSetParameter(venc,VENC_IndexParamBitrate,&br);
    VideoEncSetParameter(venc,VENC_IndexParamMaxKeyInterval,&ki);
    VencBaseConfig cfg; memset(&cfg,0,sizeof(cfg));
    cfg.nInputWidth=GW; cfg.nInputHeight=GH; cfg.nDstWidth=GW; cfg.nDstHeight=GH; cfg.nStride=GW;
    cfg.eInputFormat=VENC_PIXEL_YUV420SP; cfg.bEncH264Nalu=0;
    cfg.memops=memops; cfg.veOpsS=veOps; cfg.pVeOpsSelf=encVe;
    if(VideoEncInit(venc,&cfg)!=0) return -1;
    VencAllocateBufferParam ap; memset(&ap,0,sizeof(ap)); ap.nBufferNum=4; ap.nSizeY=GW*GH; ap.nSizeC=GW*GH/2;
    AllocInputBuffer(venc,&ap);
    VencHeaderData hd; memset(&hd,0,sizeof(hd));
    if(VideoEncGetParameter(venc,VENC_IndexParamH264SPSPPS,&hd)==0 && hd.nLength>0 && hd.nLength<=(int)sizeof(g_hdr)){
        memcpy(g_hdr,hd.pBuffer,hd.nLength); g_hdrlen=hd.nLength; }
    return g_hdrlen>0?0:-1;
}
// BGR grid -> tightly packed NV12 (Y plane + interleaved UV)
static void bgr_to_nv12(const cv::Mat& bgr, unsigned char* nv12){
    cv::Mat i420; cv::cvtColor(bgr,i420,cv::COLOR_BGR2YUV_I420);
    int w=bgr.cols,h=bgr.rows;
    memcpy(nv12,i420.data,(size_t)w*h);
    unsigned char* U=i420.data+(size_t)w*h; unsigned char* V=U+(size_t)(w/2)*(h/2);
    unsigned char* UV=nv12+(size_t)w*h; int n=(w/2)*(h/2);
    for(int i=0;i<n;i++){ UV[2*i]=U[i]; UV[2*i+1]=V[i]; }
}
// encode one NV12 frame on the VE -> push annexb (SPS prepended on keyframes) to encsrc
static void encode_push(unsigned char* nv12){
    VencInputBuffer in; memset(&in,0,sizeof(in));
    if(GetOneAllocInputBuffer(venc,&in)!=0) return;
    memcpy(in.pAddrVirY,nv12,(size_t)GW*GH);
    memcpy(in.pAddrVirC,nv12+(size_t)GW*GH,(size_t)GW*GH/2);
    static long long pts=0; in.nPts=pts; pts+=40000;
    FlushCacheAllocInputBuffer(venc,&in); AddOneInputBuffer(venc,&in);
    VideoEncodeOneFrame(venc); AlreadyUsedInputBuffer(venc,&in); ReturnOneAllocInputBuffer(venc,&in);
    for(;;){ VencOutputBuffer ob; memset(&ob,0,sizeof(ob));
        if(GetOneBitstreamFrame(venc,&ob)!=0) break;
        int total=ob.nSize0+ob.nSize1; int key=(ob.nFlag&VENC_BUFFERFLAG_KEYFRAME)?1:0;
        if(total>0){ gsize extra=(key&&g_hdrlen>0)?g_hdrlen:0;
            GstBuffer* hb=gst_buffer_new_allocate(NULL,extra+total,NULL);
            if(extra) gst_buffer_fill(hb,0,g_hdr,g_hdrlen);
            gst_buffer_fill(hb,extra,ob.pData0,ob.nSize0);
            if(ob.nSize1) gst_buffer_fill(hb,extra+ob.nSize0,ob.pData1,ob.nSize1);
            gst_app_src_push_buffer(encsrc,hb);
        }
        FreeOneBitStreamFrame(venc,&ob);
    }
}
static void* watchdog(void* a){ int s=(int)(intptr_t)a;
    for(int i=0;i<s*10;i++){ if(teardown_done) return NULL; usleep(100000); }
    fprintf(stderr,"[WATCHDOG] teardown hung >%ds — _exit; power cycle may be needed\n",s); _exit(3); }

// NPU worker: pull a frame, preprocess, run inference (NPU serialized by mtx_npu), decode+draw,
// publish the annotated cell. CPU pre/post overlaps other workers' NPU runs.
static void* worker(void* arg){
    int wid=(int)(intptr_t)arg;
    unsigned char* in=(unsigned char*)malloc(S*S*3);
    while(running){
        pthread_mutex_lock(&mtx_rr); int i=rr++ % NCAM; pthread_mutex_unlock(&mtx_rr);
        GstSample* s=gst_app_sink_try_pull_sample(sinks[i],5*GST_MSECOND);
        if(!s) continue;
        GstBuffer* b=gst_sample_get_buffer(s); GstCaps* c=gst_sample_get_caps(s);
        GstStructure* st=gst_caps_get_structure(c,0);
        int W=0,H=0; gst_structure_get_int(st,"width",&W); gst_structure_get_int(st,"height",&H);
        GstMapInfo m;
        if(W>0 && H>0 && gst_buffer_map(b,&m,GST_MAP_READ)){
            cv::Mat bgr(H,W,CV_8UC3,m.data,W*3);
            preprocess(bgr,in);
            cv::Mat frame=bgr.clone();
            gst_buffer_unmap(b,&m);
            void* ib[]={in}; float* oc[3];
            pthread_mutex_lock(&mtx_npu);
            awnn_set_input_buffers(ctxs[wid],ib); awnn_run(ctxs[wid]);
            float** out=awnn_get_output_buffers(ctxs[wid]);
            oc[0]=out[0]; oc[1]=out[1]; oc[2]=out[2];
            pthread_mutex_unlock(&mtx_npu);
            int n=detect_draw(frame,oc);   // reads ctxs[wid]'s own buffers (safe until this worker's next run)
            // trim MB-padding margin (decoder emits e.g. 1080p as 1920x1088) so cells composite clean
            cv::Rect roi(0,0,frame.cols-(frame.cols>16?16:0),frame.rows-(frame.rows>16?16:0));
            pthread_mutex_lock(&mtx_latest);
            cv::resize(frame(roi),latest[i],cv::Size(CW,CH)); updated[i]=1;
            pthread_mutex_unlock(&mtx_latest);
            __sync_add_and_fetch(&g_inf,1); __sync_add_and_fetch(&g_det,n);
        }
        gst_sample_unref(s);
    }
    free(in); return NULL;
}
// Compositor + Cedar HW encoder thread; runs at ~30fps regardless of detection rate.
static void* outputter(void* arg){ (void)arg;
    unsigned char* nv12=(unsigned char*)malloc(GW*GH*3/2);
    cv::Mat grid(GH,GW,CV_8UC3,cv::Scalar(20,20,20));
    cv::Mat gridbig;   // grid upscaled to the panel's 1920x1080 for direct-DRM scanout
    while(running){
        pthread_mutex_lock(&mtx_latest);
        for(int i=0;i<NCAM;i++) if(updated[i] && !latest[i].empty()){
            int cx=(i%2)*CW, cy=(i/2)*CH; latest[i].copyTo(grid(cv::Rect(cx,cy,CW,CH))); updated[i]=0; }
        pthread_mutex_unlock(&mtx_latest);
        bgr_to_nv12(grid,nv12); encode_push(nv12);
        static int dcnt=0;
        if(drm_ready && (++dcnt%4==0)){   // throttle monitor display to ~7fps
            cv::resize(grid,gridbig,cv::Size(DW,DH));   // upscale to panel res
            drm_show(gridbig);
        }
        usleep(33000);   // ~30 fps encode/output
    }
    free(nv12); return NULL;
}

int main(int argc,char**argv){
    const char* host = argc>1?argv[1]:"192.168.1.35";
    const char* nbg  = argc>2?argv[2]:"model/v3/yolov5.nb";
    gst_init(&argc,&argv);
    signal(SIGINT,on_sig); signal(SIGTERM,on_sig);
    awnn_init();
    for(int w=0;w<NWORK;w++) ctxs[w]=awnn_create(nbg);

    for(int i=0;i<NCAM;i++){
        char d[512]; GError* e=NULL;
        // videorate caps videoconvert to 8 fps/stream so we don't color-convert frames workers drop
        snprintf(d,sizeof(d),
          "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=100 ! rtph264depay ! h264parse ! "
          "omxh264dec ! videorate drop-only=true ! video/x-raw,framerate=8/1 ! "
          "videoconvert ! video/x-raw,format=BGR ! "
          "appsink name=s%d max-buffers=1 drop=true sync=false",host,i+1,i);
        pipes[i]=gst_parse_launch(d,&e);
        if(!pipes[i]){ fprintf(stderr,"pipe %d: %s\n",i,e?e->message:"?"); return 1; }
        char n[8]; snprintf(n,sizeof(n),"s%d",i);
        sinks[i]=GST_APP_SINK(gst_bin_get_by_name(GST_BIN(pipes[i]),n));
        gst_element_set_state(pipes[i],GST_STATE_PLAYING);
    }

    // Cedar HW H.264 encoder (VE) — coexists with OMX decode (VE) + NPU (separate).
    memops=MemAdapterGetOpsS(); CdcMemOpen(memops);
    veOps=GetVeOpsS(VE_OPS_TYPE_NORMAL);
    if(make_encoder()!=0){ fprintf(stderr,"encoder init fail\n"); return 1; }
    fprintf(stderr,"Cedar HW encoder ready, SPS/PPS=%d bytes; %d NPU workers\n",g_hdrlen,NWORK);
    GError* e=NULL; char od[1024];
    snprintf(od,sizeof(od),
      "appsrc name=encsrc is-live=true format=time do-timestamp=true ! "
      "video/x-h264,stream-format=byte-stream,alignment=au ! h264parse config-interval=1 ! "
      "flvmux streamable=true ! rtmpsink location=rtmp://%s:1935/detgrid",host);
    disp=gst_parse_launch(od,&e);
    if(!disp){ fprintf(stderr,"disp: %s\n",e?e->message:"?"); return 1; }
    encsrc=GST_APP_SRC(gst_bin_get_by_name(GST_BIN(disp),"encsrc"));
    gst_bus_add_watch(gst_element_get_bus(disp),bus_cb,NULL);
    GstCaps* hc=gst_caps_new_simple("video/x-h264","stream-format",G_TYPE_STRING,"byte-stream",
        "alignment",G_TYPE_STRING,"au",NULL);
    gst_app_src_set_caps(encsrc,hc); gst_caps_unref(hc);
    g_object_set(encsrc,"block",FALSE,"max-bytes",(guint64)4000000,"leaky-type",2,NULL);
    gst_element_set_state(disp,GST_STATE_PLAYING);

    // Standalone local monitor display (opt-in via 3rd arg); needs `systemctl stop sddm`
    // to grab DRM master. A DRM failure leaves drm_ready=0 -> streaming/inference continue.
    if(argc>3){
        if(drm_init()==0) fprintf(stderr,"standalone DRM display enabled (1920x1080)\n");
        else fprintf(stderr,"DRM display unavailable (streaming continues)\n");
    }

    fprintf(stderr,"warming up streams...\n"); usleep(1500000);

    pthread_t wk[NWORK], op;
    for(int w=0;w<NWORK;w++) pthread_create(&wk[w],NULL,worker,(void*)(intptr_t)w);
    pthread_create(&op,NULL,outputter,NULL);

    double t0=now_ms(), tlast=t0;
    while(running){
        usleep(200000);
        double t=now_ms();
        if(t-tlast>=2000){ double el=(t-t0)/1000.0;
            fprintf(stderr,"[%.0fs] total=%.1f inf/s (%ld det) | %d NPU workers\n",el,g_inf/el,g_det,NWORK);
            tlast=t; }
    }

    fprintf(stderr,"stopping (graceful VE teardown)...\n");
    pthread_t wd; pthread_create(&wd,NULL,watchdog,(void*)(intptr_t)15); pthread_detach(wd);
    for(int w=0;w<NWORK;w++) pthread_join(wk[w],NULL);
    pthread_join(op,NULL);
    for(int i=0;i<NCAM;i++) if(pipes[i]) gst_element_set_state(pipes[i],GST_STATE_NULL);
    if(disp) gst_element_set_state(disp,GST_STATE_NULL);
    if(drm_ready){ drmDropMaster(drm_fd); close(drm_fd); drm_ready=0; }
    if(venc){ ReleaseAllocInputBuffer(venc); VideoEncUnInit(venc); VideoEncDestroy(venc); venc=NULL; }
    if(encVe){ CdcVeRelease(veOps,encVe); encVe=NULL; }
    if(memops) CdcMemClose(memops);
    for(int w=0;w<NWORK;w++) if(ctxs[w]) awnn_destroy(ctxs[w]);
    awnn_uninit();
    teardown_done=1;
    fprintf(stderr,"[exit] clean\n");
    return 0;
}
