from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

BEGIN = "-----BEGIN CERTIFICATE-----"
END = "-----END CERTIFICATE-----"


def _openssl(*args: str) -> str:
    return subprocess.run(["openssl", *args], check=True, capture_output=True, text=True).stdout


def _split_certs(pem: str) -> list[str]:
    certs: list[str] = []
    index = 0
    while True:
        begin = pem.find(BEGIN, index)
        if begin == -1:
            break
        end = pem.find(END, begin)
        certs.append(pem[begin : end + len(END)] + "\n")
        index = end + len(END)
    return certs


def _post_status(base_url: str, device_id: str, token: str | None, csr: str) -> int:
    body = json.dumps({"deviceId": device_id, "csr": csr}).encode()
    headers = {"content-type": "application/json"}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{base_url}/api/certificates/device", data=body, method="POST", headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            status: int = response.status
            return status
    except urllib.error.HTTPError as error:
        return error.code


def test_provisioned_certificate_chains_to_step_ca(provisioned_device, tmp_path: Path) -> None:
    certs = _split_certs(provisioned_device.chain_path.read_text())
    assert certs, "provisioning returned no certificate"

    leaf = tmp_path / "leaf.pem"
    intermediates = tmp_path / "intermediates.pem"
    leaf.write_text(certs[0])
    intermediates.write_text("".join(certs[1:]))

    # Raises (test fails) if the leaf does not verify to the step-ca root.
    _openssl(
        "verify",
        "-CAfile",
        str(provisioned_device.root_path),
        "-untrusted",
        str(intermediates),
        str(leaf),
    )


def test_leaf_identity_matches_device(provisioned_device, tmp_path: Path) -> None:
    leaf = tmp_path / "leaf.pem"
    leaf.write_text(_split_certs(provisioned_device.chain_path.read_text())[0])

    subject = _openssl("x509", "-in", str(leaf), "-noout", "-subject")
    assert provisioned_device.device_id in subject
    assert provisioned_device.response["deviceId"] == provisioned_device.device_id

    cert_pubkey = _openssl("x509", "-in", str(leaf), "-noout", "-pubkey")
    key_pubkey = _openssl("pkey", "-in", str(provisioned_device.key_path), "-pubout")
    assert cert_pubkey == key_pubkey


def test_provisioning_rejects_bad_authentication(stack, provisioned_device) -> None:
    base = stack.public_base_url
    device_id = provisioned_device.device_id
    token = provisioned_device.access_token
    csr = provisioned_device.csr_pem

    assert _post_status(base, device_id, None, csr) == 401
    assert _post_status(base, device_id, "not-the-real-token", csr) == 401
    assert _post_status(base, "someone-elses-device", token, csr) == 401
