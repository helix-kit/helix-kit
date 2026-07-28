#!/usr/bin/env python3
"""Provision a device-cert pool against a remote Helix appliance.

Runs from a machine that can (a) SSH to the appliance host to seed `device` rows
in the loopback-only Postgres, and (b) reach the public HTTPS cert-issuance API.
For each device it seeds a row + access token, generates an EC P-256 key + CSR,
and POSTs the CSR to /api/certificates/device (Bearer token) so step-ca issues a
real device cert — exactly the material a production device presents over mTLS.

Output: <out>/manifest.json + per-device chain/key/root PEMs, consumed by
remote_harness.py's `--certs` pool.
"""

from __future__ import annotations

import argparse
import http.client
import json
import secrets
import ssl
import subprocess
import urllib.parse
from pathlib import Path
from typing import Any


def _run(cmd: list[str], stdin: str | None = None) -> str:
    res = subprocess.run(cmd, input=stdin, check=True, capture_output=True, text=True)
    return res.stdout


def _psql_remote(container: str | None) -> str:
    """The remote shell that pipes stdin SQL into the appliance Postgres, sourcing
    the generated env. `container` = docker-exec into the appliance container;
    None = native host (the AMI delivery — no Docker)."""
    load_env = (
        "set -a; . /var/lib/helix/env/secrets.env; . /var/lib/helix/env/internal.env; "
        'set +a; psql "$DATABASE_URL"'
    )
    if container:
        return f"sudo docker exec -i {container} bash -lc '{load_env}'"
    return f"sudo bash -lc '{load_env}'"


def seed_devices(
    ssh_host: str, pem: str, port: int, container: str | None, rows: list[tuple[str, str]]
) -> None:
    """Batch-insert device rows over SSH -> psql (stdin heredoc)."""
    values = ",".join(f"('{d}','lt device','{t}',true)" for d, t in rows)
    sql = (
        f"INSERT INTO device (id, name, access_token, is_active) VALUES {values} "
        "ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, is_active = true;"
    )
    _run(
        [
            "ssh",
            "-i",
            pem,
            "-p",
            str(port),
            "-o",
            "StrictHostKeyChecking=no",
            ssh_host,
            _psql_remote(container),
        ],
        stdin=sql,
    )


def issue_cert(issuer_url: str, device_id: str, token: str, csr_pem: str) -> dict[str, Any]:
    """POST the CSR to helix-server's cert-issuance API. This is the pre-mTLS
    bootstrap endpoint (bearer-token auth on the public HTTP server, port 4000),
    reached here over an SSH tunnel — it is one-time setup, not measured load, so
    plain HTTP is fine."""
    parsed = urllib.parse.urlsplit(issuer_url)
    hostname = parsed.hostname
    if hostname is None:
        raise ValueError(f"--issuer-url has no host: {issuer_url}")
    if parsed.scheme == "https":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn: http.client.HTTPConnection = http.client.HTTPSConnection(
            hostname, parsed.port or 443, context=ctx, timeout=30
        )
    else:
        conn = http.client.HTTPConnection(hostname, parsed.port or 80, timeout=30)
    body = json.dumps({"deviceId": device_id, "csr": csr_pem})
    conn.request(
        "POST",
        "/api/certificates/device",
        body,
        {"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    resp = conn.getresponse()
    raw = resp.read()
    if resp.status != 200:
        raise RuntimeError(f"cert issuance failed for {device_id}: {resp.status} {raw[:200]!r}")
    conn.close()
    payload = json.loads(raw)
    assert isinstance(payload, dict)
    return payload


def main() -> None:
    p = argparse.ArgumentParser(description="Provision remote device-cert pool")
    p.add_argument("--ssh-host", required=True, help="ubuntu@<appliance-host>")
    p.add_argument("--ssh-port", type=int, default=22)
    p.add_argument("--pem", required=True)
    p.add_argument("--container", default="helix-appliance")
    p.add_argument(
        "--native",
        action="store_true",
        help="Appliance runs natively (the AMI), not in a container: seed via psql "
        "on the host directly instead of `docker exec`.",
    )
    p.add_argument(
        "--issuer-url",
        required=True,
        help="helix-server cert-issuance base, e.g. http://127.0.0.1:14000 (tunnel)",
    )
    p.add_argument("--count", type=int, default=50)
    p.add_argument("--prefix", default="lt-device-")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    rows = [(f"{args.prefix}{i}", f"lt-{secrets.token_hex(8)}") for i in range(args.count)]
    print(f"seeding {len(rows)} device rows ...")
    seed_devices(
        args.ssh_host, args.pem, args.ssh_port, None if args.native else args.container, rows
    )

    manifest: dict[str, list[dict[str, str]]] = {"devices": []}
    for i, (device_id, token) in enumerate(rows):
        key_path = out / f"{device_id}.key"
        csr_path = out / f"{device_id}.csr"
        _run(
            [
                "openssl",
                "ecparam",
                "-name",
                "prime256v1",
                "-genkey",
                "-noout",
                "-out",
                str(key_path),
            ]
        )
        _run(
            [
                "openssl",
                "req",
                "-new",
                "-key",
                str(key_path),
                "-subj",
                f"/CN={device_id}",
                "-out",
                str(csr_path),
            ]
        )
        resp = issue_cert(args.issuer_url, device_id, token, csr_path.read_text())
        (out / f"{device_id}.chain.pem").write_text(resp["certificate"])
        (out / f"{device_id}.root.pem").write_text(resp["ca"])
        manifest["devices"].append(
            {
                "device_id": device_id,
                "chain": f"{device_id}.chain.pem",
                "key": f"{device_id}.key",
                "root": f"{device_id}.root.pem",
            }
        )
        if (i + 1) % 10 == 0:
            print(f"  issued {i + 1}/{len(rows)}")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"done: {len(manifest['devices'])} certs -> {out}/manifest.json")


if __name__ == "__main__":
    main()
