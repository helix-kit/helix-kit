from __future__ import annotations

import click

from .analyze import analyze
from .apps import apps, select
from .build import hw_test, link, prebuild, qemu, qemu_test, vscode
from .flash import flash


@click.group()
def esp32() -> None:
    """ESP32 firmware tasks."""


esp32.add_command(analyze)
esp32.add_command(apps)
esp32.add_command(flash)
esp32.add_command(link)
esp32.add_command(prebuild)
esp32.add_command(hw_test)
esp32.add_command(qemu)
esp32.add_command(qemu_test)
esp32.add_command(select)
esp32.add_command(vscode)
