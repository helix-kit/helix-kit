from __future__ import annotations

import ssl
import subprocess
import time

import paho.mqtt.client as mqtt
import pytest
from _events import post_device_events
from conftest import ProvisionedDevice, Stack, _provision_device
from paho.mqtt.enums import CallbackAPIVersion

SERVICE = "telemetry"


@pytest.fixture(scope="module")
def revocable_device(stack: Stack) -> ProvisionedDevice:
    """A device dedicated to the revocation test — its cert is revoked, so it
    must not be shared with any other test."""
    return _provision_device(stack, "e2e-revoke-device")


def _leaf_serial_hex(device: ProvisionedDevice) -> str:
    out = subprocess.run(
        ["openssl", "x509", "-in", str(device.chain_path), "-noout", "-serial"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    # openssl prints "serial=<UPPERCASE HEX>" — exactly what Node's
    # X509Certificate.serialNumber (stored in device_certificate) reports.
    return out.split("=", 1)[1].strip()


def _mqtt_publish_succeeds(stack: Stack, device: ProvisionedDevice) -> bool:
    """True iff the device can complete the mTLS handshake with mosquitto and get
    a QoS-1 PUBACK. A revoked cert fails the handshake (crlfile), so this is
    False."""
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}-revtest",
        protocol=mqtt.MQTTv311,
    )
    client.tls_set(
        ca_certs=str(device.root_path),
        certfile=str(device.chain_path),
        keyfile=str(device.key_path),
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    try:
        client.connect("127.0.0.1", stack.appliance.config.mosquitto_device_port, keepalive=30)
    except ssl.SSLError, OSError:
        return False
    client.loop_start()
    try:
        topic = f"helix/device/{device.device_id}/service/{SERVICE}/event"
        info = client.publish(topic, '{"type":"reading","msgId":"rev-1"}', qos=1)
        info.wait_for_publish(timeout=8)
        return info.is_published()
    except ValueError, RuntimeError:
        return False
    finally:
        client.loop_stop()
        client.disconnect()


def test_issued_certificate_is_recorded(stack: Stack, revocable_device: ProvisionedDevice) -> None:
    """Every issuance writes a device_certificate row with the leaf's serial and
    an 'active' status (the metadata the admin UI lists)."""
    serial = _leaf_serial_hex(revocable_device)
    rows = stack.appliance.psql(
        "SELECT status, serial_number FROM device_certificate "
        f"WHERE device_id = '{revocable_device.device_id}'"
    ).stdout
    assert serial in rows
    assert "active" in rows


def test_revocation_blocks_broker_and_gateway(
    stack: Stack, revocable_device: ProvisionedDevice
) -> None:
    """Revoking a cert lands its serial on step-ca's CRL, which both mosquitto
    and the mTLS gateway enforce — the same cert that worked before is refused by
    both after the CRL propagates."""
    # Baseline: the cert is accepted by both enforcers before revocation.
    assert _mqtt_publish_succeeds(stack, revocable_device) is True
    accepted = post_device_events(stack, revocable_device, [{"type": "heartbeat"}])
    assert accepted["accepted"] == 1

    serial_hex = _leaf_serial_hex(revocable_device)
    serial_decimal = str(int(serial_hex, 16))
    stack.appliance.revoke_certificate(serial_decimal)
    # Wait for step-ca to regenerate the CRL with this serial, then stage + reload.
    assert stack.appliance.wait_for_crl_serial(serial_hex) is True
    # Re-export the refreshed CRL to the host path the (host-mode) gateway watches
    # so its TLS context reloads; a no-op in container mode.
    crl_path = stack.server.crl_path
    if crl_path is not None:
        stack.appliance.export_crl(crl_path)

    # Give mosquitto's SIGHUP reload + the gateway's file-watch a moment to apply.
    time.sleep(3)

    # mosquitto now rejects the handshake.
    assert _mqtt_publish_succeeds(stack, revocable_device) is False

    # The mTLS gateway now rejects the handshake too.
    with pytest.raises((ssl.SSLError, OSError)):
        post_device_events(stack, revocable_device, [{"type": "heartbeat"}])
