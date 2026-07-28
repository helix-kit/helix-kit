<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 04 — Memory / CPU profiling, Jetson comparison, USB-camera feasibility

Date: 2026-07-25

Profiling and back-of-envelope analyses done while the 4-stream detection grid
was running. These explain *why* the board performs the way it does and what it
can and can't take on next.

---

## 1. Memory profile

The full 4-stream **decode → NPU detect → composite → HW encode → display +
WebRTC** pipeline runs in **~396 MB total**, and the dominant term is **not**
process RSS:

| Region | Size | Notes |
| --- | --- | --- |
| **DMA buffers** | **~380–396 MB** | the real driver of memory — the decode + NPU + encode hardware working set (`/sys/kernel/debug/dma_buf/bufinfo`), **invisible to btop** |
| Process RSS | modest | OpenCV + GStreamer + awnn contexts |
| NPU per-context | ~42 MB × NWORK | each `awnn_create` context |

The DMA working set is a **hardware floor**, not a leak — it is the buffer pool
the codec and NPU blocks need in flight. See [doc 03](03-accelerator-telemetry.md)
for how to observe it.

### journald was eating memory

journald had grown to **~109 MB** in RAM (and logs ballooned toward ~1.5 GB on
disk over the session) because the pipeline logs per-inference timing lines at
high rate. Fixed by **capping** the journal and **silencing** the service:

- `SystemMaxUse` / `RuntimeMaxUse` caps in `journald.conf` → **109 → 11 MB**.
- `StandardOutput=null` / `StandardError=null` on `npu-detgrid.service` so the
  hot per-inference prints don't hit the journal at all.

---

## 2. CPU per-stage breakdown

Measured serially per inference (the pipeline overlaps these across threads):

| Stage | Time | |
| --- | --- | --- |
| preprocess (letterbox) | 7 ms | CPU |
| **inference** | 42 ms | 26 ms NPU HW + **~16 ms fp32 output memcpy of 34 MB** (biggest CPU item) |
| postprocess / NMS | 3 ms | CPU |
| composite | 5 ms | CPU |
| BGR→NV12 | 2 ms | CPU |
| encode (memcpy + call) | 5 ms | CPU |

CPU total for the running service dropped from **~390 %** (software x264) to
**~280–296 %** once the Cedar **HW encode** replaced x264 — about one core saved.
The single biggest remaining CPU cost is the **fp32 output copy**; postprocessing
directly on the raw INT NPU output would remove it.

---

## 3. Why this cheap board beats a Jetson Nano on memory

Observed: a Jetson Nano running 4× YOLOv5 streams used **~3.6 GB** and couldn't do
much else; the A733 does the equivalent loop in **~396 MB**. But the honest
comparison is nuanced:

- **The Jetson was actually *faster* in raw FPS** (CUDA/TensorRT throughput). This
  board wins on **memory and total system headroom**, not peak fps.
- The win comes from a **lean C++/VIPLite runtime + fixed-function silicon**
  (dedicated NPU + Cedar codec blocks) versus the Jetson's CUDA/TensorRT +
  cuDNN + GStreamer-NVMM software stack, which carries a large resident memory
  tax. It is a *stack* difference as much as a silicon one.

Takeaway: for an **always-on multi-stream edge appliance** that must also run other
software in ~1 GB, fixed-function blocks + a thin runtime is the better fit; for
maximum single-box throughput, the Jetson still leads.

---

## 4. Can it run 4 USB cameras (instead of RTSP)?

**Compute: yes** — decode/detect/encode headroom is fine; RTSP vs USB doesn't
change the NPU or composite cost. The constraints are on the **USB side**:

- **Bandwidth / format.** 4× raw-YUV USB webcams would swamp USB bandwidth; you
  want cameras that deliver **MJPEG or H.264** so the link isn't carrying raw
  frames. MJPEG then needs a (cheap) JPEG decode per frame; H.264 UVC cameras feed
  the Cedar decoder directly.
- **Power.** 4 cameras on the shared USB-C need a **powered hub** — the port's PD
  budget won't feed them (a known board PD limit).
- **Enumeration.** Multiple UVC devices on one controller share bandwidth; verify
  they negotiate compressed formats, not raw.

So it's feasible without more *compute*, but needs the right **cameras (compressed
UVC) + a powered hub**, not a more powerful board.
