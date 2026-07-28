from __future__ import annotations

import json
import queue
import ssl
import threading
import time
from contextlib import contextmanager, suppress
from typing import Any

import paho.mqtt.client as mqtt
import websocket
from paho.mqtt.enums import CallbackAPIVersion


def gateway_base_url(stack) -> str:
    """The gateway WS endpoint without a query — external transport clients
    (e.g. the Android :helix MQTT transport) append their own deviceId."""
    return f"ws://127.0.0.1:{stack.appliance.config.public_http_port}/ws"


def ws_url(stack, device_id: str) -> str:
    return f"{gateway_base_url(stack)}?deviceId={device_id}"


def connect_ws(stack, device_id: str, *, timeout: float = 5.0) -> websocket.WebSocket:
    connection: websocket.WebSocket = websocket.create_connection(
        ws_url(stack, device_id), timeout=timeout
    )
    return connection


def ws_send(
    ws: websocket.WebSocket, message: dict[str, Any], *, request_id: str | None = None
) -> None:
    packet: dict[str, Any] = {"message": message}
    if request_id is not None:
        packet["requestId"] = request_id
    ws.send(json.dumps(packet))


def ws_recv(ws: websocket.WebSocket) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(ws.recv())
    return parsed


class DeviceSession:
    """A simulated device on the MQTT side of the gateway: subscribed to its
    command topic (/in) and able to publish responses/events (/out)."""

    def __init__(self, client: mqtt.Client, device_id: str) -> None:
        self._client = client
        self._device_id = device_id
        self._commands: queue.Queue[dict[str, Any]] = queue.Queue()

    def _on_command(self, payload: bytes) -> None:
        with suppress(ValueError):
            self._commands.put(json.loads(payload.decode("utf-8")))

    def wait_command(self, *, timeout: float = 5.0) -> dict[str, Any]:
        return self._commands.get(timeout=timeout)

    def publish_out(self, message: dict[str, Any], *, request_id: str | None = None) -> None:
        packet: dict[str, Any] = {"message": message}
        if request_id is not None:
            packet["requestId"] = request_id
        self._client.publish(f"helix/device/{self._device_id}/out", json.dumps(packet), qos=1)


@contextmanager
def device_session(stack, device):
    subscribed = threading.Event()
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}-devsim",
        protocol=mqtt.MQTTv311,
    )
    client.tls_set(
        ca_certs=str(device.root_path),
        certfile=str(device.chain_path),
        keyfile=str(device.key_path),
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    session = DeviceSession(client, device.device_id)
    client.on_message = lambda _c, _u, msg: session._on_command(msg.payload)
    client.on_subscribe = lambda *_: subscribed.set()
    client.connect("127.0.0.1", stack.appliance.config.mosquitto_device_port, keepalive=30)
    client.loop_start()
    client.subscribe(f"helix/device/{device.device_id}/in", qos=1)
    subscribed.wait(timeout=5)
    try:
        yield session
    finally:
        client.loop_stop()
        client.disconnect()


def settle(seconds: float = 0.4) -> None:
    """Give the gateway a moment to register a new WS client before publishing."""
    time.sleep(seconds)


GPIO_SERVICE = "gpio-control"


def _gpio_state(pin_levels: list[tuple[int, int]]) -> dict[str, Any]:
    return {
        "service": GPIO_SERVICE,
        "method": "gpio-control-state",
        "payload": {"pins": [{"pin": pin, "level": level} for pin, level in pin_levels]},
    }


class GpioDevice:
    """Records the set-gpio commands a client drove, so a test can assert the
    round-trip actually happened rather than trusting an exit code."""

    def __init__(self) -> None:
        self.set_commands: list[tuple[int, int]] = []


@contextmanager
def gpio_device_session(stack, device):
    """A simulated Helix gpio-control device on the broker: it auto-responds to
    set-gpio/read-gpio on /in with a gpio-control-state on /out, correlated by
    requestId — the cloud-side stand-in for the ESP32 gpio-control service. Any
    WS-gateway client (Python or the Android :helix transport) can drive it."""
    with device_session(stack, device) as session:
        gpio = GpioDevice()
        levels: dict[int, int] = {}
        stop = threading.Event()

        def serve() -> None:
            while not stop.is_set():
                try:
                    command = session.wait_command(timeout=0.25)
                except queue.Empty:
                    continue
                message = command.get("message") or {}
                if message.get("service") != GPIO_SERVICE:
                    continue
                request_id = command.get("requestId")
                payload = message.get("payload") or {}
                method = message.get("method")
                if method == "set-gpio":
                    pin = int(payload["pin"])
                    level = 1 if payload.get("high") else 0
                    levels[pin] = level
                    gpio.set_commands.append((pin, level))
                    session.publish_out(_gpio_state([(pin, level)]), request_id=request_id)
                elif method == "read-gpio":
                    requested = payload.get("pin")
                    pins = [int(requested)] if requested is not None else sorted(levels)
                    session.publish_out(
                        _gpio_state([(p, levels.get(p, 0)) for p in pins]), request_id=request_id
                    )

        worker = threading.Thread(target=serve, name=f"gpio-{device.device_id}", daemon=True)
        worker.start()
        try:
            yield gpio
        finally:
            stop.set()
            worker.join(timeout=2)
