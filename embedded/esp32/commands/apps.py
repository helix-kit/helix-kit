from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click

from .config import esp32_root


def load_app_manifest() -> list[dict[str, Any]]:
    manifest_path = esp32_root() / "apps" / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    apps = payload.get("apps")
    if not isinstance(apps, list):
        raise click.ClickException(f"{manifest_path} must contain apps[]")
    return [app for app in apps if isinstance(app, dict)]


def app_by_name() -> dict[str, dict[str, Any]]:
    return {str(app.get("name", "")).strip(): app for app in load_app_manifest()}


def app_names() -> list[str]:
    return [name for name in app_by_name() if name]


def app_features(selected_apps: list[str]) -> list[str]:
    """Feature fragments the selected apps declare they need (manifest `features`)."""
    known = app_by_name()
    features: list[str] = []
    for name in selected_apps:
        for feature in known.get(name, {}).get("features", []) or []:
            if feature not in features:
                features.append(str(feature))
    return features


def app_components() -> list[str]:
    components: list[str] = []
    for app in load_app_manifest():
        name = str(app.get("name", "")).strip()
        component = str(app.get("component", name)).strip()
        if component:
            components.append(component)
    return components


def validate_apps(selected_apps: list[str]) -> None:
    known = app_by_name()
    unknown = [app for app in selected_apps if app not in known]
    if unknown:
        raise click.ClickException(
            f"unknown app(s): {', '.join(unknown)}\nknown apps: {' '.join(known)}"
        )


def selection_name(selected_apps: list[str]) -> str:
    return "+".join(selected_apps) if selected_apps else "core-only"


def write_app_selection(selected_apps: list[str]) -> Path:
    validate_apps(selected_apps)
    known = app_by_name()
    output_dir = esp32_root() / "generated" / "app_selection"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "app_selection.c"

    lines = [
        '#include "app_selection.h"',
        "",
        '#include "esp_check.h"',
        '#include "esp_err.h"',
        '#include "esp_log.h"',
    ]
    for app_name in selected_apps:
        header = str(known[app_name].get("header", "")).strip()
        if not header:
            raise click.ClickException(f"app {app_name} is missing header")
        lines.append(f'#include "{header}"')

    lines.extend(
        [
            "",
            'static const char *TAG = "app_selection";',
            "",
            "esp_err_t app_selection_start(void)",
            "{",
        ]
    )
    if not selected_apps:
        lines.append('    ESP_LOGW(TAG, "no dynamic apps selected");')
    else:
        suffix = "" if len(selected_apps) == 1 else "s"
        lines.append(f'    ESP_LOGI(TAG, "starting {len(selected_apps)} dynamic app{suffix}");')
        for app_name in selected_apps:
            start = str(known[app_name].get("start", "")).strip()
            if not start:
                raise click.ClickException(f"app {app_name} is missing start")
            lines.append(f'    ESP_RETURN_ON_ERROR({start}(), TAG, "{start} failed");')
    lines.extend(["    return ESP_OK;", "}", ""])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


@click.command()
def apps() -> None:
    """List known ESP32 dynamic apps."""
    click.echo(json.dumps({"apps": load_app_manifest()}, indent=2))


@click.command()
@click.argument("selected_apps", nargs=-1)
def select(selected_apps: tuple[str, ...]) -> None:
    """Generate app_selection.c for selected apps."""
    selected = list(selected_apps)
    output = write_app_selection(selected)
    click.echo(
        json.dumps({"written": str(output), "selection": selection_name(selected)}, indent=2)
    )
