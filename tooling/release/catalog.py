"""Build-options catalog for the custom-firmware builder.

Assembles the set of options a user can pick when requesting a custom ESP32
firmware build -- the apps, feature fragments, chips, flash sizes and common
sdkconfig knobs -- from the real firmware sources in the repo (so the catalog can
never drift from what `helix embedded esp32 link` actually understands):

  - apps come from `embedded/esp32/core/apps/manifest.json` (the same manifest the
    ESP-IDF build reads),
  - feature fragments come from `embedded/esp32/core/features/*.defaults`, with
    each fragment's leading comment block used as its human description.

The build container serves this over `GET /catalog`; the cloud backend proxies it
to the admin build UI. Chips, flash sizes and the suggested sdkconfig knobs are
curated here because they are properties of the build service, not of any single
firmware source file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from embedded.esp32.commands.apps import load_app_manifest
from embedded.esp32.commands.config import esp32_root

TYPE_KEY = "esp32-firmware"

# Feature fragments that exist for internal/test builds rather than for a user
# customizing a device firmware -- kept out of the catalog.
_HIDDEN_FEATURES = {"hw-test"}

# Curated, honest lists: only what the firmware + release plane actually support
# today. Add entries here as new chips/sizes are wired end to end.
_CHIPS: list[dict[str, str]] = [
    {"value": "esp32", "label": "ESP32"},
]

_FLASH_SIZES: list[dict[str, str]] = [
    {"value": "4MB", "label": "4 MB"},
    {"value": "8MB", "label": "8 MB"},
    {"value": "16MB", "label": "16 MB"},
]

# A small set of commonly-tuned sdkconfig knobs surfaced as first-class fields.
# Any other override can still be added freehand as a raw KEY=VALUE pair.
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
    """Use a feature fragment's leading comment block as its description."""
    lines: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped.startswith("#"):
            break
        text = stripped.lstrip("#").strip()
        # Drop the boilerplate "Feature fragment:" lead-in for a cleaner blurb.
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
                # The key is the label: it matches the `--feature <key>` flag and
                # naive title-casing mangles acronyms (BLE, MQTT, UI).
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
