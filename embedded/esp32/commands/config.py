from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import click

from tooling.common import ESP32_SOURCE_ROOT, REPO_ROOT, run

DEFAULT_ESP_IDF_IMAGE = "helix/esp-idf:release-v5.4-lean"
DEFAULT_PORT = "/dev/ttyUSB0"
DEFAULT_BUILD_DIR = ".build/dynamic"
DEFAULT_QEMU_BUILD_DIR = ".build/qemu"
DEFAULT_VSCODE_BUILD_DIR = ".build/vscode"
DEFAULT_ANALYSIS_DIR = "out/analysis"


def esp32_root() -> Path:
    override = os.environ.get("HELIX_ESP32_ROOT", "").strip()
    if override:
        return Path(override)
    return ESP32_SOURCE_ROOT


def resolve_docker_image(image: str) -> str:
    return image or os.environ.get("ESP_IDF_IMAGE") or DEFAULT_ESP_IDF_IMAGE


def in_esp_idf_docker() -> bool:
    return os.environ.get("IN_ESP_IDF_DOCKER") == "1"


def resolve_build_jobs(jobs: int = 0) -> str:
    if jobs > 0:
        return str(jobs)
    return os.environ.get("IDF_PY_BUILD_JOBS", str(os.cpu_count() or 4))


def rerun_in_esp_idf_docker(argv: list[str], image: str, *, jobs: int = 0) -> None:
    command = [
        "docker",
        "run",
        "--rm",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-e",
        "HOME=/tmp",
        "-e",
        "IN_ESP_IDF_DOCKER=1",
        "-e",
        "HELIX_ESP32_ROOT=/project",
        "-e",
        f"IDF_PY_BUILD_JOBS={resolve_build_jobs(jobs)}",
        "-v",
        f"{REPO_ROOT}:/repo",
        "-v",
        f"{ESP32_SOURCE_ROOT}:/project",
        "-w",
        "/repo",
        image,
        "python",
        "-m",
        "tooling.cli",
        *argv,
    ]
    run(command, cwd=REPO_ROOT)


def sdkconfig_stale(build_dir: Path, defaults: list[Path]) -> bool:
    sdkconfig = build_dir / "sdkconfig"
    if not sdkconfig.exists():
        return True
    sdk_mtime = sdkconfig.stat().st_mtime
    return any(path.exists() and path.stat().st_mtime > sdk_mtime for path in defaults)


def remove_sdkconfig_if_stale(build_dir: Path, defaults: list[Path]) -> None:
    if sdkconfig_stale(build_dir, defaults):
        (build_dir / "sdkconfig").unlink(missing_ok=True)


def idf_build(
    build_dir: Path,
    defaults: list[Path],
    extra_args: list[str],
    *,
    jobs: int = 0,
    features: list[str] | None = None,
) -> None:
    """Configure and drive an ESP-IDF build.

    `features` reaches CMake as HELIX_FEATURES in the environment: a feature
    fragment can switch sdkconfig values on its own, but an optional *component*
    (the LVGL UI stack) has to be kept out of the component list, which only CMake
    can do -- and it must be visible to ESP-IDF's separate requirements pass too,
    which only inherits the environment.
    """
    defaults_arg = ";".join(str(path.relative_to(esp32_root())) for path in defaults)
    remove_sdkconfig_if_stale(build_dir, defaults)
    command = [
        "idf.py",
        "-B",
        str(build_dir),
        f"-DSDKCONFIG={build_dir / 'sdkconfig'}",
        f"-DSDKCONFIG_DEFAULTS={defaults_arg}",
        *extra_args,
    ]
    env = os.environ.copy()
    env["IDF_PY_BUILD_JOBS"] = resolve_build_jobs(jobs)
    env["HELIX_FEATURES"] = ";".join(features or [])
    run(command, cwd=esp32_root(), env=env)


def firmware_dir_from_arg(value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = esp32_root() / candidate
    return candidate


def ensure_host_idf() -> None:
    if shutil.which("idf.py"):
        return
    idf_path = Path(os.environ.get("IDF_PATH", Path.home() / ".espressif" / "v5.4.4" / "esp-idf"))
    export = idf_path / "export.sh"
    if not export.exists():
        raise click.ClickException(
            f"ESP-IDF not found at {idf_path}. Install ESP-IDF or set IDF_PATH=/path/to/esp-idf."
        )
    current = [sys.executable, "-m", "tooling.cli", *sys.argv[1:]]
    quoted = shlex.join(current)
    command = ["bash", "-lc", f"source {export} >/dev/null && {quoted}"]
    raise SystemExit(subprocess.run(command, check=False).returncode)
