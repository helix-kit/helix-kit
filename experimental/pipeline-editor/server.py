#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Pipeline-editor bridge (HELIX-148).

Serves the xyflow editor and turns the portable graph it emits into a RUNNING pipeline on either
target, reusing the machinery proven this session:
  - radxa  -> helix_pipeline plugin-host JSON config -> scp to board -> systemd-run (Cedar+NPU)
  - nvidia -> DeepStream gst-launch pipeline in Docker (NVDEC + TensorRT + NVENC)
Both sinks end at the laptop's MediaMTX -> WebRTC. Stdlib only (py3.14, no pip).

  python3 server.py                # serve editor + API on :8770
"""
import json, os, subprocess, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
HOST = os.environ.get("HELIX_HOST", "192.168.1.35")          # laptop = RTSP source + MediaMTX
BOARD = os.environ.get("HELIX_BOARD", "192.168.1.59")
DS_WORK = os.path.expanduser("~/edge-x86/DeepStream-Yolo")   # has yolo11s engine + config_infer + parser
NB = {"yolo11s": "/home/radxa/lab/yolo11s.nb", "yolo11m": "/home/radxa/lab/yolo11m.nb"}


def _node(graph, role):
    return next((n for n in graph["nodes"] if n["role"] == role), None)


def streams(graph):
    return [s.replace("${HOST}", HOST) for s in graph["streams"]]


# ---- compile: graph -> radxa helix_pipeline config (the all-11s.json shape the board runs) --------
def compile_radxa(graph):
    det = _node(graph, "detect")["params"]
    ovl = (_node(graph, "overlay") or {"params": {"color": "orange"}})["params"]
    tile = _node(graph, "tile")["params"]
    snk = _node(graph, "sink")["params"]
    nb = NB.get(det.get("model", "yolo11s"), NB["yolo11s"])
    post = "hx_post_yolo11" if "yolo11" in det.get("model", "yolo11s") else "hx_post_yolov5"
    st = []
    for i, uri in enumerate(streams(graph)):
        st.append({
            "label": f"cam{i+1}",
            "source": {"module": "hx_src_gst", "params": {"url": uri, "fps": det.get("fps", 15)}},
            "preprocess": {"module": "hx_pre_letterbox", "params": {"size": 640}},
            "infer": {"module": "hx_infer_awnn", "params": {"nb": nb}},
            "postprocess": {"module": post, "params": {"conf": det.get("conf", 0.35), "nms": det.get("nms", 0.45)}},
            "overlay": {"module": "hx_overlay_boxes", "params": {"color": ovl.get("color", "orange")}},
        })
    cfg = {
        "host": {"warmup_ms": 1500},
        "streams": st,
        "compositor": {"module": "hx_comp_grid", "params": {
            "cols": tile["cols"], "rows": tile["rows"], "grid_w": tile["width"], "grid_h": tile["height"]}},
        "sink": {"module": "hx_sink_cedar_rtmp", "params": {
            "url": f"rtmp://{HOST}:1935/{snk.get('name','detgrid')}", "width": tile["width"], "height": tile["height"]}},
    }
    return json.dumps(cfg, indent=2)


# ---- compile: graph -> nvidia DeepStream gst-launch (NVDEC->batch->TensorRT->tile->OSD->NVENC->RTMP) --
def compile_nvidia(graph):
    tile = _node(graph, "tile")["params"]
    snk = _node(graph, "sink")["params"]
    n = len(graph["streams"])
    name = snk.get("name", "detgrid") + "-ds"
    src = " ".join(f"nvurisrcbin uri={u} ! m.sink_{i}" for i, u in enumerate(streams(graph)))
    p = (
        f"nvstreammux name=m batch-size={n} width={tile['width']} height={tile['height']} "
        f"live-source=1 batched-push-timeout=40000 "
        f"! nvinfer config-file-path=config_infer_yolo11s.txt batch-size={n} "
        f"! nvmultistreamtiler rows={tile['rows']} columns={tile['cols']} width={tile['width']} height={tile['height']} "
        f"! nvdsosd ! nvvideoconvert ! nvv4l2h264enc bitrate={snk.get('bitrate',1500)*1000} idrinterval=15 "
        f"! h264parse config-interval=1 ! flvmux streamable=true ! rtmpsink location=rtmp://{HOST}:1935/{name} "
        f"{src}"
    )
    return "gst-launch-1.0 -e " + p, name


# ---- deploy / run -------------------------------------------------------------------------------
def _ssh(cmd):
    return subprocess.run(["sshpass", "-p", "radxa", "ssh", "-o", "StrictHostKeyChecking=no",
                           f"radxa@{BOARD}", cmd], capture_output=True, text=True, timeout=60)


def deploy_radxa(graph):
    cfg = compile_radxa(graph)
    open("/tmp/_editor_radxa.json", "w").write(cfg)
    subprocess.run(["sshpass", "-p", "radxa", "scp", "-o", "StrictHostKeyChecking=no",
                    "/tmp/_editor_radxa.json", f"radxa@{BOARD}:/home/radxa/lab/plugins/configs/_editor.json"],
                   capture_output=True, timeout=60)
    _ssh("echo radxa | sudo -S systemctl stop helixpipe 2>/dev/null; sleep 2; "
         "echo radxa | sudo -S systemctl reset-failed helixpipe 2>/dev/null; "
         "echo radxa | sudo -S systemd-run --unit=helixpipe --collect "
         "--working-directory=/home/radxa/lab/plugins --setenv=HELIX_PLUGIN_DIR=/home/radxa/lab/plugins "
         f"/home/radxa/lab/plugins/helix_pipeline /home/radxa/lab/plugins/configs/_editor.json {HOST}")
    snk = _node(graph, "sink")["params"].get("name", "detgrid")
    return {"target": "radxa", "webrtc": f"http://{HOST}:8889/{snk}", "config": cfg}


def deploy_nvidia(graph):
    pipe, name = compile_nvidia(graph)
    subprocess.run(["docker", "rm", "-f", "ds-editor"], capture_output=True)
    subprocess.run(["docker", "run", "-d", "--name", "ds-editor", "--gpus", "all", "--network", "host",
                    "-v", f"{DS_WORK}:/work", "-w", "/work", "--entrypoint", "bash",
                    "nvcr.io/nvidia/deepstream:7.1-samples-multiarch", "-lc", pipe],
                   capture_output=True, timeout=60)
    return {"target": "nvidia", "webrtc": f"http://{HOST}:8889/{name}", "pipeline": pipe}


def stop(target):
    if target == "radxa":
        _ssh("echo radxa | sudo -S systemctl stop helixpipe 2>/dev/null")
    else:
        subprocess.run(["docker", "rm", "-f", "ds-editor"], capture_output=True)
    return {"stopped": target}


def status(target):
    if target == "radxa":
        r = _ssh("systemctl is-active helixpipe 2>/dev/null; echo radxa | sudo -S journalctl -u helixpipe "
                 "--no-pager 2>/dev/null | grep -oE 'AGG=[0-9.]+ inf/s' | tail -1")
        return {"target": "radxa", "info": r.stdout.strip()}
    r = subprocess.run(["docker", "ps", "--filter", "name=ds-editor", "--format", "{{.Status}}"],
                       capture_output=True, text=True)
    return {"target": "nvidia", "info": r.stdout.strip() or "not running"}


# ---- HTTP ---------------------------------------------------------------------------------------
class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send(200, open(os.path.join(HERE, "index.html"), "rb").read(), "text/html")
        if self.path == "/graph.default.json":
            return self._send(200, open(os.path.join(HERE, "graph.default.json"), "rb").read())
        if self.path.startswith("/api/status"):
            t = self.path.split("target=")[-1] if "target=" in self.path else "radxa"
            return self._send(200, json.dumps(status(t)))
        return self._send(404, "{}")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or "{}")
        graph, target = req.get("graph", {}), req.get("target", "radxa")
        try:
            if self.path == "/api/compile":
                out = compile_radxa(graph) if target == "radxa" else compile_nvidia(graph)[0]
                return self._send(200, json.dumps({"target": target, "compiled": out}))
            if self.path == "/api/deploy":
                return self._send(200, json.dumps(deploy_radxa(graph) if target == "radxa" else deploy_nvidia(graph)))
            if self.path == "/api/stop":
                return self._send(200, json.dumps(stop(target)))
        except Exception as e:
            return self._send(500, json.dumps({"error": str(e)}))
        return self._send(404, "{}")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8770"))
    print(f"pipeline-editor bridge on http://0.0.0.0:{port}  (HOST={HOST} BOARD={BOARD})")
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
