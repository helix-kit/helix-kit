from __future__ import annotations

import json
import multiprocessing as mp
import os
import queue
import ssl
import threading
import time
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

import paho.mqtt.client as mqtt
import websocket
from paho.mqtt.enums import CallbackAPIVersion

from tooling.loadtest.generator import DeviceCert

COMMAND_SERVICE = "gateway-loadtest"
DRAIN_SECONDS = 3.0
SETTLE_SECONDS = 0.5


@dataclass(frozen=True)
class RoutingResult:
    """Outcome of a message-routing load run: WS client -> gateway -> device
    (/in) -> device echo (/out) -> gateway -> WS client round trips."""

    sent: int
    completed: int
    rtts_ms: list[float]

    @property
    def loss(self) -> int:
        return self.sent - self.completed


class _DeviceEcho:
    """A simulated device on the MQTT side: subscribes to its /in command topic
    and echoes each command back on /out (preserving requestId) after an optional
    think-time. Responses are published from a dedicated thread so the paho
    network loop is never blocked and the device processes commands serially."""

    def __init__(
        self, device: DeviceCert, host: str, port: int, suffix: str, think_ms: int
    ) -> None:
        self._device_id = device.device_id
        self._in_topic = f"helix/device/{device.device_id}/in"
        self._out_topic = f"helix/device/{device.device_id}/out"
        self._think_s = max(0, think_ms) / 1000.0
        self._inbox: queue.Queue[bytes | None] = queue.Queue()
        self._subscribed = threading.Event()
        client = mqtt.Client(
            CallbackAPIVersion.VERSION2,
            client_id=f"{device.device_id}-echo-{suffix}",
            protocol=mqtt.MQTTv311,
        )
        client.tls_set(
            ca_certs=device.root_path,
            certfile=device.chain_path,
            keyfile=device.key_path,
            cert_reqs=ssl.CERT_REQUIRED,
            tls_version=ssl.PROTOCOL_TLS_CLIENT,
        )
        client.max_inflight_messages_set(1000)
        client.max_queued_messages_set(0)
        client.on_message = lambda _c, _u, msg: self._inbox.put(msg.payload)
        client.on_subscribe = lambda *_: self._subscribed.set()
        self._client = client
        self._host = host
        self._port = port
        self._responder = threading.Thread(target=self._respond_loop, daemon=True)

    def start(self) -> None:
        self._client.connect(self._host, self._port, keepalive=60)
        self._client.loop_start()
        self._client.subscribe(self._in_topic, qos=1)
        self._subscribed.wait(timeout=10)
        self._responder.start()

    def _respond_loop(self) -> None:
        while True:
            payload = self._inbox.get()
            if payload is None:
                return
            try:
                packet = json.loads(payload.decode("utf-8"))
            except ValueError:
                continue
            if self._think_s > 0:
                time.sleep(self._think_s)
            response: dict[str, Any] = {"message": {"service": COMMAND_SERVICE, "method": "ack"}}
            request_id = packet.get("requestId")
            if request_id is not None:
                response["requestId"] = request_id
            self._client.publish(self._out_topic, json.dumps(response), qos=1)

    def stop(self) -> None:
        self._inbox.put(None)
        self._client.loop_stop()
        self._client.disconnect()


