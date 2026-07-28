"""Run the web apps locally against a REMOTE appliance (the live EC2 box).

The appliance keeps every backing service on loopback — Postgres on
127.0.0.1:5432, OpenFGA on :8080, step-ca on :9000, Redpanda on :9092 — and its
env files address them exactly that way. That is the whole trick: forward each
service to the SAME port number on your machine, and the appliance's own env is
almost verbatim usable locally. `DATABASE_URL=…@127.0.0.1:5432/helix` means the
appliance's Postgres when read on the box, and the tunnel to it when read here.

Only four things cannot survive the trip, and they are what this module fixes up:

  1. FILE paths (the mTLS/PKI certs) — they name files on the box, so we copy
     them down and rewrite the *_PATH vars to point at the local copies.
  2. ORIGIN urls (PUBLIC_APP_URL, BETTER_AUTH_URL, NEXT_PUBLIC_BASE_URL) — the
     app now runs at http://localhost:3000, and better-auth issues cookies for
     the origin it is told about, so a production origin here means you can never
     log in.
  3. FS storage — FS_STORAGE_ROOT is a directory on the box. Uploads go to a
     local dir instead, so images uploaded in prod will 404 locally (and vice
     versa). Nothing is corrupted; the DB rows just point at files you do not
     have.
  4. NODE_ENV — production here would enable prod-only behavior (and disable the
     dev-only trusted origins better-auth needs for localhost).

Everything else — the DB, the auth secret, OpenFGA, the event queue, the PKI —
is the real thing. Which is the point, and also the danger: see the warning the
command prints.
"""

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
# Everything this command writes lives here: the copied certs, the local storage
# root. Gitignored, disposable, and obviously not part of the repo's own state.
LOCAL_DIR = REPO_ROOT / ".helix-remote"

# The env files the appliance loads into every unit, in the order systemd does
# (later wins) — so a value set in site.env overrides internal.env, exactly as on
# the box.
REMOTE_ENV_FILES = ("internal.env", "secrets.env", "site.env")
REMOTE_ENV_DIR = "/var/lib/helix/env"


@dataclass(frozen=True)
class Tunnel:
    """One forwarded service.

    By default the local port equals the remote one, because the appliance's env
    already says 127.0.0.1:<port> — forwarding to the same number makes that env
    true here with no rewriting at all.

    When one of those ports is already taken on your machine (a local appliance,
    another project's container), --port-offset shifts every local port by a
    fixed amount and the env is rewritten to match, so the two modes are
    otherwise identical.
    """

    port: int
    name: str


# What the web apps actually talk to. Ports match the appliance's loopback binds.
TUNNELS: tuple[Tunnel, ...] = (
    Tunnel(5432, "postgres"),
    Tunnel(8080, "openfga"),
    Tunnel(9000, "step-ca"),
    Tunnel(9092, "redpanda (event queue)"),
    # Mosquitto has TWO listeners: 8883 is the DEVICE mTLS one, 8884 is the
    # SERVICE one that helix-server actually dials (MQTT_BROKER_URL). Forwarding
    # only 8883 leaves a locally-run helix-server unable to reach the broker.
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
    # `cat` in order: later files override earlier ones, which is what systemd's
    # repeated EnvironmentFile= does, so the merged view matches the running app.
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
    """Copy every file a *_PATH var names, and return the rewritten vars.

    The files are root-owned on the box, so they are staged into /tmp with
    readable modes before scp — a plain `scp` of them would just fail.
    """
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
    """Rewrite every 127.0.0.1:<remote-port> in the env to the local port.

    A plain string substitution is enough and is deliberately blunt: these values
    are URLs (postgres://…@127.0.0.1:5432/helix), broker lists
    (127.0.0.1:9092) and bare origins, and the host:port pair is spelled the same
    way in all of them.
    """
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
    # Must be the origin the dev server ACTUALLY serves on: it is better-auth's
    # baseURL, which is checked against the request Origin (CSRF) and is what
    # redirect/callback links are built from. Hence --port, and the check below.
    local_origin = f"http://localhost:{port}"
    overrides: dict[str, str] = {
        **certs,
        # The app runs here, not on the box. An https:// baseURL also makes
        # better-auth mark the session cookie Secure/__Secure- — tolerated on
        # localhost (a secure context) but not on a LAN IP, and prod auth emails
        # would link back to the live site.
        "BETTER_AUTH_URL": local_origin,
        "NEXT_PUBLIC_BASE_URL": local_origin,
        "PUBLIC_APP_URL": local_origin,
        # Dev mode: enables the dev-only trusted origins and Next's dev server.
        "NODE_ENV": "development",
        # FS storage is a directory on the box. Point it somewhere local; prod
        # uploads will not resolve here (the DB rows reference files we do not
        # have), and anything uploaded here stays here.
        "FS_STORAGE_ROOT": str(storage),
    }
    # The device data plane is NOT tunnelled: real devices keep talking to the
    # real box, so the browser must be told to reach them there.
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
        # Keep it a valid dotenv line even when a value contains spaces (the
        # Caddy ACME line does).
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
