# SPDX-License-Identifier: Apache-2.0
"""Talk to the Helix ESP32 firmware over its UART0 command channel.

The same protocol layer (JSON control lines + binary file-transfer frames) runs
against two interchangeable backends so any e2e test can run either place:

  * Esp32QemuSimulator -- boots the firmware under `idf.py qemu` with UART0 on a
    TCP socket (no board; runs inside the ESP-IDF Docker image).
  * Esp32SerialDevice  -- a real ESP32 on a USB serial port (e.g. /dev/ttyUSB0),
    reset via DTR/RTS so each test sees a fresh boot banner.

Select with HELIX_ESP32_TARGET=qemu|serial (see open_esp32 / the `esp32` pytest
fixture in tests/e2e/conftest.py). This module is click-free so both the
`helix embedded esp32` commands and the pytest suite can share it.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import socket
import subprocess
import time
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING, Any, Self

from .config import DEFAULT_QEMU_BUILD_DIR, esp32_root

if TYPE_CHECKING:
    import serial

# Serial binary frame constants -- must match helix_transport_serial.h.
_BINARY_MARKER = 0x02
_BINARY_VERSION = 0x01
_INPUT_PREFIX = "SERVICE "
_RESPONSE_PREFIX = "HELIX_RESPONSE "

DEFAULT_SERIAL_PORT = "/dev/ttyUSB0"


def qemu_tools_available() -> bool:
    return bool(shutil.which("qemu-system-xtensa") and shutil.which("idf.py"))


def esp32_target() -> str:
    return os.environ.get("HELIX_ESP32_TARGET", "qemu")


def serial_port() -> str:
    return os.environ.get("HELIX_ESP32_PORT", DEFAULT_SERIAL_PORT)


def target_available() -> bool:
    """Whether the selected backend can run here (for pytest skip guards)."""
    if esp32_target() == "serial":
        try:
            import serial  # noqa: F401  (pyserial)
        except ImportError:
            return False
        return Path(serial_port()).exists()
    return qemu_tools_available()


# Back-compat alias (older tests referenced tools_available for the QEMU guard).
def tools_available() -> bool:
    return target_available()


def frame_crc(data: bytes) -> int:
    """Reflected CRC-32 over the frame header+payload. Must match, bit-for-bit,
    frame_crc_step() in helix_transport_serial.c (an internal frame checksum,
    intentionally not tied to any external CRC-32 standard)."""
    crc = 0xFFFFFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xEDB88820 if (crc & 1) else (crc >> 1)
    return (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF


def build_binary_frame(session: int, offset: int, data: bytes) -> bytes:
    """Encode one host->device data frame (see helix_transport_serial.h)."""
    header = (
        bytes([_BINARY_VERSION])
        + session.to_bytes(2, "little")
        + offset.to_bytes(4, "little")
        + len(data).to_bytes(2, "little")
    )
    body = header + data
    crc = frame_crc(body)
    return bytes([_BINARY_MARKER]) + body + crc.to_bytes(4, "little")


_BINARY_HEADER_BYTES = 9  # ver + session + offset + len
_BINARY_MAX_PAYLOAD = 1024


class _Incomplete:
    """The buffer stops mid-frame: read more before deciding what these bytes are."""


_FRAME_INCOMPLETE = _Incomplete()


def _parse_binary_frame(
    raw: bytes | bytearray, start: int
) -> tuple[int, int, bytes, int] | None | _Incomplete:
    """Decode the device->host frame at `start` (which holds the 0x02 marker).

    Returns (session, offset, payload, frame_size), None if these bytes do not
    begin a valid frame, or _FRAME_INCOMPLETE if the buffer has yet to catch up.
    """
    body_start = start + 1
    if len(raw) < body_start + _BINARY_HEADER_BYTES:
        return _FRAME_INCOMPLETE
    if raw[body_start] != _BINARY_VERSION:
        return None

    length = int.from_bytes(raw[body_start + 7 : body_start + 9], "little")
    if length == 0 or length > _BINARY_MAX_PAYLOAD:
        return None

    end = body_start + _BINARY_HEADER_BYTES + length + 4
    if len(raw) < end:
        return _FRAME_INCOMPLETE

    body = bytes(raw[body_start : body_start + _BINARY_HEADER_BYTES + length])
    expected = int.from_bytes(raw[end - 4 : end], "little")
    if frame_crc(body) != expected:
        return None

    session = int.from_bytes(raw[body_start + 1 : body_start + 3], "little")
    offset = int.from_bytes(raw[body_start + 3 : body_start + 7], "little")
    payload = body[_BINARY_HEADER_BYTES:]
    return session, offset, payload, end - start


class Esp32Link:
    """Transport-agnostic Helix UART0 protocol: JSON control + binary frames.

    A context manager: `with open_esp32() as link:` brings the backend up via
    _start() and always tears it down via close().

    Subclasses provide the lifecycle via _start()/close() and the raw byte
    transport via _read_raw()/_write_raw().
    """

    def __init__(self) -> None:
        self._buf = ""
        self._raw = bytearray()
        self._frames: deque[tuple[int, int, bytes]] = deque()

    # -- lifecycle -----------------------------------------------------------
    def _start(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

    def open(self) -> Self:
        """Bring the backend up (context-manager entry does this for you)."""
        self._start()
        return self

    def __enter__(self) -> Self:
        return self.open()

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- transport hooks (subclass) -----------------------------------------
    def _read_raw(self) -> bytes:
        raise NotImplementedError

    def _write_raw(self, data: bytes) -> None:
        raise NotImplementedError

    # -- raw i/o -------------------------------------------------------------
    def send_line(self, line: str) -> None:
        self._write_raw(line.encode() + b"\n")

    def send_bytes(self, data: bytes) -> None:
        self._write_raw(data)

    def _pump(self) -> None:
        data = self._read_raw()
        if data:
            self._raw += data
            self._demux()

    def _demux(self) -> None:
        """Split the byte stream into binary frames and everything else (text).

        Both directions share the UART, so a device->host frame (0x02 marker, see
        helix_transport_serial.h) can land anywhere -- including spliced into a log
        line, since ESP_LOG writes are not covered by the firmware's TX lock. A
        frame is only consumed once its CRC checks out; a byte that fails to start
        one is text, so a damaged frame costs one rectangle and nothing more.
        """
        text = bytearray()
        index = 0
        raw = self._raw
        while index < len(raw):
            byte = raw[index]
            if byte != _BINARY_MARKER:
                text.append(byte)
                index += 1
                continue

            frame = _parse_binary_frame(raw, index)
            if isinstance(frame, _Incomplete):
                break
            if frame is None:
                text.append(byte)
                index += 1
                continue

            session, offset, payload, size = frame
            self._frames.append((session, offset, payload))
            index += size

        del raw[:index]
        if text:
            self._buf += text.decode(errors="replace")

    def pump(self) -> None:
        """Read whatever the device has sent so far into the text/frame buffers."""
        self._pump()

    @property
    def text(self) -> str:
        """Everything the device has printed that was not part of a binary frame."""
        return self._buf

    def poll_frames(self) -> list[tuple[int, int, bytes]]:
        """Drain the binary frames received so far as (session, offset, payload)."""
        self._pump()
        frames = list(self._frames)
        self._frames.clear()
        return frames

    def read_until(self, needle: str, timeout: float = 30.0) -> str:
        end = time.time() + timeout
        while time.time() < end:
            if needle in self._buf:
                return self._buf
            self._pump()
        raise TimeoutError(f"did not see {needle!r} within {timeout}s; got:\n{self._buf}")

    def read_line_with_prefix(self, prefix: str, timeout: float = 15.0) -> str:
        """Wait for a complete line starting with `prefix` and consume the buffer up to and including it."""
        end = time.time() + timeout
        while time.time() < end:
            start = self._buf.find(prefix)
            if start != -1:
                newline = self._buf.find("\n", start)
                if newline != -1:
                    line = self._buf[start + len(prefix) : newline].rstrip("\r")
                    self._buf = self._buf[newline + 1 :]
                    return line
            self._pump()
        raise TimeoutError(f"no line with prefix {prefix!r} within {timeout}s; got:\n{self._buf}")

    def call(
        self,
        service: str,
        method: str,
        payload: dict[str, Any],
        request_id: str,
        timeout: float = 15.0,
    ) -> dict[str, Any]:
        """Send a JSON service command and return the response payload, matched on requestId (not arrival order)."""
        packet = {
            "requestId": request_id,
            "message": {"service": service, "method": method, "payload": payload},
        }
        self.send_line(_INPUT_PREFIX + json.dumps(packet))

        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise TimeoutError(f"no response to {request_id} within {timeout}s")
            raw = self.read_line_with_prefix(_RESPONSE_PREFIX, timeout=remaining)
            reply: dict[str, Any] = json.loads(raw)
            if reply.get("requestId") != request_id:
                continue
            message: dict[str, Any] = reply.get("message", {})
            if message.get("method", "").endswith("-error"):
                raise RuntimeError(f"{service}.{method} failed: {message.get('payload')}")
            result: dict[str, Any] = message.get("payload", {})
            return result

    def send_chunk(self, session: int, offset: int, data: bytes) -> None:
        self.send_bytes(build_binary_frame(session, offset, data))


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class Esp32QemuSimulator(Esp32Link):
    """Boot the firmware in QEMU with UART0 on a TCP socket (wait=on so the boot log is never missed); a context manager."""

    def __init__(self, port: int | None = None, build_dir: Path | None = None) -> None:
        super().__init__()
        self._build_dir = build_dir or (esp32_root() / DEFAULT_QEMU_BUILD_DIR)
        self._port = port or free_port()
        self._proc: subprocess.Popen[bytes] | None = None
        self._sock: socket.socket | None = None

    def _start(self) -> None:
        extra = f"-serial tcp:127.0.0.1:{self._port},server=on,wait=on"
        cmd = ["idf.py", "-B", str(self._build_dir), "qemu", f"--qemu-extra-args={extra}"]
        self._proc = subprocess.Popen(
            cmd,
            cwd=str(esp32_root()),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                self._sock = socket.create_connection(("127.0.0.1", self._port), timeout=2)
                break
            except OSError as exc:
                if self._proc.poll() is not None:
                    raise RuntimeError("idf.py qemu exited before serial was ready") from exc
                time.sleep(0.2)
        if self._sock is None:
            raise RuntimeError("could not connect to qemu serial")
        self._sock.settimeout(0.25)

    def close(self) -> None:
        if self._sock is not None:
            with contextlib.suppress(OSError):
                self._sock.close()
        if self._proc is not None:
            self._proc.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self._proc.wait(timeout=5)
            if self._proc.poll() is None:
                self._proc.kill()

    def _read_raw(self) -> bytes:
        assert self._sock is not None
        with contextlib.suppress(socket.timeout, OSError):
            return self._sock.recv(4096)
        return b""

    def _write_raw(self, data: bytes) -> None:
        assert self._sock is not None
        self._sock.sendall(data)


class Esp32SerialDevice(Esp32Link):
    """Drive a real ESP32 over USB serial; pulses DTR/RTS on open to reset (RTS->EN, DTR->GPIO0) for a fresh boot. A context manager."""

    def __init__(self, port: str | None = None, baud: int = 115200) -> None:
        super().__init__()
        self._port = port or serial_port()
        self._baud = baud
        self._ser: serial.Serial | None = None

    def _start(self) -> None:
        import serial  # lazy: not needed for the QEMU backend

        self._ser = serial.Serial()
        self._ser.port = self._port
        self._ser.baudrate = self._baud
        self._ser.timeout = 0.2
        # Don't assert reset lines until we choose to.
        self._ser.dtr = False
        self._ser.rts = False
        self._ser.open()
        self.reset()
        # Command input is only accepted once the serial transport binds UART0;
        # waiting on a service banner alone races the driver install.
        self.read_until("serial command transport started", timeout=20)

    def close(self) -> None:
        if self._ser is not None:
            with contextlib.suppress(Exception):
                self._ser.close()

    def reset(self) -> None:
        """Classic ESP32 reset into run mode: GPIO0 high, pulse EN low."""
        assert self._ser is not None
        self._ser.dtr = False  # GPIO0 high -> normal boot (not download mode)
        self._ser.rts = True  # EN low -> hold reset
        time.sleep(0.1)
        self._ser.reset_input_buffer()
        self._ser.rts = False  # release EN -> boot
        self._buf = ""

    def _read_raw(self) -> bytes:
        assert self._ser is not None
        with contextlib.suppress(Exception):
            n = self._ser.in_waiting
            return self._ser.read(n if n > 0 else 1)
        return b""

    def _write_raw(self, data: bytes) -> None:
        assert self._ser is not None
        self._ser.write(data)
        self._ser.flush()


class Esp32TcpLink(Esp32Link):
    """Attach to a QEMU UART already listening on a TCP socket (for host-side tools that run QEMU in the container)."""

    def __init__(self, port: int, host: str = "127.0.0.1", connect_timeout: float = 180.0) -> None:
        super().__init__()
        self._host = host
        self._port = port
        self._connect_timeout = connect_timeout
        self._sock: socket.socket | None = None

    def _start(self) -> None:
        deadline = time.time() + self._connect_timeout
        while time.time() < deadline:
            try:
                self._sock = socket.create_connection((self._host, self._port), timeout=2)
                break
            except OSError:
                time.sleep(0.2)
        if self._sock is None:
            raise RuntimeError(f"could not connect to qemu serial at {self._host}:{self._port}")
        self._sock.settimeout(0.05)

    def close(self) -> None:
        if self._sock is not None:
            with contextlib.suppress(OSError):
                self._sock.close()
            self._sock = None

    def _read_raw(self) -> bytes:
        assert self._sock is not None
        with contextlib.suppress(socket.timeout, OSError):
            return self._sock.recv(65536)
        return b""

    def _write_raw(self, data: bytes) -> None:
        assert self._sock is not None
        self._sock.sendall(data)


def open_esp32() -> Esp32Link:
    """Return the (un-entered) backend selected by HELIX_ESP32_TARGET."""
    if esp32_target() == "serial":
        return Esp32SerialDevice()
    return Esp32QemuSimulator()
