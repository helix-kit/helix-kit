from __future__ import annotations

import hashlib
import json
import ssl
import time
import urllib.error
import urllib.request

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from tooling.release.sim import (
    ESP32_TYPE_SEED_SQL,
    ReleaseClient,
    make_ci_token_sql,
    seed_profile_for_device_sql,
    synth_esp32_artifacts,
)

TYPE_KEY = "esp32-firmware"
RELEASE_NAME = "helix-esp32-default"
CHANNEL = "stable"
SELECTOR = {"chip": "esp32", "flashSize": "4MB"}
CONFIG_V1 = {"apps": ["gpio_control"], "features": [], "chip": "esp32", "flashSize": "4MB"}
CONFIG_CUSTOM = {
    "apps": ["gpio_control"],
    "features": ["no-ble"],
    "chip": "esp32",
    "flashSize": "4MB",
}


def _count(stack, sql: str) -> int:
    return int(stack.appliance.psql(sql).stdout.strip() or "0")


def _download_via_session(stack, device, path: str) -> str:
    """POST the device's mTLS download-session for `path`; return the signed GET url."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.load_verify_locations(cafile=str(device.root_path))
    ctx.check_hostname = False
    ctx.load_cert_chain(certfile=str(device.chain_path), keyfile=str(device.key_path))
    url = f"https://127.0.0.1:{stack.appliance.config.device_mtls_port}/api/storage/packages/download-session"
    request = urllib.request.Request(
        url,
        data=json.dumps({"path": path}).encode(),
        method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, context=ctx, timeout=15) as response:  # noqa: S310
        url_from_session: str = json.loads(response.read())["url"]
        return url_from_session


def _subscribe_in(stack, device) -> tuple[mqtt.Client, list[bytes]]:
    """Subscribe to the device's /in topic over mTLS (as the device would)."""
    received: list[bytes] = []
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}-otasub",
        protocol=mqtt.MQTTv311,
    )
    client.tls_set(
        ca_certs=str(device.root_path),
        certfile=str(device.chain_path),
        keyfile=str(device.key_path),
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    client.on_message = lambda _c, _u, msg: received.append(msg.payload)
    client.connect("127.0.0.1", stack.appliance.config.mosquitto_device_port, keepalive=30)
    client.subscribe(f"helix/device/{device.device_id}/in", qos=1)
    client.loop_start()
    time.sleep(1)  # let SUBACK settle
    return client, received


def test_release_ota_and_custom_build(stack, provisioned_device) -> None:
    device = provisioned_device
    # --- seed the type registry + a scoped CI token ---
    stack.appliance.psql(ESP32_TYPE_SEED_SQL)
    ci_secret, token_sql = make_ci_token_sql()
    stack.appliance.psql(token_sql)
    client = ReleaseClient(stack.server.public_base_url, ci_secret)

    app = next(a for a in synth_esp32_artifacts(CONFIG_V1) if a.role == "app")
    app_key = f"cas/{app.sha256}"

    # --- CI-sim: register release v1 (4 artifacts + offsets) ---
    result = client.sim_ci_esp32(
        name=RELEASE_NAME, version="0.1.0", channel=CHANNEL, selector=SELECTOR, config=CONFIG_V1
    )
    assert result["releaseId"]
    assert len(result["variantIds"]) == 1
    assert _count(stack, f"SELECT count(*) FROM release WHERE name = '{RELEASE_NAME}'") == 1
    assert _count(stack, "SELECT count(*) FROM variant") == 1
    assert _count(stack, "SELECT count(*) FROM variant_artifact") == 4
    assert _count(stack, "SELECT count(*) FROM artifact") == 4
    assert (
        _count(
            stack,
            f"SELECT count(*) FROM release_channel_head WHERE name = '{RELEASE_NAME}' "
            f"AND channel = '{CHANNEL}'",
        )
        == 1
    )

    # --- re-register identical -> idempotent (no duplicate rows) ---
    client.sim_ci_esp32(
        name=RELEASE_NAME, version="0.1.0", channel=CHANNEL, selector=SELECTOR, config=CONFIG_V1
    )
    assert _count(stack, "SELECT count(*) FROM artifact") == 4
    assert _count(stack, "SELECT count(*) FROM release") == 1
    assert _count(stack, "SELECT count(*) FROM variant") == 1

    # --- assign a profile/track to the device ---
    for statement in seed_profile_for_device_sql(
        device.device_id, TYPE_KEY, RELEASE_NAME, CHANNEL, SELECTOR
    ):
        stack.appliance.psql(statement)

    # --- OTA fetch works: device downloads its firmware, sha256 matches ---
    signed_url = _download_via_session(stack, device, app_key)
    downloaded = client.get(signed_url)
    assert hashlib.sha256(downloaded).hexdigest() == app.sha256

    # --- a non-allowed key is refused (403) ---
    rejected = False
    try:
        _download_via_session(stack, device, f"cas/{'0' * 64}")
    except urllib.error.HTTPError as exc:
        rejected = exc.code == 403
    assert rejected, "unauthorized artifact key was not rejected with 403"

    # --- OTA producer: ota-update packet reaches the device /in ---
    sub, received = _subscribe_in(stack, device)
    try:
        triggered = client.trigger_ota(device.device_id)
        assert triggered["published"] is True
        deadline = time.monotonic() + 10
        while not received and time.monotonic() < deadline:
            time.sleep(0.5)
        assert received, "no ota-update packet received on /in"
        packet = json.loads(received[0])
        payload = packet["message"]["payload"]
        assert payload["packagePath"] == app_key
        assert payload["version"] == "0.1.0"
        assert payload["sha256"] == app.sha256
    finally:
        sub.loop_stop()
        sub.disconnect()

    # --- custom user build: request -> worker callbacks -> release (owner set) ---
    built = client.sim_custom_build(
        name="custom-fw",
        version="1.0.0-custom",
        channel="custom",
        selector=SELECTOR,
        config=CONFIG_CUSTOM,
        owner_user_id="user-sim",
    )
    assert built["status"] == "built"
    assert _count(stack, "SELECT count(*) FROM build WHERE source = 'custom'") == 1
    assert (
        _count(
            stack,
            "SELECT count(*) FROM release WHERE name = 'custom-fw' AND owner_user_id = 'user-sim'",
        )
        == 1
    )

    # --- repeat same config -> Tier-0 cache hit (no new build/release) ---
    hit = client.sim_custom_build(
        name="custom-fw",
        version="1.0.0-custom",
        channel="custom",
        selector=SELECTOR,
        config=CONFIG_CUSTOM,
        owner_user_id="user-sim",
    )
    assert hit["status"] == "hit"
    assert _count(stack, "SELECT count(*) FROM build WHERE source = 'custom'") == 1
    assert _count(stack, "SELECT count(*) FROM release WHERE name = 'custom-fw'") == 1
