# SPDX-License-Identifier: AGPL-3.0-only
"""Inbound command dispatch + response helpers over an IPCClient.

An app implements a ``handler(command)`` where command is a dict
``{service, method, payload, requestId}`` and runs ``run_command_loop``; it
never touches raw frames or the Helix wire format.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

from .ipc import IPCClient

# handler(command: {"service","method","payload","requestId"}) -> None
CommandHandler = Callable[[dict[str, Any]], None]

_NOTIFY_COMMAND = "command"


def run_command_loop(
    ipc: IPCClient,
    stop_event: threading.Event,
    handler: CommandHandler,
    *,
    timeout_sec: float = 1.0,
) -> None:
    """Pump inbound command notifications into ``handler`` until stop is set."""
    while not stop_event.is_set():
        note = ipc.read_notification(timeout_sec=timeout_sec)
        if note is None:
            continue
        if note.get("method") != _NOTIFY_COMMAND:
            continue
        handler(note.get("params") or {})


def respond(
    ipc: IPCClient,
    log: logging.Logger,
    request_id: str,
    method: str,
    payload: dict[str, Any],
) -> None:
    """Publish a response (method + payload) correlated to request_id."""
    try:
        ipc.respond(request_id, method, payload)
    except Exception as exc:  # noqa: BLE001 - best-effort reply
        log.warning("respond failed method=%s err=%s", method, exc)


def respond_error(
    ipc: IPCClient,
    log: logging.Logger,
    request_id: str,
    service: str,
    error: str,
) -> None:
    respond(ipc, log, request_id, f"{service}-error", {"requestId": request_id, "error": error})
