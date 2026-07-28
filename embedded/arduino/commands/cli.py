# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import subprocess

import click

from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

from .simulator import (
    BOARDS,
    DEFAULT_BOARD,
    SerialSimulator,
    ToolMissing,
    compile_sketch,
    qemu_command,
    require_tool,
    resolve_sketch,
)

BOARD_OPTION = click.option(
    "--board",
    type=click.Choice(list(BOARDS)),
    default=DEFAULT_BOARD,
    show_default=True,
    help="Target AVR board.",
)


@click.group()
def arduino() -> None:
    """Arduino / AVR firmware: build, simulate (QEMU), flash, and test.

    Serial-only devices (no WiFi/BLE), developed against a qemu-system-avr
    simulator so no physical board is needed. See embedded/arduino/README.md.
    """


@arduino.command()
@click.argument("sketch")
@BOARD_OPTION
def build(sketch: str, board: str) -> None:
    """Compile SKETCH (a dir path or a name under embedded/arduino/)."""
    try:
        elf = compile_sketch(sketch, board)
    except (ToolMissing, FileNotFoundError, RuntimeError, ValueError) as exc:
        raise click.ClickException(str(exc)) from exc
    click.echo(elf)


@arduino.command("run")
@click.argument("sketch")
@BOARD_OPTION
@click.option(
    "--tcp",
    type=int,
    metavar="PORT",
    help="Expose serial as a TCP server instead of this terminal.",
)
def run_sim(sketch: str, board: str, tcp: int | None) -> None:
    """Build SKETCH and run it under QEMU, bridging its serial port.

    Without --tcp the serial port is this terminal (Ctrl-A X quits qemu).
    """
    try:
        elf = compile_sketch(sketch, board)
        machine = BOARDS[board]["machine"]
        if tcp:
            serial = ["-serial", f"tcp:127.0.0.1:{tcp},server=on,wait=off"]
            click.echo(f"serial on tcp://127.0.0.1:{tcp}", err=True)
        else:
            serial = ["-serial", "stdio"]
            click.echo("serial is this terminal; Ctrl-A X quits qemu\n", err=True)
        subprocess.run(qemu_command(machine, elf, serial), check=False)
    except (ToolMissing, FileNotFoundError, RuntimeError, ValueError) as exc:
        raise click.ClickException(str(exc)) from exc


@arduino.command()
@click.argument("sketch")
@click.option("--port", required=True, help="Serial port of the board, e.g. /dev/ttyACM0.")
@BOARD_OPTION
def flash(sketch: str, port: str, board: str) -> None:
    """Build SKETCH and upload it to a physically connected board."""
    try:
        sketch_dir = resolve_sketch(sketch)
        require_tool("arduino-cli")
    except (ToolMissing, FileNotFoundError) as exc:
        raise click.ClickException(str(exc)) from exc
    fqbn = BOARDS[board]["fqbn"]
    run(
        ["arduino-cli", "compile", "--fqbn", fqbn, str(sketch_dir)],
        cwd=REPO_ROOT,
    )
    run(
        ["arduino-cli", "upload", "-p", port, "--fqbn", fqbn, str(sketch_dir)],
        cwd=REPO_ROOT,
    )
    click.echo(f"done: flashed {sketch_dir.name} to {port}")


@arduino.command()
@BOARD_OPTION
def smoke(board: str) -> None:
    """Quick serial + Helix-protocol round-trip check in QEMU (no pytest).

    Exercises the real helix_node firmware: FreeRTOS + the ESP32-shared Helix
    dispatcher/endpoint/cJSON core over the serial transport.
    """
    try:
        echo_elf = compile_sketch("qemu_smoke", board)
        node_elf = compile_sketch("helix_node", board)
        machine = BOARDS[board]["machine"]

        with SerialSimulator(echo_elf, machine) as sim:
            sim.send_line("ping")
            sim.read_until("ECHO ping")
        click.echo("ok: serial echo round-trip")

        request = (
            'SERVICE {"requestId":"smoke-1","message":{"service":"gpio-control",'
            '"method":"set-gpio","payload":{"pin":13,"high":true}}}'
        )
        with SerialSimulator(node_elf, machine) as sim:
            sim.read_until("HELIX_NODE ready")
            sim.send_line(request)
            reply = sim.read_line_with_prefix("HELIX_RESPONSE ")
        click.echo(f"ok: helix_node protocol round-trip -> {reply}")
    except (ToolMissing, FileNotFoundError, RuntimeError, ValueError, TimeoutError) as exc:
        raise click.ClickException(str(exc)) from exc


@arduino.command()
@click.option("-k", "keyword", default=None, help="Only run tests matching this expression.")
def test(keyword: str | None) -> None:
    """Run the Arduino simulator e2e suite (pytest)."""
    command = ["pytest", "tests/e2e/test_arduino_sim.py", "-v"]
    if keyword is not None:
        command += ["-k", keyword]
    run(command, cwd=REPO_ROOT)
