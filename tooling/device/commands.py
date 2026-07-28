from __future__ import annotations

import click

from tooling.device.ble import ble
from tooling.device.console import console
from tooling.device.deploy import deploy
from tooling.device.eyes import eyes
from tooling.device.latency import latency
from tooling.device.mqtt import mqtt
from tooling.device.package import config_push, metrics, package, status, test_host
from tooling.device.provision import provision
from tooling.device.serial import serial


@click.group()
def device() -> None:
    """Send Helix protocol requests to devices and manage the Linux runtime."""


device.add_command(ble)
device.add_command(config_push)
device.add_command(console)
device.add_command(deploy)
device.add_command(eyes)
device.add_command(latency)
device.add_command(metrics)
device.add_command(mqtt)
device.add_command(package)
device.add_command(provision)
device.add_command(serial)
device.add_command(status)
device.add_command(test_host)
