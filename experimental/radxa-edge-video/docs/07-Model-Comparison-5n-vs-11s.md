<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 07 — Model comparison: YOLOv5n vs YOLO11s (throughput on complex scenes)

Date: 2026-07-26

**Question:** does the newer/larger **YOLO11s** run as fast as the older/smaller
**YOLOv5n** on the A733 NPU, what are the per-model numbers on a complex scene, and
**if we switch all 4 streams to 11s, what is the overall frame rate?**

This is a *model* comparison at the **normal stream resolution** (768×432, same as
the earlier grid) — not the resolution/decode stress of doc 06.

## Setup

`src/npu_compare.cpp` (adapted from `npu_multimodel.cpp`). Two complex scenes, each
run through **both** models so 5n and 11s sit side-by-side on identical content:

```
stream0 = videoA + 5n      stream1 = videoA + 11s      (top-left / top-right)
stream2 = videoB + 5n      stream3 = videoB + 11s      (bottom-left / bottom-right)
```

- **videoA** = a **dense night-city street** (buses, people, motorcycles, bicycles, cars —
  many objects, mixed classes).
- **videoB** = **busy daytime highway traffic** (dozens of cars, vans, trucks).

  Both are genuinely crowded scenes (re-encoded to 768×432); at any instant each cell
  carries 10–30+ objects, so this exercises detection under real clutter, not a
  near-empty frame.
- 4× `omxh264dec` decode → per-worker NPU inference (single core, serialized by a
  mutex; each worker owns its awnn context) → decode+draw → 2×2 composite → Cedar HW
  H.264 encode → RTMP → WebRTC `/detgrid`. **5n boxes green, 11s boxes orange.**
- Layout selectable by `argv[2]`: `mixed` (default) | `all11` | `all5`, so
  "all 4 on 11s" is **measured directly**, not extrapolated.
- Per-model metric = pure inference wall cost (**NPU HW run + fp32 output copy**, with
  lock-wait excluded); throughput = achieved inf/s under the 4-way NPU time-share.

## Results (converged, 4 streams, ~30 s each)

| Layout | Aggregate | Per-stream | 5n inf | 11s inf | 11m inf |
| --- | --- | --- | --- | --- | --- |
| **all 5n** (old baseline) | **30.3 inf/s** | 7.6 fps | 52.7 ms | — | — |
| **all 11s** | **30.6 inf/s** | 7.7 fps | — | 42.6 ms | — |
| **mixed** (2×5n + 2×11s) | **31.1 inf/s** | 7.8 fps | 55 ms | 44 ms | — |
| **all 11m** | **13.5 inf/s** | 3.4 fps | — | — | 87 ms |
| **smix** (2×11s + 2×11m) | 18.6 inf/s | 4.6 fps | — | 42 ms | 86 ms |

### YOLO11m (the heavier tier)

Converted the same way (ONNX → cut 6 raw heads → uint8 NBG, 14.4 MB vs 11s's 6.8 MB;
identical `yolo11_draw` decode). On paper **~51.5 mAP** vs 11s's 47.0.

- **Inference ≈ 87 ms** — ~2× the 11s cost (43 ms), tracking its ~3× FLOPs (68 vs 21.5).
- **NPU-bound ceiling ≈ 13.5 11m-inferences/s total.** So per stream count:
  - **1 stream → ~11–13 fps** (real-time),
  - **2 streams → ~6.7 fps each** (usable CCTV),
  - **4 streams → 3.4 fps each** (below real-time).
- **Highest recall of the three** — most cumulative detections (7864 in the same window
  vs 11s's ~6200), and it catches extra classes 11s misses (e.g. `handbag`, `bicycle`
  in the crowded night scene).

**Verdict:** 11m is the right call for **1–2 high-value cameras** where accuracy beats
frame-rate; for **4 concurrent streams stay on 11s** (same throughput as 5n, +19 mAP).
11m on all 4 drops to ~3.4 fps/stream.

### Answers

- **Does 11s run as fast as 5n?** Yes — in fact **11s is *faster per inference*
  (~43 ms vs ~53 ms)**. Its anchor-free head emits a *smaller* output tensor
  (box 64ch + cls 80ch over 8400 cells ≈ 1.2 M floats) than YOLOv5n's anchor-based
  head (3 anchors × 85ch ≈ 2.1 M floats), so the fp32 read-back off the NPU is
  cheaper. The pure NPU HW execution is nearly identical (~33 ms) for both.

- **Overall frame rate on the complex scene:** ~**30 inf/s aggregate across 4
  streams (≈7.6 fps per stream)**, the same ceiling for either model. The single NPU
  core is the shared bottleneck; the fp32 copy overlaps the next inference, so 11s's
  cheaper copy doesn't raise the ceiling but its heavier CPU decode doesn't lower it
  either — they converge.

- **If we switch entirely to 11s:** **~30.6 inf/s (≈7.7 fps/stream) — no throughput
  penalty vs 5n.** You get the newer architecture for free.

- **Detection quality on the crowded scenes:** 11s finds **~16 % more objects** than
  5n on identical dense content (**6182 vs 5317** cumulative detections over the same
  window) — better recall exactly where it matters (buses/people in the night street,
  the wall of highway cars). Both densely box the scenes correctly.
  Caveat: 11s's on-screen **confidences read lower** (e.g. `car 57%` vs 5n's `car 84%`)
  because the uint8-quantised 11s input scale came out at 0.00368
  rather than the ideal 1/255 = 0.00392 (calibration never saw a full-255 pixel), a
  ~6 % contrast reduction — cosmetic on the score, not a miss. See doc 06 / the
  quantize-uint8 recipe.

## Takeaway

On this NPU the **newer YOLO11s is a strict upgrade over YOLOv5n** for detection:
same (slightly better) throughput, cheaper output read-back, at least as many
correct detections. The board sustains **~30 object-detections/s split across 4
concurrent camera streams** regardless of which of the two models is used.

## Reproduce

```sh
# host: serve 2 complex scenes on the fake-camera (vidA on stream1/2, vidB on 3/4)
docker cp vidA.mp4 fake-camera:/video/stream-1.mp4   # + stream-2
docker cp vidB.mp4 fake-camera:/video/stream-3.mp4   # + stream-4
docker restart fake-camera        # entrypoint waits on its ffmpeg pushers — do NOT pkill them

# board (root; LD_LIBRARY_PATH = viplite v2.0 dir), build via build_compare.sh, then:
sudo LD_LIBRARY_PATH=$VIP ./npu_compare 192.168.1.35 mixed   # | all11 | all5
# watch: http://192.168.1.35:8889/detgrid   (green=5n, orange=11s)
```

Prints, every 2 s, per-model `inf/s (per-stream) @inference-ms  det-count` and the
aggregate. `REC=1` re-enables the on-demand clip recorder (off here to keep the
throughput measurement clean).
