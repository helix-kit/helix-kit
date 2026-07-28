# SPDX-License-Identifier: AGPL-3.0-only
"""Thin NDJSON IPC client to the helixd core over its Unix socket."""

from __future__ import annotations

import contextlib
import json
import logging
import queue
import socket
import threading
import time
from typing import IO, Any

Frame = dict[str, Any]

_REGISTER = "register-service"
_RESPOND = "respond"
_EMIT = "emit-event"


class IPCError(Exception):
    """An RPC-level error returned by helixd."""


class IPCClient:
    """One connection to helixd; auto-registers ``service`` on connect."""

    def __init__(
        self, socket_path: str, service: str, logger: logging.Logger | None = None
    ) -> None:
        self._socket_path = socket_path
        self._service = service
        self._log = logger or logging.getLogger("helix.ipc")
        self._sock: socket.socket | None = None
        self._reader: IO[str] | None = None
        self._writer: IO[str] | None = None
        self._write_lock = threading.Lock()
        self._pending: dict[str, queue.Queue[Frame]] = {}
        self._pending_lock = threading.Lock()
        self._notifications: queue.Queue[Frame] = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._closed = False
        self._id = 0

    @property
    def service(self) -> str:
        return self._service

    def connect(self, timeout_sec: float = 5.0) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self._socket_path)
        self._sock = sock
        self._reader = sock.makefile("r", encoding="utf-8")
        self._writer = sock.makefile("w", encoding="utf-8")
        self._reader_thread = threading.Thread(
            target=self._reader_loop, name=f"{self._service}-ipc", daemon=True
        )
        self._reader_thread.start()
        self._request(_REGISTER, {"service": self._service}, timeout_sec=timeout_sec)
        self._log.info("ipc connected service=%s", self._service)

    def close(self) -> None:
        self._closed = True
        if self._sock is not None:
            with contextlib.suppress(OSError):
                self._sock.close()

    def respond(self, request_id: str, method: str, payload: dict[str, Any] | None) -> None:
        """Publish a control response on `.../out`, echoing request_id."""
        self._request(
            _RESPOND, {"method": method, "payload": payload or {}, "requestId": request_id}
        )

    def emit(self, event_type: str, payload: dict[str, Any] | None) -> None:
        """Publish a telemetry event on this service's event topic."""
        self._request(_EMIT, {"type": event_type, "payload": payload or {}})

    def read_notification(self, timeout_sec: float = 1.0) -> Frame | None:
        """Return the next server-pushed notification, or None on timeout."""
        try:
            return self._notifications.get(timeout=timeout_sec)
        except queue.Empty:
            return None

    def _next_id(self) -> str:
        self._id += 1
        return f"{self._service}-{time.time_ns()}-{self._id}"

    def _request(self, method: str, params: dict[str, Any], timeout_sec: float = 2.0) -> Frame:
        req_id = self._next_id()
        reply: queue.Queue[Frame] = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[req_id] = reply
        self._write_json({"id": req_id, "method": method, "params": params})
        try:
            frame = reply.get(timeout=timeout_sec)
        except queue.Empty:
            with self._pending_lock:
                self._pending.pop(req_id, None)
            raise IPCError(f"ipc request timeout: {method}") from None
        if frame.get("error"):
            raise IPCError(str(frame["error"].get("message", "ipc error")))
        return frame.get("result") or {}

    def _write_json(self, obj: dict[str, Any]) -> None:
        line = json.dumps(obj, separators=(",", ":")) + "\n"
        with self._write_lock:
            if self._writer is None:
                raise IPCError("ipc not connected")
            self._writer.write(line)
            self._writer.flush()

    def _reader_loop(self) -> None:
        assert self._reader is not None
        try:
            for line in self._reader:
                line = line.strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    continue
                frame_id = frame.get("id")
                if isinstance(frame_id, str) and frame_id:
                    with self._pending_lock:
                        waiter = self._pending.pop(frame_id, None)
                    if waiter is not None:
                        waiter.put(frame)
                elif frame.get("method"):
                    self._notifications.put(frame)
        except (OSError, ValueError):
            pass
        if not self._closed:
            self._log.warning("ipc reader loop ended service=%s", self._service)
