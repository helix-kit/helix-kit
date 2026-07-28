#!/usr/bin/env python3
"""Mock release backend for the ESP32 build service harness.

Stands in for helix-server so the build worker can be exercised end-to-end without
the full cloud stack. It speaks the *same* build-callback protocol the real
backend does (`tooling.release.sim.ReleaseClient`), so a build that works here
works against helix-server unchanged:

  - `POST /builds` creates a build and dispatches it to the worker,
  - `POST /api/build/artifact-url` hands out content-addressed presigned PUT URLs
    (pointing back at its own `/storage`),
  - `PUT /storage/<key>` stores uploaded blobs on local disk,
  - `POST /api/build/complete` records the worker's completion callback.

Deliberately dependency-free (stdlib only) so it runs anywhere.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

WORKER_URL = os.environ.get("WORKER_URL", "http://build-worker:9098")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://mock-backend:9099")
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", "/storage"))
LISTEN_PORT = int(os.environ.get("MOCK_PORT", "9099"))

_lock = threading.Lock()
_builds: dict[str, dict[str, Any]] = {}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _storage_path(key: str) -> Path:
    # Reject traversal; keys are content-addressed (cas/<sha256> or similar).
    parts = [p for p in key.split("/") if p not in ("", ".", "..")]
    return STORAGE_DIR.joinpath(*parts)


def _dispatch_to_worker(build_id: str, job: dict[str, Any]) -> None:
    body = json.dumps(job).encode()
    req = urllib.request.Request(
        f"{WORKER_URL}/build", data=body, headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except Exception as exc:  # noqa: BLE001 - mock: surface dispatch failures inline
        with _lock:
            _builds[build_id]["status"] = "dispatch-failed"
            _builds[build_id]["error"] = str(exc)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter logs
        print(f"[mock] {self.command} {self.path}")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("content-length", "0"))
        return self.rfile.read(length) if length else b""

    def _read_json(self) -> dict[str, Any]:
        raw = self._read_body()
        return json.loads(raw) if raw else {}

    def _authorized(self, build_id: str) -> bool:
        auth = self.headers.get("authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        with _lock:
            build = _builds.get(build_id)
        return build is not None and secrets.compare_digest(token, build.get("token", ""))

    # ---- routing -----------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/builds":
            self._handle_create_build()
        elif path == "/api/build/artifact-url":
            self._handle_artifact_url()
        elif path == "/api/build/complete":
            self._handle_complete()
        else:
            self._send_json(404, {"error": "not found"})

    def do_PUT(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/storage/"):
            self._handle_storage_put(path[len("/storage/") :])
        else:
            self._send_json(404, {"error": "not found"})

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/builds/"):
            self._handle_get_build(path[len("/builds/") :])
        elif path.startswith("/storage/"):
            self._handle_storage_get(path[len("/storage/") :])
        else:
            self._send_json(404, {"error": "not found"})

    # ---- handlers ----------------------------------------------------------

    def _handle_create_build(self) -> None:
        payload = self._read_json()
        config = payload.get("config", {})
        selector = payload.get("selector") or {
            "chip": config.get("chip", "esp32"),
            "flashSize": config.get("flashSize", "4MB"),
        }
        release = payload.get("release") or {
            "name": config.get("profileName", "custom-fw"),
            "version": "1.0.0-custom",
            "channel": "custom",
        }
        build_id = _new_id("bld")
        token = secrets.token_hex(16)
        with _lock:
            _builds[build_id] = {"id": build_id, "status": "dispatched", "token": token}
        print(f"[mock] created {build_id} config={json.dumps(config)}")
        job = {
            "buildId": build_id,
            "callbackToken": token,
            "publicUrl": PUBLIC_URL,
            "release": release,
            "selector": selector,
            "config": config,
            "fake": bool(payload.get("fake")),
        }
        threading.Thread(target=_dispatch_to_worker, args=(build_id, job), daemon=True).start()
        self._send_json(202, {"buildId": build_id})

    def _handle_get_build(self, build_id: str) -> None:
        with _lock:
            build = _builds.get(build_id)
        if build is None:
            self._send_json(404, {"error": "unknown build"})
            return
        self._send_json(
            200,
            {
                "id": build_id,
                "status": build["status"],
                "error": build.get("error"),
                "result": build.get("result"),
            },
        )

    def _handle_artifact_url(self) -> None:
        payload = self._read_json()
        build_id = str(payload.get("buildId", ""))
        if not self._authorized(build_id):
            self._send_json(401, {"error": "unauthorized"})
            return
        sha256 = str(payload.get("sha256", ""))
        if len(sha256) != 64:
            self._send_json(400, {"error": "sha256 required"})
            return
        key = f"cas/{sha256}"
        exists = _storage_path(key).exists()
        with _lock:
            _builds[build_id]["status"] = "uploading"
        self._send_json(
            200,
            {
                "storageKey": key,
                "exists": exists,
                "method": "PUT",
                "url": f"{PUBLIC_URL}/storage/{key}",
                "headers": {
                    "content-type": str(payload.get("contentType", "application/octet-stream"))
                },
            },
        )

    def _handle_storage_put(self, key: str) -> None:
        data = self._read_body()
        target = _storage_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        expected = key.rsplit("/", 1)[-1]
        integrity = "ok" if digest == expected else f"MISMATCH(got {digest})"
        print(f"[mock] stored {key} ({len(data)} bytes) integrity={integrity}")
        self._send_json(200, {"stored": key, "bytes": len(data), "sha256": digest})

    def _handle_storage_get(self, key: str) -> None:
        target = _storage_path(key)
        if not target.exists():
            self._send_json(404, {"error": "not found"})
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("content-type", "application/octet-stream")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_complete(self) -> None:
        payload = self._read_json()
        build_id = str(payload.get("buildId", ""))
        if not self._authorized(build_id):
            self._send_json(401, {"error": "unauthorized"})
            return
        status = str(payload.get("status", "unknown"))
        with _lock:
            build = _builds.get(build_id)
            if build is not None:
                build["status"] = status
                build["result"] = payload
        print(f"\n[mock] ===== BUILD COMPLETE: {build_id} status={status} =====")
        print(json.dumps(payload, indent=2))
        print("[mock] ===== END COMPLETE =====\n")
        # The real backend returns a release id here; the mock echoes a stub.
        self._send_json(200, {"ok": status == "success", "releaseId": f"rel_{build_id}"})


def main() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    print(f"[mock] backend on :{LISTEN_PORT} storage={STORAGE_DIR} worker={WORKER_URL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
