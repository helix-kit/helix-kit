from __future__ import annotations

import importlib

import click

from embedded.commands import embedded


@click.group()
def cli() -> None:
    """Helix developer tooling."""


# `embedded` is always available (and is all the lean ESP-IDF build image needs).
cli.add_command(embedded)

# Optional command groups. Their extra dependencies (paho, pyserial, ...) are not
# installed in lean environments such as the ESP-IDF build image, where only the
# `embedded` group is exercised via `python -m tooling.cli embedded esp32 ...`.
# Skip a group whose dependencies are missing rather than break the whole CLI.
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
