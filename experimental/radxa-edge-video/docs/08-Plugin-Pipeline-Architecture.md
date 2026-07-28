<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 08 — Plugin pipeline architecture (dlopen-loaded, swappable stages)

Date: 2026-07-26

## Why

The NPU video-detection pipeline lived in one monolith (`src/npu_compare.cpp`, 987 lines):
source, preprocess, inference, per-model decode, overlay, compositor, and Cedar encoder all
hardcoded; only the model was swappable (a `Model{}` function-pointer struct). The end goal is
a **React graph editor** that composes a pipeline visually — add/drop stages, swap models and
pre/post-process, choose the overlay, and tap detections at any node. **Step 1 (this doc)** is
the enabling refactor: split the monolith into **runtime-loaded `.so` stage modules**, wired by
a **JSON config** (the seam the editor will emit), so stages swap without recompiling the host.

Scope kept deliberately narrow: the host runtime keeps the *proven threading model* (per-stream
workers + single-NPU mutex + compositor/sink thread) that measured ~31 inf/s; each stage becomes
a swappable module. A general arbitrary-DAG scheduler is a later step.

## The ABI — `src/plugins/helix_pipeline.h`

A versioned `extern "C"` boundary, mirroring the repo's existing pluggable idiom
(`embedded/protocol`'s `helix_transport_t` vtable + accessor) but loaded at runtime via `dlopen`.
Plugins use C++/OpenCV internally; only the boundary is C.

- `HELIX_ABI_VERSION` — host refuses a mismatched `.so`.
- Tagged edge payloads so a **detection list is first-class** (usable at any node): `helix_frame_t`
  (BGR/…), `helix_tensor_t` (preproc output), `helix_tensors_t` (raw NPU heads = `float**`),
  `helix_detections_t` (`helix_det_t{x,y,w,h,cls,score,kpts,nkpt}` in **original-frame pixels**),
  wrapped in a tagged `helix_packet_t`.
- One vtable per node (unused fn-ptrs NULL): `create(params_json)`, `destroy`, `process(in[],n,out)`,
  plus an **infer specialization** `infer_submit`/`infer_collect` — the host holds the single-NPU
  mutex around `infer_submit` only and does the fp32 read-back (`infer_collect`) outside it,
  preserving the measured 28→32 inf/s split.
- Each `.so` exports one symbol: `const helix_node_vtable* helix_node_entry(void)`.

`hx_json.h` is a tiny header-only JSON parser/dumper used by the host (read config) and plugins
(read `params`). Hand-written rather than vendoring cJSON — no board dependency, and it dodges the
1 GB-board OOM that heavy header libs (nlohmann/json) trigger under the mandatory `-O1`.

## The host — `src/plugins/helix_pipeline.cpp` → `helix_pipeline`

`helix_pipeline <config.json> [host_ip]`. Reads the config (`${HOST}` → `host_ip`), `dlopen`s each
node's `.so`, checks the ABI, `create`s it with its params, then runs the **npu_compare threading
verbatim**: one worker thread per stream doing
`source → preprocess → {lock; infer_submit; unlock; infer_collect} → postprocess → overlay →
publish`, a compositor/sink `outputter` thread at ~30 fps, `mtx_npu` serializing the NPU,
`mtx_latest` guarding the annotated cells, a teardown watchdog, and per-stream inf/s + ms + aggregate
stats. The host is geometry-agnostic — the compositor owns grid layout.

## The stage plugins — `src/plugins/<stage>/*.cpp`, one `.so` each

| `.so` | kind | from `npu_compare.cpp` |
| --- | --- | --- |
| `hx_src_gst` | source | rtspsrc→omxh264dec→BGR appsink (:821-826, :595) |
| `hx_pre_letterbox` | preprocess | `preprocess()` (:161) → CHW uint8 |
| `hx_infer_awnn` | infer | awnn `create`/`run_hw`/`finish`/`get_output` (:614-625); **model = the `nb` param** |
| `hx_post_yolov5` | postprocess | `detect_draw` decode (:181-207) → detections |
| `hx_post_yolo11` | postprocess | `yolo11_draw` decode (:366-423) → detections (11s **and** 11m) |
| `hx_post_pose` | postprocess | `pose_draw` decode (:260-360) → detections + 17 keypoints |
| `hx_overlay_boxes` | overlay | box + label draw, **split out of decode** |
| `hx_overlay_pose` | overlay | skeleton + keypoint draw |
| `hx_comp_grid` | compositor | 2×2 composite (:651-658) |
| `hx_sink_cedar_rtmp` | sink | Cedar `make_encoder`/`bgr_to_nv12`/`encode_push` + RTMP (:471-569, :851-855) |

Shared decode helpers (sort/NMS/letterbox-inverse) live in `hx_detect_common.h`.

**What this unlocks:** swap a **model** = change `infer.nb` (same `.so`); a *different decode family* =
swap the `postprocess` `.so`; the **overlay is separated from decode**, so postprocess emits
`helix_detections_t` and overlay (or any future recorder/alert/export node) consumes it. All are
config edits — **no host recompile**.

## Config — `src/plugins/configs/*.json`

Per-stream `{source, preprocess, infer, postprocess, overlay}` + shared `{compositor, sink}`; each
node is `{"module": "...", "params": {...}}`. `configs/mixed.json` reproduces the `mixed` run
(5n + 11s), `configs/all-11m.json` is the swap demo (only `infer.nb` differs). This is exactly the
JSON a React editor will generate.

## Build & run (on the board)

```sh
scp -r src/plugins radxa@BOARD:/home/radxa/npu/examples/yolov5/plugins
ssh radxa@BOARD 'make -C /home/radxa/npu/examples/yolov5/plugins'   # host + 10 .so, -O1
ssh radxa@BOARD 'cd /home/radxa/npu/examples/yolov5/plugins && sudo ./helix_pipeline configs/mixed.json 192.168.1.35'
# watch: http://192.168.1.35:8889/detgrid
```

The `Makefile` mirrors `build_split.sh` (opencv4 + gstreamer + `-I$VIP/inc` + cedar headers in
`/usr/include`; `-O1` OOM guard; the infer `.so` links `-lNBGlinker -lVIPhal` with baked RPATH, the
sink `.so` links the Cedar libs). A `helix edge` CLI wrapper (scp + on-board make) is a noted
follow-up, not part of step 1.

## Verification (on-board, confirmed)

Built on the board (host + 10 `.so`, `-O1`) and run against the same 4 complex streams as the
monolith comparison:

- **Parity — matched exactly.** `configs/mixed.json` (5n + 11s) held **AGG = 31.7 inf/s**, with
  per-model timing identical to the monolith (5n @53–54 ms, 11s @43 ms). The annotated `/detgrid`
  is visually identical: night-city + highway scenes, 5n green vs 11s orange, dense correct boxes
  (bus/person/car/truck).
- **Swappability — proven, no recompile.** `configs/all-11m.json` (the *only* change is
  `infer.nb` → `yolo11m.nb`) run with the **same `helix_pipeline` binary and the same `.so`s**
  dropped straight to all-11m behavior: **AGG = 13.5 inf/s @86 ms**, matching the monolith's
  measured 11m numbers. Swapping the model was a pure config edit.

### Resource cost vs the monolith (measured, identical `mixed` workload)

Same 4 streams, same models, one process each (plugins are `dlopen`'d in-process). Sampled CPU
(`utime+stime` delta) + peak RSS over 30 s at steady state:

| | monolith `npu_compare` | plugin `helix_pipeline` |
| --- | --- | --- |
| CPU | 284% | **295%** (+3.8%) |
| RSS | ~98 MB | ~96–98 MB (equal) |
| threads | 57 | 57 |
| throughput | 32.0 inf/s | 31.0 inf/s (parity) |

The **first** naive version cost **+13% CPU** (322%) because the compositor re-resized all four
*full* frames every 33 ms tick (~120 resizes/s) plus a full-frame snapshot copy — vs the monolith
resizing to a cell only on a new inference (~32/s). Two host-only fixes closed most of the gap: an
`updated[]` flag so the compositor only touches **changed** cells, and compositing **under the
`mtx_latest` lock** (encode outside it) to drop the snapshot copy. The residual **~+3.8% CPU** is
the price of the clean separation — the worker copies the *full* annotated frame into `latest[]`
(the monolith wrote a pre-resized small cell) so full-resolution frames flow to the compositor and
any future node. RAM and thread count are effectively identical. (Reducible to ~0 by resizing to
the cell in the worker, but that recouples the worker to grid geometry — not worth it for ~4%.)

Two build notes worth carrying forward: the source and sink `.so`s must link **libgstapp**
(`gst_app_sink_*`/`gst_app_src_*` are not in `-lgstreamer-1.0`); and under `sudo` the loader runs
in secure-execution mode, so the host `dlopen`s each plugin by a **canonical absolute path**
(`realpath`) — cwd-relative paths are rejected.
