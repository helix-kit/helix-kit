"""`helix device deploy` — install the systemd device runtime on a real device.

This is the real-hardware counterpart to `helix device test-host` (which is the
systemd-in-container test host). It provisions a device identity against the
cloud, cross-compiles the base runtime + the requested app packages for the
target architecture, and bootstraps everything onto a remote Linux device over
SSH: it creates the helix service user + the FHS layout, installs the binaries,
static units, seed package DB, config, and PKI, brings up helixd +
runtime-manager under systemd, then installs the app packages through
runtime-manager (which auto-starts them).

The whole on-device step is a single root bootstrap script, so it is atomic and
easy to inspect.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT
from tooling.device.package import _build_pkg
from tooling.device.provision import (
    DEFAULT_PEM,
    _provision_cloud,
    _write_config,
)

DEVICE_DIR = REPO_ROOT / "linux" / "device"
GO_DIR = DEVICE_DIR / "go"
SYSTEMD_DIR = DEVICE_DIR / "systemd"
SEED_DB = DEVICE_DIR / "docker" / "seed-package-db.json"

BASE_BINARIES = ["helixd", "helix-runtime-manager", "helix-pkg"]
UNITS = ["helixd.service", "helix-runtime-manager.service", "helix.target"]


def _sh(cmd: list[str], **kw: object) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)  # type: ignore[call-overload]
    return result.stdout or ""


def _cross_build_base(arch: str, out_dir: Path) -> None:
    """Cross-compile the base runtime binaries for the target arch."""
    out_dir.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GOOS": "linux", "GOARCH": arch, "CGO_ENABLED": "0"}
    for b in BASE_BINARIES:
        click.echo(f"  building {b} ({arch})")
        subprocess.run(
            ["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(out_dir / b), f"./cmd/{b}"],
            check=True,
            cwd=GO_DIR,
            env=env,
        )


BOOTSTRAP = r"""#!/usr/bin/env bash
# Root bootstrap for the Helix device runtime. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

getent group helix >/dev/null || groupadd --system helix
getent passwd helix >/dev/null || useradd --system --gid helix --shell /usr/sbin/nologin helix

install -d -m0755 /usr/lib/helix/bin /usr/lib/helix/packages /usr/lib/helix/defaults \
                  /usr/lib/helix/catalog /usr/lib/helix/metrics
install -d -m0755 /etc/helix /etc/helix/conf.d /etc/helix/pki
install -d -m0750 -o root -g helix /etc/helix/secrets
install -d -m0755 /var/lib/helix /var/lib/helix/db /var/lib/helix/tmp

