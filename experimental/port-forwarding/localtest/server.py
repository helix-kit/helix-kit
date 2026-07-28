#!/usr/bin/env python3
"""Tiny dynamic web app that proves the port-forwarding tunnel is live via an uncacheable /api/info hit counter."""

import datetime
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PORT = int(os.environ.get("APP_PORT", "8000"))
HOSTNAME = socket.gethostname()
hits = 0

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Helix Port Forwarding</title>
<style>
  body {{ font-family: ui-monospace, monospace; background:#0b0f14; color:#e6edf3;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0 }}
  .card {{ background:#111820; border:1px solid #223; border-radius:14px; padding:32px 40px;
          box-shadow:0 8px 40px #0008; max-width:520px }}
  h1 {{ margin:0 0 4px; font-size:20px }}
  .ok {{ color:#3fb950 }} .k {{ color:#8b949e }} .v {{ color:#58a6ff }}
  code {{ color:#d2a8ff }}
  button {{ margin-top:16px; background:#238636; color:#fff; border:0; padding:10px 16px;
           border-radius:8px; font-size:14px; cursor:pointer }}
  pre {{ background:#0b0f14; padding:12px; border-radius:8px; overflow:auto }}
</style></head>
<body><div class="card">
  <h1>🚀 Helix Port Forwarding <span class="ok">works</span></h1>
  <p class="k">This page is served by a Python process inside a container on the
  device, reached only through an outbound tunnel &mdash; no inbound ports.</p>
  <pre id="info">loading…</pre>
  <button onclick="refresh()">Refresh /api/info</button>
</div>
<script>
async function refresh() {{
  const r = await fetch('/api/info');
  const j = await r.json();
  document.getElementById('info').textContent =
    'served_by : ' + j.hostname + '\\n' +
    'hit_count : ' + j.hits + '\\n' +
    'server_utc: ' + j.time + '\\n' +
    'your_path : ' + j.path;
}}
refresh();
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[app] " + (fmt % args))

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        global hits
        hits += 1
        if self.path.startswith("/api/info"):
            body = json.dumps(
                {
                    "hostname": HOSTNAME,
                    "hits": hits,
                    "time": datetime.datetime.utcnow().isoformat() + "Z",
                    "path": self.path,
                }
            ).encode()
            self._send(200, body, "application/json")
        else:
            self._send(200, PAGE.encode(), "text/html; charset=utf-8")


if __name__ == "__main__":
    print(f"[app] listening on 0.0.0.0:{PORT} (hostname={HOSTNAME})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
