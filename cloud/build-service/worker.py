#!/usr/bin/env python3
"""Long-running ESP32 build service (runs in the lean ESP-IDF container, repo at /repo).

Publishes the build-options catalog over `GET /catalog` and accepts build jobs over
`POST /build`, driving the release backend's build-callback protocol. Build/upload/complete
are shared with the CLI worker via `tooling.release.build_worker.complete_build`.
Set `HELIX_BUILD_FAKE=1` (or `fake: true` in a job) to synthesize artifacts instead of compiling.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from tooling.release.build_worker import complete_build
from tooling.release.catalog import build_catalog
from tooling.release.sim import JsonDict, ReleaseClient, synth_esp32_artifacts

LISTEN_PORT = int(os.environ.get("WORKER_PORT", "9098"))
FAKE_BUILDS = os.environ.get("HELIX_BUILD_FAKE", "").strip() in ("1", "true", "yes")

_jobs: queue.Queue[dict[str, Any]] = queue.Queue()


def _fake_complete(
    client: ReleaseClient,
    build_id: str,
    token: str,
    *,
    name: str,
    version: str,
    channel: str,
    selector: JsonDict,
    config: JsonDict,
) -> JsonDict:
    """Synthetic build: upload stand-in artifacts and complete, no ESP-IDF compile."""
    started = time.monotonic()
    artifacts = synth_esp32_artifacts(config)
    for artifact in artifacts:
        client.upload_build_blob(
            build_id, token, artifact.sha256, artifact.size_bytes, artifact.data
        )
    release: JsonDict = {
        "typeKey": "esp32-firmware",
        "name": name,
        "version": version,
        "channel": channel,
        "publish": True,
        "config": config,
        "variants": [
            {
                "selector": selector,
                "artifacts": [
                    {
                        "role": a.role,
                        "offset": a.offset,
                        "sha256": a.sha256,
                        "sizeBytes": a.size_bytes,
                    }
                    for a in artifacts
                ],
            }
        ],
    }
    duration_ms = int((time.monotonic() - started) * 1000)
    result = client.build_complete(
        build_id, token, release, analysis={"fake": True}, duration_ms=duration_ms
    )
    return {
        "status": "built",
        "buildId": build_id,
        "releaseId": result.get("releaseId"),
        "durationMs": duration_ms,
    }


def _run_job(job: dict[str, Any]) -> None:
    build_id = str(job["buildId"])
    token = str(job["callbackToken"])
    public_url = str(job["publicUrl"])
    config: JsonDict = job.get("config", {})
    selector: JsonDict = job.get("selector", {})
    release_meta: JsonDict = job.get("release", {})
    name = str(release_meta.get("name", "custom-fw"))
    version = str(release_meta.get("version", "1.0.0-custom"))
    channel = str(release_meta.get("channel", "custom"))
    fake = FAKE_BUILDS or bool(job.get("fake"))

    client = ReleaseClient(public_url)
    print(f"[worker] {build_id} start fake={fake} config={json.dumps(config)}")
    try:
        if fake:
            result = _fake_complete(
                client,
                build_id,
                token,
                name=name,
                version=version,
                channel=channel,
                selector=selector,
                config=config,
            )
        else:
            result = complete_build(
                client,
                build_id,
                token,
                name=name,
                version=version,
                channel=channel,
                selector=selector,
                config=config,
                analyze=True,
            )
        print(f"[worker] {build_id} done -> {json.dumps(result)}")
    except Exception as exc:  # noqa: BLE001 - report any failure back to the backend
        summary = f"{type(exc).__name__}: {exc}"
        print(f"[worker] {build_id} FAILED: {summary}")
        try:
            client.build_failed(build_id, token, summary)
        except Exception as report_exc:  # noqa: BLE001 - best-effort failure report
            print(f"[worker] {build_id} could not report failure: {report_exc}")


def _worker_loop() -> None:
    while True:
        job = _jobs.get()
        try:
            _run_job(job)
        finally:
            _jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[worker] {self.command} {self.path}")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "queue": _jobs.qsize(), "fake": FAKE_BUILDS})
        elif self.path == "/catalog":
            self._send(200, build_catalog())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/build":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("content-length", "0"))
        job = json.loads(self.rfile.read(length) or b"{}")
        if not job.get("buildId") or not job.get("callbackToken") or not job.get("publicUrl"):
            self._send(400, {"error": "buildId, callbackToken and publicUrl are required"})
            return
        _jobs.put(job)
        print(f"[worker] queued {job.get('buildId')} (depth={_jobs.qsize()})")
        self._send(202, {"accepted": True, "buildId": job.get("buildId")})


def main() -> None:
    threading.Thread(target=_worker_loop, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    print(f"[worker] on :{LISTEN_PORT} fake={FAKE_BUILDS}")
    server.serve_forever()


if __name__ == "__main__":
    main()
