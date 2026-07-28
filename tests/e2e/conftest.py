from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import tempfile
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from tooling.appliance import Appliance, ApplianceConfig, HelixServer, ServerMode


@dataclass
class Stack:
    appliance: Appliance
    server: HelixServer
    work_dir: Path

    @property
    def public_base_url(self) -> str:
        return self.server.public_base_url


@dataclass
class ProvisionedDevice:
    device_id: str
    access_token: str
    csr_pem: str
    key_path: Path
    chain_path: Path  # leaf + intermediate, as returned by provisioning
    root_path: Path
    response: dict[str, Any]


def _config() -> ApplianceConfig:
    mode = ServerMode(os.environ.get("HELIX_E2E_MODE", ServerMode.HOST.value))
    base = os.environ.get("HELIX_E2E_PORT_BASE")
    if base:
        return ApplianceConfig.from_base_port(int(base), mode=mode)
    return ApplianceConfig(mode=mode)


@pytest.fixture(scope="session")
def stack() -> Iterator[Stack]:
    config = _config()
    appliance = Appliance(config)

    if os.environ.get("HELIX_E2E_BUILD") and not appliance.image_exists():
        appliance.build()
    if not appliance.image_exists():
        pytest.skip(
            f"appliance image {config.image} not found; run 'helix appliance build' "
            "or pass --build."
        )

    work_dir = Path(tempfile.mkdtemp(prefix="helix-e2e-"))
    server = HelixServer(appliance, work_dir)
    keep = bool(os.environ.get("HELIX_E2E_KEEP"))
    # Reuse an already-running appliance instead of recreating it (start/stop only the host server).
    reuse = bool(os.environ.get("HELIX_E2E_REUSE"))

    if not reuse:
        appliance.up(fresh=True)
    try:
        appliance.wait_ready()
        appliance.prepare_host_access()
        appliance.run_migrations()
        server.start()
        yield Stack(appliance=appliance, server=server, work_dir=work_dir)
    finally:
        server.stop()
        if not reuse and not keep:
            appliance.down(purge=True)
        if not keep:
            shutil.rmtree(work_dir, ignore_errors=True)


def _openssl(*args: str) -> None:
    subprocess.run(["openssl", *args], check=True, capture_output=True)


def _generate_key_and_csr(work_dir: Path, device_id: str) -> tuple[Path, str]:
    key_path = work_dir / f"{device_id}.key"
    csr_path = work_dir / f"{device_id}.csr"
    _openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key_path))
    _openssl(
        "req", "-new", "-key", str(key_path), "-subj", f"/CN={device_id}", "-out", str(csr_path)
    )
    return key_path, csr_path.read_text()


def provision_certificate(
    base_url: str, device_id: str, token: str, csr_pem: str
) -> dict[str, Any]:
    body = json.dumps({"deviceId": device_id, "csr": csr_pem}).encode()
    request = urllib.request.Request(
        f"{base_url}/api/certificates/device",
        data=body,
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(
        request, timeout=30
    ) as response:  # noqa: S310 - local test endpoint
        parsed: dict[str, Any] = json.loads(response.read())
        return parsed


def _provision_device(stack: Stack, device_id: str) -> ProvisionedDevice:
    access_token = f"e2e-{secrets.token_hex(16)}"
    stack.appliance.seed_device(device_id, access_token)

    key_path, csr_pem = _generate_key_and_csr(stack.work_dir, device_id)
    response = provision_certificate(stack.public_base_url, device_id, access_token, csr_pem)

    chain_path = stack.work_dir / f"{device_id}.chain.pem"
    root_path = stack.work_dir / f"{device_id}.root.pem"
    chain_path.write_text(response["certificate"])
    root_path.write_text(response["ca"])

    return ProvisionedDevice(
        device_id=device_id,
        access_token=access_token,
        csr_pem=csr_pem,
        key_path=key_path,
        chain_path=chain_path,
        root_path=root_path,
        response=response,
    )


@pytest.fixture(scope="session")
def provisioned_device(stack: Stack) -> ProvisionedDevice:
    return _provision_device(stack, "e2e-device-1")


@pytest.fixture(scope="session")
def http_device(stack: Stack) -> ProvisionedDevice:
    """A device dedicated to the HTTP mTLS ingestion tests (isolates their event counts)."""
    return _provision_device(stack, "e2e-http-device")
