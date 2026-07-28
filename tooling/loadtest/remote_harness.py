#!/usr/bin/env python3
"""Remote load-test harness for an already-running Helix appliance over the network."""

from __future__ import annotations

import argparse
import contextlib
import http.client
import json
import multiprocessing as mp
import os
import ssl
import threading
import time
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

SERVICE = "telemetry"


@dataclass(frozen=True)
class DeviceCert:
    device_id: str
    chain_path: str
    key_path: str
    root_path: str


def load_devices(certs_dir: str) -> list[DeviceCert]:
    """Load the cert pool provisioned by provision_remote.py (manifest.json)."""
    manifest = json.loads((Path(certs_dir) / "manifest.json").read_text())
    devices: list[DeviceCert] = []
    for entry in manifest["devices"]:
        devices.append(
            DeviceCert(
                device_id=entry["device_id"],
                chain_path=str(Path(certs_dir) / entry["chain"]),
                key_path=str(Path(certs_dir) / entry["key"]),
                root_path=str(Path(certs_dir) / entry["root"]),
            )
        )
    return devices


def percentiles(values: list[float]) -> dict[str, float]:
    if not values:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    ordered = sorted(values)

    def pct(p: float) -> float:
        idx = min(len(ordered) - 1, int(p * len(ordered)))
        return ordered[idx]

    return {
        "p50": pct(0.50),
        "p95": pct(0.95),
        "p99": pct(0.99),
        "max": ordered[-1],
    }


def _mtls_context(device: DeviceCert) -> ssl.SSLContext:
    # Skip server-name checks: we connect by IP, but the server still does the full handshake.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.load_cert_chain(certfile=device.chain_path, keyfile=device.key_path)
    return ctx


def _mqtt_connect(device: DeviceCert, host: str, port: int, suffix: str) -> mqtt.Client:
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
    client.tls_insecure_set(True)  # connect by IP; server CN differs
    client.max_inflight_messages_set(1000)
    client.max_queued_messages_set(0)
    client.connect(host, port, keepalive=60)
    client.loop_start()
    return client


