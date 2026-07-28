<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# hxc — cross-platform pipeline compiler (prototype)

The original goal: **define a detection pipeline once** (in a React editor), with **platform-agnostic
components**, and run **the exact same pipeline** — optimally — on DeepStream (NVIDIA dGPU/Jetson),
Radxa A733 NPU, RPi + Hailo, etc. No redefining per platform.

The key insight from the optimization work (see `../docs/09`, `../deepstream/`): abstract at the
**graph** layer, not the per-frame data layer. The portable artifact is the *graph* (semantic nodes
+ params); a **backend per platform compiles it to that platform's native, zero-copy pipeline**,
picking the best component + model artifact for each node. Most accelerators expose their engines as
**GStreamer elements** (DeepStream, Hailo, our Cedar path), so the backend is mostly "instantiate the
platform's element for each node" — each staying native/zero-copy.

## Files

- **`graph.json`** — one portable pipeline (4 streams → decode → batch → detect(yolo11s) → track →
  tile 2×2 → overlay → rtsp sink). This is what the editor emits.
- **`hxc.py`** — the compiler. `compile` prints a target's native pipeline; `run` executes it.

```sh
python3 hxc.py compile graph.json --target deepstream   # nvstreammux/nvinfer/nvtracker/tiler/osd/NVENC
python3 hxc.py compile graph.json --target hailo        # hailonet/hailofilter/hailotracker/...
python3 hxc.py compile graph.json --target radxa        # -> OUR plugin host's JSON config (awnn/Cedar)
python3 hxc.py run     graph.json --target deepstream   # actually runs it (DeepStream container)
```

## The mapping (the heart of the compiler)

| node role | DeepStream | Hailo (RPi) | Radxa A733 |
| --- | --- | --- | --- |
| decode | `nvurisrcbin` (NVDEC→NVMM) | `v4l2h264dec` | `omxh264dec` (Cedar) |
| batch | `nvstreammux` | `hailoroundrobin` | per-stream workers |
| **detect** | `nvinfer` + **`.engine`** | `hailonet` + **`.hef`** | `hxawnninfer` + **`.nb`** |
| track | `nvtracker` (NvDCF) | `hailotracker` | (cpu) |
| tile | `nvmultistreamtiler` | `compositor` | `hx_comp_grid` |
| overlay | `nvdsosd` | `hailooverlay` | `hx_overlay_boxes` |
| sink | `nvv4l2h264enc` (NVENC) | `x264enc` | `hx_sink_cedar_rtmp` (Cedar) |
| model artifact | ONNX→TensorRT `.engine` | ONNX→Hailo `.hef` | ONNX→ACUITY `.nb` |

## Proven (on this laptop, GTX 1650)

- **`--target deepstream` runs end-to-end** from the graph: ~60 fps aggregate, NVDEC+NVENC+TensorRT
  +nvtracker, 24% CPU. The `track` node in the graph auto-wired `nvtracker` in.
- **`--target radxa` compiles to `../src/plugins`' JSON config** — the exact format our dlopen plugin
  host already runs on the A733 board. Full circle: the same graph feeds both the NVIDIA-native
  backend and our NPU backend.
- **`--target hailo` emits the native Hailo GStreamer pipeline** (runs on RPi+Hailo, not this box).

So: **one graph, three native pipelines, one of them running now.** That is the goal, prototyped.

## What a real version needs (this is a prototype)

1. **Richer graph schema** — arbitrary DAGs, branches (tee to record + analytics + live), per-node
   config, the metadata taps (probes) for "use detections at any step".
2. **Model artifact resolver** — a build step that converts a model id (`yolo11s`) to each platform's
   format: `.engine` (trtexec), `.hef` (Hailo DFC), `.nb` (ACUITY). We already did all three by hand
   this session.
3. **awnn-as-a-GStreamer-element** (`hxawnninfer`) so the Radxa backend is also a pure GStreamer graph
   like the others (today it uses our dlopen host — equivalent, just not gst-native).
4. **The React editor** emits `graph.json`; `hxc` is the backend that compiles + deploys per target.
5. Real Hailo / Jetson backends validated on hardware.

It's a real project (a cross-platform inference-pipeline compiler), but the core — *one graph →
per-platform native pipeline, running* — is demonstrated here.
