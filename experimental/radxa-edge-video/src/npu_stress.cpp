// Stress test: hard-to-decode 4K H.264 stream + the strong YOLO11s detector on the A733.
//   rtspsrc ! omxh264dec (Cedar VE 4K decode) ! BGR appsink  -> letterbox 640 -> YOLO11s (NPU)
//   -> anchor-free DFL decode + 80-class -> draw -> 1280x720 -> x264 -> RTMP -> WebRTC.
// Reports DECODE fps (can the VE keep up with 4K?) and inference ms.  Build: ./build.sh npu_stress
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <opencv2/opencv.hpp>
#include <awnn_lib.h>
#include <csignal>
#include <cmath>
#include <cstdio>
#include <vector>
#include <algorithm>

#define S 640
#define OW 1280
#define OH 720
static volatile int running = 1;
static void on_sig(int){ running = 0; }

static const char* CLS[] = {"person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"};

// letterbox BGR -> 640 CHW uint8 RGB
static void preprocess(const cv::Mat& bgr, unsigned char* out){
    cv::Mat img; cv::cvtColor(bgr,img,cv::COLOR_BGR2RGB);
    float sl=std::min(S*1.f/img.rows,S*1.f/img.cols);
    int rc=int(sl*img.cols), rr=int(sl*img.rows);
    cv::resize(img,img,cv::Size(rc,rr));
    cv::Mat canvas(S,S,CV_8UC3,cv::Scalar(0,0,0));
    int top=(S-rr)/2,left=(S-rc)/2; img.copyTo(canvas(cv::Rect(left,top,rc,rr)));
    for(int h=0;h<S;h++)for(int w=0;w<S;w++){ const cv::Vec3b&p=canvas.at<cv::Vec3b>(h,w);
        for(int c=0;c<3;c++) out[c*S*S+h*S+w]=p[c]; }
}
struct Det { cv::Rect_<float> r; int cls; float score; };
// YOLO11/YOLOv8 anchor-free decode from 6 raw heads: out[0..2]=box[64,G,G] DFL, out[3..5]=cls[80,G,G]
static int yolo_decode_draw(cv::Mat& bgr, float** out){
    const int GR[3]={80,40,20}, ST[3]={8,16,32};
    std::vector<Det> props;
    for(int s=0;s<3;s++){
        int G=GR[s], HW=G*G, st=ST[s];
        const float* box=out[0+s]; const float* cls=out[3+s];
        for(int y=0;y<G;y++) for(int x=0;x<G;x++){ int cell=y*G+x;
            int bc=0; float bs=cls[cell];
            for(int c=1;c<80;c++){ float v=cls[c*HW+cell]; if(v>bs){bs=v;bc=c;} }
            float conf=1.f/(1.f+expf(-bs)); if(conf<0.35f) continue;
            float dist[4];
            for(int side=0;side<4;side++){ float e[16],mx=-1e9f,sum=0,d=0;
                for(int b=0;b<16;b++){ float v=box[(side*16+b)*HW+cell]; e[b]=v; if(v>mx)mx=v; }
                for(int b=0;b<16;b++){ e[b]=expf(e[b]-mx); sum+=e[b]; }
                for(int b=0;b<16;b++) d+=b*(e[b]/sum); dist[side]=d; }
            float ax=x+0.5f, ay=y+0.5f;
            props.push_back({cv::Rect_<float>((ax-dist[0])*st,(ay-dist[1])*st,
                (dist[0]+dist[2])*st,(dist[1]+dist[3])*st), bc, conf});
        }
    }
    std::sort(props.begin(),props.end(),[](const Det&a,const Det&b){return a.score>b.score;});
    std::vector<int> keep;
    for(size_t i=0;i<props.size();i++){ int ok=1; for(int j:keep){
        cv::Rect_<float> I=props[i].r&props[j].r; float ia=I.area();
        float ua=props[i].r.area()+props[j].r.area()-ia; if(ua>0&&ia/ua>0.45f){ok=0;break;} }
        if(ok) keep.push_back(i); }
    float sl=std::min(S*1.f/bgr.rows,S*1.f/bgr.cols);
    int rc=int(sl*bgr.cols),rr=int(sl*bgr.rows),tw=(S-rc)/2,th=(S-rr)/2;
    float rx=(float)bgr.cols/rc, ry=(float)bgr.rows/rr;
    for(int idx:keep){ Det&d=props[idx];
        float x0=(d.r.x-tw)*rx, y0=(d.r.y-th)*ry, x1=(d.r.x+d.r.width-tw)*rx, y1=(d.r.y+d.r.height-th)*ry;
        cv::rectangle(bgr,cv::Point(x0,y0),cv::Point(x1,y1),cv::Scalar(0,255,0),2);
        char t[96]; snprintf(t,sizeof(t),"%s %.0f%%",CLS[d.cls],d.score*100);
        cv::putText(bgr,t,cv::Point(x0,std::max(12.f,y0-4)),cv::FONT_HERSHEY_SIMPLEX,0.5,cv::Scalar(0,255,0),1);
    }
    return (int)keep.size();
}
static double now_ms(){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1000.0+t.tv_nsec/1e6; }

