from __future__ import annotations

import importlib

import click

from embedded.commands import embedded


@click.group()
def cli() -> None:
    """Helix developer tooling."""


# `embedded` is always available (and is all the lean ESP-IDF build image needs).
cli.add_command(embedded)

# Optional groups: skip any whose extra deps (paho, pyserial, ...) are absent rather than break the CLI.
_OPTIONAL_GROUPS: tuple[tuple[str, str, str | None], ...] = (
    ("linux.platform_os.commands", "platform_os", "os"),
    ("tooling.android.commands", "android", None),
    ("tooling.device.commands", "device", None),
    ("tooling.protocol.commands", "protocol", None),
    ("tooling.ui.commands", "ui", None),
    ("tooling.appliance.commands", "appliance", None),
    ("tooling.ami.commands", "ami", None),
    ("tooling.e2e.commands", "e2e", None),
    ("tooling.loadtest.commands", "loadtest", None),
    ("tooling.release.commands", "release", None),
    ("tooling.reports.commands", "reports", None),
    ("tooling.lint.commands", "lint", None),
)

for module_path, attribute, command_name in _OPTIONAL_GROUPS:
    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError:
        continue
    cli.add_command(getattr(module, attribute), command_name)


if __name__ == "__main__":
    cli()
