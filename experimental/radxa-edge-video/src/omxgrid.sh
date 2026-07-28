#!/bin/bash
# Fully generic GStreamer 2x2 HW grid — NO custom C.
# Portable shape: swap omxh264dec/omxh264videoenc for nvv4l2decoder/nvv4l2h264enc
# (Jetson) or v4l2h264dec/v4l2h264enc (RPi) and the rest is unchanged.
HOST="${1:-192.168.1.35}"
exec gst-launch-1.0 -e \
  compositor name=mix background=black \
    sink_0::xpos=0   sink_0::ypos=0   sink_0::width=640 sink_0::height=360 \
    sink_1::xpos=640 sink_1::ypos=0   sink_1::width=640 sink_1::height=360 \
    sink_2::xpos=0   sink_2::ypos=360 sink_2::width=640 sink_2::height=360 \
    sink_3::xpos=640 sink_3::ypos=360 sink_3::width=640 sink_3::height=360 \
    ! video/x-raw,format=NV12,width=1280,height=720 ! tee name=t \
    t. ! queue ! videoscale ! video/x-raw,width=1920,height=1080 ! \
         kmssink driver-name=sunxi-drm connector-id=153 force-modesetting=true \
    t. ! queue leaky=downstream max-size-buffers=3 ! \
         omxh264videoenc target-bitrate=4000000 control-rate=2 interval-intraframes=30 ! \
         video/x-h264,profile=main ! h264parse config-interval=1 ! \
         flvmux streamable=true ! rtmpsink location=rtmp://$HOST:1935/grid \
  rtspsrc location=rtsp://$HOST:8554/stream1 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! videoconvert ! video/x-raw,format=NV12 ! queue ! mix.sink_0 \
  rtspsrc location=rtsp://$HOST:8554/stream2 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! videoconvert ! video/x-raw,format=NV12 ! queue ! mix.sink_1 \
  rtspsrc location=rtsp://$HOST:8554/stream3 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! videoconvert ! video/x-raw,format=NV12 ! queue ! mix.sink_2 \
  rtspsrc location=rtsp://$HOST:8554/stream4 protocols=tcp latency=200 ! rtph264depay ! h264parse ! omxh264dec ! videoconvert ! video/x-raw,format=NV12 ! queue ! mix.sink_3
