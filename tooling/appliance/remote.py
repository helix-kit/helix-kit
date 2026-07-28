"""Run the web apps locally against a REMOTE appliance (the live EC2 box)."""

from __future__ import annotations

import shlex
import signal
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT

WEB_APPS = REPO_ROOT / "web" / "apps"
# Everything this command writes (copied certs, local storage root); gitignored, disposable.
LOCAL_DIR = REPO_ROOT / ".helix-remote"

# The appliance's env files, in systemd's load order (later wins).
REMOTE_ENV_FILES = ("internal.env", "secrets.env", "site.env")
REMOTE_ENV_DIR = "/var/lib/helix/env"


@dataclass(frozen=True)
class Tunnel:
    """One forwarded service (local port == remote port unless --port-offset shifts it)."""

    port: int
    name: str


# What the web apps actually talk to. Ports match the appliance's loopback binds.
TUNNELS: tuple[Tunnel, ...] = (
    Tunnel(5432, "postgres"),
    Tunnel(8080, "openfga"),
    Tunnel(9000, "step-ca"),
    Tunnel(9092, "redpanda (event queue)"),
    # Mosquitto has TWO listeners: 8883 device mTLS, 8884 service (what helix-server dials).
    Tunnel(8883, "mosquitto (device mTLS)"),
    Tunnel(8884, "mosquitto (service)"),
    Tunnel(4000, "helix-server (http)"),
    Tunnel(4001, "helix-server (device mTLS)"),
)

# Cert/key files referenced by *_PATH vars. Copied down; the vars are rewritten.
PATH_SUFFIX = "_PATH"


def _ssh_base(host: str, user: str, key: Path | None) -> list[str]:
    cmd = ["ssh", "-o", "StrictHostKeyChecking=accept-new"]
    if key is not None:
        cmd += ["-i", str(key)]
    return cmd + [f"{user}@{host}"]


def _read_remote_env(host: str, user: str, key: Path | None) -> dict[str, str]:
    """Merge the appliance's three env files, in systemd's order."""
    files = " ".join(f"{REMOTE_ENV_DIR}/{name}" for name in REMOTE_ENV_FILES)
    # `cat` in order: later files override earlier, matching systemd's repeated EnvironmentFile=.
    result = subprocess.run(
        _ssh_base(host, user, key) + [f"sudo cat {files}"],
        capture_output=True,
        text=True,
        check=True,
    )
    env: dict[str, str] = {}
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        env[name.strip()] = value.strip()
    return env


