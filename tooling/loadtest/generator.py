from __future__ import annotations

import json
import multiprocessing as mp
import os
import ssl
import time
from dataclasses import dataclass

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

SERVICE = "telemetry"


@dataclass(frozen=True)
class DeviceCert:
    device_id: str
    chain_path: str
    key_path: str
    root_path: str


@dataclass(frozen=True)
class LoadResult:
    emitted: int
    duration_s: float

    @property
    def emit_rate(self) -> float:
        return self.emitted / self.duration_s if self.duration_s > 0 else 0.0


def _connect(device: DeviceCert, host: str, port: int, suffix: str) -> mqtt.Client:
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}-lg-{suffix}",
        protocol=mqtt.MQTTv311,
    )
    client.tls_set(
        ca_certs=device.root_path,
        certfile=device.chain_path,
        keyfile=device.key_path,
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    # Keep a deep outbound queue so pacing, not paho, controls the rate.
    client.max_inflight_messages_set(1000)
    client.max_queued_messages_set(0)
    client.connect(host, port, keepalive=60)
    client.loop_start()
    return client


def _worker(
    host: str,
    port: int,
    devices: list[DeviceCert],
    rate: float,
    duration: float,
    payload_size: int,
    run_id: str,
    result_queue: mp.Queue[int],
) -> None:
    pid = os.getpid()
    clients = [_connect(device, host, port, str(pid)) for device in devices]
    pad = "x" * max(0, payload_size)
    interval = 1.0 / rate if rate > 0 else 0.0

    emitted = 0
    seq = 0
    start = time.monotonic()
    deadline = start + duration
    next_send = start
    count = len(clients)
    while time.monotonic() < deadline:
        device = devices[seq % count]
        client = clients[seq % count]
        envelope = {
            "type": "load",
            "msgId": f"{run_id}-{pid}-{seq}",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "payload": {"publishedAtNs": time.time_ns(), "seq": seq, "runId": run_id, "pad": pad},
        }
        topic = f"helix/device/{device.device_id}/service/{SERVICE}/event"
        client.publish(topic, json.dumps(envelope), qos=1)
        emitted += 1
        seq += 1
        next_send += interval
        sleep = next_send - time.monotonic()
        if sleep > 0:
            time.sleep(sleep)

    for client in clients:
        client.loop_stop()
        client.disconnect()
    result_queue.put(emitted)


def run_load(
    *,
    host: str,
    port: int,
    devices: list[DeviceCert],
    rate: float,
    duration: float,
    payload_size: int,
    run_id: str,
    workers: int,
) -> LoadResult:
    """Emit `rate` events/second (aggregate) for `duration` seconds across the
    device pool, split over `workers` processes so the generator scales past the
    subject-under-test."""
    workers = max(1, min(workers, len(devices)))
    device_shards: list[list[DeviceCert]] = [[] for _ in range(workers)]
    for index, device in enumerate(devices):
        device_shards[index % workers].append(device)

    result_queue: mp.Queue[int] = mp.Queue()
    per_worker_rate = rate / workers
    processes = [
        mp.Process(
            target=_worker,
            args=(host, port, shard, per_worker_rate, duration, payload_size, run_id, result_queue),
        )
        for shard in device_shards
        if shard
    ]

    started = time.monotonic()
    for process in processes:
        process.start()
    emitted = sum(result_queue.get() for _ in processes)
    for process in processes:
        process.join()
    return LoadResult(emitted=emitted, duration_s=time.monotonic() - started)
