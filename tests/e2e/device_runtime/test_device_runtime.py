# SPDX-License-Identifier: AGPL-3.0-only
"""End-to-end test of the Linux device runtime foundation.

Exercises the whole path on a systemd-in-container test host (no cloud/appliance
needed): provision a local identity -> boot (helixd + runtime-manager under
systemd) -> build + install the helix-shell package -> runtime-manager
auto-starts it as the helix user -> the shell app registers on helixd's IPC bus
-> push a config drop-in and confirm the service is reconfigured, not broken ->
remove and confirm the unit + payload are gone.

Driven entirely through the `helix device` CLI, so it doubles as coverage for the
tooling. Skips cleanly when Docker is unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from collections.abc import Iterator
from typing import Any

import pytest

from tooling.common.paths import REPO_ROOT

CONTAINER = "helix-testhost"
BUNDLE = REPO_ROOT / "linux" / "device" / "docker" / ".bundle"
SHELL_PKG = BUNDLE / "helix-shell.helixpkg"
METRICS_PKG = BUNDLE / "helix-metrics-linux.helixpkg"
HELIX_PKG = "/usr/lib/helix/bin/helix-pkg"

pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="docker not available")


def cli(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "tooling.cli", "device", *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=check,
    )


def dexec(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", CONTAINER, *args], text=True, capture_output=True, check=check
    )


def wait_active(unit: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if dexec("systemctl", "is-active", unit, check=False).stdout.strip() == "active":
            return True
        time.sleep(0.5)
    return False


def active_state(unit: str) -> str:
    return dexec("systemctl", "is-active", unit, check=False).stdout.strip()


def ctl(method: str) -> dict[str, Any]:
    """Call a runtime-manager control method and parse its JSON result."""
    out = dexec(HELIX_PKG, "ctl", "-method", method, "-params", "{}").stdout.strip()
    result: dict[str, Any] = json.loads(out)
    return result


def nrestarts(unit: str) -> str:
    return dexec("systemctl", "show", unit, "-p", "NRestarts", "--no-pager").stdout.strip()


@pytest.fixture(scope="module")
def test_host() -> Iterator[None]:
    """Build the packages, provision a local identity, and boot the test host."""
    cli("package", "build", "helix-shell")
    cli("package", "build", "helix-metrics-linux")
    cli("provision", "--local", "--device-id", "helix-e2e-1")
    up = cli("test-host", "up", "--rebuild", check=False)
    if up.returncode != 0:
        cli("test-host", "down", check=False)
        pytest.skip(f"test host did not come up (docker/systemd unavailable?):\n{up.stderr}")
    try:
        yield
    finally:
        cli("test-host", "down", check=False)


def test_core_services_active(test_host: None) -> None:
    assert wait_active("helixd.service"), "helixd did not become active"
    assert wait_active("helix-runtime-manager.service"), "runtime-manager did not become active"


def test_install_autostarts_shell_as_helix(test_host: None) -> None:
    cli("package", "install", str(SHELL_PKG))
    assert wait_active(
        "helix-shell.service"
    ), "runtime-manager did not auto-start the shell service"

    props = dexec(
        "systemctl", "show", "helix-shell.service", "-p", "User,ActiveState,SubState", "--no-pager"
    ).stdout
    assert "User=helix" in props, f"shell not running as helix: {props}"
    assert "SubState=running" in props, f"shell not running: {props}"

    # The shell app connected to helixd and claimed its service name on the bus.
    journal = dexec("journalctl", "-u", "helixd.service", "--no-pager").stdout
    assert "service=shell" in journal, "shell app did not register on the IPC bus"

    listing = json.loads(cli("package", "list").stdout)
    names = {e["name"] for e in listing}
    assert "helix-shell" in names, f"shell not recorded in package DB: {names}"


def test_config_push_reconfigures_without_breaking(test_host: None) -> None:
    cli("config-push", "shell", '{"shell":"/bin/sh"}')

    owner = dexec("stat", "-c", "%U:%G %a", "/etc/helix/conf.d/shell.json").stdout.strip()
    assert owner == "root:helix 640", f"drop-in perms wrong: {owner}"

    # The service is restarted with the new config and stays up (regression guard
    # for the drop-in being unreadable by the service user).
    time.sleep(4)
    assert active_state("helix-shell.service") == "active", "shell broke after config push"
    restarts = dexec(
        "systemctl", "show", "helix-shell.service", "-p", "NRestarts", "--no-pager"
    ).stdout.strip()
    assert restarts == "NRestarts=0", f"shell crash-looped after config push: {restarts}"


def test_per_service_metrics_and_pluggable_host_provider(test_host: None) -> None:
    # Per-service resource metrics come from /proc/<MainPID> (generic Linux).
    status = ctl("get-status")
    shell = next((s for s in status["services"] if s["name"] == "shell"), None)
    assert shell is not None, f"shell not in status: {status}"
    assert shell["mainPid"] > 0 and shell["memoryBytes"] > 0, f"no per-service metrics: {shell}"

    # No host-metrics provider is installed yet, so host.providers is empty.
    assert status["host"]["providers"] == {}, f"unexpected providers: {status['host']}"

    # Installing a provider package must make its metrics appear WITHOUT a
    # runtime-manager restart (re-discovered on the next sample).
    before = nrestarts("helix-runtime-manager.service")
    cli("package", "install", str(METRICS_PKG))

    deadline = time.time() + 15
    providers: dict[str, Any] = {}
    while time.time() < deadline:
        providers = ctl("get-status")["host"]["providers"]
        if "linux" in providers:
            break
        time.sleep(1)
    assert "linux" in providers, f"host provider not picked up: {providers}"
    assert (
        "memory" in providers["linux"]["metrics"]
    ), f"provider metrics missing: {providers['linux']}"
    assert (
        nrestarts("helix-runtime-manager.service") == before
    ), "runtime-manager restarted (should hot-add)"


def test_remove_cleans_up(test_host: None) -> None:
    cli("package", "remove", "helix-shell", "--purge")
    assert active_state("helix-shell.service") != "active", "shell still active after remove"

    gone = dexec(
        "sh", "-c", "ls /run/systemd/system/helix-shell.service 2>/dev/null || echo GONE"
    ).stdout.strip()
    assert gone == "GONE", "generated unit not removed"

    binary = dexec(
        "sh", "-c", "ls /usr/lib/helix/bin/helix-shell 2>/dev/null || echo GONE"
    ).stdout.strip()
    assert binary == "GONE", "payload binary not removed"

    listing = json.loads(cli("package", "list").stdout)
    assert "helix-shell" not in {e["name"] for e in listing}, "shell still in package DB"
