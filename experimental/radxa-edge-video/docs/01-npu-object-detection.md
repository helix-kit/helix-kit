<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 01 — NPU object detection (YOLOv5 on the VIP9000)

Date: 2026-07-25

This extends the [hardware video grid](../README.md) with **on-device object
detection**: four RTSP camera streams are decoded, each frame is run through
**YOLOv5 on the A733's Vivante VIP9000 NPU**, boxes are drawn, the annotated
frames are composited into a 2×2 grid, and the grid is both displayed locally and
streamed. This is the full **DeepStream-equivalent loop** —
decode → detect → annotate → compose → encode → display/stream — on a ~$40 board.

Source:
- [`src/npu_grid_display.cpp`](../src/npu_grid_display.cpp) — the full pipeline
  (detection + grid + Cedar HW encode + standalone display). **This is the one
  that runs as a service.**
- [`src/npu_grid.cpp`](../src/npu_grid.cpp) — earlier single-threaded throughput
  probe (4 streams → NPU → FPS report, no encode/display).
- [`src/npu_bench.c`](../src/npu_bench.c) — bare single-image NPU latency probe.

---

## 1. The NPU stack

| Piece | What it is |
| --- | --- |
| **NPU** | Vivante **VIP9000**, 3 TOPS INT8, `compatible = allwinner,npu`, kernel driver `vipcore` (`/dev/vipcore`), debugfs `/sys/kernel/debug/viplite` |
| **Runtime** | **VIPLite 2.0** — `libNBGlinker.so` + `libVIPhal.so` (not the older v1.13 `libVIPlite`/`libVIPuser`) |
| **Model format** | **NBG `.nb`** — offline-compiled from ONNX by the vendor **ACUITY** toolkit. Prebuilt `.nb` ship in the SDK, so ACUITY is only needed for *custom* classes. |
| **High-level API** | **awnn** (`awnn_init` / `awnn_create` / `awnn_set_input_buffers` / `awnn_run` / `awnn_get_output_buffers` / `awnn_destroy`), compiled from source, wraps VIPLite. |

