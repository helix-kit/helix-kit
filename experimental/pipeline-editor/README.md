<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Helix Pipeline Editor (HELIX-148)

A visual, fully-editable **xyflow** graph editor for the edge-video pipeline: compose the graph once,
then **compile + deploy + run** it — unchanged — on either target, both ending at **MediaMTX → WebRTC**:

- **Radxa A733** → `helix_pipeline` plugin-host config → Cedar decode + NPU (yolo11s) + overlay +
  2×2 grid + Cedar encode → RTMP.
- **NVIDIA GTX 1650** → DeepStream gst pipeline → NVDEC + `nvinfer`(TensorRT) + tiler + OSD + NVENC → RTMP.

This is the front-end HELIX-148's "define once, run anywhere" model calls for; it reuses the proven
`helix_pipeline` (Radxa) and DeepStream (NVIDIA) paths via the bridge.

## Run

```sh
python3 server.py          # bridge + editor on http://localhost:8770  (stdlib only, no pip)
# open http://localhost:8770  → edit graph → pick target → "▶ Deploy & Run" → "open WebRTC ↗"
```
Env: `HELIX_HOST` (laptop = RTSP source + MediaMTX, default `192.168.1.35`), `HELIX_BOARD`
(default `192.168.1.59`). Prereqs (all live this session): `fake-camera` (RTSP :8554) + `mtx-webrtc`
(MediaMTX RTMP :1935 / WebRTC :8889) on the laptop; the board's `~/lab/plugins` (see
`../radxa-edge-video/docs/12`); `~/edge-x86/DeepStream-Yolo` (engine + `config_infer_yolo11s.txt`).

## Files

- **`index.html`** — the xyflow editor (React + `@xyflow/react` via ESM CDN, no build step). Add/drop
  nodes (detect/overlay/track/tile/sink/record), rewire edges, edit every node's params, pick target,
  Compile / Deploy / Stop, open the WebRTC link.
- **`server.py`** — the bridge (stdlib `http.server`). `POST /api/{compile,deploy,stop}` + `GET
  /api/status`. Turns the graph into each platform's native pipeline (`compile_radxa` = the
  `all-11s.json` config the board runs; `compile_nvidia` = a DeepStream `gst-launch`), then deploys
  (radxa via `scp`+`systemd-run`; nvidia via `docker run`).
- **`graph.default.json`** — the portable graph the editor loads/emits (the interchange).

## The portable graph

```json
{ "streams": ["rtsp://${HOST}:8554/stream1", …],
  "nodes": [ {"id":"det","role":"detect","params":{"model":"yolo11s","conf":0.35,"fps":15}}, … ],
  "edges": [["src","det"],["det","ovl"],["ovl","tile"],["tile","sink"]] }
```
`${HOST}` is substituted by the bridge. Roles: `source · detect · overlay · track · tile · sink ·
record`. The bridge maps each role to the target's native component (same idea as `../radxa-edge-video/
graph-compiler/hxc.py`, but wired to actually deploy + run).

## Verified (2026-07-29) — one graph, both targets, full 4-cam → WebRTC

| target | how | result |
| --- | --- | --- |
| **Radxa A733** | graph → `_editor.json` → `systemd-run helix_pipeline` | **AGG 32.6 inf/s**, 4 cams detecting → `http://192.168.1.35:8889/detgrid` |
| **NVIDIA GTX 1650** | graph → DeepStream `gst-launch` in Docker | PLAYING, GPU 68% + NVDEC + NVENC, MediaMTX `detgrid-ds` online (H264) → `http://192.168.1.35:8889/detgrid-ds` |

## Status / not-yet

Editor → compile → deploy → run → WebRTC is proven on both targets. **Not yet** (the deeper HELIX-148
runtime): the demand-gated tee + refcount runtime (start/stop a branch on a *running* pipeline; NPU
idles when nothing needs it), the GLES→KMS display branch, and per-branch on-demand triggers (MediaMTX
reader webhook / display switch). Today Deploy restarts the pipeline; the editor already models the
graph those will execute.
