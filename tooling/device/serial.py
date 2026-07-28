from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import click

from tooling.device.common import (
    compact_json,
    create_packet,
    echo_response,
    load_json_option,
    request_options,
    validate_response_packet,
)

DEFAULT_BAUDRATE = 115200
DEFAULT_PORT = "/dev/ttyUSB0"
SERIAL_INPUT_PREFIX = "SERVICE "
SERIAL_OUTPUT_PREFIX = "HELIX_RESPONSE "
SERIAL_ERROR_PREFIX = "HELIX_ERROR "


class SerialHelixClient:
    def __init__(
        self,
        port: str,
        baudrate: int,
        timeout: float,
        boot_wait: float,
        show_log: bool,
    ) -> None:
        try:
            import serial
        except ImportError as exc:
            raise click.ClickException(
                "pyserial is required for serial device commands: uv sync"
            ) from exc

        self._serial_module = serial
        self._port = port
        self._baudrate = baudrate
        self._timeout = timeout
        self._boot_wait = boot_wait
        self._show_log = show_log

    def request(self, service: str, method: str, payload: Any) -> dict[str, Any]:
        packet = create_packet(service, method, payload)
        request_id = packet["requestId"]
        line = f"{SERIAL_INPUT_PREFIX}{compact_json(packet)}\n".encode()

        try:
            with self._serial_module.Serial(
                self._port,
                self._baudrate,
                timeout=0.1,
                write_timeout=2,
            ) as handle:
                if self._boot_wait > 0:
                    time.sleep(self._boot_wait)
                    handle.reset_input_buffer()

                handle.write(line)
                handle.flush()

                deadline = time.monotonic() + self._timeout
                buffer = bytearray()
                while time.monotonic() < deadline:
                    chunk = handle.read(1024)
                    if not chunk:
                        continue
                    buffer.extend(chunk)
                    while b"\n" in buffer:
                        raw, _, rest = buffer.partition(b"\n")
                        buffer = bytearray(rest)
                        text = raw.decode("utf-8", "replace").strip()
                        if not text:
                            continue
                        response = self._process_line(text, request_id)
                        if response is not None:
                            return response
        except self._serial_module.SerialException as exc:
            raise click.ClickException(
                f"serial communication failed on {self._port}: {exc}"
            ) from exc

        raise click.ClickException(
            f"timed out waiting for serial response on {self._port} requestId={request_id}"
        )

    def _process_line(self, text: str, request_id: str) -> dict[str, Any] | None:
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
                click.echo(f"unmatched: {raw_packet}", err=True)
            return None
        return packet

    def _extract_packet_json(self, text: str) -> str | None:
        if text.startswith(SERIAL_OUTPUT_PREFIX):
            return text[len(SERIAL_OUTPUT_PREFIX) :].strip()

        # UART0 also carries ESP-IDF logs, so log writes can prefix or splice
        # serial responses. Recover the Helix packet by locating its JSON body.
        start = text.find('{"requestId":')
        if start < 0:
            return None
        candidate = text[start:].strip()
        try:
            _, end = json.JSONDecoder().raw_decode(candidate)
        except json.JSONDecodeError:
            return None
        return candidate[:end]


@click.group()
def serial() -> None:
    """Send Helix protocol requests over newline-framed serial."""


@serial.command("request")
@click.option("--port", default=DEFAULT_PORT, show_default=True)
@click.option("--baudrate", default=DEFAULT_BAUDRATE, show_default=True)
@click.option("--timeout", default=10.0, show_default=True, type=float)
@click.option("--boot-wait", default=0.0, show_default=True, type=float)
@click.option("--show-log", is_flag=True)
@request_options
def serial_request(
    port: str,
    baudrate: int,
    timeout: float,
    boot_wait: float,
    show_log: bool,
    service: str,
    method: str,
    payload_json: str,
    payload_file: Path | None,
) -> None:
    """Send one raw service/method request and print the matching response packet."""

    payload = load_json_option(payload_json, payload_file, "payload")
    packet = SerialHelixClient(port, baudrate, timeout, boot_wait, show_log).request(
        service=service,
        method=method,
        payload=payload,
    )
    echo_response(packet)
