from __future__ import annotations

import json
import secrets
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

from tooling.appliance import Appliance
from tooling.loadtest.generator import DeviceCert

DEVICE_PREFIX = "lt-device-"


def _openssl(*args: str) -> None:
    subprocess.run(["openssl", *args], check=True, capture_output=True)


def _provision(base_url: str, device_id: str, token: str, csr_pem: str) -> dict[str, Any]:
    body = json.dumps({"deviceId": device_id, "csr": csr_pem}).encode()
    request = urllib.request.Request(
        f"{base_url}/api/certificates/device",
        data=body,
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        payload = json.loads(response.read())
    assert isinstance(payload, dict)
    return payload


def provision_pool(
    appliance: Appliance, base_url: str, count: int, work_dir: Path
) -> list[DeviceCert]:
    """Seed `count` devices and provision a real step-ca cert for each, so the
    generator publishes over genuine mTLS just like production devices."""
    work_dir.mkdir(parents=True, exist_ok=True)
    devices: list[DeviceCert] = []
    for index in range(count):
        device_id = f"{DEVICE_PREFIX}{index}"
        token = f"lt-{secrets.token_hex(8)}"
        appliance.seed_device(device_id, token)

        key_path = work_dir / f"{device_id}.key"
        csr_path = work_dir / f"{device_id}.csr"
        _openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key_path))
        _openssl(
            "req", "-new", "-key", str(key_path), "-subj", f"/CN={device_id}", "-out", str(csr_path)
        )
        response = _provision(base_url, device_id, token, csr_path.read_text())

        chain_path = work_dir / f"{device_id}.chain.pem"
        root_path = work_dir / f"{device_id}.root.pem"
        chain_path.write_text(response["certificate"])
        root_path.write_text(response["ca"])
        devices.append(
            DeviceCert(
                device_id=device_id,
                chain_path=str(chain_path),
                key_path=str(key_path),
                root_path=str(root_path),
            )
        )
    return devices