def _mqtt_worker(
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
    clients = [_mqtt_connect(d, host, port, str(pid)) for d in devices]
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


def run_mqtt(args: argparse.Namespace) -> dict[str, Any]:
    devices = load_devices(args.certs)[: args.devices]
    workers = max(1, min(args.workers, len(devices)))
    shards: list[list[DeviceCert]] = [[] for _ in range(workers)]
    for i, d in enumerate(devices):
        shards[i % workers].append(d)
    result_queue: mp.Queue[int] = mp.Queue()
    per_worker = args.rate / workers
    procs = [
        mp.Process(
            target=_mqtt_worker,
            args=(
                args.host,
                args.port,
                s,
                per_worker,
                args.duration,
                args.payload,
                args.run_id,
                result_queue,
            ),
        )
        for s in shards
        if s
    ]
    start = time.monotonic()
    for p in procs:
        p.start()
    emitted = sum(result_queue.get() for _ in procs)
    for p in procs:
        p.join()
    elapsed = time.monotonic() - start
    return {
        "surface": "mqtt",
        "target_rate": args.rate,
        "emitted": emitted,
        "duration_s": round(elapsed, 2),
        "emit_rate": round(emitted / elapsed, 1),
    }


@dataclass
class HttpStats:
    ok: int = 0
    err: int = 0
    accepted: int = 0
    latencies: list[float] = field(default_factory=list)


def _https_worker(
    host: str,
    port: int,
    device: DeviceCert,
    rate: float,
    duration: float,
    batch: int,
    run_id: str,
    stats: HttpStats,
    lock: threading.Lock,
) -> None:
    ctx = _mtls_context(device)
    conn = http.client.HTTPSConnection(host, port, context=ctx, timeout=30)
    interval = batch / rate if rate > 0 else 0.0
    start = time.monotonic()
    deadline = start + duration
    next_send = start
    seq = 0
    local = HttpStats()
    while time.monotonic() < deadline:
        events = [
            {
                "type": "load",
                "msgId": f"{run_id}-{device.device_id}-{seq}-{j}",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "payload": {"publishedAtNs": time.time_ns(), "seq": seq, "j": j},
            }
            for j in range(batch)
        ]
        body = json.dumps({"deviceId": device.device_id, "events": events})
        t0 = time.monotonic()
        try:
            conn.request("POST", "/api/device/events", body, {"Content-Type": "application/json"})
            resp = conn.getresponse()
            data = resp.read()
            if resp.status == 200:
                local.ok += 1
                local.accepted += json.loads(data).get("accepted", 0)
            else:
                local.err += 1
        except Exception:
            local.err += 1
            with contextlib.suppress(Exception):
                conn.close()
            conn = http.client.HTTPSConnection(host, port, context=ctx, timeout=30)
        local.latencies.append((time.monotonic() - t0) * 1000.0)
        seq += 1
        next_send += interval
        sleep = next_send - time.monotonic()
        if sleep > 0:
            time.sleep(sleep)
    with contextlib.suppress(Exception):
        conn.close()
    with lock:
        stats.ok += local.ok
        stats.err += local.err
        stats.accepted += local.accepted
        stats.latencies.extend(local.latencies)


def run_https(args: argparse.Namespace) -> dict[str, Any]:
    devices = load_devices(args.certs)[: args.devices]
    workers = max(1, min(args.workers, len(devices)))
    stats = HttpStats()
    lock = threading.Lock()
    per_worker = args.rate / workers
    threads = [
        threading.Thread(
            target=_https_worker,
            args=(
                args.host,
                args.port,
                devices[i % len(devices)],
                per_worker,
                args.duration,
                args.batch,
                args.run_id,
                stats,
                lock,
            ),
        )
        for i in range(workers)
    ]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.monotonic() - start
    pct = percentiles(stats.latencies)
    return {
        "surface": "https",
        "target_rate": args.rate,
        "requests_ok": stats.ok,
        "requests_err": stats.err,
        "events_accepted": stats.accepted,
        "duration_s": round(elapsed, 2),
        "accept_rate": round(stats.accepted / elapsed, 1),
        "req_latency_ms": {k: round(v, 1) for k, v in pct.items()},
    }


def _api_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _api_signin(sni: str, email: str, password: str) -> str:
    # Connect by SNI hostname (mapped to the appliance IP via /etc/hosts) so SNI+Host+origin match.
    ctx = _api_context()
    conn = http.client.HTTPSConnection(sni, 443, context=ctx, timeout=30)
    body = json.dumps({"email": email, "password": password})
    conn.request(
        "POST",
        "/api/auth/sign-in/email",
        body,
        {"Content-Type": "application/json", "Origin": f"https://{sni}", "Host": sni},
    )
    resp = conn.getresponse()
    raw = resp.read()
    if resp.status != 200:
        raise RuntimeError(f"sign-in failed: {resp.status} {raw[:200]!r}")
    cookies = []
    for header, value in resp.getheaders():
        if header.lower() == "set-cookie":
            cookies.append(value.split(";", 1)[0])
    conn.close()
    if not cookies:
        raise RuntimeError("sign-in returned no cookies")
    return "; ".join(cookies)


@dataclass
class ApiStats:
    reads_ok: int = 0
    writes_ok: int = 0
    err: int = 0
    latencies: list[float] = field(default_factory=list)


_LIST_INPUT = urllib.parse.quote(
    json.dumps(
        {
            "0": {
                "json": {
                    "page": 1,
                    "perPage": 20,
                    "name": "",
                    "status": [],
                    "sort": [{"id": "createdAt", "desc": True}],
                }
            }
        }
    )
)


def _api_worker(
    sni: str,
    cookie: str,
    duration: float,
    write_ratio: float,
    worker_id: int,
    stats: ApiStats,
    lock: threading.Lock,
) -> None:
    ctx = _api_context()
    conn = http.client.HTTPSConnection(sni, 443, context=ctx, timeout=30)
    headers = {"Cookie": cookie, "Host": sni, "Origin": f"https://{sni}"}
    local = ApiStats()
    start = time.monotonic()
    deadline = start + duration
    i = 0
    while time.monotonic() < deadline:
        do_write = (i % max(1, int(1 / write_ratio))) == 0 if write_ratio > 0 else False
        t0 = time.monotonic()
        try:
            if do_write:
                body = json.dumps({"0": {"json": {"name": f"lt-w{worker_id}-{i}"}}})
                conn.request(
                    "POST",
                    "/api/trpc/devices.create?batch=1",
                    body,
                    {**headers, "Content-Type": "application/json"},
                )
                resp = conn.getresponse()
                resp.read()
                if resp.status == 200:
                    local.writes_ok += 1
                else:
                    local.err += 1
            else:
                conn.request(
                    "GET", f"/api/trpc/devices.list?batch=1&input={_LIST_INPUT}", None, headers
                )
                resp = conn.getresponse()
                resp.read()
                if resp.status == 200:
                    local.reads_ok += 1
                else:
                    local.err += 1
        except Exception:
            local.err += 1
            with contextlib.suppress(Exception):
                conn.close()
            conn = http.client.HTTPSConnection(sni, 443, context=ctx, timeout=30)
        local.latencies.append((time.monotonic() - t0) * 1000.0)
        i += 1
    with contextlib.suppress(Exception):
        conn.close()
    with lock:
        stats.reads_ok += local.reads_ok
        stats.writes_ok += local.writes_ok
        stats.err += local.err
        stats.latencies.extend(local.latencies)


def run_api(args: argparse.Namespace) -> dict[str, Any]:
    cookie = _api_signin(args.sni, args.email, args.password)
    stats = ApiStats()
    lock = threading.Lock()
    threads = [
        threading.Thread(
            target=_api_worker,
            args=(args.sni, cookie, args.duration, args.write_ratio, w, stats, lock),
        )
        for w in range(args.concurrency)
    ]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.monotonic() - start
    total = stats.reads_ok + stats.writes_ok
    pct = percentiles(stats.latencies)
    return {
        "surface": "api",
        "concurrency": args.concurrency,
        "reads_ok": stats.reads_ok,
        "writes_ok": stats.writes_ok,
        "err": stats.err,
        "duration_s": round(elapsed, 2),
        "req_rate": round(total / elapsed, 1),
        "latency_ms": {k: round(v, 1) for k, v in pct.items()},
    }


def run_combined(args: argparse.Namespace) -> dict[str, Any]:
    results: dict[str, dict[str, Any]] = {}
    rlock = threading.Lock()

    def runner(
        name: str, fn: Callable[[argparse.Namespace], dict[str, Any]], sub: argparse.Namespace
    ) -> None:
        res = fn(sub)
        with rlock:
            results[name] = res

    def sub(**over: Any) -> argparse.Namespace:
        d = vars(args).copy()
        d.update(over)
        return argparse.Namespace(**d)

    threads = [
        threading.Thread(
            target=runner,
            args=(
                "mqtt",
                run_mqtt,
                sub(
                    host=args.mqtt_host,
                    port=8883,
                    rate=args.mqtt_rate,
                    workers=args.mqtt_workers,
                    devices=args.devices,
                    payload=args.payload,
                ),
            ),
        ),
        threading.Thread(
            target=runner,
            args=(
                "https",
                run_https,
                sub(
                    host=args.mqtt_host,
                    port=4001,
                    rate=args.https_rate,
                    workers=args.https_workers,
                    devices=args.devices,
                    batch=args.batch,
                ),
            ),
        ),
        threading.Thread(
            target=runner,
            args=(
                "api",
                run_api,
                sub(
                    host=args.mqtt_host,
                    sni=args.sni,
                    concurrency=args.api_concurrency,
                    write_ratio=args.write_ratio,
                ),
            ),
        ),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return {"surface": "combined", "results": results}


def main() -> None:
    p = argparse.ArgumentParser(description="Remote Helix appliance load-test harness")
    p.add_argument("--run-id", default=f"rh{int(time.time())}")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mqtt")
    m.add_argument("--host", required=True)
    m.add_argument("--port", type=int, default=8883)
    m.add_argument("--certs", required=True)
    m.add_argument("--rate", type=float, default=500)
    m.add_argument("--duration", type=float, default=30)
    m.add_argument("--workers", type=int, default=8)
    m.add_argument("--devices", type=int, default=50)
    m.add_argument("--payload", type=int, default=200)
    m.set_defaults(fn=run_mqtt)

    h = sub.add_parser("https")
    h.add_argument("--host", required=True)
    h.add_argument("--port", type=int, default=4001)
    h.add_argument("--certs", required=True)
    h.add_argument("--rate", type=float, default=500)
    h.add_argument("--duration", type=float, default=30)
    h.add_argument("--workers", type=int, default=16)
    h.add_argument("--devices", type=int, default=50)
    h.add_argument("--batch", type=int, default=10)
    h.set_defaults(fn=run_https)

    a = sub.add_parser("api")
    a.add_argument(
        "--sni",
        required=True,
        help="TLS SNI / Host (nip.io name mapped to the appliance IP via /etc/hosts)",
    )
    a.add_argument("--email", required=True)
    a.add_argument("--password", required=True)
    a.add_argument("--duration", type=float, default=30)
    a.add_argument("--concurrency", type=int, default=20)
    a.add_argument("--write-ratio", type=float, default=0.2)
    a.set_defaults(fn=run_api)

    c = sub.add_parser("combined")
    c.add_argument("--mqtt-host", required=True, help="appliance IP for mqtt+https")
    c.add_argument("--sni", required=True)
    c.add_argument("--certs", required=True)
    c.add_argument("--email", required=True)
    c.add_argument("--password", required=True)
    c.add_argument("--duration", type=float, default=60)
    c.add_argument("--devices", type=int, default=50)
    c.add_argument("--payload", type=int, default=200)
    c.add_argument("--batch", type=int, default=10)
    c.add_argument("--mqtt-rate", type=float, default=300)
    c.add_argument("--mqtt-workers", type=int, default=8)
    c.add_argument("--https-rate", type=float, default=200)
    c.add_argument("--https-workers", type=int, default=16)
    c.add_argument("--api-concurrency", type=int, default=10)
    c.add_argument("--write-ratio", type=float, default=0.2)
    c.set_defaults(fn=run_combined)

    args = p.parse_args()
    result = args.fn(args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
