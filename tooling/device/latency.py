from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import statistics
import struct
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import click

from tooling.device.ble import (
    HELIX_ESP32_BLE_COMMAND_UUID,
    HELIX_ESP32_BLE_NAME_PREFIX,
    HELIX_ESP32_BLE_RESPONSE_UUID,
)
from tooling.device.common import compact_json, create_packet, validate_response_packet
from tooling.device.serial import (
    DEFAULT_BAUDRATE,
    DEFAULT_PORT,
    SERIAL_ERROR_PREFIX,
    SERIAL_INPUT_PREFIX,
    SERIAL_OUTPUT_PREFIX,
)

if TYPE_CHECKING:
    from bleak.backends.characteristic import BleakGATTCharacteristic


@dataclass(frozen=True)
class LatencySample:
    index: int
    milliseconds: float


def _default_payload(pin: int) -> dict[str, int]:
    return {"pin": pin}


def _print_summary(name: str, samples: list[LatencySample]) -> None:
    values = [sample.milliseconds for sample in samples]
    click.echo(
        json.dumps(
            {
                "transport": name,
                "count": len(values),
                "averageMs": round(statistics.fmean(values), 3),
                "medianMs": round(statistics.median(values), 3),
                "minMs": round(min(values), 3),
                "maxMs": round(max(values), 3),
                "stdevMs": round(statistics.stdev(values), 3) if len(values) > 1 else 0.0,
            },
            sort_keys=True,
        )
    )


class SerialLatencyClient:
    def __init__(self, port: str, baudrate: int, timeout: float, show_log: bool) -> None:
        try:
            import serial
        except ImportError as exc:
            raise click.ClickException(
                "pyserial is required for serial device commands: uv sync"
            ) from exc

        self._serial = serial
        self._port = port
        self._baudrate = baudrate
        self._timeout = timeout
        self._show_log = show_log
        self._handle: Any = None
        self._buffer = bytearray()

    def __enter__(self) -> SerialLatencyClient:
        self._handle = self._serial.Serial(
            self._port,
            self._baudrate,
            timeout=0.005,
            write_timeout=2,
        )
        self._handle.reset_input_buffer()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None

    def request(self, service: str, method: str, payload: Any) -> dict[str, Any]:
        if self._handle is None:
            raise click.ClickException("serial client is not open")

        packet = create_packet(service, method, payload)
        request_id = packet["requestId"]
        line = f"{SERIAL_INPUT_PREFIX}{compact_json(packet)}\n".encode()
        self._handle.write(line)
        self._handle.flush()

        deadline = time.monotonic() + self._timeout
        while time.monotonic() < deadline:
            waiting = getattr(self._handle, "in_waiting", 0)
            chunk = self._handle.read(waiting or 1)
            if not chunk:
                continue
            self._buffer.extend(chunk)
            while b"\n" in self._buffer:
                raw, _, rest = self._buffer.partition(b"\n")
                self._buffer = bytearray(rest)
                response = self._process_line(raw.decode("utf-8", "replace").strip(), request_id)
                if response is not None:
                    return response

        raise click.ClickException(
            f"timed out waiting for serial response on {self._port} requestId={request_id}"
        )

    def _process_line(self, text: str, request_id: str) -> dict[str, Any] | None:
        if not text:
            return None
        if text.startswith(SERIAL_ERROR_PREFIX):
            raise click.ClickException(text)

        raw_packet = self._extract_packet_json(text)
        if raw_packet is None:
            if self._show_log:
                click.echo(f"device: {text}", err=True)
            return None

        try:
            packet = validate_response_packet(json.loads(raw_packet))
        except json.JSONDecodeError as exc:
            raise click.ClickException(f"device returned invalid Helix JSON: {exc}") from exc

        if packet.get("requestId") != request_id:
            if self._show_log:
                click.echo(f"serial unmatched: {raw_packet}", err=True)
            return None
        return packet

    def _extract_packet_json(self, text: str) -> str | None:
        if text.startswith(SERIAL_OUTPUT_PREFIX):
            return text[len(SERIAL_OUTPUT_PREFIX) :].strip()

        start = text.find('{"requestId":')
        if start < 0:
            return None
        candidate = text[start:].strip()
        try:
            _, end = json.JSONDecoder().raw_decode(candidate)
        except json.JSONDecodeError:
            return None
        return candidate[:end]


