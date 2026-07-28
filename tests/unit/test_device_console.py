"""Tests for `helix device console`, exercised against a pty pair so the reconnect path is reproducible in CI."""

from __future__ import annotations

import os
import pty
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONSOLE_CMD = [sys.executable, "-m", "tooling.cli", "device", "console"]
CONNECT_GRACE = 3.0
IO_GRACE = 1.5


def _spawn(port: str, *extra: str) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [*CONSOLE_CMD, "open", "--port", port, *extra],
        cwd=REPO_ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _stop(proc: subprocess.Popen[bytes]) -> str:
    proc.send_signal(signal.SIGINT)
    try:
        out = proc.communicate(timeout=15)[0]
    except subprocess.TimeoutExpired:  # pragma: no cover - hung child
        proc.kill()
        out = proc.communicate()[0]
    return out.decode("utf-8", "replace")


def test_ports_hides_legacy_tty_by_default() -> None:
    """Motherboard ttyS* ports are noise; only USB adapters are shown."""

    result = subprocess.run(
        [*CONSOLE_CMD, "ports"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "/dev/ttyS" not in result.stdout


def test_console_streams_and_logs_device_output(tmp_path: Path) -> None:
    """Bytes from the device reach both stdout and the --log file verbatim."""

    master, slave = pty.openpty()
    log = tmp_path / "console.log"
    proc = _spawn(os.ttyname(slave), "--log", str(log))
    try:
        time.sleep(CONNECT_GRACE)
        os.write(master, b"U-Boot 2018.07\r\nradxa-cubie-a7z login: \r\n")
        time.sleep(IO_GRACE)
        output = _stop(proc)
    finally:
        os.close(master)
        os.close(slave)

    assert "U-Boot 2018.07" in output
    assert log.read_bytes() == b"U-Boot 2018.07\r\nradxa-cubie-a7z login: \r\n"


def test_console_reconnects_across_device_reset(tmp_path: Path) -> None:
    """A board reset makes the port vanish; the session must survive it (unlike `cat /dev/ttyUSB0`)."""

    link = tmp_path / "uart"

    def attach() -> tuple[int, int]:
        master, slave = pty.openpty()
        if link.is_symlink():
            link.unlink()
        link.symlink_to(os.ttyname(slave))
        return master, slave

    master, slave = attach()
    proc = _spawn(str(link))
    try:
        time.sleep(CONNECT_GRACE)
        os.write(master, b"before reset\r\n")
        time.sleep(IO_GRACE)

        # Device resets: port closes and the node disappears.
        os.close(master)
        os.close(slave)
        link.unlink()
        time.sleep(2.0)

        # Adapter re-enumerates.
        master, slave = attach()
        time.sleep(CONNECT_GRACE)
        os.write(master, b"after reset\r\n")
        time.sleep(IO_GRACE)
        output = _stop(proc)
    finally:
        os.close(master)
        os.close(slave)

    assert "before reset" in output
    assert "device disconnected" in output
    assert "after reset" in output, "console did not recover after the device came back"
