from __future__ import annotations

import json
import ssl
import time
import urllib.request
from datetime import UTC, datetime
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

SERVICE = "telemetry"


def publish_event(stack, device, msg_id: str, payload: dict[str, Any]) -> None:
    """Publish a device event over mTLS using the provisioned certificate,
    exactly as a real device would."""
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}-{msg_id}",
        protocol=mqtt.MQTTv311,
    )
    client.tls_set(
        ca_certs=str(device.root_path),
        certfile=str(device.chain_path),
        keyfile=str(device.key_path),
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    client.connect("127.0.0.1", stack.appliance.config.mosquitto_device_port, keepalive=30)
    client.loop_start()
    try:
        topic = f"helix/device/{device.device_id}/service/{SERVICE}/event"
        envelope = {
            "type": "reading",
            "msgId": msg_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "payload": payload,
        }
        info = client.publish(topic, json.dumps(envelope), qos=1)
        info.wait_for_publish(timeout=10)
    finally:
        client.loop_stop()
        client.disconnect()


def post_device_events(
    stack,
    device,
    events: list[dict[str, Any]],
    *,
    body_device_id: str | None = None,
) -> dict[str, Any]:
    """POST device telemetry to the mTLS HTTP ingestion endpoint using the
    provisioned client certificate, exactly as a real device would. Returns the
    parsed JSON response; raises urllib.error.HTTPError on non-2xx."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.load_verify_locations(cafile=str(device.root_path))
    # The server cert carries the broker SANs (localhost/127.0.0.1) but we reach
    # it by loopback IP; verify the chain, skip hostname pinning (as MQTT does).
    ctx.check_hostname = False
    ctx.load_cert_chain(certfile=str(device.chain_path), keyfile=str(device.key_path))

    body: dict[str, Any] = {"events": events}
    if body_device_id is not None:
        body["deviceId"] = body_device_id
    url = f"https://127.0.0.1:{stack.appliance.config.device_mtls_port}/api/device/events"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, context=ctx, timeout=15) as response:  # noqa: S310
        parsed: dict[str, Any] = json.loads(response.read())
        return parsed


def wait_for_message(appliance, device_id: str, message_id: str, *, timeout: int = 30) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if appliance.has_event(device_id, message_id):
            return True
        time.sleep(1)
    return False
