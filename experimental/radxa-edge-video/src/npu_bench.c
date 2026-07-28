// Sustained NPU throughput benchmark for the YOLOv5 .nb model.
// Preprocesses one image, then loops set_input -> run -> get_output N times to
// measure the warmed-up NPU inference rate (the hard ceiling shared by all
// streams, since core_count=1).
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <awnn_lib.h>
#include "yolov5_pre_process.h"

static double now_ms(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1000.0 + t.tv_nsec/1e6; }

int main(int argc, char** argv){
    const char* nbg = argc>1?argv[1]:"model/v3/yolov5.nb";
    const char* img = argc>2?argv[2]:"input_data/dog_640_640.jpg";
    int N = argc>3?atoi(argv[3]):200;

    awnn_init();
    Awnn_Context_t* ctx = awnn_create(nbg);
    unsigned int fsz;
    unsigned char* in = yolov5_pre_process(img, &fsz);
    void* inbuf[] = { in };

    // warmup
    for (int i=0;i<5;i++){ awnn_set_input_buffers(ctx, inbuf); awnn_run(ctx); awnn_get_output_buffers(ctx); }

    double t0 = now_ms();
    for (int i=0;i<N;i++){
        awnn_set_input_buffers(ctx, inbuf);
        awnn_run(ctx);
        awnn_get_output_buffers(ctx);
    }
    double dt = now_ms()-t0;
    fprintf(stderr, "\n==== NPU sustained: %d inferences, %.1f ms total, %.2f ms/inf, %.1f inf/s (all streams share this); ~%.1f fps/stream over 4 ====\n",
            N, dt, dt/N, N*1000.0/dt, N*1000.0/dt/4);

    awnn_destroy(ctx); awnn_uninit();
    return 0;
}
