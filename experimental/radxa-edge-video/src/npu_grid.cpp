// 4-stream NPU object detection throughput test.
//   4x [rtspsrc ! omxh264dec ! videoconvert ! BGR appsink]  ->  round-robin:
//   letterbox->640x640 CHW uint8 -> awnn (YOLOv5 on the VIP9000 NPU) -> decode+NMS
//   -> draw boxes. Reports per-stream and aggregate detection FPS.
// Single shared NPU network (core_count=1), single detection thread for now.
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <opencv2/opencv.hpp>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>
#include <time.h>
#include <vector>
#include <algorithm>
#include <awnn_lib.h>

#define NCAM 4
#define S 640            // model input side

// ---- YOLOv5 decode (reused verbatim from the vendor yolov5_post_process.cpp) ----
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

static GstAppSink* sinks[NCAM];
static GstElement* pipes[NCAM];

int main(int argc,char**argv){
    const char* host = argc>1?argv[1]:"192.168.1.35";
    const char* nbg  = argc>2?argv[2]:"model/v3/yolov5.nb";
    gst_init(&argc,&argv);
    awnn_init();
    Awnn_Context_t* ctx = awnn_create(nbg);
    unsigned char* in = (unsigned char*)malloc(S*S*3);

    for(int i=0;i<NCAM;i++){
        char d[512]; GError* e=NULL;
        snprintf(d,sizeof(d),
          "rtspsrc location=rtsp://%s:8554/stream%d protocols=tcp latency=100 ! rtph264depay ! h264parse ! "
          "omxh264dec ! videoconvert ! video/x-raw,format=BGR ! "
          "appsink name=s%d max-buffers=1 drop=true sync=false",host,i+1,i);
        pipes[i]=gst_parse_launch(d,&e);
        if(!pipes[i]){ fprintf(stderr,"pipe %d: %s\n",i,e?e->message:"?"); return 1; }
        char n[8]; snprintf(n,sizeof(n),"s%d",i);
        sinks[i]=GST_APP_SINK(gst_bin_get_by_name(GST_BIN(pipes[i]),n));
        gst_element_set_state(pipes[i],GST_STATE_PLAYING);
    }
    fprintf(stderr,"warming up streams...\n"); usleep(1500000);

    long inf[NCAM]={0}, det[NCAM]={0}, total=0; double t0=now_ms(), tlast=t0;
    int saved=0;
    while(1){
        for(int i=0;i<NCAM;i++){
            GstSample* s=gst_app_sink_try_pull_sample(sinks[i],0); // non-blocking: newest or none
            if(!s) s=gst_app_sink_try_pull_sample(sinks[i],5*GST_MSECOND);
            if(!s) continue;
            GstBuffer* b=gst_sample_get_buffer(s); GstCaps* c=gst_sample_get_caps(s);
            GstStructure* st=gst_caps_get_structure(c,0);
            int W=0,H=0; gst_structure_get_int(st,"width",&W); gst_structure_get_int(st,"height",&H);
            GstMapInfo m;
            if(W>0 && H>0 && gst_buffer_map(b,&m,GST_MAP_READ)){
                cv::Mat bgr(H,W,CV_8UC3,m.data,W*3);  // BGR rows are width*3 (4-byte aligned for these widths)
                preprocess(bgr,in);
                void* ib[]={in}; awnn_set_input_buffers(ctx,ib); awnn_run(ctx);
                float** out=awnn_get_output_buffers(ctx);
                cv::Mat frame=bgr.clone();
                int n=detect_draw(frame,out);
                inf[i]++; det[i]+=n; total++;
                if(total%120==0 && saved<NCAM){ char p[64]; snprintf(p,sizeof(p),"/home/radxa/det_stream%d.jpg",i); cv::imwrite(p,frame); if(i==NCAM-1)saved=1; }
                gst_buffer_unmap(b,&m);
            }
            gst_sample_unref(s);
        }
        double t=now_ms();
        if(t-tlast>=2000){
            double el=(t-t0)/1000.0;
            fprintf(stderr,"[%.0fs] total=%.1f inf/s | per-stream:",el,total/el);
            for(int i=0;i<NCAM;i++) fprintf(stderr," s%d=%.1f(%ld det)",i,inf[i]/el,det[i]);
            fprintf(stderr,"\n");
            tlast=t;
        }
    }
    return 0;
}
