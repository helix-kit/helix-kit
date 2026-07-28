from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import click

from tooling.common import REPO_ROOT, run

from .config import DEFAULT_PORT, esp32_root, firmware_dir_from_arg, resolve_docker_image


def load_provision_json(provision_file: str, provision_json: str) -> str:
    if provision_file and provision_json:
        raise click.ClickException("use only one of --provision-file or --provision-json")
    if provision_file:
        payload = json.loads(Path(provision_file).read_text(encoding="utf-8"))
        return json.dumps(payload, separators=(",", ":"))
    if provision_json:
        return json.dumps(json.loads(provision_json), separators=(",", ":"))
    return ""


def run_esptool_docker(
    port: str, firmware_dir: Path, image: str, command: list[str], baud: int = 460800
) -> None:
    run(
        [
            "docker",
            "run",
            "--rm",
            f"--device={port}",
            "-v",
            f"{firmware_dir}:/firmware",
            "-w",
            "/firmware",
            image,
            "python",
            "-m",
            "esptool",
            "--chip",
            "esp32",
            "-p",
            port,
            "-b",
            str(baud),
            *command,
        ],
        cwd=REPO_ROOT,
    )


def provision_over_uart(port: str, provision_json: str) -> None:
    try:
        import serial
    except ImportError as exc:
        raise click.ClickException(
            "pyserial is required for provisioning: python3 -m pip install pyserial"
        ) from exc

    line = f"NVS_SET {provision_json}\n".encode()
    with serial.Serial(port, 115200, timeout=0.2) as ser:
        time.sleep(2.0)
        ser.write(line)
        ser.flush()

        deadline = time.time() + 30
        buf = bytearray()
        while time.time() < deadline:
            data = ser.read(1024)
            if not data:
                continue
            buf.extend(data)
            while b"\n" in buf:
                raw, _, rest = buf.partition(b"\n")
                buf = bytearray(rest)
                text = raw.decode("utf-8", "replace").strip()
                if not text:
                    continue
                click.echo(text)
                if text == "NVS_OK" or "PROVISIONING_OK" in text:
                    click.echo("done: NVS provisioning accepted")
                    return
                if (
                    text.startswith("NVS_ERROR")
                    or "PROVISIONING_INVALID" in text
                    or "PROVISIONING_STORE_FAILED" in text
                ):
                    raise click.ClickException("provisioning failed")
    raise click.ClickException("timed out waiting for NVS provisioning acknowledgement")


@click.command()
@click.option("--port", default=DEFAULT_PORT, show_default=True)
@click.option("--firmware-dir", default="out/firmware/latest", show_default=True)
@click.option(
    "--baud",
    default=460800,
    show_default=True,
    type=int,
    help="esptool baud rate; lower it (e.g. 115200) for long/marginal USB cables.",
)
@click.option("--clear-nvs", is_flag=True)
@click.option("--erase-flash", is_flag=True)
@click.option("--provision-file", default="")
@click.option("--provision-json", default="")
@click.option("--no-provision", is_flag=True)
@click.option("--docker-image", default="")
def flash(
    port: str,
    firmware_dir: str,
    baud: int,
    clear_nvs: bool,
    erase_flash: bool,
    provision_file: str,
    provision_json: str,
    no_provision: bool,
    docker_image: str,
) -> None:
    """Flash firmware artifacts to a USB ESP32."""
    if clear_nvs and erase_flash:
        raise click.ClickException("--clear-nvs and --erase-flash are mutually exclusive")
    if not Path(port).exists():
        raise click.ClickException(f"serial port not found: {port}")
    firmware_path = firmware_dir_from_arg(firmware_dir)
    if not firmware_path.is_dir():
        raise click.ClickException(f"firmware directory not found: {firmware_path}")
    if not (firmware_path / "flash_args").exists():
        raise click.ClickException(
            f"missing flash_args in {firmware_path}; run `helix embedded esp32 link ...` first"
        )

    provision_payload = load_provision_json(provision_file, provision_json)
    do_provision = not no_provision and provision_payload != ""
    if not no_provision and provision_payload == "":
        click.echo("no provisioning JSON supplied; flashing without NVS write")

    image = resolve_docker_image(docker_image)
    display_firmware = (
        firmware_path.relative_to(esp32_root())
        if firmware_path.is_relative_to(esp32_root())
        else firmware_path
    )
    click.echo(f"port: {port}")
    click.echo(f"firmware: {display_firmware}")
    click.echo(f"docker image: {image}")

    if erase_flash:
        click.echo("erasing full flash")
        run_esptool_docker(
            port,
            firmware_path,
            image,
            ["--before", "default_reset", "--after", "no_reset", "erase_flash"],
            baud=baud,
        )
    elif clear_nvs:
        click.echo("erasing NVS partition at 0x9000 size 0x6000")
        run_esptool_docker(
            port,
            firmware_path,
            image,
            [
                "--before",
                "default_reset",
                "--after",
                "no_reset",
                "erase_region",
                "0x9000",
                "0x6000",
            ],
            baud=baud,
        )

    click.echo("flashing firmware")
    run_esptool_docker(
        port,
        firmware_path,
        image,
        [
            "--before",
            "default_reset",
            "--after",
            "hard_reset",
            "write_flash",
            "@flash_args",
        ],
        baud=baud,
    )

    if not do_provision:
        click.echo("done: flashed firmware; NVS provisioning skipped")
        return

    if shutil.which("setfacl") and not os.access(port, os.W_OK):
        subprocess.run(
            ["sudo", "setfacl", "-m", f"u:{os.environ.get('USER', '')}:rw", port],
            check=False,
        )
    click.echo("writing NVS provisioning over UART")
    provision_over_uart(port, provision_payload)
