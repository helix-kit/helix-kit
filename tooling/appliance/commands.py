from __future__ import annotations

from pathlib import Path

import click

from tooling.appliance.appliance import Appliance
from tooling.appliance.bundles import BUNDLE_NAMES, build_bundles
from tooling.appliance.config import ApplianceConfig, ServerMode
from tooling.appliance.remote import run_remote_dev

_PORT_BASE_HELP = (
    "Base host port: every service maps to base+1, base+2, … and the container "
    "+ volume are suffixed with the base, so several appliances run in parallel."
)


def _appliance(port_base: int | None = None) -> Appliance:
    config = ApplianceConfig() if port_base is None else ApplianceConfig.from_base_port(port_base)
    return Appliance(config)


@click.group()
def appliance() -> None:
    """Build and run the Helix appliance container."""


@appliance.command("build")
def appliance_build() -> None:
    """Build the appliance image from the current repo."""
    _appliance().build()
    click.echo("appliance image built.")


@appliance.command("bundles")
@click.option("--version", default=None, help="Bundle version label (default: 0.0.0+<git sha>).")
@click.option(
    "--only",
    type=click.Choice(BUNDLE_NAMES),
    default=None,
    help="Build just one bundle instead of all.",
)
@click.option(
    "--skip-build",
    is_flag=True,
    help="Skip pnpm install + turbo build; only (re)stage + zip existing build output.",
)
@click.option(
    "--arch",
    type=click.Choice(("amd64", "arm64")),
    default="amd64",
    show_default=True,
    help="Target architecture. arm64 builds an arch-independent bundle (no native sharp).",
)
def appliance_bundles(version: str | None, only: str | None, skip_build: bool, arch: str) -> None:
    """Build the web app bundles (Next standalone + helix-server) into cloud/appliance/bundles/."""
    built = build_bundles(version=version, only=only, skip_build=skip_build, arch=arch)
    click.echo("")
    click.echo("bundles ready:")
    for path in built:
        size_mb = path.stat().st_size / (1024 * 1024)
        click.echo(f"  {path.name}  ({size_mb:.1f} MiB)")


@appliance.command("up")
@click.option("--fresh/--no-fresh", default=True, help="Recreate the container + data volume.")
@click.option("--build", "build_image", is_flag=True, help="Build the image first if missing.")
@click.option("--port-base", type=int, default=None, help=_PORT_BASE_HELP)
def appliance_up(fresh: bool, build_image: bool, port_base: int | None) -> None:
    """Start the appliance (safe cgroup flags, isolated ports) and wait for readiness."""
    instance = _appliance(port_base)
    if build_image and not instance.image_exists():
        instance.build()
    if not instance.image_exists():
        raise click.ClickException(
            f"image {instance.config.image} not found; run 'helix appliance build' first."
        )
    instance.up(fresh=fresh)
    instance.wait_ready()
    instance.prepare_host_access()
    if instance.config.mode is ServerMode.HOST:
        instance.write_dev_env(fresh=fresh, echo_env=True)
    instance.run_migrations()
    instance.seed_features()
    cfg = instance.config
    click.echo("")
    click.echo(f"appliance '{cfg.container}' is up.")
    click.echo(f"  postgres  127.0.0.1:{cfg.postgres_port}")
    click.echo(f"  step-ca   https://127.0.0.1:{cfg.step_ca_port}")
    click.echo(f"  redpanda  127.0.0.1:{cfg.redpanda_port}")
    click.echo(
        f"  mosquitto 127.0.0.1:{cfg.mosquitto_device_port} (device) / "
        f"{cfg.mosquitto_service_port} (service)"
    )
    click.echo(f"  http/mtls 127.0.0.1:{cfg.public_http_port} / {cfg.device_mtls_port}")


@appliance.command("down")
@click.option("--purge/--keep", default=True, help="Also delete the data volume.")
@click.option("--port-base", type=int, default=None, help=_PORT_BASE_HELP)
def appliance_down(purge: bool, port_base: int | None) -> None:
    """Stop and remove the appliance container."""
    _appliance(port_base).down(purge=purge)
    click.echo("appliance stopped.")


@appliance.command("psql")
@click.argument("sql")
@click.option("--port-base", type=int, default=None, help=_PORT_BASE_HELP)
def appliance_psql(sql: str, port_base: int | None) -> None:
    """Run a SQL statement against the appliance database."""
    result = _appliance(port_base).psql(sql)
    click.echo(result.stdout.strip())


@appliance.command("remote")
@click.option("--host", required=True, help="The appliance host (e.g. the EC2 public IP).")
@click.option("--user", default="helix", show_default=True, help="SSH user on the appliance.")
@click.option(
    "--key",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="SSH private key (defaults to your agent/ssh config).",
)
@click.option(
    "--app",
    default="helix",
    show_default=True,
    help="Which web app's .env to write.",
)
@click.option(
    "--no-env",
    is_flag=True,
    help="Only open the tunnels; leave the existing .env alone.",
)
@click.option(
    "--port",
    default=3000,
    show_default=True,
    type=int,
    help=(
        "The port the dev server will serve on. The auth origin in the generated .env "
        "is pinned to it, so start the dev server with the SAME --port."
    ),
)
@click.option(
    "--port-offset",
    default=0,
    show_default=True,
    type=int,
    help=(
        "Shift every LOCAL port by this much when the appliance's ports are already "
        "taken here (e.g. 10000 → Postgres on 15432). The generated .env is rewritten "
        "to match, so nothing else changes."
    ),
)
def appliance_remote(
    host: str,
    user: str,
    key: Path | None,
    app: str,
    no_env: bool,
    port: int,
    port_offset: int,
) -> None:
    """Run the web apps locally against a REMOTE (live) appliance."""
    run_remote_dev(
        host=host,
        user=user,
        key=key,
        write_env=not no_env,
        app=app,
        port_offset=port_offset,
        port=port,
    )
