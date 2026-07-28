"""`helix device package` + `helix device test-host` — the device package tools.

``package build`` compiles a package spec (under ``linux/device/packages/<name>``)
into a ``.helixpkg`` using the Go ``helix-pkg`` tool. ``test-host`` boots the
systemd-in-container image (the x86 test host) with a provisioned identity, and
``package install/remove/list`` + ``config push`` drive the on-device
runtime-manager through its control socket via ``docker exec``.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT

DEVICE_DIR = REPO_ROOT / "linux" / "device"
GO_DIR = DEVICE_DIR / "go"
PACKAGES_DIR = DEVICE_DIR / "packages"
DOCKERFILE = DEVICE_DIR / "docker" / "Dockerfile"
DEFAULT_BUNDLE = DEVICE_DIR / "docker" / ".bundle"

TEST_IMAGE = "helix/device-test:latest"
TEST_CONTAINER = "helix-testhost"
HELIX_PKG = "/usr/lib/helix/bin/helix-pkg"


def _run(
    cmd: list[str], capture: bool = True, cwd: Path | None = None, env: dict[str, str] | None = None
) -> str:
    full_env = {**os.environ, **env} if env else None
    result = subprocess.run(
        cmd, check=True, capture_output=capture, text=True, cwd=cwd, env=full_env
    )
    return result.stdout or ""


# ── package build ────────────────────────────────────────────────────────────


def _build_pkg(name: str, out: Path, arch: str = "amd64") -> Path:
    spec = PACKAGES_DIR / name
    if not (spec / "helix-control.json").exists():
        raise click.ClickException(f"no package spec at {spec}")

    # Payload binaries are cross-compiled for the target; CGO stays off so the
    # build is a pure static cross-compile (no toolchain per arch).
    build_env = {"GOOS": "linux", "GOARCH": arch, "CGO_ENABLED": "0"}

    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / name
        shutil.copytree(spec, work)

        # Compile declared Go binaries into the payload overlay.
        build_json = spec / "build.json"
        if build_json.exists():
            recipe = json.loads(build_json.read_text())
            (work / "build.json").unlink(missing_ok=True)
            for b in recipe.get("goBinaries", []):
                dest = work / "payload" / b["dest"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                click.echo(f"  compiling cmd/{b['cmd']} ({arch}) -> payload/{b['dest']}")
                _run(
                    [
                        "go",
                        "build",
                        "-trimpath",
                        "-ldflags=-s -w",
                        "-o",
                        str(dest),
                        f"./cmd/{b['cmd']}",
                    ],
                    capture=False,
                    cwd=GO_DIR,
                    env=build_env,
                )

        out.parent.mkdir(parents=True, exist_ok=True)
        click.echo(f"  packing -> {out}")
        _run(
            ["go", "run", "./cmd/helix-pkg", "build", "-spec", str(work), "-out", str(out)],
            capture=False,
            cwd=GO_DIR,
        )
    return out


@click.group()
def package() -> None:
    """Build and manage Helix device packages (.helixpkg)."""


@package.command("build")
@click.argument("name")
@click.option("--out", type=click.Path(path_type=Path), default=None, help="Output .helixpkg path.")
@click.option("--arch", default="amd64", show_default=True, help="Target GOARCH (e.g. arm64).")
def package_build(name: str, out: Path | None, arch: str) -> None:
    """Build a .helixpkg from linux/device/packages/<name>."""
    suffix = "" if arch == "amd64" else f".{arch}"
    out = out or (DEVICE_DIR / "docker" / ".bundle" / f"{name}{suffix}.helixpkg")
    _build_pkg(name, out, arch)
    click.echo(f"Built {out}")


# ── test host (systemd-in-container) ─────────────────────────────────────────


def _dexec(
    *args: str, check: bool = True, capture: bool = False
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", TEST_CONTAINER, *args], check=check, capture_output=capture, text=True
    )


def _container_running() -> bool:
    r = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", TEST_CONTAINER],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and r.stdout.strip() == "true"


def _wait_active(unit: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = _dexec("systemctl", "is-active", unit, check=False, capture=True)
        if r.stdout.strip() == "active":
            return True
        time.sleep(0.5)
    return False


@click.group("test-host")
def test_host() -> None:
    """Boot the systemd-in-container device test host (x86)."""


@test_host.command("up")
@click.option(
    "--bundle", type=click.Path(path_type=Path), default=DEFAULT_BUNDLE, show_default=True
)
@click.option("--rebuild", is_flag=True, help="Rebuild the image.")
def test_host_up(bundle: Path, rebuild: bool) -> None:
    """Build + boot the test host and load the provisioned identity."""
    bundle = bundle.expanduser()
    if not (bundle / "config.json").exists():
        raise click.ClickException(
            f"no provisioning bundle at {bundle} — run `helix device provision --local` first"
        )

    have_image = (
        subprocess.run(["docker", "image", "inspect", TEST_IMAGE], capture_output=True).returncode
        == 0
    )
    if rebuild or not have_image:
        click.echo(f"Building {TEST_IMAGE} ...")
        _run(
            ["docker", "build", "-f", str(DOCKERFILE), "-t", TEST_IMAGE, str(DEVICE_DIR)],
            capture=False,
        )

    subprocess.run(["docker", "rm", "-f", TEST_CONTAINER], capture_output=True)
    click.echo(f"Starting {TEST_CONTAINER} (systemd) ...")
    _run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            TEST_CONTAINER,
            "--privileged",
            "--cgroupns=host",
            "--tmpfs",
            "/run",
            "--tmpfs",
            "/run/lock",
            "--tmpfs",
            "/tmp",
            "-v",
            "/sys/fs/cgroup:/sys/fs/cgroup:rw",
            TEST_IMAGE,
        ]
    )

    # Wait for systemd to come up, then load the provisioned identity.
    for _ in range(60):
        r = _dexec("systemctl", "is-system-running", check=False, capture=True)
        if r.stdout.strip() in ("running", "degraded", "starting"):
            break
        time.sleep(0.5)

    click.echo("Loading provisioning bundle into /etc/helix ...")
    _run(["docker", "cp", str(bundle / "config.json"), f"{TEST_CONTAINER}:/etc/helix/config.json"])
    _run(["docker", "cp", str(bundle / "pki"), f"{TEST_CONTAINER}:/etc/helix/pki"])
    _dexec("chown", "-R", "root:helix", "/etc/helix/config.json", "/etc/helix/pki")
    _dexec("chmod", "0640", "/etc/helix/config.json")
    # 0640 root:helix (not 0600): helixd runs as helix and must read the device key.
    _dexec("chmod", "0640", "/etc/helix/pki/device.key")
    # Restart core now that config is present (clearing any pre-provision failures).
    _dexec("systemctl", "reset-failed", check=False)
    _dexec("systemctl", "restart", "helixd.service", "helix-runtime-manager.service", check=False)

    ok_core = _wait_active("helixd.service") and _wait_active("helix-runtime-manager.service")
    if not ok_core:
        raise click.ClickException("core services did not become active — see `test-host logs`")
    click.echo("Test host up: helixd + helix-runtime-manager active.")


@test_host.command("down")
def test_host_down() -> None:
    """Stop and remove the test host."""
    subprocess.run(["docker", "rm", "-f", TEST_CONTAINER], capture_output=True)
    click.echo(f"Removed {TEST_CONTAINER}")


@test_host.command("logs")
@click.option("--unit", default="", help="Show a specific unit's journal.")
def test_host_logs(unit: str) -> None:
    """Show the test host's systemd journal."""
    if unit:
        _dexec("journalctl", "-u", unit, "--no-pager", "-n", "200", check=False)
    else:
        _dexec("journalctl", "--no-pager", "-n", "200", check=False)


