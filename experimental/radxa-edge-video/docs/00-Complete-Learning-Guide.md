<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Edge AI on a $40 Board — A Complete Learning Guide

**What this document is:** a from-scratch, beginner-friendly walkthrough of an entire
edge-AI project built on a small single-board computer (the **Radxa Cubie A7Z**, chip =
**Allwinner A733**). It covers *everything* we built — hardware video processing, object
detection, pose estimation, face recognition — with **all the real measured numbers**,
**every problem we hit and how we fixed it**, and **plain-English explanations of the ML and
systems concepts** behind each step.

It is written so you can hand it to a tutor AI and say *"teach me this, quiz me on it."* If a
term is unfamiliar, check the **Glossary (Section 13)** first — it defines everything.

---

## Table of contents

1. [The big picture: what & why](#1-the-big-picture)
2. [The hardware inside the board](#2-the-hardware)
3. [ML concepts primer (read this if you're new)](#3-ml-concepts-primer)
4. [Part A — Hardware video pipeline (decode → grid → encode → stream)](#4-part-a--hardware-video-pipeline)
5. [Part B — Object detection with YOLOv5 on the NPU](#5-part-b--object-detection-yolov5)
6. [Part C — Putting the picture on a monitor (the DisplayPort saga)](#6-part-c--the-display-saga)
7. [Part D — Two models at once (detection + pose) & model conversion](#7-part-d--two-models-at-once)
8. [Part E — Making it faster (performance engineering)](#8-part-e--performance-engineering)
9. [Part F — On-demand video clip recording](#9-part-f--clip-recording)
10. [Part G — Face recognition (FaceNet vs MobileFaceNet)](#10-part-g--face-recognition)
11. [Master table of all the numbers](#11-master-numbers-table)
12. [Master table of problems & fixes](#12-master-problems--fixes)
13. [Glossary](#13-glossary)
14. [Suggested learning path & questions to ask your tutor](#14-learning-path)

---

## 1. The big picture

**Goal:** run modern AI (that normally needs a beefy GPU server) *directly on a tiny, cheap,
low-power board* sitting next to the cameras. This is called **edge AI** — "edge" meaning at
the edge of the network, on the device, instead of in the cloud.

**Why edge AI matters:**
- **Privacy** — video never leaves the device.
- **Latency** — no round-trip to a server.
- **Cost/bandwidth** — you don't stream raw video to the cloud or rent GPUs.
- **Offline** — works with no internet.

**What we actually made it do**, all at the same time on one board:
- Take in **4 camera streams** (H.264 video over the network).
- **Decode** them (turn compressed video back into images).
- Run **AI models** on every frame — find people/objects (detection), find body joints (pose),
  recognise faces (face recognition).
- **Draw** the results on the video, **stitch 4 cameras into one 2×2 grid**.
- **Re-encode** the annotated grid and **stream it out** (viewable in a browser via WebRTC), or
  show it on a **monitor** plugged into the board.
- **Record clips** on demand.

The board is a **"practice board"** — the intended real targets are things like an NVIDIA
Jetson Nano, a Raspberry Pi, or a small x86 box. The point was to learn how to squeeze a full
"video-analytics" pipeline (the kind NVIDIA sells as *DeepStream*) onto cheap hardware, and to
understand exactly where the limits are.

---

## 2. The hardware

A modern chip like the A733 is not "a CPU." It's a **System-on-Chip (SoC)**: several
specialised engines on one piece of silicon, each good at a different job. Using the right
engine for each job is the whole game in edge AI. Here's what's inside and what we used it for:

| Block | What it is | Analogy | We used it for |
|---|---|---|---|
| **CPU** — 8 cores | General-purpose processors. **6 "little" (Cortex-A55)** + **2 "big" (Cortex-A76)** — this is called **big.LITTLE**: little cores save power, big cores go fast. | General handymen | Glue logic, image maths (resize, colour convert), drawing boxes, running the software that coordinates everything |
| **NPU** — Vivante VIP9000 | **Neural Processing Unit** — fixed-function silicon that does *only* neural-network math, extremely efficiently. **3 TOPS** (3 trillion ops/sec) at INT8. | A calculator built only for AI | Running the AI models (detection, pose, face embeddings) |
| **VE (Cedar)** — video engine | Dedicated **video decoder + encoder** (H.264/H.265). Turns compressed video ↔ raw images in hardware. | A dedicated video codec chip | Decoding the 4 camera streams, encoding the output |
| **GPU** — PowerVR BXM-4-64 | **Graphics** processor (3D, OpenGL). | A gaming graphics card (tiny) | **Nothing** — it stayed power-gated. (More on why below.) |
| **Display Engine** (sunxi-drm) | Drives the actual **monitor output** (DisplayPort/HDMI). Separate from the GPU. | The video-out port controller | Showing the grid on a physical monitor |
| **RAM** | ~**961 MB** shared memory | Desk space | Everything shares this — a key constraint |

**Core numbers we measured:**
- Little cores (cpu0–5): "capacity" 385, max 1794 MHz. Big cores (cpu6–7): capacity 1024, max
  2002 MHz. So a big core is ~2.6× more capable than a little one.
- DDR memory clock: 1.8 GHz. NPU core clock: ~648 MHz–1008 MHz. VE: 624 MHz.

**Key idea #1 — heterogeneous computing:** the reason this works on cheap hardware is that we
**never** make the CPU do what a dedicated block can do. Video decode → VE (not CPU). AI math →
NPU (not CPU). This is how ~$40 of silicon keeps up with tasks that would peg a laptop CPU.

---

## 3. ML concepts primer

If you're new to ML, read this once; the rest of the doc will make sense.

**Neural network / "model":** a big math function with millions of tunable numbers
("weights"). You feed it an input (an image) and it produces an output (e.g. "there's a person
at these coordinates"). The weights were learned during *training* (done once, by someone else,
on giant GPU clusters). We only do **inference** — *running* a trained model. We never trained
anything here.

**Inference:** one forward pass of data through the model to get a prediction. "26 ms per
inference" means one image through the model takes 26 ms.

**Model formats & the NPU toolchain — this is important:**
- Models are usually shared as **ONNX** files (`.onnx`) — a portable, standard description of the
  network (its layers + weights). Think "PDF for neural networks."
- An NPU can't run ONNX directly. You must **compile** the ONNX into the NPU's private binary
  format. On this board that format is **NBG** (`.nb` file), and the compiler is a big
  proprietary toolkit from the chip vendor called **ACUITY / Pegasus** (runs in Docker on a PC).
- The flow: **`.onnx` → (ACUITY: import → quantize → export) → `.nb` → runs on the NPU.**

**Quantization — the concept that caused us the most pain, so understand it well:**
- Trained models use **fp32** (32-bit floating-point) numbers — very precise, but slow and
  memory-hungry.
- NPUs are fastest with **integers**: **uint8** (8-bit, 0–255) or **int16** (16-bit).
  Converting the model's fp32 weights/activations to integers is **quantization**.
- It's like saving a photo as a smaller JPEG: much smaller/faster, slightly less accurate. Done
  well, accuracy loss is tiny. Done wrong, the model's output becomes garbage.
- To quantize well, the toolkit needs **calibration data** — a handful of real example images —
  so it can measure the typical range of numbers flowing through the model and pick good integer
  scales.
- **Two facts that bit us hard (remember these):**
  1. If a single output tensor **mixes very different number ranges** (e.g. box coordinates
     0–640 *and* confidences 0–1), one integer scale can't represent both → the small values get
     crushed to zero. **Fix:** cut the model before that mixing and do the final math in
     software.
  2. The **quantization type you choose also sets the *input* format**. Quantize to `int16` →
     the model now expects **int16** input; feed it plain `uint8` bytes and it sees garbage.
     Quantize to `uint8` → it expects `uint8`, which is what we naturally have. (This one cost a
     lot of time in the face-recognition part.)

**The three AI tasks we ran (all different "shapes" of output):**
- **Object detection** (YOLOv5/YOLOv8): input image → list of **bounding boxes** + a class label
  ("person", "car") + a confidence. "Where are the things, and what are they?"
- **Pose estimation** (YOLOv8-pose): input image → for each person, **17 body keypoints**
  (nose, shoulders, elbows, knees…) → draw a stick-figure skeleton. "How is the body arranged?"
- **Face recognition** (FaceNet / MobileFaceNet): input **a cropped face** → a **512-number
  "embedding"** (a fingerprint of that face). Two photos of the *same* person produce *similar*
  embeddings; different people produce *different* ones. You compare embeddings with **cosine
  similarity** (a number from -1 to 1; ~1 = very similar). "Whose face is this?"

**Embedding & cosine similarity (the heart of face recognition):**
- An **embedding** is a point in 512-dimensional space. Same identity → nearby points.
- **Cosine similarity** measures the angle between two embedding vectors. ~1.0 = same direction
  (same person), ~0.0 = unrelated (different people). You set a threshold (say 0.4): above =
  "same person," below = "different."

---

## 4. Part A — Hardware video pipeline

**The task:** take 4 compressed camera streams, decode them, arrange them in a 2×2 grid,
re-encode, and stream the result — *without melting the CPU.*

**How video works (quick):** cameras send **H.264**, a compressed format (like a "zip" for
video). To draw or analyse it you must **decode** it back to raw pixels; to send it out again
you **encode** it. Decode/encode are expensive — but the **Cedar VE** does them in dedicated
hardware, so they cost almost no CPU.

**The pipeline (built with GStreamer, a media-pipeline toolkit):**
```
4× RTSP camera → [Cedar VE decode] → raw frames → [compose 2×2 grid] → [Cedar VE encode] → stream out (WebRTC)
```

**What we learned / measured:**
- Doing the encode in **software** (a library called `x264`) cost **~390% CPU** (≈4 of 8 cores).
  Moving the encode to the **Cedar hardware** dropped it to **~280–296%** — about one core saved,
  and it freed the CPU for AI work later.
- Getting the hardware encoder to produce *valid* video took **three specific fixes** (annex-B
  bitstream format, recycling input buffers to avoid a stall, and repeating the SPS/PPS "video
  headers" on keyframes). Detail: these are low-level H.264 plumbing; the lesson is that hardware
  codecs are picky and need exact configuration.

**Problem A1 — the board froze / video engine "deadlocked."**
- **Symptom:** kill the program abruptly and the VE would hang; memory leaked (a 505 MB DMA-buffer
  leak), sometimes needing a reboot.
- **Why:** the VE is a *single* shared hardware block. If you `kill -9` the program while it's
  mid-operation, the driver never cleans up.
- **Fix:** a **graceful shutdown** — catch the stop signal, drain in-flight work, then release the
  VE properly (`VideoEncUnInit` → `CdcVeRelease` → `CdcMemClose`). **Lesson:** shared hardware
  blocks need orderly teardown; never hard-kill them.

**Problem A2 — the grid froze to "one blurry stuck video." (Cost ~1 hour of wrong guesses.)**
- **Symptom:** looked exactly like a decoder/AI bug.
- **Real cause:** **WiFi.** The board has no Ethernet. After a reboot it connected to a congested
  **2.4 GHz** network at **1 Mbit/s** with **1.5–2 second** ping — starved of video data.
- **Fix:** switch to the **5 GHz** network → **117 Mbit/s, 4 ms** ping → instantly fixed.
- **Lesson (very ML-relevant):** when a pipeline "looks broken," first check whether it's
  **starved of input** (network/IO), not the compute. A frozen accelerator with no data looks
  identical to a crashed one.

---

## 5. Part B — Object detection (YOLOv5)

**YOLO** ("You Only Look Once") is a famous, fast object-detection model family. We ran
**YOLOv5** on the NPU.

**The per-frame flow for one camera:**
```
raw frame → [preprocess: resize+pad to 640×640, convert to the model's number format]
          → [NPU runs YOLOv5]  → raw numbers
          → [decode: turn numbers into boxes, remove duplicates] → draw boxes on the frame
```

**Concepts introduced here:**
- **Preprocessing / letterbox:** models want a fixed input size (640×640). "Letterbox" =
  resize keeping aspect ratio + pad with black, so the image isn't distorted.
- **The model outputs raw numbers, not boxes.** A **decode** step (running on the CPU) turns
  them into actual boxes. Part of decode is **NMS (Non-Max Suppression)** — the model often
  predicts the same object several times; NMS keeps the best box and removes overlapping
  duplicates.
- **Anchors:** YOLOv5 predicts boxes relative to preset reference box shapes called "anchors."

**Numbers measured (this is the good stuff):**
- One YOLOv5 inference on the NPU: **~26 ms** of pure NPU time.
- A hidden cost: after inference, copying the model's output from the NPU to the CPU as fp32 =
  **~16 ms** (34 MB of data). This "fp32 copy" turned out to be a major bottleneck later.
- The **single-inference ceiling** (how fast the one NPU can go, back-to-back) ≈ **27.5
  inferences/sec**.
- Running **4 cameras** through the one NPU, naively (one at a time), gave **~15 inf/s**.
- **Pipelining with 2 worker threads** (so the CPU preps the next frame while the NPU chews on the
  current one) raised it to **~21.4 inf/s** — a **+43%** gain. **Lesson:** overlap CPU work with
  NPU work; don't let the NPU sit idle waiting for the CPU.

**The "DeepStream loop":** decode (VE) → detect (NPU) → draw → compose grid → encode (VE) →
stream. This is exactly what NVIDIA's DeepStream does; we built it from parts on cheap hardware.

**Bonus — how does this beat a Jetson Nano?** A Jetson running 4× YOLOv5 used **~3.6 GB** RAM and
was CPU-bound. Ours did the equivalent loop in **~396 MB**. The honest picture: the Jetson was
actually *faster* in raw frames/sec (it has CUDA), but it uses **5× the memory** because its
software stack (CUDA/TensorRT/cuDNN) is heavy. Our win is **memory + total system headroom**, from
using lean fixed-function silicon (NPU + VE) instead of a general GPU software stack. Different
tool, different trade-off.

---

## 6. Part C — the display saga

**The task:** show the live annotated grid on a **physical monitor** plugged into the board
(a true "standalone appliance," no laptop needed). This turned into a multi-hour debugging story
with a great lesson.

**The problem:** the monitor stayed **black**. Every software attempt reported "success" but no
picture appeared.

**Root cause (two things stacked):**
1. The monitor was plugged into the board's **USB-C port in "DisplayPort alt-mode."** That port
   shares its high-speed wires with USB3, so it only brings up **2 of the 4 DisplayPort lanes** —
   about **half the bandwidth**.
2. **2560×1440 @ 60 Hz** needs a 248 MHz pixel clock — **too much for 2 lanes**, so the display
   link never "trained" (established) → **no signal → black**. But **1920×1080 @ 60 Hz** (148 MHz)
   *fits* 2 lanes — and it's actually what the monitor reported as its **preferred** mode all
   along. Everything had been hardcoded to 1440p from a wrong earlier note.

**The fix:** drive the monitor at **1920×1080** using **direct DRM scanout** — we write pixels
straight into a framebuffer the Display Engine reads (bypassing higher-level display software that
was misbehaving). Cost: negligible (~3% CPU), because the Display Engine (not the GPU/CPU) does
the actual scanout.

**Bonus problem — a magenta line across the grid.** After it worked, a thin **magenta seam**
appeared between cells. **Cause:** video decoders output frames padded up to a multiple of 16
pixels (1080 → **1088**); those 8 extra "garbage" rows showed as a colored strip when we scaled
the frame. Invisible on the compressed stream (compression smears it away) but sharp on the direct
RGB monitor. **Fix:** crop a 16-pixel margin before composing. **Lesson:** a lossy video stream is
a *poor oracle* — it can hide pixel-exact bugs that a raw display exposes.

**Concepts:** "link training" (how a display cable negotiates a working connection),
"pixel clock" (data rate a resolution needs), "framebuffer/scanout" (the memory the display
hardware reads to make a picture), "macroblock padding" (codecs work in 16-pixel blocks).

---

## 7. Part D — two models at once

**The task:** run **two different AI models simultaneously** — object **detection** on 2 camera
streams and **pose estimation** on the other 2 — on the single NPU. This is where we learned to
**convert and quantize our own models**.

### 7.1 Converting YOLOv8-pose (the ACUITY toolchain, hands-on)

Only YOLOv5 came pre-converted. To get **pose**, we had to convert **YOLOv8-pose** ourselves:
1. Export the model from PyTorch to **ONNX**.
2. Get the vendor's **ACUITY** Docker toolkit (a **2.7 GB** gated download — we sped it up from a
   2-hour estimate to a few minutes using `aria2c` with **16 parallel connections**, since the
   server throttles *per connection* but allows many).
3. Inside the toolkit: **import** ONNX → **quantize** (with ~20–30 calibration face/scene images)
   → **export** the `.nb`.
4. Write the software **decode** for the model's output and integrate.

### 7.2 The "quantization crush" — a core ML lesson

First attempt: quantize the **whole** YOLOv8-pose model. Result on the NPU: **skeletons drawn on
empty shelves**, real people missed. **Why:** YOLOv8's final output tensor **mixes** box
coordinates (range 0–640) with confidences (range 0–1) in one tensor. A single integer scale is
dominated by the big coordinate numbers, so the tiny confidence values get **quantized to
zero** → the model can't tell where the people are.

- Tried **int16** (finer): slightly better but still wrong (skeletons mislocated).
- Tried **bf16** (a float format): correct, but the NPU has **no hardware bf16**, so it emulated
  it at **0.1 inference/sec** — unusably slow.
- **The fix (the standard pro technique):** **cut the model *before* its final decode** — export
  the **9 raw "head" outputs** (which all have similar number ranges, so `uint8` quantizes them
  cleanly) — and do the final decode math (the DFL box math, anchor grid, keypoint offsets,
  sigmoids) **in software** on the CPU. This is exactly how the working YOLOv5 was built too.
- **Result:** correct skeletons on real people. **Lesson:** quantize the "easy" part (the
  convolution layers), do the range-sensitive final math in software.

### 7.3 Results (both models, live)

| Model | Streams | Throughput |
|---|---|---|
| YOLOv5 detection | 2 | ~15.6 inf/s |
| YOLOv8-pose | 2 | ~15.6 inf/s |
| **Aggregate** | 4 | **~30.8 inf/s** (~7.7 fps/stream), NPU ~64% busy |

Interesting: running two models totalled *more* inferences/sec than one model (30.8 vs 21.4),
because YOLOv8-**nano**-pose is a lighter network than YOLOv5, so mixing a cheaper model raised
total throughput.

**Software architecture idea introduced:** a **Model registry** — a small table describing each
model (its file, its preprocess function, its decode function) plus a per-stream assignment. That
made "2 detection + 2 pose" just a config, not a rewrite.

---

## 8. Part E — performance engineering

The NPU was only **~59–67% busy** — meaning **~one-third idle**, so there was headroom. Finding
*why* it idled is a great systems-thinking exercise. Here's what we tried and measured:

- **The bottleneck was not the NPU compute** — it was that `awnn_run` (the NPU call) held a lock
  around **both** the hardware inference **and** the ~16 ms fp32 output copy. During that copy the
  NPU sat idle but locked, so the other worker couldn't use it.
- **Fix 1 — move the fp32 copy out of the lock** + **Fix 2 — use 4 worker threads (one per
  stream)**. These are **coupled**: alone, the copy-out-of-lock did nothing (with 2 workers the
  NPU was under-fed anyway); with 4 workers, keeping the copy *inside* the lock was actively worse
  (28.4 inf/s). Together: **31.9 inf/s, NPU 66%** (up from 30.4 / 59%).
- **What did *not* work (equally instructive):**
  - **Raising input frame rate** to feed the idle NPU → the simple lock became **unfair**: the
    faster model hogged the NPU and **starved** the slower one (det → 0). Lesson: fairness matters
    once you contend for a shared resource.
  - **GPU offload** — moving the CPU image-maths (resize/colour-convert) to the PowerVR GPU via
    OpenCL: measured **46 ms on GPU vs 8 ms on CPU** — the GPU was **5.7× slower**. Why: it's a
    tiny 1-unit mobile GPU, and every operation pays a CPU↔GPU memory-copy tax. Lesson: small
    integrated GPUs lose on lightweight, memory-bound image ops.
  - **Pinning stream work to the 6 "little" CPU cores** (to reserve the big cores) → throughput
    **dropped** (31.9 → 27.1), because the heavy per-frame math ran on slower cores. Lesson:
    throughput-critical work wants the **fast** cores; pinning to slow cores only makes sense to
    reserve headroom, not to go faster.
- **Theoretical ceiling** for this 2-det+2-pose mix ≈ **52 inf/s** (if the NPU were 100% fed
  fairly). Reaching it needs a **fair scheduler** — the identified next step.

**Meta-lesson:** performance work is *measure → hypothesise → test → often be wrong → measure
again.* Several "obvious" optimizations (GPU offload, more frames, core pinning) made things
**worse**, and only measurement revealed it.

**Also profiled:**
- Total memory **~396 MB**, dominated by **DMA buffers** (~380 MB) — the hardware working memory
  for decode+NPU+encode, invisible to normal tools like `htop`. We built `boardtop.sh` to read the
  vendor's hidden counters (NPU %, VE state, DMA memory).
- The system logger **journald** had ballooned to ~109 MB (and ~1.5 GB on disk) from the pipeline's
  chatty logs; capped it to ~11 MB.

---

## 9. Part F — clip recording

**The task:** save short video clips **on demand** — e.g. "save the last 30 seconds" when
something happens.

**Concept — the ring buffer (pre-roll):** to save the seconds *before* an event, you must be
**continuously recording into a fixed-size circular buffer** in memory. When triggered, you dump
the buffer (that's your "pre-roll") and optionally keep recording. The buffer holds a bounded
window; old data is overwritten.

**What we built:** a dedicated recorder that continuously encodes one camera's *annotated* video
(overlay included) at 640×360, 10 fps, into an in-memory ring bounded to 30 s; a signal
(`SIGUSR1`) dumps it to a clip.

**Why software encoding here (and its cost):** we used **software x264** on purpose — the *hardware*
VE was already busy (4 decodes + grid encode), and adding a second hardware-encoder instance risks
contention on that single block. Software x264 for this small stream is cheap:
- **~0.2 of one CPU core** for **one** camera (measured 22% of a core including overhead).
- Scales ~linearly: **~0.8 core for all 4** overlaid streams.
- The **raw** (un-annotated) camera streams cost **~0 to record** — they're already compressed, so
  you just save the bytes (no re-encoding).

**Memory of the ring (it stores *compressed* video, which is the trick):**
- **~180 KB/s** → **30 s ≈ 5.4 MB**, 60 s ≈ 11 MB, 5 min ≈ 56 MB. (If it stored *raw* frames it'd
  be ~207 MB for 30 s — ~40× more. Encoding-then-buffering is why it's cheap.)
- For **long** retention, the better pattern is **rolling 15-second segments written to disk**
  (keep the last N, delete older) — then a clip of any length is just concatenating segments. RAM
  stays flat; disk grows. ~1 hour of history ≈ 360 MB of disk.

**A real limitation we hit:** the board's media library couldn't finalize an **`.mp4`** from stored
frames (a board-specific quirk), so clips save as raw **`.h264`** (fully playable; a one-line
`ffmpeg` remuxes to mp4 on any PC). Honest engineering: ship the format that works, document the
caveat.

---

## 10. Part G — face recognition

**The task:** recognise *who* a face belongs to. Pipeline (four independent stages):
```
frame → [1] detect faces (box + 5 landmarks) → [2] align (warp to a standard 112×112)
      → [3] embed (face → 512-number fingerprint, on the NPU) → [4] match (cosine vs a gallery of known faces)
```
The hard/novel part is **[3] the embedding model on the NPU** — so we proved that first.

**Concepts:**
- **Alignment:** using 5 facial landmarks (eyes, nose, mouth corners) to **warp** every face to a
  canonical position/size (112×112). This makes the embedding robust to head tilt/position. It's a
  geometric transform (`cv2.estimateAffinePartial2D`), done on the CPU.
- **Embedding + verification:** covered in Section 3. We tested with **LFW** (Labeled Faces in the
  Wild), a standard face dataset, checking that *same-person* pairs score high and *different-person*
  pairs score low.

**The FaceNet detour (and the real bug):**
- We first tried **FaceNet** (a classic face model, InceptionResNet-v1). The **float** model was
  perfect: same-person cosine **0.71–0.85**, different-person **≤ 0.29** — cleanly separable.
- But on the NPU it **collapsed**: every face's embedding looked ~identical (all ~0.8 similar), and
  didn't match the float version at all. It looked like "FaceNet is too big/sensitive to quantize."
- We switched to **MobileFaceNet** (a small, edge-designed face model, ArcFace-trained, 30× smaller).
  It **collapsed identically.** ← *This was the clue.* Two very different models failing the **exact
  same way** means the bug is **not** the model — it's something common to both: our conversion.
- **Root cause (the second big quantization lesson):** we had quantized to **int16**, which makes
  the model's **input** an **int16** tensor. But our code fed plain **uint8** bytes → the model saw
  garbage → collapsed output. Switching the quantization to **uint8** makes the input a **uint8**
  tensor (with the face normalization baked into its scale), and our raw-uint8 feed is then correct.
- **Result (MobileFaceNet, uint8, working):**
  - Model size **2.77 MB**, **6.2 ms/face** (~160 faces/sec).
  - **NPU-vs-float fidelity: 0.946** (the quantized embedding faithfully matches the float one).
  - **Identity separation:** same-person cosine **≥ 0.46** cleanly above different-person **≤ 0.31**
    — matches the float model. **It works.**
- **Lesson:** don't conclude "the model is too sensitive" until you've ruled out a **preprocessing/
  input-format bug**. Two models failing identically is a systemic-bug fingerprint. Also: **for
  these NPU image models, quantize `uint8` and feed raw `uint8`** — verify the expected input format
  in the compiler's `nbg_meta.json` before blaming the model.

**Where it stands:** the embedding (stage 3) is proven on the NPU. Stages 1 (a face **detector**,
SCRFD, already downloaded) and 4 (matching against an enrolled gallery) are the next steps to a full
"recognise a known person live" demo.

---

## 11. Master numbers table

| Thing | Number | Notes |
|---|---|---|
| Board / chip | Radxa Cubie A7Z / Allwinner A733 | ~$40 class |
| CPU | 8 cores: 6× A55 (little, 1.79 GHz) + 2× A76 (big, 2.0 GHz) | big.LITTLE |
| NPU | Vivante VIP9000, 3 TOPS INT8 | runs the AI models |
| Video engine (VE) | Cedar, 624 MHz decode + encode | H.264 in hardware |
| GPU | PowerVR BXM-4-64 | **unused** (stayed off) |
| RAM | ~961 MB | shared |
| YOLOv5 inference | ~26 ms NPU + ~16 ms fp32 copy | per frame |
| Single-NPU ceiling | ~27.5 inf/s | one model, back-to-back |
| 4-stream detection | 15 → **21.4 inf/s** | +43% from 2-worker pipelining |
| 2-detect + 2-pose | **30.8–31.9 inf/s** | NPU 59–67% busy |
| Optimized aggregate | **31.9 inf/s** | 4 workers + copy-out-of-lock |
| Theoretical NPU ceiling | ~52 inf/s | needs fair scheduling |
| HW encode CPU | 390% (software) → ~285% (Cedar HW) | ~1 core saved |
| Display | 1920×1080 @ 60 Hz | 1440p impossible on 2-lane USB-C DP |
| Total memory | ~396 MB (≈380 MB DMA buffers) | invisible to htop |
| Clip ring | ~180 KB/s → 5.4 MB per 30 s | compressed; raw would be ~40× |
| Recorder CPU (sw x264) | ~0.2 core/camera, ~0.8 core/4 | raw streams: ~free |
| GPU offload test | 46 ms (GPU) vs 8 ms (CPU) | GPU 5.7× **slower** |
| Face embedding (MobileFaceNet) | 2.77 MB, **6.2 ms/face** | ~160 faces/s |
| Face NPU-vs-float fidelity | **0.946** | quantization faithful |
| Face separation | same ≥ 0.46 > cross ≤ 0.31 | identities separable |
| ACUITY toolkit download | 2.7 GB in minutes | aria2c 16 connections |

---

## 12. Master problems & fixes

| # | Problem | Root cause | Fix / lesson |
|---|---|---|---|
| 1 | VE deadlock / memory leak on stop | Hard-killing a program mid-hardware-op | Graceful shutdown (drain → release VE). Never `kill -9` shared HW |
| 2 | Grid froze, "1 blurry video" | WiFi at 1 Mbit/s (2.4 GHz, congested) | Switch to 5 GHz. Check input starvation before blaming compute |
| 3 | Monitor black | USB-C DP-alt-mode = 2 lanes; 1440p can't link-train | Use 1080p (the EDID-preferred mode) + direct DRM |
| 4 | Magenta seam on grid | Decoder pads 1080→1088; 8 garbage rows | Crop 16 px before composing. Lossy streams hide such bugs |
| 5 | Pose skeletons on empty shelves | Quantizing full model crushed confidences (mixed ranges in one tensor) | Cut before decode → export raw heads → decode in software |
| 6 | bf16 model at 0.1 inf/s | NPU has no hardware bf16 (emulated) | Don't use bf16 on this NPU |
| 7 | NPU only 60% busy | fp32 copy held the NPU lock; too few workers | Copy out of lock **+** 4 workers (coupled) |
| 8 | Higher fps starved a model | Plain lock is unfair under contention | Needs a fair scheduler (open) |
| 9 | GPU offload slower | Tiny GPU + CPU↔GPU copy tax | Keep image maths on CPU |
| 10 | Pinning to little cores slower | Heavy work ran on slow cores | Throughput work wants big cores |
| 11 | mp4 clips 0 bytes | Board's muxer won't finalize from stored frames | Save `.h264`; remux to mp4 on a PC |
| 12 | Face embeddings collapsed (both models!) | int16 quant → int16 *input*; we fed uint8 | Quantize **uint8**, feed uint8. Two models failing identically = systemic bug, not the model |

---

## 13. Glossary

- **Edge AI** — running AI on the local device (at the network edge) instead of the cloud.
- **SoC (System-on-Chip)** — one chip containing CPU + specialised engines (NPU, VE, GPU…).
- **big.LITTLE** — a CPU with a mix of fast "big" cores and efficient "little" cores.
- **NPU (Neural Processing Unit)** — fixed-function silicon that runs neural-network math fast.
- **VE / Cedar** — the chip's hardware **video** decoder/encoder.
- **GPU** — graphics processor; here, unused for AI.
- **Display Engine** — drives the monitor output (separate from the GPU).
- **Inference** — running a trained model to get a prediction (one forward pass).
- **Model / weights** — the learned math function and its millions of tuned numbers.
- **ONNX** — a portable file format for sharing neural-network models.
- **NBG (`.nb`)** — this NPU's compiled model format (what actually runs on-device).
- **ACUITY / Pegasus** — the vendor toolkit that compiles ONNX → NBG (with quantization).
- **Quantization** — converting a model from fp32 floats to integers (uint8/int16) for speed/size.
- **fp32 / int16 / uint8 / bf16** — number formats: 32-bit float / 16-bit int / 8-bit int / 16-bit "brain" float.
- **Calibration data** — sample images used during quantization to pick good integer scales.
- **Object detection** — find bounding boxes + class labels in an image.
- **Bounding box** — a rectangle around a detected object.
- **NMS (Non-Max Suppression)** — removes duplicate overlapping detections, keeps the best.
- **Anchors** — preset reference box shapes some detectors predict relative to.
- **Pose estimation** — locate body keypoints (joints) → a skeleton.
- **Keypoints / landmarks** — labelled points (e.g. eyes, elbows) the model predicts.
- **Face recognition** — turn a face into an **embedding** and match identities.
- **Embedding** — a vector (here 512 numbers) that acts as a "fingerprint"; similar faces → nearby vectors.
- **Cosine similarity** — angle-based similarity between two vectors (−1…1; ~1 = same).
- **Alignment** — warping a face to a canonical size/pose using landmarks.
- **Preprocessing / normalization** — preparing an image for a model (resize, scale pixel values to a fixed range).
- **Letterbox** — resize + pad to a square without distorting aspect ratio.
- **DeepStream** — NVIDIA's video-analytics framework (decode→infer→encode); we rebuilt its shape from parts.
- **GStreamer** — an open media-pipeline toolkit used to wire the video stages together.
- **H.264** — a common compressed video format; needs decoding to view/analyse.
- **DMA buffer** — hardware working memory shared between engines (decode/NPU/encode).
- **RTSP / WebRTC** — protocols to bring camera video **in** / send processed video **out** (to a browser).
- **DRM/KMS, framebuffer, scanout** — the Linux graphics stack that puts pixels on a monitor.
- **Link training / pixel clock / DP alt-mode** — how a display cable negotiates a working mode; the data rate a resolution needs; DisplayPort running over USB-C (sharing lanes with USB).
- **Ring buffer** — a fixed-size circular buffer that overwrites old data; used for pre-roll recording.
- **big.LITTLE core pinning / affinity** — forcing a thread to run on specific CPU cores.

---

## 14. Learning path

If you're new, learn the ideas in roughly this order, and ask your tutor to go deep on each:

1. **What inference is** and how a trained model turns an image into numbers (Sections 3, 5).
2. **Detection vs pose vs recognition** — the three output "shapes" (Section 3).
3. **Preprocessing** — why images must be resized/normalized to match the model (Sections 3, 5, 10).
4. **Quantization** — the single most important practical concept here; understand *why* int8/int16
   speed things up and *how* it can break (mixed-range crush; input-format mismatch) (Sections 3, 7, 10).
5. **The compile-to-NPU flow** — ONNX → ACUITY → NBG, and why models can't run directly (Sections 3, 7).
6. **Embeddings & cosine similarity** — the mechanism of face recognition (Sections 3, 10).
7. **Heterogeneous computing** — using NPU/VE/CPU/GPU for the right jobs (Sections 2, 4, 8).
8. **Performance engineering** — pipelining, locks/contention, why "obvious" optimizations fail
   (Section 8).

**Good questions to ask your tutor AI (using this doc as context):**
- "Explain quantization with a simple analogy, then explain both quantization bugs from this
  project (the mixed-range crush and the int16-input mismatch) and why each happened."
- "Walk me through what happens to a single camera frame, step by step, from H.264 bytes to a
  drawn bounding box."
- "Why does an embedding + cosine similarity let you recognise faces? What is 512-dimensional
  space intuitively?"
- "Why did running two AI models give *more* inferences/sec than one? What does that tell me about
  where the bottleneck was?"
- "Explain why the GPU was *slower* than the CPU here, even though GPUs are 'supposed to be fast.'"
- "What is the difference between detection, pose estimation, and recognition — in terms of what
  the model outputs?"
- "Quiz me: give me 10 questions across these topics and grade my answers."

---

*This guide summarizes a real hands-on project. Every number here was measured on the actual
board. The detailed technical write-ups live alongside this file (`docs/01`–`05` for the video/NPU
work, and `../../radxa-face-recognition/` for face recognition).*
