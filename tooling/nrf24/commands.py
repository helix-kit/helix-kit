from __future__ import annotations

import shlex
import subprocess
from pathlib import Path

import click

from tooling.common import REPO_ROOT

MODULE_DIR = Path(__file__).resolve().parent
REMOTE_DIR = "~/.helix-nrf24"


def _run_remote(host: str, module: str, args: list[str]) -> int:
    """Ship the driver to the board and run it there.

    The radio is wired to the board's SPI/GPIO, so the tool has to execute on the
    device. It is dependency-free by design, so syncing two files is the whole
    install -- no apt, no venv, nothing left behind but a directory.
    """
    # -n on every ssh: without it ssh reads the caller's stdin, which silently
    # steals input from whatever is driving this command.
    subprocess.run(["ssh", "-n", host, f"mkdir -p {REMOTE_DIR}/nrf24"], check=True)
    sources = ["__init__.py", "driver.py", "probe.py", "receive.py"]
    subprocess.run(
        ["scp", "-q", *[str(MODULE_DIR / name) for name in sources], f"{host}:{REMOTE_DIR}/nrf24/"],
        check=True,
    )
    remote_cmd = (
        f"cd {REMOTE_DIR} && python3 -m nrf24.{module} {' '.join(shlex.quote(a) for a in args)}"
    )
    return subprocess.run(["ssh", "-n", host, remote_cmd], check=False).returncode


def _run_local(module: str, args: list[str]) -> int:
    return subprocess.run(
        ["python3", "-m", f"tooling.nrf24.{module}", *args], cwd=REPO_ROOT, check=False
    ).returncode


def _dispatch(host: str, module: str, args: tuple[str, ...]) -> None:
    code = _run_remote(host, module, list(args)) if host else _run_local(module, list(args))
    if code != 0:
        raise SystemExit(code)


@click.group()
def nrf24() -> None:
    """Drive an nRF24L01(+) radio wired to a Linux board's SPI + GPIO."""


@nrf24.command(context_settings={"ignore_unknown_options": True})
@click.option("--host", default="", help="Run on this SSH host instead of locally.")
@click.argument("args", nargs=-1, type=click.UNPROCESSED)
def probe(host: str, args: tuple[str, ...]) -> None:
    """Bring-up probe: registers, round-trip, variant, CE/IRQ."""
    _dispatch(host, "probe", args)


@nrf24.command(context_settings={"ignore_unknown_options": True})
@click.option("--host", default="", help="Run on this SSH host instead of locally.")
@click.argument("args", nargs=-1, type=click.UNPROCESSED)
def receive(host: str, args: tuple[str, ...]) -> None:
    """Listen as PRX for the ESP32 `nrf24_link` app's packets."""
    _dispatch(host, "receive", args)