@test_host.command("status")
def test_host_status() -> None:
    """List Helix units on the test host."""
    if not _container_running():
        click.echo(f"{TEST_CONTAINER}: not running")
        return
    _dexec("systemctl", "list-units", "helix*", "--no-pager", check=False)


# ── package operations on the test host (via runtime-manager control) ────────


def _ctl(method: str, params: dict[str, object] | None = None) -> str:
    r = _dexec(
        HELIX_PKG,
        "ctl",
        "-method",
        method,
        "-params",
        json.dumps(params or {}),
        check=True,
        capture=True,
    )
    return r.stdout.strip()


@package.command("install")
@click.argument("pkgfile", type=click.Path(path_type=Path, exists=True))
def package_install(pkgfile: Path) -> None:
    """Install a .helixpkg on the test host via runtime-manager."""
    remote = f"/var/lib/helix/tmp/{pkgfile.name}"
    _dexec("mkdir", "-p", "/var/lib/helix/tmp")
    _run(["docker", "cp", str(pkgfile), f"{TEST_CONTAINER}:{remote}"])
    out = _ctl("install-package", {"path": remote})
    click.echo(out or "installed")


@package.command("remove")
@click.argument("name")
@click.option("--purge", is_flag=True)
def package_remove(name: str, purge: bool) -> None:
    """Remove a package on the test host."""
    _ctl("remove-package", {"name": name, "purge": purge})
    click.echo(f"removed {name}")


@package.command("list")
def package_list() -> None:
    """List installed packages on the test host."""
    click.echo(_ctl("list-packages"))


@click.command("status")
def status() -> None:
    """Show service health + resource metrics from runtime-manager (get-status)."""
    click.echo(json.dumps(json.loads(_ctl("get-status")), indent=2))


@click.command("metrics")
def metrics() -> None:
    """Show host/hardware metrics from the installed provider plugins (get-metrics)."""
    click.echo(json.dumps(json.loads(_ctl("get-metrics")), indent=2))


@click.command("config-push")
@click.argument("service")
@click.argument("section_json")
def config_push(service: str, section_json: str) -> None:
    """Push a config drop-in for SERVICE (SECTION_JSON is a JSON object)."""
    section = json.loads(section_json)
    _ctl("put-config", {"service": service, "section": section})
    click.echo(f"pushed config for {service}")
