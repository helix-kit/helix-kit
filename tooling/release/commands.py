from __future__ import annotations

import json
from pathlib import Path

import click

from tooling.release.build_worker import read_firmware_dir, run_custom_build
from tooling.release.catalog import build_catalog
from tooling.release.firmware_server import detect_lan_ip, serve_firmware
from tooling.release.sim import (
    ESP32_TYPE_SEED_SQL,
    LINUX_PACKAGE_TYPE_SEED_SQL,
    JsonDict,
    ReleaseClient,
    make_ci_token_sql,
    seed_profile_for_device_sql,
)


def _parse_set(overrides: tuple[str, ...]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for item in overrides:
        key, _, value = item.partition("=")
        parsed[key.strip()] = value.strip()
    return parsed


@click.group()
def release() -> None:
    """Release/OTA control plane: simulators + seed helpers (see docs/06)."""


_BASE_URL = click.option(
    "--base-url", default="http://127.0.0.1:4000", help="helix-server public URL."
)
_CI_TOKEN = click.option("--ci-token", envvar="HELIX_CI_TOKEN", help="Scoped CI bearer token.")


@release.command("catalog")
def catalog() -> None:
    """Print the custom-firmware build-options catalog (apps/features/chips/...).

    This is the same catalog the build container serves over `GET /catalog` and the
    admin build UI renders; use it to inspect or diff the selectable options.
    """
    click.echo(json.dumps(build_catalog(), indent=2))


@release.command("emit-seed-sql")
@click.option("--device-id", help="Also emit a CI token + profile/track assigning this device.")
@click.option("--name", default="helix-esp32-default", help="Release slug the profile follows.")
@click.option("--channel", default="stable")
@click.option("--chip", default="esp32")
@click.option("--flash-size", default="4MB")
def emit_seed_sql(
    device_id: str | None, name: str, channel: str, chip: str, flash_size: str
) -> None:
    """Print SQL to seed the esp32 artifact_type (+ optional CI token & device profile).

    Pipe into psql, e.g. `helix release emit-seed-sql | psql "$DATABASE_URL"`.
    """
    click.echo(f"{ESP32_TYPE_SEED_SQL};")
    click.echo(f"{LINUX_PACKAGE_TYPE_SEED_SQL};")
    if device_id is not None:
        secret, token_sql = make_ci_token_sql()
        click.echo(f"{token_sql};")
        for statement in seed_profile_for_device_sql(
            device_id, "esp32-firmware", name, channel, {"chip": chip, "flashSize": flash_size}
        ):
            click.echo(f"{statement};")
        click.echo(f"-- CI token (save it): {secret}")


@release.command("sim-ci-esp32")
@_BASE_URL
@_CI_TOKEN
@click.option("--name", default="helix-esp32-default")
@click.option("--version", default="0.1.0")
@click.option("--channel", default="stable")
@click.option("--chip", default="esp32")
@click.option("--flash-size", default="4MB")
@click.option("--app", "apps", multiple=True, default=("gpio_control",))
@click.option("--feature", "features", multiple=True)
def sim_ci_esp32(
    base_url: str,
    ci_token: str,
    name: str,
    version: str,
    channel: str,
    chip: str,
    flash_size: str,
    apps: tuple[str, ...],
    features: tuple[str, ...],
) -> None:
    """Simulate a CI ESP32 build: upload synthetic artifacts and register the release."""
    client = ReleaseClient(base_url, ci_token)
    result = client.sim_ci_esp32(
        name=name,
        version=version,
        channel=channel,
        selector={"chip": chip, "flashSize": flash_size},
        config={
            "apps": list(apps),
            "features": list(features),
            "chip": chip,
            "flashSize": flash_size,
        },
    )
    click.echo(json.dumps(result, indent=2))


@release.command("custom-build")
@_BASE_URL
@_CI_TOKEN
@click.option("--name", default="custom-fw")
@click.option("--version", default="1.0.0-custom")
@click.option("--channel", default="custom")
@click.option("--owner", default="user-sim")
@click.option("--chip", default="esp32")
@click.option("--flash-size", default="4MB")
@click.option("--app", "apps", multiple=True, default=("gpio_control",))
@click.option("--feature", "features", multiple=True)
def custom_build(
    base_url: str,
    ci_token: str,
    name: str,
    version: str,
    channel: str,
    owner: str,
    chip: str,
    flash_size: str,
    apps: tuple[str, ...],
    features: tuple[str, ...],
) -> None:
    """Simulate a user custom build (request -> worker callbacks); repeat hits Tier-0 cache."""
    client = ReleaseClient(base_url, ci_token)
    result = client.sim_custom_build(
        name=name,
        version=version,
        channel=channel,
        owner_user_id=owner,
        selector={"chip": chip, "flashSize": flash_size},
        config={
            "apps": list(apps),
            "features": list(features),
            "chip": chip,
            "flashSize": flash_size,
        },
    )
    click.echo(json.dumps(result, indent=2))


@release.command("build-firmware")
@_BASE_URL
@_CI_TOKEN
@click.option("--name", default="custom-fw", help="Release slug for this custom firmware.")
@click.option("--version", default="1.0.0-custom", help="Free-form version label.")
@click.option("--channel", default="custom")
@click.option("--owner", default="user-sim", help="Owning user id (marks it a custom build).")
@click.option("--chip", default="esp32")
@click.option("--flash-size", default="4MB")
@click.option("--app", "apps", multiple=True, default=("gpio_control",), help="App(s) to include.")
@click.option("--feature", "features", multiple=True, help="Feature fragment, e.g. no-ble.")
@click.option("--set", "overrides", multiple=True, help="sdkconfig override KEY=VALUE.")
def build_firmware(
    base_url: str,
    ci_token: str,
    name: str,
    version: str,
    channel: str,
    owner: str,
    chip: str,
    flash_size: str,
    apps: tuple[str, ...],
    features: tuple[str, ...],
    overrides: tuple[str, ...],
) -> None:
    """Build a REAL customized ESP32 firmware (via the ESP-IDF image) and register
    it as an owned, OTA-ready release. Repeat same-config builds hit the Tier-0 cache."""
    client = ReleaseClient(base_url, ci_token)
    config = {
        "apps": list(apps),
        "features": list(features),
        "set": _parse_set(overrides),
        "chip": chip,
        "flashSize": flash_size,
    }
    result = run_custom_build(
        client,
        name=name,
        version=version,
        channel=channel,
        selector={"chip": chip, "flashSize": flash_size},
        config=config,
        owner_user_id=owner,
        echo=click.echo,
    )
    click.echo(json.dumps(result, indent=2))


@release.command("publish-esp32")
@_BASE_URL
@_CI_TOKEN
@click.option("--name", default="helix-esp32", help="Release slug.")
@click.option("--version", default="0.1.0")
@click.option("--channel", default="stable")
@click.option("--chip", default="esp32")
@click.option("--flash-size", default="4MB")
@click.option(
    "--variant",
    "variants",
    multiple=True,
    required=True,
    help=(
        "featureSet:firmware-dir (repeatable), e.g. "
        "--variant ble:embedded/esp32/core/out/firmware/ble-on"
    ),
)
def publish_esp32(
    base_url: str,
    ci_token: str,
    name: str,
    version: str,
    channel: str,
    chip: str,
    flash_size: str,
    variants: tuple[str, ...],
) -> None:
    """Publish REAL pre-built ESP32 firmware(s) as one multi-variant release via the
    CI API (presign -> PUT bytes -> register + publish). Each --variant maps a
    `featureSet` selector value to a built firmware output dir."""
    client = ReleaseClient(base_url, ci_token)
    variant_specs: list[JsonDict] = []
    for spec in variants:
        feature_set, sep, dir_path = spec.partition(":")
        if sep == "" or feature_set.strip() == "" or dir_path.strip() == "":
            raise click.ClickException(f"--variant must be featureSet:dir (got '{spec}')")
        artifacts, _ = read_firmware_dir(Path(dir_path.strip()))
        variant_specs.append(
            {
                "selector": {
                    "chip": chip,
                    "flashSize": flash_size,
                    "featureSet": feature_set.strip(),
                },
                "artifacts": artifacts,
            }
        )
    result = client.ci_publish(
        name=name,
        version=version,
        channel=channel,
        config={"chip": chip, "flashSize": flash_size},
        variants=variant_specs,
    )
    click.echo(json.dumps(result, indent=2))


@release.command("trigger-ota")
@_BASE_URL
@_CI_TOKEN
@click.argument("device_id")
def trigger_ota(base_url: str, ci_token: str, device_id: str) -> None:
    """Publish an ota-update to a device's /in topic for its resolved release."""
    client = ReleaseClient(base_url, ci_token)
    click.echo(json.dumps(client.trigger_ota(device_id), indent=2))


@release.command("serve-firmware")
@click.option(
    "--firmware-dir",
    default="embedded/esp32/core/out/firmware/latest",
    show_default=True,
    help="Built firmware output dir (absolute, or relative to the repo root).",
)
@click.option("--host", default=None, help="Advertised host/IP in manifest URLs [default: LAN IP].")
@click.option("--port", default=8000, show_default=True, type=int)
@click.option("--baud-rate", default=115200, show_default=True, type=int)
def serve_firmware_cmd(firmware_dir: str, host: str | None, port: int, baud_rate: int) -> None:
    """Serve a built firmware dir over HTTP as a flashable manifest (dummy release
    server) for the Android app or a browser. Bind to the LAN so a phone on the
    same Wi-Fi can download and flash. Point the client at
    `http://<host>:<port>/manifest.json`."""
    directory = Path(firmware_dir)
    if not directory.is_absolute():
        from tooling.common.paths import REPO_ROOT

        directory = REPO_ROOT / directory
    if not (directory / "manifest.json").exists():
        raise click.ClickException(
            f"no firmware manifest at {directory}. Build first, e.g. "
            "`helix embedded esp32 link gpio_control`."
        )
    resolved_host = host or detect_lan_ip()
    serve_firmware(directory.resolve(), resolved_host, port, baud_rate)
