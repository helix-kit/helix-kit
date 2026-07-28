"""Build-options catalog for the custom-firmware builder."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from embedded.esp32.commands.apps import load_app_manifest
from embedded.esp32.commands.config import esp32_root

TYPE_KEY = "esp32-firmware"

_HIDDEN_FEATURES = {"hw-test"}

_CHIPS: list[dict[str, str]] = [
    {"value": "esp32", "label": "ESP32"},
]

_FLASH_SIZES: list[dict[str, str]] = [
    {"value": "4MB", "label": "4 MB"},
    {"value": "8MB", "label": "8 MB"},
    {"value": "16MB", "label": "16 MB"},
]

_SDKCONFIG_KNOBS: list[dict[str, Any]] = [
    {
        "key": "CONFIG_LOG_DEFAULT_LEVEL",
        "label": "Default log level",
        "description": "Compile-time log verbosity for the firmware.",
        "type": "select",
        "default": "",
        "options": [
            {"value": "CONFIG_LOG_DEFAULT_LEVEL_NONE", "label": "None"},
            {"value": "CONFIG_LOG_DEFAULT_LEVEL_ERROR", "label": "Error"},
            {"value": "CONFIG_LOG_DEFAULT_LEVEL_WARN", "label": "Warning"},
            {"value": "CONFIG_LOG_DEFAULT_LEVEL_INFO", "label": "Info"},
            {"value": "CONFIG_LOG_DEFAULT_LEVEL_DEBUG", "label": "Debug"},
        ],
    },
]

_DEFAULTS = {"chip": "esp32", "flashSize": "4MB", "channel": "custom"}


def _feature_description(path: Path) -> str:
    lines: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped.startswith("#"):
            break
        text = stripped.lstrip("#").strip()
        prefix = "Feature fragment:"
        if text.startswith(prefix):
            text = text[len(prefix) :].strip()
        if text:
            lines.append(text)
    description = " ".join(lines).strip()
    return description[:1].upper() + description[1:] if description else description


def catalog_apps() -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    for app in load_app_manifest():
        name = str(app.get("name", "")).strip()
        if not name:
            continue
        apps.append(
            {
                "name": name,
                "label": str(app.get("label") or name),
                "description": str(app.get("description") or ""),
                "features": [str(f) for f in (app.get("features") or [])],
            }
        )
    return apps


def catalog_features() -> list[dict[str, Any]]:
    features_dir = esp32_root() / "features"
    features: list[dict[str, Any]] = []
    for path in sorted(features_dir.glob("*.defaults")):
        key = path.stem
        if key in _HIDDEN_FEATURES:
            continue
        features.append(
            {
                "key": key,
                # key is the label: naive title-casing mangles acronyms (BLE, MQTT, UI)
                "label": key,
                "description": _feature_description(path),
            }
        )
    return features


def build_catalog() -> dict[str, Any]:
    """Assemble the full build-options catalog served to the build UI."""
    return {
        "typeKey": TYPE_KEY,
        "chips": _CHIPS,
        "flashSizes": _FLASH_SIZES,
        "apps": catalog_apps(),
        "features": catalog_features(),
        "sdkconfig": _SDKCONFIG_KNOBS,
        "defaults": _DEFAULTS,
    }
