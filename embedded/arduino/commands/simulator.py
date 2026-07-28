# SPDX-License-Identifier: Apache-2.0
"""Build Arduino sketches and run them under qemu-system-avr over serial (click-free)."""

from __future__ import annotations

import contextlib
import shutil
import socket
import subprocess
import time
from pathlib import Path

from tooling.common.paths import EMBEDDED_ROOT

ARDUINO_ROOT = EMBEDDED_ROOT / "arduino"

# Repo-vendored Arduino libs (patched FreeRTOS + HelixEspCompat shim) for reproducible builds.
VENDORED_LIBRARIES = ARDUINO_ROOT / "libraries"

SHARED_PROTOCOL_LIBRARY = EMBEDDED_ROOT / "protocol"

# QEMU-emulable AVRs only; the Leonardo's ATmega32u4 + native-USB CDC is not emulable.
BOARDS: dict[str, dict[str, str]] = {
    "mega2560": {"fqbn": "arduino:avr:mega", "machine": "mega2560"},
    "uno": {"fqbn": "arduino:avr:uno", "machine": "uno"},
    "mega1280": {"fqbn": "arduino:avr:mega:cpu=atmega1280", "machine": "mega"},
}

DEFAULT_BOARD = "mega2560"


class ToolMissing(RuntimeError):
    """A required host tool (arduino-cli / qemu-system-avr) is not installed."""


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise ToolMissing(f"{name!r} not found on PATH")
    return path


def tools_available() -> bool:
    return bool(shutil.which("arduino-cli") and shutil.which("qemu-system-avr"))


def resolve_sketch(sketch: str | Path) -> Path:
    """Accept a sketch dir path or a bare name under embedded/arduino/."""
    path = Path(sketch)
    if not path.exists():
        path = ARDUINO_ROOT / str(sketch)
    path = path.resolve()
    if not (path / f"{path.name}.ino").is_file():
        raise FileNotFoundError(f"not a sketch dir (no {path.name}.ino): {path}")
    return path


def compile_sketch(sketch: str | Path, board: str = DEFAULT_BOARD) -> Path:
    if board not in BOARDS:
        raise ValueError(f"unknown board {board!r}; known: {', '.join(BOARDS)}")
    sketch_dir = resolve_sketch(sketch)
    out_dir = sketch_dir / "build" / board
    command = [require_tool("arduino-cli"), "compile", "--fqbn", BOARDS[board]["fqbn"]]
    if VENDORED_LIBRARIES.is_dir():
        command += ["--libraries", str(VENDORED_LIBRARIES)]
    if SHARED_PROTOCOL_LIBRARY.is_dir():
        command += ["--library", str(SHARED_PROTOCOL_LIBRARY)]
    command += [str(sketch_dir), "--output-dir", str(out_dir)]
    subprocess.run(command, check=True)
    elf = out_dir / f"{sketch_dir.name}.ino.elf"
    if not elf.is_file():
        raise RuntimeError(f"expected ELF not produced: {elf}")
    return elf


def qemu_command(machine: str, elf: Path, serial: list[str]) -> list[str]:
    return [
        require_tool("qemu-system-avr"),
        "-machine",
        machine,
        "-bios",
        str(elf),
        "-display",
        "none",
        "-monitor",
        "none",
        *serial,
    ]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class SerialSimulator:
    """Boot an ELF in qemu with its USART on a TCP socket (wait=on so the boot banner is never missed); a context manager."""

    def __init__(self, elf: Path, machine: str, port: int | None = None) -> None:
        self._elf = elf
        self._machine = machine
        self._port = port or _free_port()
        self._proc: subprocess.Popen[bytes] | None = None
        self._sock: socket.socket | None = None
        self._buf = ""
        self._offset = 0

    def __enter__(self) -> SerialSimulator:
        serial = [
            "-serial",
            f"tcp:127.0.0.1:{self._port},server=on,wait=on",
        ]
        self._proc = subprocess.Popen(
            qemu_command(self._machine, self._elf, serial),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                self._sock = socket.create_connection(("127.0.0.1", self._port), timeout=2)
                break
            except OSError as exc:
                if self._proc.poll() is not None:
                    raise RuntimeError("qemu exited before serial was ready") from exc
                time.sleep(0.05)
        if self._sock is None:
            raise RuntimeError("could not connect to qemu serial")
        self._sock.settimeout(0.25)
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._sock is not None:
            with contextlib.suppress(OSError):
                self._sock.close()
        if self._proc is not None:
            self._proc.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self._proc.wait(timeout=3)
            if self._proc.poll() is None:
                self._proc.kill()

    @property
    def text(self) -> str:
        """All output received from the device so far."""
        return self._buf

    def send_line(self, line: str) -> None:
        assert self._sock is not None
        self._sock.sendall(line.encode() + b"\n")

    def _pump(self) -> None:
        assert self._sock is not None
        with contextlib.suppress(socket.timeout, OSError):
            data = self._sock.recv(4096)
            if data:
                self._buf += data.decode(errors="replace")

    def read_until(self, needle: str, timeout: float = 6.0) -> str:
        """Wait until `needle` appears in newly-received output (consuming past it), else TimeoutError."""
        end = time.time() + timeout
        while time.time() < end:
            found = self._buf.find(needle, self._offset)
            if found != -1:
                self._offset = found + len(needle)
                return self._buf[: self._offset]
            self._pump()
        raise TimeoutError(f"did not see {needle!r} within {timeout}s; got:\n{self._buf}")

    def read_line_with_prefix(self, prefix: str, timeout: float = 6.0) -> str:
        """Wait for the next complete line starting with `prefix` and return the rest, advancing past it."""
        end = time.time() + timeout
        while time.time() < end:
            start = self._buf.find(prefix, self._offset)
            if start != -1:
                newline = self._buf.find("\n", start)
                if newline != -1:
                    self._offset = newline + 1
                    return self._buf[start + len(prefix) : newline].rstrip("\r")
            self._pump()
        raise TimeoutError(f"no line with prefix {prefix!r} within {timeout}s; got:\n{self._buf}")


def send_expect(
    sketch: str | Path,
    board: str,
    send: str,
    expect: str,
    timeout: float = 6.0,
) -> str:
    """Build, boot, send one line, and return output once `expect` appears."""
    elf = compile_sketch(sketch, board)
    with SerialSimulator(elf, BOARDS[board]["machine"]) as sim:
        if send:
            sim.send_line(send)
        return sim.read_until(expect, timeout=timeout)