Everything came from **github.com/ZIFENG278/ai-sdk** (the "Radxa Cubie series NPU
ai-sdk", ~1.1 GB, plain clone — not git-lfs). The A733 uses the **`v3`** model
(`machinfo/a733/config.mk`: `NPU_VERSION=v3`, `NPU_SW_VERSION=v2.0`) and the
`v2.0` runtime libs under `viplite-tina/lib/aarch64-none-linux-gnu/v2.0`.

> The apt `npu-runtime` package was **not** in the configured board repo; the
> ai-sdk repo is the source of truth for libs, headers, and prebuilt models.

Static-image proof: on the classic `dog.jpg`, YOLOv5 detects dog 82 %,
bicycle 47 %, truck 69 % at **~26 ms/frame (~38 FPS)** of pure NPU time.

---

## 2. Per-inference cost

Single warmed inference (set_input + run + get), measured on-board:

| Stage | Time |
| --- | --- |
| `awnn_init` | 6 ms (one-time) |
| `awnn_create` (build network) | 59 ms (one-time) |
| `vip_run_network` (**NPU HW**) | **~26–33 ms** |
| output tensor → fp32 `memcpy` (34 MB) | **~11–16 ms** ← biggest CPU item |
| letterbox preprocess (640² CHW) | ~7 ms |
| YOLO decode + NMS | ~3 ms |

Sustained single-inference NPU ceiling ≈ **27.5 inf/s** (the core is a **single**
NPU, `core_count = 1`). The fp32 output copy is the largest *CPU* cost and the
obvious next optimization (postprocess directly on the raw INT output).

---

## 3. Making it a real pipeline

### Preprocess (matches the vendor recipe exactly)

Letterbox the BGR frame into a 640×640 canvas, convert BGR→RGB, then pack
**HWC → CHW uint8**. Getting this bit-identical to the vendor `yolov5_pre_process`
is what makes the prebuilt `.nb` produce correct boxes.

### Decode / NMS

The YOLOv5 head decode (3 output heads 85×{80,40,20}²×3, 80 COCO classes + 5),
sigmoid/anchor math, and NMS are reused **verbatim** from the vendor
`yolov5_post_process.cpp` so results match the reference.

### Two-worker pipelining

A single detection thread leaves the NPU idle during CPU pre/post. The pipeline
uses **`NWORK = 2` worker threads**, each with **its own `awnn_create`
context**:

- `mtx_npu` serializes the actual `awnn_run` (one physical NPU core).
- Each worker reads **its own context's** output buffers **outside** the lock for
  postprocess — per-context buffers, verified no cross-corruption.
- A separate compositor/encoder ("outputter") thread runs at ~30 fps regardless
  of detection rate, so the stream and display stay smooth as cells refresh.
- A **`videorate drop-only=true framerate=8/1`** element sits before each
  `videoconvert`, cutting CPU-side color-convert from ~100 to ~32 frames/s.

Result: **15 → 21.4 inf/s aggregate (+43 %)**, boxes correct on all four varied
streams. (With the standalone display enabled, 20.7 inf/s — see
[02](02-standalone-display.md).)

> Note on load average: `loadavg ~7` is **inflated** by the 3 D-state VIP kernel
> threads (`vip_device0_dae`, `vip_core0_wait`, `vip_power_manag`) that sit in
> D-state whenever the NPU is active. That is normal, not a wedge.

---

## 4. How it wires into the grid

```
 4× rtspsrc ! omxh264dec ! videorate 8fps ! videoconvert ! BGR appsink
        │
        ▼  (round-robin across 2 NPU workers)
 letterbox 640² ─► awnn (YOLOv5 / VIP9000) ─► decode + NMS ─► draw boxes
        │
        ▼  (outputter thread, ~30 fps)
 composite 2×2 (each cell 640×360 → 1280×720)
        ├── Cedar HW encode ─► appsrc ! h264parse ! flvmux ! rtmpsink ─► MediaMTX ─► WebRTC
        └── direct-DRM scanout ─► DP-1 panel (see doc 02)
```

The Cedar HW encoder is the same one documented in the
[main README §5](../README.md#5-cedar-hw-encode--the-three-fixes) (the three
fixes: `bEncH264Nalu=0`, `AlreadyUsedInputBuffer()`, SPS/PPS on keyframe). CPU
dropped from ~390 % (software x264) to ~280–296 % (Cedar VE encode).

---

## 5. Build & run

Native aarch64 build on the board (no cross-toolchain). The board has ~1 GB RAM,
so **`g++ -O2` OOM-kills `cc1plus`** on this OpenCV-heavy file — the build script
uses **`-O1`**, drops caches first, and split-compiles one translation unit at a
time. See [`src/build_split.sh`](../src/build_split.sh).

```sh
# on the board, staged under /home/radxa/npu (ai-sdk layout preserved)
bash build_split.sh          # -O1 split compile -> npu_grid_display
```

Runs durably as **`npu-detgrid.service`**
([`src/npu-detgrid.service`](../src/npu-detgrid.service)):
`ExecStart=… npu_grid_display 192.168.1.35 model/v3/yolov5.nb disp`
(the `disp` 3rd arg enables the standalone display). Stable, publishes
RTMP→MediaMTX, viewable at `http://<host>:8889/detgrid`.

> **Service launch gotcha:** a background process started via
> `sudo -S bash -c '... &'` over SSH dies on SIGHUP when the SSH/sudo parent
> exits, and a heredoc-created unit file *inside* nested `sudo bash -c` silently
> fails to write. Always **scp the unit file** and `systemctl enable --now` — never
> background-over-SSH.

---

## 6. Custom models

To detect **custom classes**, convert your ONNX → NBG with the ACUITY Docker
(`ubuntu-npu:v2.0.10.1`) targeting `v3` / `NPU_SW_VERSION=v2.0`. The prebuilt
`.nb` covers stock COCO-80 YOLOv5.

Test streams: four varied H.264 clips from
`github.com/intel-iot-devkit/sample-videos` (person-bicycle-car, people,
store-aisle, worker-zone) served as fake cameras `stream1`–`stream4`.
