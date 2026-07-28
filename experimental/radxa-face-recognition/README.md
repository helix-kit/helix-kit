<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Radxa face recognition (experimental)

Face recognition on the **Radxa Cubie A7Z** (Allwinner A733) **Vivante VIP9000 NPU**,
kept **completely separate** from the [edge-video / multi-model pipeline](../radxa-edge-video/).
Exploratory — "let's see where it goes".

## Pipeline (four independent stages)

```
frame ─► [1] face DETECT (bbox + 5 landmarks) ─► [2] ALIGN (warp to 160²)
      ─► [3] EMBED (FaceNet → 512-d, on the NPU) ─► [4] MATCH (cosine vs gallery)
```

The hard/novel part is **[3] the embedding model on the NPU** — face-recognition nets are
much more **quantization-sensitive** than detectors (small embedding-distance differences
decide identity), so that's proven first, before building detection/alignment/matching.

## Model — MobileFaceNet (not FaceNet)

We tried **FaceNet** (`InceptionResnet-v1`, 160×160) first (as suggested) — the float model is
perfect, but it would **not** produce a usable embedding on the NPU. Switched to
**MobileFaceNet** (InsightFace `w600k_mbf`, ArcFace-trained, **112×112 → 512-d**), which is the
edge/NPU-appropriate choice — ~1M params, quantizes cleanly, faster, and typically *more*
accurate than FaceNet. (Detector `det_500m` = SCRFD is bundled in the same `buffalo_sc` pack,
for M2.)

- **Preprocessing:** ArcFace norm `(x - 127.5)/127.5` → ACUITY inputmeta `mean = 127.5`,
  `scale = 0.00784314` (= 1/127.5), RGB, plus 5-landmark similarity-transform alignment to the
  canonical 112×112 (`cv2.estimateAffinePartial2D` to the ArcFace reference points).
- **⚠️ Critical conversion lesson (cost the whole first day of this):** the **quantizer type
  sets the NBG *input* tensor format**. Quantize `int16` → the input tensor is `int16`
  fixed-point (pre-normalized), NOT uint8; feeding raw uint8 bytes to it gives **garbage in →
  collapsed embeddings** (all faces ~0.8 similar, uncorrelated with float). Quantize **`uint8`**
  → the input is uint8 (`scale 0.00784, zero_point 127`, i.e. the ArcFace norm baked in), and a
  raw-uint8 feed is correct. This collapse hit FaceNet *and* MobileFaceNet identically, which is
  what proved it was the input format, not model sensitivity. **For these awnn image models:
  quantize uint8 and feed raw uint8 CHW.**

## Result (M1)

MobileFaceNet **uint8** on the A733 NPU (`models/mbf_uint8.nb`, 2.77 MB), via
[`src/facenet_embed.cpp`](src/facenet_embed.cpp) (awnn; `FACE_SIZE`/`FACENET_NB` env):
- **NPU-vs-float embedding fidelity: 0.946 mean** (0.915 min) — quantization faithful.
- **Identity separation: same-person cos ≥ 0.46 > cross-person ≤ 0.31** (margin +0.15) — matches
  the float model's separation.
- **6.2 ms/face end-to-end** (~160 faces/s), model 2.77 MB.

## Status

- [x] **M1 — MobileFaceNet embedding on the NPU** (fidelity 0.95, identities separable, 6 ms/face)
- [ ] M2 — SCRFD face detector on the NPU (`det_500m` → bbox + 5 landmarks) + alignment
- [ ] M3 — end-to-end: camera → detect → align → embed → match against a gallery