install -m0755 "$HERE"/bin/* /usr/lib/helix/bin/
install -m0644 "$HERE"/systemd/* /etc/systemd/system/
# Seed the package DB only on a fresh install (never clobber an existing one).
if [ ! -f /var/lib/helix/db/status ]; then
  install -m0640 -o root -g helix "$HERE"/db/status /var/lib/helix/db/status
fi
# Config + PKI are only shipped on a provisioning deploy (not --reuse-identity).
if [ -f "$HERE"/etc/config.json ]; then
  install -m0640 -o root -g helix "$HERE"/etc/config.json /etc/helix/config.json
  install -m0640 -o root -g helix "$HERE"/etc/pki/chain.pem /etc/helix/pki/chain.pem
  install -m0640 -o root -g helix "$HERE"/etc/pki/root.pem /etc/helix/pki/root.pem
  # 0640 root:helix, not 0600: helixd runs as the unprivileged helix user and must
  # read the device key to present the mTLS client cert. Group-only, never world.
  install -m0640 -o root -g helix "$HERE"/etc/pki/device.key /etc/helix/pki/device.key
fi

systemctl daemon-reload
systemctl enable helix.target helixd.service helix-runtime-manager.service >/dev/null 2>&1
systemctl restart helixd.service helix-runtime-manager.service

# Wait for the runtime control socket, then install app packages via runtime-manager.
for _ in $(seq 1 60); do [ -S /run/helix/runtime.sock ] && break; sleep 0.5; done
shopt -s nullglob
for pkg in "$HERE"/packages/*.helixpkg; do
  base="$(basename "$pkg")"
  cp "$pkg" /var/lib/helix/tmp/"$base"
  echo "installing $base"
  /usr/lib/helix/bin/helix-pkg ctl -method install-package \
    -params "{\"path\":\"/var/lib/helix/tmp/$base\"}"
done

echo "--- helix units ---"
systemctl is-active helixd.service helix-runtime-manager.service || true
"""


def _remote(target: str, key: str | None) -> list[str]:
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
    if key:
        cmd += ["-i", key]
    return [*cmd, target]


@click.command()
@click.argument("target")
@click.option("--device-id", required=True, help="Device identity to provision (CN).")
@click.option("--arch", default="arm64", show_default=True, help="Target GOARCH.")
@click.option("--apps", default="shell,port-forward", show_default=True, help="Comma app list.")
@click.option("--host", default="helix-kit.com", show_default=True, help="Cloud domain.")
@click.option("--ssh-host", default="helix@3.108.135.4", show_default=True, help="Appliance SSH.")
@click.option("--pem", default=DEFAULT_PEM, show_default=True, help="Appliance SSH key.")
@click.option("--target-key", default=None, help="SSH key for the device (default: agent/config).")
@click.option(
    "--reuse-identity",
    is_flag=True,
    help="Update binaries/packages only; keep the device's existing config + cert.",
)
def deploy(  # noqa: PLR0913
    target: str,
    device_id: str,
    arch: str,
    apps: str,
    host: str,
    ssh_host: str,
    pem: str,
    target_key: str | None,
    reuse_identity: bool,
) -> None:
    """Provision + install the Helix device runtime on a remote device over SSH."""
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / "helix-deploy"
        (stage / "bin").mkdir(parents=True)
        (stage / "systemd").mkdir()
        (stage / "db").mkdir()
        (stage / "packages").mkdir()

        # 1. Provision an identity against the cloud (seed row + step-ca cert),
        #    unless reusing the device's existing identity.
        if reuse_identity:
            click.echo("Reusing the device's existing identity (no provisioning).")
        else:
            pem_path = Path(pem).expanduser()
            if not pem_path.exists():
                raise click.ClickException(f"appliance SSH key not found: {pem_path}")
            click.echo(f"Provisioning '{device_id}' against {host} ...")
            pki = stage / "etc" / "pki"
            pki.mkdir(parents=True)
            _provision_cloud(host, pem_path, ssh_host, device_id, pki)
            (pki / "device.csr").unlink(missing_ok=True)
            _write_config(stage / "etc", host, device_id, local=False)

        # 2. Cross-build base runtime + app packages.
        click.echo(f"Cross-building base runtime ({arch}) ...")
        _cross_build_base(arch, stage / "bin")
        for name in [f"helix-{a.strip()}" for a in apps.split(",") if a.strip()]:
            click.echo(f"Building package {name} ({arch}) ...")
            _build_pkg(name, stage / "packages" / f"{name}.helixpkg", arch)

        # 3. Static units + seed DB + bootstrap script.
        for u in UNITS:
            shutil.copy(SYSTEMD_DIR / u, stage / "systemd" / u)
        shutil.copy(SEED_DB, stage / "db" / "status")
        (stage / "bootstrap.sh").write_text(BOOTSTRAP)

        # 4. Ship + run the bootstrap on the device.
        tarball = Path(td) / "helix-deploy.tar.gz"
        _sh(["tar", "-czf", str(tarball), "-C", str(stage.parent), stage.name])

        click.echo(f"Copying runtime to {target} ...")
        scp = ["scp", "-o", "StrictHostKeyChecking=no"]
        if target_key:
            scp += ["-i", target_key]
        _sh([*scp, str(tarball), f"{target}:/tmp/helix-deploy.tar.gz"])

        click.echo("Bootstrapping (sudo) ...")
        remote_script = (
            "set -e; cd /tmp; rm -rf helix-deploy; tar -xzf helix-deploy.tar.gz; "
            "sudo bash helix-deploy/bootstrap.sh; rm -rf helix-deploy helix-deploy.tar.gz"
        )
        subprocess.run([*_remote(target, target_key), remote_script], check=True)

    status_cmd = "sudo /usr/lib/helix/bin/helix-pkg ctl -method get-status -params {}"
    click.echo(
        f"\nDeployed '{device_id}' to {target}.\n"
        f"  device logs:  ssh {target} 'journalctl -u helixd -u helix-runtime-manager -f'\n"
        f"  status:       ssh {target} '{status_cmd}'"
    )
