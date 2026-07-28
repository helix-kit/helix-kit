#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""hxc — Helix cross-platform pipeline compiler (prototype).

One portable graph.json -> each platform's native pipeline; a backend per platform maps each
semantic node to that platform's best component + model artifact.

  hxc.py compile graph.json --target deepstream|hailo|radxa   # show the native pipeline
  hxc.py run     graph.json --target deepstream [--host IP]    # actually run it (DeepStream here)
"""
import argparse, json, os, subprocess, sys, tempfile

# node role -> native component, per platform (the "compiler" mapping table)
ROLE_MAP = {
    "deepstream": {
        "decode": "nvurisrcbin(RTSP+NVDEC->NVMM)", "batch": "nvstreammux", "detect": "nvinfer(TensorRT)",
        "track": "nvtracker(NvDCF)", "tile": "nvmultistreamtiler", "overlay": "nvdsosd",
        "sink": "nvv4l2h264enc(NVENC)->RTSP", "artifact": "yolo11s.onnx -> .engine (TensorRT)"},
    "hailo": {
        "decode": "v4l2h264dec", "batch": "hailoroundrobin", "detect": "hailonet(HEF)+hailofilter",
        "track": "hailotracker", "tile": "compositor", "overlay": "hailooverlay",
        "sink": "x264enc->RTSP", "artifact": "yolo11s.onnx -> .hef (Hailo DFC)"},
    "radxa": {
        "decode": "omxh264dec(Cedar VE)", "batch": "(per-stream workers)", "detect": "hxawnninfer(NPU,.nb)",
        "track": "(cpu)", "tile": "hx_comp_grid(opencv)", "overlay": "hx_overlay_boxes(opencv)",
        "sink": "hx_sink_cedar_rtmp(Cedar VE)", "artifact": "yolo11s.onnx -> .nb (ACUITY)"},
}


def load(path, host):
    g = json.load(open(path))
    g["streams"] = [s.replace("${HOST}", host) for s in g["streams"]]
    return g


def show_mapping(g, target):
    m = ROLE_MAP[target]
    print(f"# graph '{g['name']}'  ->  target '{target}'")
    print(f"#   model artifact: {m['artifact']}")
    for n in g["nodes"]:
        print(f"    {n['role']:8s} ({n['id']:5s}) -> {m[n['role']]}")


# DeepStream backend: emit a runnable deepstream-app config from the graph
def deepstream_config(g, work):
    det = next(n for n in g["nodes"] if n["role"] == "detect")["params"]
    tile = next(n for n in g["nodes"] if n["role"] == "tile")["params"]
    snk = next(n for n in g["nodes"] if n["role"] == "sink")["params"]
    out = ["[application]", "enable-perf-measurement=1", "perf-measurement-interval-sec=5", "",
           "[tiled-display]", "enable=1", f"rows={tile['rows']}", f"columns={tile['cols']}",
           f"width={tile['width']}", f"height={tile['height']}", "gpu-id=0", ""]
    for i, uri in enumerate(g["streams"]):
        out += [f"[source{i}]", "enable=1", "type=4", f"uri={uri}", "num-sources=1", "gpu-id=0",
                "cudadec-memtype=0", "latency=100", ""]
    bat = next(n for n in g["nodes"] if n["role"] == "batch")["params"]
    out += ["[streammux]", "gpu-id=0", "live-source=1", f"batch-size={len(g['streams'])}",
            "batched-push-timeout=40000", f"width={bat['width']}", f"height={bat['height']}",
            "attach-sys-ts-as-ntp=1", ""]
    out += ["[primary-gie]", "enable=1", "gpu-id=0", f"batch-size={len(g['streams'])}", "interval=0",
            "gie-unique-id=1", "config-file=config_infer_yolo11s.txt", ""]
    if any(n["role"] == "track" for n in g["nodes"]):
        base = "/opt/nvidia/deepstream/deepstream/samples/configs/deepstream-app"
        out += ["[tracker]", "enable=1", "tracker-width=640", "tracker-height=384", "gpu-id=0",
                "ll-lib-file=/opt/nvidia/deepstream/deepstream/lib/libnvds_nvmultiobjecttracker.so",
                f"ll-config-file={base}/config_tracker_NvDCF_perf.yml", ""]
    out += ["[osd]", "enable=1", "gpu-id=0", "border-width=2", "text-size=12", ""]
    out += ["[sink0]", "enable=1", "type=4", "codec=1", "enc-type=0", "sync=0", "bitrate=4000000",
            f"rtsp-port={snk['port']}", "udp-port=5400", "gpu-id=0", ""]
    out += ["[tests]", "file-loop=0", ""]
    return "\n".join(out)


def deepstream_gstlaunch(g):
    n = len(g["streams"])
    tile = next(x for x in g["nodes"] if x["role"] == "tile")["params"]
    p = [f"nvstreammux name=m batch-size={n} width={tile['width']} height={tile['height']} live-source=1",
         "! nvinfer config-file-path=config_infer_yolo11s.txt"]
    if any(x["role"] == "track" for x in g["nodes"]):
        p.append("! nvtracker ll-lib-file=.../libnvds_nvmultiobjecttracker.so")
    p += [f"! nvmultistreamtiler rows={tile['rows']} columns={tile['cols']} width={tile['width']} height={tile['height']}",
          "! nvdsosd ! nvvideoconvert ! nvv4l2h264enc ! rtph264pay ! (RTSP server)"]
    for i, uri in enumerate(g["streams"]):
        p.append(f"nvurisrcbin uri={uri} ! m.sink_{i}")
    return "gst-launch-1.0 \\\n    " + " \\\n    ".join(p)


# Hailo backend (illustrative; runs on RPi+Hailo, not this box)
def hailo_gstlaunch(g):
    n = len(g["streams"])
    p = [f"hailoroundrobin name=rr", "! hailonet hef-path=yolo11s.hef batch-size=%d" % n,
         "! hailofilter so-path=libyolo_post.so", "! hailotracker", "! compositor name=comp",
         "! hailooverlay ! x264enc ! rtph264pay ! (RTSP)"]
    for i, uri in enumerate(g["streams"]):
        p.append(f"uridecodebin uri={uri} ! v4l2h264dec ! rr.")
    return "gst-launch-1.0 \\\n    " + " \\\n    ".join(p)


# Radxa backend: compile to our plugin host's JSON config (awnn NPU + Cedar)
def radxa_config(g):
    det = next(x for x in g["nodes"] if x["role"] == "detect")["params"]
    tile = next(x for x in g["nodes"] if x["role"] == "tile")["params"]
    snk = next(x for x in g["nodes"] if x["role"] == "sink")["params"]
    streams = []
    for i, uri in enumerate(g["streams"]):
        streams.append({
            "label": f"s{i+1}",
            "source": {"module": "hx_src_gst", "params": {"url": uri, "decoder": "omxh264dec", "fps": 12}},
            "preprocess": {"module": "hx_pre_letterbox", "params": {"size": 640}},
            "infer": {"module": "hx_infer_awnn", "params": {"nb": "/home/radxa/lab/yolo11s.nb"}},
            "postprocess": {"module": "hx_post_yolo11", "params": {"conf": det["conf"], "nms": det["nms"]}},
            "overlay": {"module": "hx_overlay_boxes", "params": {"color": "orange"}},
        })
    return json.dumps({
        "host": {"warmup_ms": 1500, "serialize_infer": True},
        "streams": streams,
        "compositor": {"module": "hx_comp_grid", "params": {"cols": tile["cols"], "rows": tile["rows"],
                                                            "grid_w": tile["width"], "grid_h": tile["height"]}},
        "sink": {"module": "hx_sink_cedar_rtmp", "params": {"url": f"rtmp://${{HOST}}:1935/detgrid",
                                                            "width": tile["width"], "height": tile["height"]}},
    }, indent=2)


def cmd_compile(g, target):
    show_mapping(g, target)
    print("\n# concrete pipeline:")
    if target == "deepstream":
        print(deepstream_gstlaunch(g))
    elif target == "hailo":
        print(hailo_gstlaunch(g))
    elif target == "radxa":
        print(radxa_config(g))


def cmd_run(g, target, host):
    if target != "deepstream":
        print(f"[hxc] run for '{target}' needs that hardware; only 'deepstream' is runnable on this box.")
        print("      Native pipeline that WOULD run there:\n")
        cmd_compile(g, target)
        return
    work = os.path.expanduser("~/edge-x86/DeepStream-Yolo")   # has the engine + parser + config_infer
    if not os.path.isdir(work):
        sys.exit(f"[hxc] {work} not found — run deepstream/run.sh once to build the engine + parser.")
    cfg = deepstream_config(g, work)
    open(os.path.join(work, "_hxc_ds.txt"), "w").write(cfg)
    print(f"[hxc] compiled graph '{g['name']}' -> DeepStream (nvstreammux+nvinfer+nvtracker+tiler+osd+NVENC)")
    subprocess.run(["docker", "rm", "-f", "ds-hxc"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["docker", "run", "-d", "--name", "ds-hxc", "--gpus", "all", "--network", "host",
                    "-v", f"{work}:/work", "-w", "/work", "--entrypoint", "deepstream-app",
                    "nvcr.io/nvidia/deepstream:7.1-samples-multiarch", "-c", "_hxc_ds.txt"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("[hxc] deepstream-app launched as 'ds-hxc'.  FPS: docker logs -f ds-hxc | grep PERF")
    print(f"[hxc] view: rtsp://{host}:{next(n for n in g['nodes'] if n['role']=='sink')['params']['port']}/ds-test")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["compile", "run"])
    ap.add_argument("graph")
    ap.add_argument("--target", required=True, choices=["deepstream", "hailo", "radxa"])
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    g = load(a.graph, a.host)
    (cmd_compile if a.cmd == "compile" else lambda g, t: cmd_run(g, t, a.host))(g, a.target)


if __name__ == "__main__":
    main()
