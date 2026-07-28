# SPDX-License-Identifier: AGPL-3.0-only
"""Round-trip tests for the generated echo contract + the EchoService handler.

These prove the code-generated typed dispatch end to end: a raw command dict in,
a wire-mapped response out, without touching a real IPC socket.
"""

from __future__ import annotations

import logging
from typing import Any

from helix_echo.generated._runtime import to_wire_value
from helix_echo.generated.echo import (
    EchoPingInput,
    EchoPongOutput,
    dispatch_echo,
    parse_ping_input,
)
from helix_echo.service import EchoService

from helix_service_runtime import DeviceConfig

_LOG = logging.getLogger("test-echo")


class _RecordingIPC:
    """Captures respond() calls the generated dispatch makes."""

    def __init__(self) -> None:
        self.replies: list[tuple[str, str, dict[str, Any]]] = []

    def respond(self, request_id: str, method: str, payload: dict[str, Any]) -> None:
        self.replies.append((request_id, method, payload))


def _service() -> EchoService:
    return EchoService(DeviceConfig(device_id="d", ipc_socket_path="/tmp/x.sock", raw={}), _LOG)


def test_parse_maps_wire_names() -> None:
    assert parse_ping_input({"message": "hi"}) == EchoPingInput(message="hi")
    # Absent optional field decodes to None, not a crash.
    assert parse_ping_input({}) == EchoPingInput(message=None)


def test_to_wire_value_drops_none_and_keeps_wire_keys() -> None:
    assert to_wire_value(EchoPongOutput(echo="x", service="echo")) == {
        "echo": "x",
        "service": "echo",
    }


def test_ping_round_trip() -> None:
    ipc = _RecordingIPC()
    command = {"service": "echo", "method": "ping", "payload": {"message": "hi"}, "requestId": "r1"}
    dispatch_echo(ipc, _LOG, command, _service())
    assert ipc.replies == [("r1", "pong", {"echo": "hi", "service": "echo"})]


def test_ping_without_message_echoes_empty() -> None:
    ipc = _RecordingIPC()
    command = {"service": "echo", "method": "ping", "payload": {}, "requestId": "r2"}
    dispatch_echo(ipc, _LOG, command, _service())
    assert ipc.replies == [("r2", "pong", {"echo": "", "service": "echo"})]


def test_unknown_command_responds_error() -> None:
    ipc = _RecordingIPC()
    command = {"service": "echo", "method": "nope", "payload": {}, "requestId": "r3"}
    dispatch_echo(ipc, _LOG, command, _service())
    assert ipc.replies == [
        ("r3", "echo-error", {"requestId": "r3", "error": "unknown command: nope"})
    ]