int main(int argc,char**argv){
    const char* host = argc>1?argv[1]:"192.168.1.35";
    const char* nb   = argc>2?argv[2]:"yolo11s.nb";
    const char* path = argc>3?argv[3]:"stream";      // rtsp path on host:8554
    setvbuf(stdout,NULL,_IONBF,0); setvbuf(stderr,NULL,_IONBF,0);
    fprintf(stderr,"BOOT host=%s nb=%s\n",host,nb);
    signal(SIGINT,on_sig); signal(SIGTERM,on_sig);
    gst_init(&argc,&argv);
    fprintf(stderr,"gst_init done, awnn_create...\n");
    awnn_init(); Awnn_Context_t* ctx=awnn_create(nb);
    if(!ctx){ fprintf(stderr,"model load failed: %s\n",nb); return 1; }
    fprintf(stderr,"model loaded ok\n");

    char id[512];
    snprintf(id,sizeof(id),"rtspsrc location=rtsp://%s:8554/%s protocols=tcp latency=200 ! "
        "rtph264depay ! h264parse ! omxh264dec ! videoconvert ! video/x-raw,format=BGR ! "
        "appsink name=sink max-buffers=1 drop=true sync=false",host,path);
    GError* e=NULL; GstElement* ip=gst_parse_launch(id,&e);
    if(!ip){ fprintf(stderr,"input: %s\n",e?e->message:"?"); return 1; }
    GstAppSink* sink=GST_APP_SINK(gst_bin_get_by_name(GST_BIN(ip),"sink"));

    char od[512];
    snprintf(od,sizeof(od),"appsrc name=src is-live=true format=time do-timestamp=true ! "
        "video/x-raw,format=BGR,width=%d,height=%d,framerate=15/1 ! videoconvert ! "
        "x264enc tune=zerolatency speed-preset=ultrafast bitrate=3000 key-int-max=30 ! "
        "h264parse config-interval=1 ! flvmux streamable=true ! rtmpsink location=rtmp://%s:1935/stress",OW,OH,host);
    GstElement* op=gst_parse_launch(od,&e);
    GstAppSrc* src=GST_APP_SRC(gst_bin_get_by_name(GST_BIN(op),"src"));
    gst_element_set_state(ip,GST_STATE_PLAYING);
    gst_element_set_state(op,GST_STATE_PLAYING);
    fprintf(stderr,"stress: 4K stream + YOLO11s -> http://%s:8889/stress\n",host);

    unsigned char* in=(unsigned char*)malloc(S*S*3);
    long frames=0, dets=0, lframes=0; double t0=now_ms(), tlast=t0, infsum=0;
    int inW=0,inH=0;
    while(running){
        GstSample* smp=gst_app_sink_try_pull_sample(sink,GST_SECOND);
        if(!smp) continue;
        GstBuffer* b=gst_sample_get_buffer(smp); GstCaps* c=gst_sample_get_caps(smp);
        GstStructure* st=gst_caps_get_structure(c,0); int W=0,H=0;
        gst_structure_get_int(st,"width",&W); gst_structure_get_int(st,"height",&H);
        GstMapInfo m;
        if(W>0&&H>0&&gst_buffer_map(b,&m,GST_MAP_READ)){
            cv::Mat bgr(H,W,CV_8UC3,m.data,W*3); inW=W; inH=H;
            preprocess(bgr,in);
            cv::Mat frame; cv::resize(bgr,frame,cv::Size(OW,OH));   // draw on 720p for output
            gst_buffer_unmap(b,&m);
            void* ib[]={in}; double ti=now_ms();
            awnn_set_input_buffers(ctx,ib); awnn_run(ctx);
            float** out=awnn_get_output_buffers(ctx);
            infsum += now_ms()-ti;
            int n=yolo_decode_draw(frame,out); dets+=n; frames++;
            size_t sz=(size_t)frame.total()*frame.elemSize();
            GstBuffer* ob=gst_buffer_new_allocate(NULL,sz,NULL);
            gst_buffer_fill(ob,0,frame.data,sz);
            gst_app_src_push_buffer(src,ob);
        }
        gst_sample_unref(smp);
        double t=now_ms();
        if(t-tlast>=2000){
            double ivfps=(frames-lframes)*1000.0/(t-tlast);
            fprintf(stderr,"[%.0fs] %dx%d | pipeline=%.1f fps (interval) | inference=%.1f ms/frame | dets/total=%ld\n",
                (t-t0)/1000.0, inW, inH, ivfps, infsum/frames, dets);
            tlast=t; lframes=frames; }
    }
    free(in);
    gst_element_set_state(ip,GST_STATE_NULL); gst_element_set_state(op,GST_STATE_NULL);
    awnn_destroy(ctx); awnn_uninit();
    return 0;
}
