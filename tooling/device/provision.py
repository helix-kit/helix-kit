"""`helix device provision` — mint a device identity + config bundle (cloud or local)."""

from __future__ import annotations

import json
import secrets
import ssl
import subprocess
import urllib.request
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT

DEVICE_DIR = REPO_ROOT / "linux" / "device"
DEFAULT_PEM = "~/Downloads/Helix Kit Admin.pem"

# Canonical on-device paths the config points at (bundle mounts at /etc/helix).
PKI = "/etc/helix/pki"


def _run(cmd: list[str], stdin: str | None = None, capture: bool = True) -> str:
    result = subprocess.run(cmd, input=stdin, check=True, capture_output=capture, text=True)
    return result.stdout or ""


def _ssh(pem: Path, ssh_host: str, remote_cmd: str, stdin: str | None = None) -> str:
    return _run(
        [
            "ssh",
            "-i",
            str(pem),
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "ConnectTimeout=10",
            ssh_host,
            remote_cmd,
        ],
        stdin=stdin,
    )


def _seed_device(pem: Path, ssh_host: str, device_id: str, token: str) -> None:
    # Insert/refresh the device row + token so step-ca will issue a cert for it.
    sql = (
        "INSERT INTO device (id, name, access_token, is_active) "
        f"VALUES ('{device_id}', 'helix device', '{token}', true) "
        "ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, "
        "is_active = true;"
    )
    load_env = (
        "set -a; . /var/lib/helix/env/secrets.env 2>/dev/null; "
        ". /var/lib/helix/env/internal.env 2>/dev/null; set +a; "
        'psql "$DATABASE_URL" -v ON_ERROR_STOP=1'
    )
    _ssh(pem, ssh_host, f"sudo -n bash -lc '{load_env}'", stdin=sql)


def _issue_cert(host: str, device_id: str, token: str, csr_pem: str) -> dict[str, str]:
    body = json.dumps({"deviceId": device_id, "csr": csr_pem}).encode()
    request = urllib.request.Request(
        f"https://{host}/api/certificates/device",
        data=body,
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=30, context=context) as response:  # noqa: S310
        payload = json.loads(response.read())
    if not isinstance(payload, dict) or "certificate" not in payload or "ca" not in payload:
        raise click.ClickException(f"unexpected cert-issuance response: {payload!r}")
    return payload


def _provision_cloud(host: str, pem: Path, ssh_host: str, device_id: str, pki: Path) -> None:
    pki.mkdir(parents=True, exist_ok=True)
    key, csr = pki / "device.key", pki / "device.csr"
    chain, root = pki / "chain.pem", pki / "root.pem"

    token = f"hd-{secrets.token_hex(8)}"
    click.echo(f"  seeding device row '{device_id}' on {ssh_host}")
    _seed_device(pem, ssh_host, device_id, token)

    click.echo("  generating EC P-256 key + CSR")
    _run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key)])
    _run(
        ["openssl", "req", "-new", "-key", str(key), "-subj", f"/CN={device_id}", "-out", str(csr)]
    )

    click.echo(f"  requesting a device cert from https://{host}/api/certificates/device")
    issued = _issue_cert(host, device_id, token, csr.read_text())
    chain.write_text(issued["certificate"])
    root.write_text(issued["ca"])
    csr.unlink(missing_ok=True)
    key.chmod(0o600)


def _provision_local(device_id: str, pki: Path) -> None:
    """Generate a throwaway self-signed CA + device leaf for infra-free testing."""
    pki.mkdir(parents=True, exist_ok=True)
    ca_key, ca_crt = pki / "ca.key", pki / "root.pem"
    key, csr, chain = pki / "device.key", pki / "device.csr", pki / "chain.pem"

    click.echo("  generating a self-signed CA + device certificate (local mode)")
    _run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(ca_key)])
    _run(
        [
            "openssl",
            "req",
            "-new",
            "-x509",
            "-key",
            str(ca_key),
            "-subj",
            "/CN=helix-local-ca",
            "-days",
            "3650",
            "-out",
            str(ca_crt),
        ]
    )
    _run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key)])
    _run(
        ["openssl", "req", "-new", "-key", str(key), "-subj", f"/CN={device_id}", "-out", str(csr)]
    )
    _run(
        [
            "openssl",
            "x509",
            "-req",
            "-in",
            str(csr),
            "-CA",
            str(ca_crt),
            "-CAkey",
            str(ca_key),
            "-CAcreateserial",
            "-days",
            "825",
            "-out",
            str(chain),
        ]
    )
    csr.unlink(missing_ok=True)
    ca_key.unlink(missing_ok=True)
    key.chmod(0o600)


def _write_config(bundle: Path, host: str, device_id: str, local: bool) -> None:
    broker = "tls://localhost:8883" if local else f"tls://{host}:8883"
    stream = "wss://localhost:4001/stream/device" if local else f"wss://{host}:4001/stream/device"
    config = {
        "schemaVersion": 1,
        "device": {"id": device_id},
        "mqtt": {
            "brokerUrl": broker,
            "caCert": f"{PKI}/root.pem",
            "clientCert": f"{PKI}/chain.pem",
            "clientKey": f"{PKI}/device.key",
        },
        "ipc": {"socketPath": "/run/helix/helix-ipc.sock"},
        "gateway": {
            "streamUrl": stream,
            "caCert": f"{PKI}/root.pem",
            "clientCert": f"{PKI}/chain.pem",
            "clientKey": f"{PKI}/device.key",
        },
    }
    (bundle / "config.json").write_text(json.dumps(config, indent=2) + "\n")


@click.command()
@click.option("--device-id", default="helix-dev-1", show_default=True)
@click.option(
    "--bundle",
    type=click.Path(path_type=Path),
    default=DEVICE_DIR / "docker" / ".bundle",
    show_default=True,
    help="Output directory for config.json + pki/.",
)
@click.option("--local", is_flag=True, help="Self-signed local identity (no cloud needed).")
@click.option(
    "--host", default="helix-kit.com", show_default=True, help="Cloud domain (cloud mode)."
)
@click.option("--ssh-host", default="helix@3.108.135.4", show_default=True)
@click.option("--pem", default=DEFAULT_PEM, show_default=True, help="SSH key for --ssh-host.")
def provision(  # noqa: PLR0913
    device_id: str, bundle: Path, local: bool, host: str, ssh_host: str, pem: str
) -> None:
    """Provision a device identity + config bundle for the systemd runtime."""
    bundle = bundle.expanduser()
    pki = bundle / "pki"
    click.echo(f"Provisioning '{device_id}' -> {bundle}")
    if local:
        _provision_local(device_id, pki)
    else:
        pem_path = Path(pem).expanduser()
        if not pem_path.exists():
            raise click.ClickException(f"SSH key not found: {pem_path}")
        _provision_cloud(host, pem_path, ssh_host, device_id, pki)
    _write_config(bundle, host, device_id, local)
    click.echo(f"Wrote {bundle / 'config.json'} and {pki}/")