class WebSocketLatencyClient:
    def __init__(self, host: str, port: int, path: str, timeout: float) -> None:
        self._host = host
        self._port = port
        self._path = path
        self._timeout = timeout
        self._socket: socket.socket | None = None

    def __enter__(self) -> WebSocketLatencyClient:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {self._path} HTTP/1.1\r\n"
            f"Host: {self._host}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self._socket = socket.create_connection((self._host, self._port), timeout=self._timeout)
        self._socket.settimeout(self._timeout)
        self._socket.sendall(request.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            response += self._socket.recv(4096)
        status = response.decode("utf-8", "replace").split("\r\n", 1)[0]
        if " 101 " not in status:
            raise click.ClickException(f"WebSocket upgrade failed: {status}")
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None

    def request(self, service: str, method: str, payload: Any) -> dict[str, Any]:
        if self._socket is None:
            raise click.ClickException("WebSocket client is not open")

        packet = create_packet(service, method, payload)
        request_id = packet["requestId"]
        self._send_text(compact_json(packet).encode("utf-8"))
        while True:
            opcode, data = self._recv_frame()
            if opcode == 1:
                candidate = validate_response_packet(json.loads(data.decode("utf-8")))
                if candidate.get("requestId") == request_id:
                    return candidate
            if opcode == 8:
                raise click.ClickException("WebSocket server closed the connection")

    def _send_text(self, data: bytes) -> None:
        if self._socket is None:
            raise click.ClickException("WebSocket client is not open")

        header = bytearray([0x81])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        header.extend(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self._socket.sendall(header)

    def _recv_frame(self) -> tuple[int, bytes]:
        first, second = self._recv_exact(2)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        data = self._recv_exact(length)
        if masked:
            data = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        return opcode, data

    def _recv_exact(self, length: int) -> bytes:
        if self._socket is None:
            raise click.ClickException("WebSocket client is not open")

        data = b""
        while len(data) < length:
            chunk = self._socket.recv(length - len(data))
            if not chunk:
                raise click.ClickException("WebSocket connection closed")
            data += chunk
        return data


class BleLatencyClient:
    def __init__(
        self,
        address: str,
        name_prefix: str,
        timeout: float,
        scan_timeout: float,
        show_log: bool,
    ) -> None:
        self._address = address
        self._name_prefix = name_prefix
        self._timeout = timeout
        self._scan_timeout = scan_timeout
        self._show_log = show_log

    async def run_samples(
        self,
        count: int,
        delay: float,
        service: str,
        method: str,
        payload: Any,
    ) -> list[LatencySample]:
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError as exc:
            raise click.ClickException("bleak is required for BLE latency tests: uv sync") from exc

        device: Any = self._address
        if not device:
            devices = await BleakScanner.discover(timeout=self._scan_timeout)
            for candidate in devices:
                name = getattr(candidate, "name", None) or ""
                if name.startswith(self._name_prefix):
                    device = candidate
                    break
        if not device:
            raise click.ClickException(
                f"BLE device not found for name prefix {self._name_prefix!r}"
            )

        pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

        def handle_notification(_: BleakGATTCharacteristic, data: bytearray) -> None:
            text = bytes(data).decode("utf-8", "replace")
            try:
                packet = validate_response_packet(json.loads(text))
            except Exception as exc:
                if self._show_log:
                    click.echo(f"ble ignored: {text} ({exc})", err=True)
                return
            request_id = packet.get("requestId")
            if not isinstance(request_id, str):
                return
            future = pending.get(request_id)
            if future is not None and not future.done():
                future.set_result(packet)

        samples: list[LatencySample] = []
        async with BleakClient(device, timeout=self._timeout) as client:
            await client.start_notify(HELIX_ESP32_BLE_RESPONSE_UUID, handle_notification)
            try:
                for index in range(1, count + 1):
                    packet = create_packet(service, method, payload)
                    request_id = packet["requestId"]
                    pending[request_id] = asyncio.get_running_loop().create_future()
                    start = time.perf_counter()
                    await client.write_gatt_char(
                        HELIX_ESP32_BLE_COMMAND_UUID,
                        compact_json(packet).encode("utf-8"),
                        response=False,
                    )
                    await asyncio.wait_for(pending[request_id], timeout=self._timeout)
                    elapsed = (time.perf_counter() - start) * 1000
                    samples.append(LatencySample(index=index, milliseconds=elapsed))
                    click.echo(f"ble sample {index}/{count}: {elapsed:.3f} ms")
                    pending.pop(request_id, None)
                    if delay > 0:
                        await asyncio.sleep(delay)
            finally:
                await client.stop_notify(HELIX_ESP32_BLE_RESPONSE_UUID)
        return samples


def _run_sync_samples(
    name: str,
    count: int,
    delay: float,
    service: str,
    method: str,
    payload: Any,
    client: Any,
) -> list[LatencySample]:
    samples: list[LatencySample] = []
    for index in range(1, count + 1):
        start = time.perf_counter()
        client.request(service, method, payload)
        elapsed = (time.perf_counter() - start) * 1000
        samples.append(LatencySample(index=index, milliseconds=elapsed))
        click.echo(f"{name} sample {index}/{count}: {elapsed:.3f} ms")
        if delay > 0:
            time.sleep(delay)
    return samples


@click.command("latency")
@click.option(
    "--transport",
    "transports",
    multiple=True,
    type=click.Choice(["serial", "ble", "websocket"]),
    help="Transport to test. Repeat to choose multiple. Defaults to all three.",
)
@click.option("--count", default=20, show_default=True, type=click.IntRange(min=1))
@click.option("--delay", default=0.05, show_default=True, type=float)
@click.option("--service", default="gpio-control", show_default=True)
@click.option("--method", default="read-gpio", show_default=True)
@click.option("--pin", default=2, show_default=True, type=int)
@click.option("--serial-port", default=DEFAULT_PORT, show_default=True)
@click.option("--serial-baudrate", default=DEFAULT_BAUDRATE, show_default=True)
@click.option(
    "--ble-address", default="", help="BLE adapter address/id. If omitted, scan by name prefix."
)
@click.option("--ble-name-prefix", default=HELIX_ESP32_BLE_NAME_PREFIX, show_default=True)
@click.option("--ble-scan-timeout", default=5.0, show_default=True, type=float)
@click.option("--websocket-host", default="192.168.1.39", show_default=True)
@click.option("--websocket-port", default=80, show_default=True, type=int)
@click.option("--websocket-path", default="/helix", show_default=True)
@click.option("--timeout", default=10.0, show_default=True, type=float)
@click.option("--show-log", is_flag=True)
def latency(
    transports: tuple[str, ...],
    count: int,
    delay: float,
    service: str,
    method: str,
    pin: int,
    serial_port: str,
    serial_baudrate: int,
    ble_address: str,
    ble_name_prefix: str,
    ble_scan_timeout: float,
    websocket_host: str,
    websocket_port: int,
    websocket_path: str,
    timeout: float,
    show_log: bool,
) -> None:
    """Measure sequential Helix request/response latency across device transports."""

    selected = list(transports or ("serial", "ble", "websocket"))
    payload = _default_payload(pin)
    summaries: dict[str, list[LatencySample]] = {}

    for name in selected:
        click.echo(f"\n{name}: starting {count} sequential request(s)")
        if name == "serial":
            with SerialLatencyClient(serial_port, serial_baudrate, timeout, show_log) as client:
                summaries[name] = _run_sync_samples(
                    name, count, delay, service, method, payload, client
                )
        elif name == "websocket":
            with WebSocketLatencyClient(
                websocket_host, websocket_port, websocket_path, timeout
            ) as client:
                summaries[name] = _run_sync_samples(
                    name, count, delay, service, method, payload, client
                )
        elif name == "ble":
            summaries[name] = asyncio.run(
                BleLatencyClient(
                    ble_address, ble_name_prefix, timeout, ble_scan_timeout, show_log
                ).run_samples(count, delay, service, method, payload)
            )
        _print_summary(name, summaries[name])

    click.echo("\nsummary:")
    for name in selected:
        _print_summary(name, summaries[name])
