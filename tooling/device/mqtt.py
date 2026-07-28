from __future__ import annotations

import click


@click.group()
def mqtt() -> None:
    """Send Helix protocol requests over MQTT."""


@mqtt.command("request")
def mqtt_request() -> None:
    """Placeholder for the same request shape over MQTT."""

    raise click.ClickException("MQTT device requests are not implemented in the CLI yet")
