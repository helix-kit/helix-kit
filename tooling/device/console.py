from __future__ import annotations

import contextlib
import os
import select
import sys
import termios
import time
import tty
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import click

DEFAULT_BAUDRATE = 115200
ESCAPE_KEY = 0x1D  # Ctrl-]
RECONNECT_POLL = 0.5

# Adapters that expose a UART bridge. Boards re-enumerate on reset, so the kernel
# name (ttyUSB0/ttyUSB1) is not stable; match on the bridge's USB VID instead.
UART_BRIDGE_VIDS = {
    0x10C4,  # Silicon Labs CP210x
    0x1A86,  # QinHeng CH340/CH341
    0x0403,  # FTDI
    0x067B,  # Prolific PL2303
}


def _import_serial() -> Any:
    try:
        import serial
    except ImportError as exc:  # pragma: no cover - environment guard
        raise click.ClickException("pyserial is required for console commands: uv sync") from exc
    return serial


@dataclass(frozen=True)
class PortInfo:
    device: str
    description: str
    vid: int | None
    pid: int | None
    serial_number: str | None

    @property
    def is_uart_bridge(self) -> bool:
        return self.vid in UART_BRIDGE_VIDS

    def label(self) -> str:
        ids = f"{self.vid:04x}:{self.pid:04x}" if self.vid and self.pid else "-"
        return f"{self.device}  {ids}  {self.description}"


def list_ports() -> list[PortInfo]:
    from serial.tools import list_ports as _lp

    return [
        PortInfo(
            device=p.device,
            description=p.description or "?",
            vid=p.vid,
            pid=p.pid,
            serial_number=p.serial_number,
        )
        for p in sorted(_lp.comports(), key=lambda p: p.device)
    ]


def resolve_port(port: str | None) -> str:
    """Return an explicit port, or auto-detect the single attached UART bridge."""

    if port is not None:
        return port

    bridges = [p for p in list_ports() if p.is_uart_bridge]
    if len(bridges) == 1:
        click.echo(f"auto-detected {bridges[0].label()}", err=True)
        return bridges[0].device
    if not bridges:
        raise click.ClickException(
            "no USB UART bridge found. Plug one in, or pass --port explicitly.\n"
            "Run `helix device console ports` to see what is attached."
        )
    listed = "\n  ".join(p.label() for p in bridges)
    raise click.ClickException(f"multiple UART bridges found; pass --port:\n  {listed}")


def wait_for_port(port: str, timeout: float) -> bool:
    """Block until `port` exists, or timeout. Devices vanish across a reboot."""

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if os.path.exists(port):
            # Give udev a moment to chmod the freshly created node.
            time.sleep(0.3)
            return True
        time.sleep(RECONNECT_POLL)
    return False