def _fetch_cert_files(
    env: dict[str, str], host: str, user: str, key: Path | None, dest: Path
) -> dict[str, str]:
    # Copy every *_PATH file (staged to /tmp readable first, they're root-owned) + rewrite vars.
    remote_paths = {
        name: value
        for name, value in env.items()
        if name.endswith(PATH_SUFFIX) and value.startswith("/var/lib/helix/")
    }
    if not remote_paths:
        return {}

    dest.mkdir(parents=True, exist_ok=True)
    staging = "/tmp/helix-remote-certs"
    quoted = " ".join(shlex.quote(p) for p in sorted(set(remote_paths.values())))
    subprocess.run(
        _ssh_base(host, user, key)
        + [
            f"rm -rf {staging} && mkdir -p {staging} && "
            f"sudo cp {quoted} {staging}/ 2>/dev/null || true; "
            f"sudo chown -R $(id -u):$(id -g) {staging} && chmod 600 {staging}/*"
        ],
        check=True,
    )
    scp = ["scp", "-o", "StrictHostKeyChecking=accept-new"]
    if key is not None:
        scp += ["-i", str(key)]
    subprocess.run(
        scp + [f"{user}@{host}:{staging}/*", str(dest)],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(_ssh_base(host, user, key) + [f"rm -rf {staging}"], check=False)

    rewritten: dict[str, str] = {}
    for name, remote in remote_paths.items():
        local = dest / Path(remote).name
        if local.exists():
            rewritten[name] = str(local)
    return rewritten


def _retarget_ports(env: dict[str, str], offset: int) -> dict[str, str]:
    """Rewrite every 127.0.0.1:<remote-port> in the env to the local port."""
    if offset == 0:
        return {}
    rewritten: dict[str, str] = {}
    for name, value in env.items():
        updated = value
        for tunnel in TUNNELS:
            updated = updated.replace(
                f"127.0.0.1:{tunnel.port}", f"127.0.0.1:{tunnel.port + offset}"
            )
        if updated != value:
            rewritten[name] = updated
    return rewritten


def _local_overrides(
    env: dict[str, str], certs: dict[str, str], storage: Path, port: int
) -> dict[str, str]:
    """The values that MUST differ locally. Everything else is used verbatim."""
    # Must be the origin the dev server actually serves on (better-auth baseURL / CSRF check).
    local_origin = f"http://localhost:{port}"
    overrides: dict[str, str] = {
        **certs,
        "BETTER_AUTH_URL": local_origin,
        "NEXT_PUBLIC_BASE_URL": local_origin,
        "PUBLIC_APP_URL": local_origin,
        "NODE_ENV": "development",
        "FS_STORAGE_ROOT": str(storage),
    }
    # The device data plane is NOT tunnelled: the browser must reach devices on the real box.
    domain = env.get("APP_DOMAIN")
    if domain:
        overrides["NEXT_PUBLIC_HELIX_DEVICE_STREAM_URL"] = f"wss://{domain}:4001/stream/device"
    return overrides


def _render_env(env: dict[str, str], overrides: dict[str, str]) -> str:
    merged = {**env, **overrides}
    lines = [
        "# GENERATED by `helix appliance remote` — do not edit, it is overwritten.",
        "#",
        "# This points your LOCAL dev server at the LIVE appliance: the same",
        "# Postgres, the same auth secret, the same OpenFGA, the same PKI. Writes",
        "# from `pnpm dev` are writes to PRODUCTION.",
        "#",
        "# The service URLs below say 127.0.0.1 — those are the SSH tunnels that",
        "# `helix appliance remote` holds open. They only work while it runs.",
        "",
    ]
    for name in sorted(merged):
        value = merged[name]
        # Keep it a valid dotenv line even when a value contains spaces.
        lines.append(f"{name}={value}" if " " not in value else f'{name}="{value}"')
    return "\n".join(lines) + "\n"


def _tunnel_args(host: str, user: str, key: Path | None, offset: int) -> list[str]:
    args = ["ssh", "-N", "-o", "StrictHostKeyChecking=accept-new", "-o", "ExitOnForwardFailure=yes"]
    if key is not None:
        args += ["-i", str(key)]
    for tunnel in TUNNELS:
        # local:remote — the remote side is always the appliance's real port.
        args += ["-L", f"127.0.0.1:{tunnel.port + offset}:127.0.0.1:{tunnel.port}"]
    return args + [f"{user}@{host}"]


def _in_use(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _conflicts(offset: int) -> Iterator[Tunnel]:
    for tunnel in TUNNELS:
        if _in_use(tunnel.port + offset):
            yield tunnel


def run_remote_dev(
    *,
    host: str,
    user: str,
    key: Path | None,
    write_env: bool,
    app: str,
    port_offset: int = 0,
    port: int = 3000,
) -> None:
    """Write the local .env from the live appliance, then hold the tunnels open."""
    click.secho("\n  ⚠  This points local dev at the LIVE appliance.", fg="yellow", bold=True)
    click.secho(
        "     Same Postgres, same auth secret, same PKI. `pnpm dev` writes to PRODUCTION,\n"
        "     and `pnpm db:migrate` would migrate PRODUCTION. Read-only work is fine;\n"
        "     anything that writes is a production write.\n",
        fg="yellow",
    )

    if _in_use(port):
        raise click.ClickException(
            f"port {port} is already in use, so the dev server would fall back to another "
            f"one — and the .env pins the auth origin to http://localhost:{port}, which "
            "would then be wrong and login would fail with no useful error.\n"
            "Free it, or pass --port <n> and start the dev server with the same --port."
        )

    busy = list(_conflicts(port_offset))
    if busy:
        names = ", ".join(f"{t.port + port_offset} ({t.name})" for t in busy)
        raise click.ClickException(
            f"these local ports are already in use: {names}\n"
            "Either stop whatever holds them (a local appliance? "
            "`helix appliance down --keep`), or shift the tunnels with "
            "--port-offset 10000 — the generated .env is rewritten to match."
        )

    if write_env:
        click.echo(f"Reading the appliance env from {user}@{host} …")
        env = _read_remote_env(host, user, key)
        certs = _fetch_cert_files(env, host, user, key, LOCAL_DIR / "certs")
        storage = LOCAL_DIR / "storage"
        storage.mkdir(parents=True, exist_ok=True)
        overrides = {
            **_retarget_ports(env, port_offset),
            **_local_overrides(env, certs, storage, port),
        }

        target = WEB_APPS / app / ".env"
        if target.exists():
            backup = target.with_suffix(".env.local-backup")
            backup.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
            click.echo(f"  backed up the existing .env → {backup.name}")
        target.write_text(_render_env(env, overrides), encoding="utf-8")
        click.echo(f"  wrote {target}  ({len(env)} vars from the box, {len(overrides)} overridden)")
        if certs:
            click.echo(f"  copied {len(certs)} cert/key file(s) → {LOCAL_DIR / 'certs'}")

    click.echo("\nForwarding:")
    for tunnel in TUNNELS:
        local = tunnel.port + port_offset
        arrow = f"127.0.0.1:{local:<5} → {host}:{tunnel.port}"
        click.echo(f"  {arrow:<40} {tunnel.name}")
    click.echo(
        f"\nTunnels are up. In another shell:\n"
        f"  cd web/apps/{app} && NODE_OPTIONS=--max-old-space-size=2048 "
        f"pnpm run dev --port {port}\n\n"
        "Ctrl-C here closes the tunnels (and the app loses its backing services).\n"
    )

    process = subprocess.Popen(_tunnel_args(host, user, key, port_offset))
    try:
        process.wait()
    except KeyboardInterrupt:
        click.echo("\nclosing tunnels …")
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        sys.exit(0)
    if process.returncode not in (0, None):
        raise click.ClickException(f"ssh exited with {process.returncode}")
