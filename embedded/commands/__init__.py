from __future__ import annotations

import click

from embedded.arduino.commands import arduino
from embedded.esp32.commands import esp32


@click.group()
def embedded() -> None:
    """Embedded device tooling."""


embedded.add_command(arduino)
embedded.add_command(esp32)
