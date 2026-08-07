"""Interactive console to a device's `console` service over the HelixStream data plane."""

from __future__ import annotations

import json
import os
import select
import sys
import termios
import threading
import time
import tty
import urllib.parse
import uuid
from typing import Any

import click

ESCAPE_KEY = 0x1D  # Ctrl-]
DEFAULT_HOST = "helix-kit.com"
CONSOLE_SERVICE = "console"


def _import_ws() -> Any:
    try:
        import websocket
    except ImportError as exc:  # pragma: no cover - environment guard
        raise click.ClickException(
            "websocket-client is required for the gateway console: uv sync"
        ) from exc
    return websocket


def _notice(message: str) -> None:
    sys.stderr.write(f"\r\n[helix] {message}\r\n")
    sys.stderr.flush()


def _open_session(ws_mod: Any, control_url: str, session_id: str, data_url: str) -> None:
    """Send `console.open` over the control plane and await the `opened` reply."""
    control = ws_mod.create_connection(control_url, timeout=15)
    try:
        request_id = uuid.uuid4().hex
        control.send(
            json.dumps(
                {
                    "requestId": request_id,
                    "message": {
                        "service": CONSOLE_SERVICE,
                        "method": "open",
                        "payload": {
                            "sessionId": session_id,
                            "transport": "relay",
                            "dataUrl": data_url,
                        },
                    },
                }
            )
        )
        deadline = time.time() + 20
        while time.time() < deadline:
            control.settimeout(3)
            try:
                raw = control.recv()
            except Exception:  # noqa: BLE001 - timeout / transient
                continue
            if not raw:
                continue
            try:
                packet = json.loads(raw)
            except Exception:  # noqa: BLE001
                continue
            message = packet.get("message", {})
            if message.get("service") != CONSOLE_SERVICE:
                continue
            method = message.get("method")
            payload = message.get("payload") or {}
            if method == "opened":
                return
            if method == "console-error" or "error" in payload:
                raise click.ClickException(f"device rejected open: {payload.get('error')}")
        raise click.ClickException("timed out waiting for the device to open the session")
    finally:
        try:
            control.close()
        except Exception:  # noqa: BLE001
            pass


def _attach_stream(ws_mod: Any, client_url: str) -> Any:
    # The device dials /stream/device asynchronously after `opened`, so the client
    # attach can race ahead; the gateway rejects with a close until it exists.
    for _ in range(15):
        socket = ws_mod.create_connection(client_url, timeout=15)
        socket.settimeout(0.5)
        try:
            first = socket.recv_data(control_frame=True)
        except Exception:  # noqa: BLE001 - no immediate frame == still attached
            return socket
        opcode, data = first
        # A text frame here is the gateway's {"type":"error"} rejection.
        if opcode == ws_mod.ABNF.OPCODE_TEXT:
            socket.close()
            time.sleep(1.0)
            continue
        # Early binary at attach is negligible; drop it and proceed.
        return socket
    raise click.ClickException("could not attach to the device stream (session never registered)")


class GatewayConsoleSession:
    def __init__(self, host: str, device_id: str, secure: bool) -> None:
        scheme = "wss" if secure else "ws"
        self._device_id = device_id
        self._control_url = f"{scheme}://{host}/ws?deviceId={urllib.parse.quote(device_id)}"
        self._session_id = uuid.uuid4().hex
        self._data_url = f"{scheme}://{host}:4001/stream/device?session={self._session_id}"
        cols, rows = self._term_size()
        meta = urllib.parse.quote(json.dumps({"cols": cols, "rows": rows}))
        self._client_url = f"{scheme}://{host}/stream/client?session={self._session_id}&meta={meta}"
        self._socket: Any = None
        self._ws_mod: Any = None
        self._stop = threading.Event()

    @staticmethod
    def _term_size() -> tuple[int, int]:
        try:
            size = os.get_terminal_size()
            return size.columns, size.lines
        except OSError:
            return 80, 24

    def run(self) -> int:
        self._ws_mod = _import_ws()
        _notice(f"opening console session on {self._device_id} …")
        _open_session(self._ws_mod, self._control_url, self._session_id, self._data_url)
        _notice("session opened; attaching data stream …")
        self._socket = _attach_stream(self._ws_mod, self._client_url)
        _notice("connected — Ctrl-] to exit")

        interactive = sys.stdin.isatty()
        stdin_fd = sys.stdin.fileno()
        saved = termios.tcgetattr(stdin_fd) if interactive else None
        reader = threading.Thread(target=self._read_loop, daemon=True)
        reader.start()
        try:
            if interactive:
                tty.setraw(stdin_fd)
            return self._write_loop(stdin_fd, interactive)
        finally:
            self._stop.set()
            if saved is not None:
                termios.tcsetattr(stdin_fd, termios.TCSADRAIN, saved)
            try:
                self._socket.close()
            except Exception:  # noqa: BLE001
                pass

    def _write_loop(self, stdin_fd: int, interactive: bool) -> int:
        while not self._stop.is_set():
            if not interactive:
                self._stop.wait(0.2)
                continue
            ready, _, _ = select.select([stdin_fd], [], [], 0.2)
            if stdin_fd not in ready:
                continue
            keys = os.read(stdin_fd, 1024)
            if not keys:
                break
            if ESCAPE_KEY in keys:
                _notice("closing")
                break
            try:
                self._socket.send_binary(keys)
            except Exception as exc:  # noqa: BLE001
                _notice(f"send failed: {exc}")
                return 1
        return 0

    def _read_loop(self) -> None:
        ws_mod = self._ws_mod
        while not self._stop.is_set():
            try:
                self._socket.settimeout(1.0)
                opcode, data = self._socket.recv_data(control_frame=True)
            except Exception:  # noqa: BLE001 - timeout or closed
                if self._stop.is_set():
                    break
                continue
            if opcode in (ws_mod.ABNF.OPCODE_CLOSE,):
                break
            if opcode == ws_mod.ABNF.OPCODE_BINARY and data:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        self._stop.set()


@click.command("gateway")
@click.option("--device", "device_id", required=True, help="Target device id (the ESP32 bridge).")
@click.option(
    "--host",
    default=lambda: os.environ.get("HELIX_GATEWAY_HOST", DEFAULT_HOST),
    show_default=DEFAULT_HOST,
    help="Cloud host (gateway /ws + :4001 data plane).",
)
@click.option("--insecure", is_flag=True, help="Use ws:// instead of wss:// (local testing).")
def gateway_console(device_id: str, host: str, insecure: bool) -> None:
    """Attach an interactive console to a device's `console` service via the gateway."""
    session = GatewayConsoleSession(host=host, device_id=device_id, secure=not insecure)
    raise SystemExit(session.run())
