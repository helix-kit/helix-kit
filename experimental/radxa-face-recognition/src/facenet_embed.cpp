// FaceNet embedding on the A733 NPU (VIPLite/awnn). Reads aligned 160x160 face crops,
// runs the int16-quantized FaceNet NBG, prints the L2-normalized 512-d embedding per file
// as CSV ("path,e0,e1,...,e511"). Compare against the float (pytorch) reference off-board.
// Preprocess must match the NBG's inputmeta: RGB, CHW uint8; the NBG bakes in mean 127.5 /
// scale 1/128 (FaceNet standardization to [-1,1]).
#include <opencv2/opencv.hpp>
#include <awnn_lib.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
// Face embedder on the NPU. Input side S: FaceNet=160, MobileFaceNet/ArcFace=112 (env FACE_SIZE).
int main(int argc,char**argv){
    const int S = getenv("FACE_SIZE") ? atoi(getenv("FACE_SIZE")) : 112;
    const char* nb = getenv("FACENET_NB") ? getenv("FACENET_NB") : "facenet.nb";
    awnn_init();
    Awnn_Context_t* ctx = awnn_create(nb);
    if(!ctx){ fprintf(stderr,"awnn_create(%s) failed\n",nb); return 1; }
    unsigned char* in = (unsigned char*)malloc(S*S*3);
    for(int a=1;a<argc;a++){
        cv::Mat bgr = cv::imread(argv[a]);
        if(bgr.empty()){ fprintf(stderr,"read fail %s\n",argv[a]); continue; }
        cv::Mat rgb; cv::cvtColor(bgr,rgb,cv::COLOR_BGR2RGB);
        if(rgb.rows!=S||rgb.cols!=S) cv::resize(rgb,rgb,cv::Size(S,S));
        for(int h=0;h<S;h++) for(int w=0;w<S;w++){ const cv::Vec3b&p=rgb.at<cv::Vec3b>(h,w);
            for(int c=0;c<3;c++) in[c*S*S+h*S+w]=p[c]; }        // HWC RGB -> CHW uint8
        void* ib[]={in}; awnn_set_input_buffers(ctx,ib); awnn_run(ctx);
        float** out = awnn_get_output_buffers(ctx);
        float* e = out[0];
        double n=0; for(int i=0;i<512;i++) n+=(double)e[i]*e[i]; n=sqrt(n)+1e-9;
        printf("%s",argv[a]);
        for(int i=0;i<512;i++) printf(",%.6f", e[i]/n);
        printf("\n"); fflush(stdout);
    }
    free(in); awnn_destroy(ctx); awnn_uninit();
    return 0;
}
