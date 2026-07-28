from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EMBEDDED_ROOT = REPO_ROOT / "embedded"
ESP32_SOURCE_ROOT = EMBEDDED_ROOT / "esp32" / "core"
