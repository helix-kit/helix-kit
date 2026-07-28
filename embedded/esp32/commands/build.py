from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import click

from tooling.common import REPO_ROOT, run

from .apps import (
    app_components,
    app_features,
    app_names,
    selection_name,
    write_app_selection,
)
from .config import (
    DEFAULT_BUILD_DIR,
    DEFAULT_QEMU_BUILD_DIR,
    DEFAULT_VSCODE_BUILD_DIR,
    ensure_host_idf,
    esp32_root,
    idf_build,
    in_esp_idf_docker,
    rerun_in_esp_idf_docker,
    resolve_docker_image,
)


def source_revision() -> tuple[str, bool]:
    revision = run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    status = run(
        ["git", "status", "--porcelain"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    commit = revision.stdout.strip() if revision.returncode == 0 else "unknown"
    dirty = status.returncode != 0 or bool(status.stdout.strip())
    return commit, dirty


def copy_firmware_outputs(
    build_dir: Path, selected_apps: list[str], out_name: str | None = None
) -> Path:
    name = out_name or selection_name(selected_apps)
    out_dir = esp32_root() / "out" / "firmware" / name
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    copies = {
        build_dir / "bootloader" / "bootloader.bin": out_dir / "bootloader.bin",
        build_dir / "partition_table" / "partition-table.bin": out_dir / "partition-table.bin",
        build_dir / "ota_data_initial.bin": out_dir / "ota_data_initial.bin",
        build_dir / "esp32_firmware.bin": out_dir / "esp32_firmware.bin",
    }
    for source, destination in copies.items():
        if not source.exists():
            raise click.ClickException(f"missing build artifact: {source}")
        shutil.copy2(source, destination)

    (out_dir / "flash_args").write_text(
        "\n".join(
            [
                "--flash_mode dio --flash_freq 40m --flash_size 4MB",
                "0x1000 bootloader.bin",
                "0x8000 partition-table.bin",
                "0xf000 ota_data_initial.bin",
                "0x20000 esp32_firmware.bin",
                "",
            ]
        ),
        encoding="utf-8",
    )

    flasher_args = build_dir / "flasher_args.json"
    if flasher_args.exists():
        payload = json.loads(flasher_args.read_text(encoding="utf-8"))
        payload.setdefault("flash_files", {})
        payload["flash_files"]["0x1000"] = "bootloader.bin"
        payload["flash_files"]["0x8000"] = "partition-table.bin"
        payload["flash_files"]["0xf000"] = "ota_data_initial.bin"
        payload["flash_files"]["0x20000"] = "esp32_firmware.bin"
        payload.setdefault("bootloader", {})["file"] = "bootloader.bin"
        payload.setdefault("partition-table", {})["file"] = "partition-table.bin"
        payload.setdefault("otadata", {})["file"] = "ota_data_initial.bin"
        payload.setdefault("app", {})["file"] = "esp32_firmware.bin"
        (out_dir / "flasher_args.json").write_text(
            json.dumps(payload, indent=2) + "\n",
            encoding="utf-8",
        )

    app_bin = out_dir / "esp32_firmware.bin"
    revision, dirty = source_revision()
    manifest = {
        "name": name,
        "selection": selection_name(selected_apps),
        "apps": list(selected_apps),
        "chip": "esp32",
        "appSha256": hashlib.sha256(app_bin.read_bytes()).hexdigest(),
        "appSizeBytes": app_bin.stat().st_size,
        "source": {
            "license": "AGPL-3.0-only",
            "repository": "https://github.com/helix-kit/helix-kit",
            "revision": revision,
            "dirty": dirty,
        },
        "artifacts": {
            "bootloader": "bootloader.bin",
            "partitionTable": "partition-table.bin",
            "otaData": "ota_data_initial.bin",
            "app": "esp32_firmware.bin",
            "flashArgs": "flash_args",
            "flasherArgs": "flasher_args.json",
        },
        "offsets": {
            "bootloader": "0x1000",
            "partitionTable": "0x8000",
            "otaData": "0xf000",
            "app": "0x20000",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    latest = esp32_root() / "out" / "firmware" / "latest"
    latest.unlink(missing_ok=True)
    latest.symlink_to(out_dir.name)
    return out_dir


def resolve_feature_fragments(features: list[str]) -> list[Path]:
    fragments: list[Path] = []
    for feature in features:
        fragment = esp32_root() / "features" / f"{feature}.defaults"
        if not fragment.exists():
            available = sorted(p.stem for p in (esp32_root() / "features").glob("*.defaults"))
            raise click.ClickException(
                f"unknown feature fragment: {feature}\nknown features: {' '.join(available)}"
            )
        fragments.append(fragment)
    return fragments


def write_override_fragment(build_dir: Path, overrides: list[str]) -> Path:
    for override in overrides:
        if "=" not in override:
            raise click.ClickException(f"--set expects KEY=VALUE, got: {override}")
    build_dir.mkdir(parents=True, exist_ok=True)
    fragment = build_dir / "custom.defaults"
    fragment.write_text("\n".join(overrides) + "\n", encoding="utf-8")
    return fragment


@click.command()
@click.argument("selected_apps", nargs=-1)
@click.option("--no-out", is_flag=True)
@click.option(
    "--feature",
    "features",
    multiple=True,
    help="Feature fragment from features/<name>.defaults (repeatable), e.g. --feature no-ble.",
)
@click.option(
    "--set",
    "overrides",
    multiple=True,
    help=(
        "Extra sdkconfig override KEY=VALUE (repeatable), e.g. "
        "--set CONFIG_HELIX_TRANSPORT_MQTT=n."
    ),
)
@click.option("--build-dir", "build_dir_opt", default="", help="Override build directory.")
@click.option("--out-name", default="", help="Override out/firmware/<name> directory name.")
@click.option("--host", is_flag=True, help="Run idf.py on host instead of ESP-IDF Docker.")
@click.option("--docker-image", default="")
def link(
    selected_apps: tuple[str, ...],
    no_out: bool,
    features: tuple[str, ...],
    overrides: tuple[str, ...],
    build_dir_opt: str,
    out_name: str,
    host: bool,
    docker_image: str,
) -> None:
    """Build final firmware for selected apps and an optional feature set."""
    selected = list(selected_apps)
    if not in_esp_idf_docker() and not host:
        forwarded = ["embedded", "esp32", "link"]
        if no_out:
            forwarded.append("--no-out")
        for feature in features:
            forwarded.extend(["--feature", feature])
        for override in overrides:
            forwarded.extend(["--set", override])
        if build_dir_opt:
            forwarded.extend(["--build-dir", build_dir_opt])
        if out_name:
            forwarded.extend(["--out-name", out_name])
        forwarded.extend(selected)
        rerun_in_esp_idf_docker(forwarded, resolve_docker_image(docker_image))
        return

    write_app_selection(selected)
    build_dir = esp32_root() / (build_dir_opt or DEFAULT_BUILD_DIR)

    # A selected app's declared features count as requested: `link ui_demo` needn't also pass `--feature ui`.
    enabled = list(features) + [f for f in app_features(selected) if f not in features]
    defaults = [esp32_root() / "sdkconfig.defaults", *resolve_feature_fragments(enabled)]
    if overrides:
        defaults.append(write_override_fragment(build_dir, list(overrides)))

    idf_build(build_dir, defaults, ["build"], features=enabled)
    if no_out:
        return
    out_dir = copy_firmware_outputs(build_dir, selected, out_name or None)
    click.echo(f"firmware artifacts: {out_dir.relative_to(esp32_root())}")


@click.command()
@click.option("--host", is_flag=True, help="Run idf.py on host instead of ESP-IDF Docker.")
@click.option("--docker-image", default="")
@click.option("-j", "--jobs", type=click.IntRange(min=0), default=0, show_default=True)
def prebuild(host: bool, docker_image: str, jobs: int) -> None:
    """Prebuild all component archives into out/lib."""
    if not in_esp_idf_docker() and not host:
        forwarded = ["embedded", "esp32", "prebuild"]
        if jobs > 0:
            forwarded.extend(["--jobs", str(jobs)])
        rerun_in_esp_idf_docker(
            forwarded,
            resolve_docker_image(docker_image),
            jobs=jobs,
        )
        return

    selected = app_names()
    write_app_selection(selected)
    build_dir = esp32_root() / DEFAULT_BUILD_DIR
    enabled = app_features(selected)
    idf_build(
        build_dir,
        [esp32_root() / "sdkconfig.defaults", *resolve_feature_fragments(enabled)],
        ["build"],
        jobs=jobs,
        features=enabled,
    )

    out_lib = esp32_root() / "out" / "lib"
    if out_lib.exists():
        shutil.rmtree(out_lib)
    out_lib.mkdir(parents=True, exist_ok=True)

    for component in [
        "protocol",
        "platform",
        *app_components(),
        "app_selection",
    ]:
        archive = build_dir / "esp-idf" / component / f"lib{component}.a"
        if archive.exists():
            shutil.copy2(archive, out_lib / archive.name)
    click.echo(f"prebuilt archives: {out_lib.relative_to(esp32_root())}")


@click.command(context_settings={"ignore_unknown_options": True})
@click.argument("idf_args", nargs=-1, type=click.UNPROCESSED)
def qemu(idf_args: tuple[str, ...]) -> None:
    """Run idf.py for the QEMU build directory."""
    write_app_selection([])
    build_dir = esp32_root() / DEFAULT_QEMU_BUILD_DIR
    idf_build(
        build_dir,
        [esp32_root() / "sdkconfig.defaults", esp32_root() / "sdkconfig.defaults.qemu"],
        list(idf_args or ["qemu"]),
    )


@click.command(name="qemu-test", context_settings={"ignore_unknown_options": True})
@click.option("--docker-image", default="")
@click.argument("pytest_args", nargs=-1, type=click.UNPROCESSED)
def qemu_test(docker_image: str, pytest_args: tuple[str, ...]) -> None:
    """Run the QEMU e2e tests (file-transfer over serial) in the ESP-IDF image."""
    import importlib.util
    import os
    import sys

    if not in_esp_idf_docker():
        forwarded = ["embedded", "esp32", "qemu-test", *pytest_args]
        rerun_in_esp_idf_docker(forwarded, resolve_docker_image(docker_image))
        return

    # Build the image these tests run against; the app selection is shared across build dirs and would otherwise reconfigure against the wrong defaults.
    write_app_selection([])
    idf_build(
        esp32_root() / DEFAULT_QEMU_BUILD_DIR,
        [esp32_root() / "sdkconfig.defaults", esp32_root() / "sdkconfig.defaults.qemu"],
        ["build"],
    )

    # pytest isn't in the base ESP-IDF image and its python env is read-only, so install into a scratch dir on PYTHONPATH.
    pytest_home: str | None = None
    if importlib.util.find_spec("pytest") is None:
        pytest_home = "/tmp/helix-pytest"
        if not os.path.isdir(os.path.join(pytest_home, "pytest")):
            run(
                [
                    sys.executable,
                    "-m",
                    "pip",
                    "install",
                    "--quiet",
                    "--disable-pip-version-check",
                    "--target",
                    pytest_home,
                    "pytest",
                ],
                cwd=REPO_ROOT,
            )

    e2e_dir = REPO_ROOT / "tests" / "e2e"
    test_paths = [
        str(e2e_dir / "test_esp32_qemu_filexfer.py"),
        str(e2e_dir / "test_esp32_qemu_db.py"),
        str(e2e_dir / "test_esp32_qemu_events.py"),
    ]
    env = os.environ.copy()
    search = [str(REPO_ROOT)]
    if pytest_home:
        search.insert(0, pytest_home)
    env["PYTHONPATH"] = os.pathsep.join(search)
    run(
        [sys.executable, "-m", "pytest", "-v", "-s", *test_paths, *pytest_args],
        cwd=REPO_ROOT,
        env=env,
    )


@click.command(name="hw-test", context_settings={"ignore_unknown_options": True})
@click.option("--port", default="/dev/ttyUSB0", show_default=True)
@click.argument("pytest_args", nargs=-1, type=click.UNPROCESSED)
def hw_test(port: str, pytest_args: tuple[str, ...]) -> None:
    """Run the ESP32 e2e suite against a real, already-flashed board over USB serial (on host, not Docker)."""
    import os
    import sys

    e2e_dir = REPO_ROOT / "tests" / "e2e"
    test_paths = [
        str(e2e_dir / "test_esp32_qemu_filexfer.py"),
        str(e2e_dir / "test_esp32_qemu_db.py"),
        str(e2e_dir / "test_esp32_qemu_events.py"),
    ]
    env = os.environ.copy()
    env["HELIX_ESP32_TARGET"] = "serial"
    env["HELIX_ESP32_PORT"] = port
    env["PYTHONPATH"] = str(REPO_ROOT)
    run(
        [sys.executable, "-m", "pytest", "-v", "-s", *test_paths, *pytest_args],
        cwd=REPO_ROOT,
        env=env,
    )


@click.command()
def vscode() -> None:
    """Configure the persistent host ESP-IDF build used by editors."""
    ensure_host_idf()
    write_app_selection([])
    build_dir = esp32_root() / DEFAULT_VSCODE_BUILD_DIR
    idf_build(build_dir, [esp32_root() / "sdkconfig.defaults"], ["reconfigure"])
    compile_commands = build_dir.relative_to(esp32_root()) / "compile_commands.json"
    click.echo(f"VS Code compile database: {compile_commands}")
