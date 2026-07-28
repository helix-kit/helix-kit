<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 06 — Decode ceiling + best-model stress test

Date: 2026-07-26

**Question:** run a *hard-to-decode* video and the *best model we can run* on the
Radxa Cubie A7Z (Allwinner A733), end-to-end. This documents (a) the board's real
H.264 **decode ceiling**, and (b) **YOLO11s** (the strongest YOLO we converted)
running live on the hardest decodable stream.

## TL;DR

- **The A733 Cedar VE does NOT decode 4K H.264.** It initialises for 3840×2160
  input but **emits zero output frames** (output port stays at the 176×144
  default forever), then shuts down cleanly. 4K is simply beyond this decoder.
- **1440p (2560×1440) decodes — but via a ½-scale-down path**: the decoder parses
  the full 1440p bitstream and hands back a **1280×720** surface.
- **1080p (1920×1080) decodes at full resolution** (appsink delivers 1920×1088,
  1080 padded to the 16-px macroblock grid).
- On the hardest *full-res* stream (**1080p60, 20 Mbps, High profile, CABAC,
  3 B-frames**), **YOLO11s** runs at **33–34 ms/frame (~30 inf/s pure NPU)** and
  the whole single-stream pipeline (decode → letterbox → NPU → draw → H.264
  encode → WebRTC) holds a steady **~18 fps**, with correct detections.

## Hardware decode ceiling (measured)

| Source stream | Cedar VE result | appsink frame size |
| --- | --- | --- |
| 4K30, 40 Mbps, High@L5.1 | inits, **0 frames out** — not decodable | — |
| 1440p30, 25 Mbps, High, bf3 | decodes, **½-scale-down** | 1280×720 |
| 1080p60, 20 Mbps, High, bf3 | decodes, **full-res** | 1920×1088 |

Notes:
- The 4K failure is visible in the OMX logs: the input port negotiates to
  `width = 3840, height = 2160`, but the output port never advances past
  `width = 176, height = 144` — no decoded surface is ever produced. There is no
  explicit "unsupported" error; it just stalls.
- The ½-scale-down above 1080p is an Allwinner CedarX decoder behaviour, not a
  pipeline resize. It is actually *helpful* here — less pixel data to move into
  the NPU preprocess — but means "1440p" on this board is really "1440p bitstream,
  720p pixels".
- This is why the "hardest decodable" demo lands at **1080p60 high-bitrate**, not
  4K: that is the true edge of what the VE can hand back at full resolution.

## Best model — YOLO11s

The strongest YOLO we converted for the NPU (see also the multi-model pipeline).
Converted ONNX → NBG with the same **cut-at-raw-heads + uint8-quantize** recipe as
YOLOv8-pose (§01, §05):

- Export YOLO11s to ONNX (`images [1,3,640,640] → output0 [1,84,8400]`, anchor-free).
- **Cut the model at the 6 raw detection heads** (before the DFL/anchor decode that
  quantises badly): `/model.23/cv2.{0,1,2}/…/Conv_output_0` (box, 64 ch = 4 sides
  × 16 DFL bins) and `/model.23/cv3.{0,1,2}/…/Conv_output_0` (class, 80 ch), at the
  three strides (grids 80/40/20).
- **Quantize `uint8`** so the NBG input tensor is uint8 with the /255 normalisation
  baked into `scale`/`zero_point` → feed raw uint8 CHW (the input-format gotcha from
  §05 / the face-recognition notes). `nbg_meta.json` confirms `qtype=u8`,
  `scale=0.003677`, `zp=0`, and the 6 outputs in the order
  `box80, box40, box20, cls80, cls40, cls20`.
- **Software decode on the CPU** (`yolo_decode_draw` in `src/npu_stress.cpp`): per
  cell, argmax the 80 class logits → sigmoid confidence; DFL-expand the 4×16 box
  bins → distances → box via anchor point `(x+0.5, y+0.5)·stride`; NMS; letterbox
  inverse; draw. Identical structure to the YOLOv8 head decode, minus the pose
  keypoints.

Model: `network_binary.nb` 6.8 MB. Inference **33.4 ms/frame** steady
(≈30 inf/s), which matches YOLO11s being a heavier network than the yolov5n/yolov8n
used in the multi-model grid.

## Pipeline & result

`src/npu_stress.cpp` — single stream, one worker:

```
rtspsrc(hard 1080p60) ! omxh264dec (Cedar VE, full-res)
  ! BGR appsink → letterbox 640 → YOLO11s (awnn/NPU) → DFL+80-class decode + NMS
  → draw boxes → resize 1280×720 → x264 (ultrafast) → RTMP → MediaMTX WebRTC (/stress)
```

Steady-state on 1080p60 / 20 Mbps / High+bf3:

```
1920x1088 | pipeline=17.9 fps (interval) | inference=33.4 ms/frame
```

- **~18 fps end-to-end.** Inference alone is 33 ms (30 fps); the drop to 18 fps is
  the *single-threaded serial cost* — letterboxing a 1920×1088 frame, the H.264
  encode of the 720p output, and decode all run in series with the NPU on the same
  loop. The 4-worker `npu_multimodel` hides exactly this overhead to reach ~32
  inf/s; here it is deliberately one serial stream to isolate the "one hard stream,
  best model" question.
- **Detections correct**: a hi-vis worker in the warehouse scene is boxed tightly as
  `person 57%` (captured from the live WebRTC output). The slight input-scale
  mismatch (uint8 quant picked `scale=0.003677` vs the ideal `1/255=0.003922`,
  because calibration never saw a full-255 pixel) costs a few % of confidence but
  does not break detection.

## How to reproduce

Host side (streams served by the `fake-camera` MediaMTX on `192.168.1.35:8554`):

```sh
# hard 1080p60 clip from a high-motion source
ffmpeg -y -i worker-zone.mp4 -vf scale=1920:1080 -r 60 -c:v libx264 \
  -profile:v high -preset medium -b:v 20M -maxrate 24M -bufsize 30M -bf 3 -g 60 \
  -an hard_1080p.mp4
# publish on the spare "stream" path
ffmpeg -re -stream_loop -1 -i hard_1080p.mp4 -c:v copy -bsf:v h264_mp4toannexb \
  -f rtsp rtsp://127.0.0.1:8554/stream
```

Board side (needs root for `/dev/cedar_dev`):

```sh
./build.sh npu_stress.cpp
sudo ./npu_stress 192.168.1.35 yolo11s.nb stream    # args: host nb rtsp-path
# watch: http://192.168.1.35:8889/stress   (MediaMTX WebRTC)
```

Prints interval fps + inference ms every 2 s. Clean shutdown on SIGINT (releases
the VE properly — a hard SIGKILL leaves the Cedar VE in a dirty state and the next
`omxh264dec` init fails with `pInBufHdr is NULL` until it self-recovers).
