from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click

from tooling.device.common import (
    compact_json,
    create_packet,
    echo_response,
    load_json_option,
    request_options,
    validate_response_packet,
)

if TYPE_CHECKING:
    from bleak.backends.characteristic import BleakGATTCharacteristic

HELIX_ESP32_BLE_NAME_PREFIX = "Helix ESP32"
HELIX_ESP32_BLE_SERVICE_UUID = "8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0001"
HELIX_ESP32_BLE_COMMAND_UUID = "8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0002"
HELIX_ESP32_BLE_RESPONSE_UUID = "8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0003"
HELIX_ESP32_BLE_INFO_UUID = "8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0004"


class BleHelixClient:
    def __init__(
        self,
        address: str,
        name_prefix: str,
        timeout: float,
        scan_timeout: float,
        show_log: bool,
    ) -> None:
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError as exc:
            raise click.ClickException(
                "bleak is required for BLE device commands: uv sync"
            ) from exc

        self._bleak_client = BleakClient
        self._bleak_scanner = BleakScanner
        self._address = address
        self._name_prefix = name_prefix
        self._timeout = timeout
        self._scan_timeout = scan_timeout
        self._show_log = show_log

    async def request(self, service: str, method: str, payload: Any) -> dict[str, Any]:
        device = await self._resolve_device()
        if device is None:
            target = self._address or f"name prefix {self._name_prefix!r}"
            raise click.ClickException(f"BLE device not found for {target}")

        packet = create_packet(service, method, payload)
        request_id = packet["requestId"]
        response = asyncio.get_running_loop().create_future()

        def handle_notification(_: BleakGATTCharacteristic, data: bytearray) -> None:
            text = bytes(data).decode("utf-8", "replace")
            try:
                candidate = validate_response_packet(json.loads(text))
            except json.JSONDecodeError:
                if self._show_log:
                    click.echo(f"ble invalid-json: {text}", err=True)
                return
            except click.ClickException as exc:
                if self._show_log:
                    click.echo(f"ble invalid-packet: {exc.message}", err=True)
                return
            if candidate.get("requestId") != request_id:
                if self._show_log:
                    click.echo(f"ble unmatched: {text}", err=True)
                return
            if not response.done():
                response.set_result(candidate)

        try:
            async with self._bleak_client(device, timeout=self._timeout) as client:
                if self._show_log:
                    await self._print_info(client)
                await client.start_notify(HELIX_ESP32_BLE_RESPONSE_UUID, handle_notification)
                try:
                    await client.write_gatt_char(
                        HELIX_ESP32_BLE_COMMAND_UUID,
                        compact_json(packet).encode("utf-8"),
                        response=False,
                    )
                    return await asyncio.wait_for(response, timeout=self._timeout)
                finally:
                    await client.stop_notify(HELIX_ESP32_BLE_RESPONSE_UUID)
        except TimeoutError as exc:
            raise click.ClickException(
                f"timed out waiting for BLE response requestId={request_id}"
            ) from exc
        except Exception as exc:
            raise click.ClickException(f"BLE communication failed: {exc}") from exc

    async def _resolve_device(self) -> Any:
        if self._address:
            return self._address
        devices = await self._bleak_scanner.discover(timeout=self._scan_timeout)
        for device in devices:
            name = getattr(device, "name", None) or ""
            if name.startswith(self._name_prefix):
                return device
        return None

    async def _print_info(self, client: Any) -> None:
        try:
            raw = await client.read_gatt_char(HELIX_ESP32_BLE_INFO_UUID)
        except Exception as exc:
            click.echo(f"ble info unavailable: {exc}", err=True)
            return
        click.echo(f"ble info: {bytes(raw).decode('utf-8', 'replace')}", err=True)


@click.group()
def ble() -> None:
    """Send Helix protocol requests over BLE."""


@ble.command("scan")
@click.option("--timeout", default=5.0, show_default=True, type=float)
@click.option("--name-prefix", default=HELIX_ESP32_BLE_NAME_PREFIX, show_default=True)
def ble_scan(timeout: float, name_prefix: str) -> None:
    """Scan for BLE devices, optionally filtering by name prefix."""

    async def run() -> None:
        try:
            from bleak import BleakScanner
        except ImportError as exc:
            raise click.ClickException(
                "bleak is required for BLE device commands: uv sync"
            ) from exc

        devices = await BleakScanner.discover(timeout=timeout)
        for device in devices:
            name = device.name or ""
            if name_prefix and not name.startswith(name_prefix):
                continue
            click.echo(json.dumps({"address": device.address, "name": name}, sort_keys=True))

    asyncio.run(run())


@ble.command("request")
@click.option(
    "--address", default="", help="BLE adapter address/id. If omitted, scan by name prefix."
)
@click.option("--name-prefix", default=HELIX_ESP32_BLE_NAME_PREFIX, show_default=True)
@click.option("--timeout", default=10.0, show_default=True, type=float)
@click.option("--scan-timeout", default=5.0, show_default=True, type=float)
@click.option("--show-log", is_flag=True)
@request_options
def ble_request(
    address: str,
    name_prefix: str,
    timeout: float,
    scan_timeout: float,
    show_log: bool,
    service: str,
    method: str,
    payload_json: str,
    payload_file: Path | None,
) -> None:
    """Send one raw service/method request over BLE and print the matching response packet."""

    payload = load_json_option(payload_json, payload_file, "payload")
    packet = asyncio.run(
        BleHelixClient(address, name_prefix, timeout, scan_timeout, show_log).request(
            service=service,
            method=method,
            payload=payload,
        )
    )
    echo_response(packet)
