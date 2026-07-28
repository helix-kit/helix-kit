"""A dummy ESP32 firmware release server for local flashing.

Serves a built firmware output dir over HTTP as the same `Esp32FirmwareManifest`
the web `@helix/esp32-flasher` package consumes (`GET /manifest.json`) plus the
raw `.bin` files, so the Android app (or a browser) can download and flash a
device without the full appliance/release control plane. Bind it to a LAN
address and point the phone at `http://<laptop-ip>:<port>/manifest.json`.
"""

from __future__ import annotations

import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tooling.release.build_worker import read_firmware_dir
from tooling.release.sim import JsonDict


def detect_lan_ip() -> str:
    """Best-effort primary LAN IPv4 (the address a phone on the same Wi-Fi
    reaches this laptop on). Falls back to 127.0.0.1."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packets are sent; this just selects the outbound interface.
        sock.connect(("8.8.8.8", 80))
        return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _flash_settings(firmware_dir: Path) -> dict[str, str]:
    """Read flash mode/freq/size from the build's flasher_args.json, with the
    standard ESP32 defaults as a fallback."""
    defaults = {"flash_mode": "dio", "flash_freq": "40m", "flash_size": "4MB"}
    args_path = firmware_dir / "flasher_args.json"
    if not args_path.exists():
        return defaults
    parsed = json.loads(args_path.read_text(encoding="utf-8"))
    settings = parsed.get("flash_settings", {})
    return {key: settings.get(key, fallback) for key, fallback in defaults.items()}


def build_manifest(
    firmware_dir: Path, base_url: str, baud_rate: int
) -> tuple[JsonDict, dict[str, bytes]]:
    """Return the web-compatible firmware manifest plus a role -> bytes map. The
    artifact URLs point at `<base_url>/<role>.bin`."""
    artifacts, build_manifest_json = read_firmware_dir(firmware_dir)
    settings = _flash_settings(firmware_dir)

    manifest_artifacts: list[JsonDict] = []
    blobs: dict[str, bytes] = {}
    for artifact in artifacts:
        role = str(artifact["role"])
        blobs[role] = artifact["data"]
        manifest_artifacts.append(
            {
                "id": role,
                "name": f"{role}.bin",
                "offset": int(str(artifact["offset"]), 16),
                "sha256": artifact["sha256"],
                "size": artifact["sizeBytes"],
                "url": f"{base_url}/{role}.bin",
            }
        )

    manifest: JsonDict = {
        "chip": "esp32",
        "baudRate": baud_rate,
        "flashMode": settings["flash_mode"],
        "flashFreq": settings["flash_freq"],
        "flashSize": settings["flash_size"],
        "profile": build_manifest_json.get("name", firmware_dir.name),
        "artifacts": manifest_artifacts,
    }
    return manifest, blobs


def make_handler(manifest: JsonDict, blobs: dict[str, bytes]) -> type[BaseHTTPRequestHandler]:
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    files = {f"/{role}.bin": data for role, data in blobs.items()}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, content_type: str, body: bytes) -> None:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 (http.server API)
            if self.path in ("/manifest.json", "/"):
                self._send("application/json", manifest_bytes)
                return
            blob = files.get(self.path)
            if blob is not None:
                self._send("application/octet-stream", blob)
                return
            self.send_error(404, "not found")

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"[firmware-server] {self.address_string()} {fmt % args}")

    return Handler


def serve_firmware(firmware_dir: Path, host: str, port: int, baud_rate: int) -> None:
    """Serve `firmware_dir` as a flashable manifest on `host:port` until Ctrl-C."""
    base_url = f"http://{host}:{port}"
    manifest, blobs = build_manifest(firmware_dir, base_url, baud_rate)
    handler = make_handler(manifest, blobs)

    total = sum(len(data) for data in blobs.values())
    print(f"[firmware-server] serving {firmware_dir}")
    print(f"[firmware-server] profile={manifest['profile']} artifacts={len(blobs)} bytes={total}")
    print(f"[firmware-server] manifest: {base_url}/manifest.json")
    for artifact in manifest["artifacts"]:
        name, offset, size = artifact["name"], artifact["offset"], artifact["size"]
        print(f"[firmware-server]   {name} @ 0x{offset:x} ({size} B)")

    # Bind on all interfaces so a phone on the LAN can reach it, regardless of
    # the advertised host in the manifest URLs.
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[firmware-server] stopped")
    finally:
        server.server_close()