class ConsoleSession:
    """Full-duplex raw serial console with reconnect across device resets."""

    def __init__(
        self,
        port: str,
        baudrate: int,
        log: Path | None,
        reconnect: bool,
    ) -> None:
        self._serial = _import_serial()
        self._port = port
        self._baudrate = baudrate
        self._reconnect = reconnect
        self._log_handle = log.open("ab") if log is not None else None
        self._log_path = log

    def run(self) -> int:
        stdin_fd = sys.stdin.fileno()
        interactive = sys.stdin.isatty()
        saved = termios.tcgetattr(stdin_fd) if interactive else None

        self._banner()
        try:
            if interactive:
                tty.setraw(stdin_fd)
            return self._loop(stdin_fd, interactive)
        finally:
            if saved is not None:
                termios.tcsetattr(stdin_fd, termios.TCSADRAIN, saved)
            if self._log_handle is not None:
                self._log_handle.close()
            click.echo("", err=True)

    def _banner(self) -> None:
        click.echo(f"connecting to {self._port} @ {self._baudrate} 8N1", err=True)
        if self._log_path is not None:
            click.echo(f"logging to {self._log_path}", err=True)
        click.echo("press Ctrl-] to exit", err=True)

    def _loop(self, stdin_fd: int, interactive: bool) -> int:
        while True:
            handle = self._open()
            if handle is None:
                return 1
            try:
                if self._pump(handle, stdin_fd, interactive):
                    return 0
            except self._serial.SerialException:
                # Device reset or unplugged mid-session.
                self._notice("device disconnected")
            finally:
                with contextlib.suppress(Exception):
                    handle.close()

            if not self._reconnect:
                return 1
            self._notice(f"waiting for {self._port} ...")
            if not wait_for_port(self._port, timeout=120.0):
                self._notice("timed out waiting for device")
                return 1

    def _open(self) -> Any:
        try:
            return self._serial.Serial(self._port, self._baudrate, timeout=0)
        except self._serial.SerialException as exc:
            if not self._reconnect:
                raise click.ClickException(f"cannot open {self._port}: {exc}") from exc
            self._notice(f"cannot open {self._port}: {exc}")
            if not wait_for_port(self._port, timeout=120.0):
                return None
            return self._open()

    def _pump(self, handle: Any, stdin_fd: int, interactive: bool) -> bool:
        """Shuttle bytes both ways. Returns True when the user asked to exit."""

        self._notice(f"connected to {self._port}")
        watch = [handle.fileno(), stdin_fd] if interactive else [handle.fileno()]
        while True:
            ready, _, _ = select.select(watch, [], [], 0.2)

            if handle.fileno() in ready:
                data = handle.read(4096)
                if data:
                    self._write_out(data)

            if interactive and stdin_fd in ready:
                keys = os.read(stdin_fd, 1024)
                if not keys:
                    return True
                if ESCAPE_KEY in keys:
                    return True
                handle.write(keys)
                handle.flush()

    def _write_out(self, data: bytes) -> None:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        if self._log_handle is not None:
            self._log_handle.write(data)
            self._log_handle.flush()

    def _notice(self, message: str) -> None:
        # \r keeps the notice readable while the tty is in raw mode.
        sys.stderr.write(f"\r\n[helix] {message}\r\n")
        sys.stderr.flush()


@click.group()
def console() -> None:
    """Interactive UART console for board bring-up and boot debugging."""


from tooling.device.gateway_console import gateway_console  # noqa: E402

console.add_command(gateway_console)


@console.command("ports")
@click.option(
    "--all",
    "show_all",
    is_flag=True,
    help="Include motherboard legacy /dev/ttyS* ports, which are almost never real.",
)
def console_ports(show_all: bool) -> None:
    """List attached serial ports, flagging recognised USB UART bridges."""

    ports = list_ports()
    if not show_all:
        ports = [p for p in ports if p.vid is not None]

    if not ports:
        click.echo("no USB serial adapters found (use --all to include legacy ttyS*)")
        return
    for port in ports:
        mark = "*" if port.is_uart_bridge else " "
        click.echo(f" {mark} {port.label()}")
    if any(p.is_uart_bridge for p in ports):
        click.echo("\n* = USB UART bridge (auto-detected by `helix device console open`)")


@console.command("open")
@click.option("--port", default=None, help="Serial device. Auto-detected when omitted.")
@click.option("--baudrate", default=DEFAULT_BAUDRATE, show_default=True, type=int)
@click.option(
    "--log",
    type=click.Path(dir_okay=False, path_type=Path),
    default=None,
    help="Tee the session to a file (appends).",
)
@click.option(
    "--no-reconnect",
    is_flag=True,
    help="Exit when the device resets instead of waiting for it to re-enumerate.",
)
@click.option(
    "--wait",
    is_flag=True,
    help="Wait for the port to appear before connecting.",
)
def console_open(
    port: str | None,
    baudrate: int,
    log: Path | None,
    no_reconnect: bool,
    wait: bool,
) -> None:
    """Open an interactive serial console.

    Survives device resets by default: when the board reboots and the adapter
    re-enumerates, the session reconnects instead of dying.
    """

    resolved = resolve_port(port)
    if wait and not os.path.exists(resolved):
        click.echo(f"waiting for {resolved} ...", err=True)
        if not wait_for_port(resolved, timeout=120.0):
            raise click.ClickException(f"{resolved} did not appear within 120s")

    session = ConsoleSession(
        port=resolved,
        baudrate=baudrate,
        log=log,
        reconnect=not no_reconnect,
    )
    raise SystemExit(session.run())
