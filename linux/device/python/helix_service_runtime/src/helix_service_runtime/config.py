# SPDX-License-Identifier: AGPL-3.0-only
"""Thin device-config access for Python apps."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_SOCKET_PATH = "/tmp/helix-ipc.sock"


@dataclass(frozen=True)
class DeviceConfig:
    device_id: str
    ipc_socket_path: str
    raw: dict[str, Any]


def load_device_config(path: str | Path) -> DeviceConfig:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    ipc = data.get("ipc") or {}
    device = data.get("device") or {}
    return DeviceConfig(
        device_id=str(device.get("id", "")),
        ipc_socket_path=str(ipc.get("socketPath") or DEFAULT_SOCKET_PATH),
        raw=data,
    )