class _RoutingClient:
    """A cloud-side WS client bound to one device: sends commands and correlates
    responses back to their send time by requestId."""

    def __init__(self, ws: websocket.WebSocket, device_id: str) -> None:
        self.ws = ws
        self.device_id = device_id
        self.pending: dict[str, int] = {}
        self.lock = threading.Lock()
        self.rtts_ms: list[float] = []
        self.completed = 0

    def record_send(self, request_id: str, sent_ns: int) -> None:
        with self.lock:
            self.pending[request_id] = sent_ns

    def receive_loop(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                raw = self.ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                return
            if not raw:
                return
            try:
                packet = json.loads(raw)
            except ValueError:
                continue
            request_id = packet.get("requestId")
            now = time.time_ns()
            with self.lock:
                sent_ns = self.pending.pop(request_id, None)
            if sent_ns is not None:
                self.rtts_ms.append((now - sent_ns) / 1e6)
                self.completed += 1


def _worker(
    host: str,
    mqtt_port: int,
    ws_port: int,
    devices: list[DeviceCert],
    rate: float,
    duration: float,
    think_ms: int,
    run_id: str,
    result_queue: mp.Queue[tuple[int, int, list[float]]],
) -> None:
    suffix = str(os.getpid())
    echoes = [_DeviceEcho(d, host, mqtt_port, suffix, think_ms) for d in devices]
    for echo in echoes:
        echo.start()

    clients = [
        _RoutingClient(
            websocket.create_connection(
                f"ws://{host}:{ws_port}/ws?deviceId={d.device_id}", timeout=10
            ),
            d.device_id,
        )
        for d in devices
    ]
    # Let the gateway register the WS clients before commands start flowing.
    time.sleep(SETTLE_SECONDS)

    stop = threading.Event()
    receivers = [
        threading.Thread(target=client.receive_loop, args=(stop,), daemon=True)
        for client in clients
    ]
    for receiver in receivers:
        receiver.start()

    interval = 1.0 / rate if rate > 0 else 0.0
    sent = 0
    seq = 0
    count = len(clients)
    start = time.monotonic()
    deadline = start + duration
    next_send = start
    while time.monotonic() < deadline:
        client = clients[seq % count]
        request_id = f"{run_id}-{suffix}-{seq}"
        packet = {
            "message": {"service": COMMAND_SERVICE, "method": "ping", "payload": {"seq": seq}},
            "requestId": request_id,
        }
        client.record_send(request_id, time.time_ns())
        try:
            client.ws.send(json.dumps(packet))
            sent += 1
        except Exception:
            with client.lock:
                client.pending.pop(request_id, None)
        seq += 1
        next_send += interval
        sleep = next_send - time.monotonic()
        if sleep > 0:
            time.sleep(sleep)

    # Let in-flight round trips complete before tearing the receivers down.
    time.sleep(DRAIN_SECONDS + think_ms / 1000.0)
    stop.set()
    for client in clients:
        with suppress(Exception):
            client.ws.close()
    for echo in echoes:
        echo.stop()

    completed = sum(client.completed for client in clients)
    rtts = [rtt for client in clients for rtt in client.rtts_ms]
    result_queue.put((sent, completed, rtts))


def run_routing_load(
    *,
    host: str,
    mqtt_port: int,
    ws_port: int,
    devices: list[DeviceCert],
    rate: float,
    duration: float,
    run_id: str,
    workers: int,
    think_ms: int = 0,
) -> RoutingResult:
    """Drive `rate` command/response round trips per second (aggregate) for
    `duration` seconds across the device pool, split over `workers` processes."""
    workers = max(1, min(workers, len(devices)))
    shards: list[list[DeviceCert]] = [[] for _ in range(workers)]
    for index, device in enumerate(devices):
        shards[index % workers].append(device)

    result_queue: mp.Queue[tuple[int, int, list[float]]] = mp.Queue()
    per_worker_rate = rate / workers
    processes = [
        mp.Process(
            target=_worker,
            args=(
                host,
                mqtt_port,
                ws_port,
                shard,
                per_worker_rate,
                duration,
                think_ms,
                run_id,
                result_queue,
            ),
        )
        for shard in shards
        if shard
    ]

    for process in processes:
        process.start()
    results = [result_queue.get() for _ in processes]
    for process in processes:
        process.join()

    sent = sum(item[0] for item in results)
    completed = sum(item[1] for item in results)
    rtts = [rtt for item in results for rtt in item[2]]
    return RoutingResult(sent=sent, completed=completed, rtts_ms=rtts)
