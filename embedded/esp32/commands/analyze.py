from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import click

from tooling.common import REPO_ROOT, format_bytes

from .config import (
    DEFAULT_ANALYSIS_DIR,
    DEFAULT_BUILD_DIR,
    esp32_root,
    firmware_dir_from_arg,
    resolve_docker_image,
)


def parse_int(value: str) -> int:
    value = value.strip()
    if value.lower().startswith("0x"):
        return int(value, 16)
    return int(value, 10)


def parse_partition_table(path: Path) -> list[dict[str, Any]]:
    partitions: list[dict[str, Any]] = []
    if not path.exists():
        return partitions
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5:
            continue
        name, part_type, subtype, offset, size = parts[:5]
        partitions.append(
            {
                "name": name,
                "type": part_type,
                "subtype": subtype,
                "offset": parse_int(offset),
                "size": parse_int(size),
            }
        )
    return partitions


def app_partition_capacity() -> dict[str, Any] | None:
    app_partitions = [
        partition
        for partition in parse_partition_table(esp32_root() / "partitions_4mb.csv")
        if partition.get("type") == "app"
    ]
    if not app_partitions:
        return None
    smallest = min(app_partitions, key=lambda partition: int(partition["size"]))
    return {"partition": smallest["name"], "sizeBytes": int(smallest["size"])}


def artifact_sizes(build_dir: Path, firmware_dir: Path) -> dict[str, dict[str, Any]]:
    candidates = {
        "appBin": build_dir / "esp32_firmware.bin",
        "elf": build_dir / "esp32_firmware.elf",
        "map": build_dir / "esp32_firmware.map",
        "bootloader": build_dir / "bootloader" / "bootloader.bin",
        "partitionTable": build_dir / "partition_table" / "partition-table.bin",
        "otaData": build_dir / "ota_data_initial.bin",
    }
    if firmware_dir.exists():
        candidates.update(
            {
                "firmwareAppBin": firmware_dir / "esp32_firmware.bin",
                "firmwareBootloader": firmware_dir / "bootloader.bin",
                "firmwarePartitionTable": firmware_dir / "partition-table.bin",
                "firmwareOtaData": firmware_dir / "ota_data_initial.bin",
                "firmwareManifest": firmware_dir / "manifest.json",
            }
        )

    sizes: dict[str, dict[str, Any]] = {}
    for name, path in candidates.items():
        if path.exists():
            if path.is_relative_to(esp32_root()):
                display_path = path.relative_to(esp32_root())
            else:
                display_path = path
            sizes[name] = {"path": str(display_path), "bytes": path.stat().st_size}
    return sizes


def run_xtensa_tool(args: list[str], image: str, use_host: bool) -> str:
    if use_host:
        command = args
        cwd = esp32_root()
    else:
        command = [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{esp32_root()}:/project",
            "-w",
            "/project",
            image,
            *args,
        ]
        cwd = REPO_ROOT
    result = subprocess.run(command, cwd=cwd, check=False, text=True, capture_output=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise click.ClickException(f"analysis tool failed: {' '.join(args)}\n{message}")
    return result.stdout


def parse_size_sections(output: str) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[0] == "section":
            continue
        try:
            size = int(parts[1])
        except ValueError:
            continue
        sections.append({"name": parts[0], "sizeBytes": size, "address": parts[2]})
    return sections


def section_groups(sections: list[dict[str, Any]]) -> dict[str, int]:
    by_name = {str(section["name"]): int(section["sizeBytes"]) for section in sections}
    debug_total = sum(
        size
        for name, size in by_name.items()
        if name.startswith(".debug_") or name in {".xtensa.info", ".comment"}
    )
    return {
        "flashTextBytes": by_name.get(".flash.text", 0),
        "flashRodataBytes": by_name.get(".flash.rodata", 0)
        + by_name.get(".flash.rodata_noload", 0)
        + by_name.get(".flash.appdesc", 0),
        "iramTextBytes": by_name.get(".iram0.text", 0),
        "dramStaticBytes": by_name.get(".dram0.data", 0) + by_name.get(".dram0.bss", 0),
        "debugElfOnlyBytes": debug_total,
    }


def archive_sizes(build_dir: Path, limit: int) -> list[dict[str, Any]]:
    archives: list[dict[str, Any]] = []
    for archive in (build_dir / "esp-idf").glob("*/*.a"):
        component = archive.parent.name
        archives.append(
            {
                "component": component,
                "path": str(archive.relative_to(esp32_root())),
                "bytes": archive.stat().st_size,
            }
        )
    return sorted(archives, key=lambda item: int(item["bytes"]), reverse=True)[:limit]


def parse_nm_symbols(output: str, limit: int) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    for line in output.splitlines():
        parts = line.split(maxsplit=3)
        if len(parts) != 4:
            continue
        address, size_text, symbol_type, name = parts
        try:
            size = int(size_text, 10)
        except ValueError:
            continue
        symbols.append({"name": name, "type": symbol_type, "address": address, "sizeBytes": size})
    return sorted(symbols, key=lambda item: int(item["sizeBytes"]), reverse=True)[:limit]


def write_analysis_outputs(report: dict[str, Any], out_dir: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "size-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# ESP32 Size Analysis",
        "",
        f"- Build directory: `{report['buildDir']}`",
        f"- Firmware directory: `{report['firmwareDir']}`",
    ]
    partition = report.get("partitionUsage")
    if partition:
        lines.append(
            f"- App partition `{partition['partition']}`: {format_bytes(partition['usedBytes'])} "
            f"used / {format_bytes(partition['capacityBytes'])} total "
            f"({partition['usedPercent']:.1f}%)"
        )
    lines.extend(["", "## Section Summary", ""])
    for key, value in report["sectionSummary"].items():
        lines.append(f"- `{key}`: {format_bytes(value)}")
    lines.extend(["", "## Largest Linked Symbols", ""])
    for symbol in report["topSymbols"][:20]:
        lines.append(f"- {format_bytes(symbol['sizeBytes'])} `{symbol['name']}`")
    (out_dir / "size-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_analysis_text(report: dict[str, Any]) -> None:
    click.echo("ESP32 size analysis")
    click.echo(f"build: {report['buildDir']}")
    click.echo(f"firmware: {report['firmwareDir']}")
    partition = report.get("partitionUsage")
    if partition:
        click.echo(
            "app partition: "
            f"{partition['partition']} {format_bytes(partition['usedBytes'])}/"
            f"{format_bytes(partition['capacityBytes'])} used "
            f"({partition['usedPercent']:.1f}%, {format_bytes(partition['freeBytes'])} free)"
        )
    click.echo()
    click.echo("artifacts")
    for name, artifact in report["artifacts"].items():
        click.echo(f"  {name:22} {format_bytes(artifact['bytes']):>10}  {artifact['path']}")
    click.echo()
    click.echo("section summary")
    for key, value in report["sectionSummary"].items():
        click.echo(f"  {key:22} {format_bytes(value):>10}")
    click.echo()
    click.echo("largest component archives (compiled archive size, not exact linked contribution)")
    for archive in report["topArchives"]:
        click.echo(f"  {archive['component']:28} {format_bytes(archive['bytes']):>10}")
    click.echo()
    click.echo("largest linked symbols")
    for symbol in report["topSymbols"]:
        click.echo(f"  {format_bytes(symbol['sizeBytes']):>10}  {symbol['type']}  {symbol['name']}")
    click.echo()
    click.echo(f"report: {report['reportDir']}")


@click.command()
@click.option("--build-dir", default=DEFAULT_BUILD_DIR, show_default=True)
@click.option("--firmware-dir", default="out/firmware/latest", show_default=True)
@click.option("--top", default=25, show_default=True, help="Number of top archives and symbols.")
@click.option("--format", "output_format", type=click.Choice(["text", "json"]), default="text")
@click.option("--host", is_flag=True, help="Run xtensa analysis tools on host.")
@click.option("--docker-image", default="")
def analyze(
    build_dir: str,
    firmware_dir: str,
    top: int,
    output_format: str,
    host: bool,
    docker_image: str,
) -> None:
    """Analyze ESP32 firmware binary size and linked symbols."""
    build_path = esp32_root() / build_dir
    firmware_path = firmware_dir_from_arg(firmware_dir)
    elf = build_path / "esp32_firmware.elf"
    app_bin = build_path / "esp32_firmware.bin"
    if not elf.exists() or not app_bin.exists():
        raise click.ClickException(
            f"missing firmware build artifacts in {build_path}; "
            "run `helix embedded esp32 link ...` first"
        )

    image = resolve_docker_image(docker_image)
    size_output = run_xtensa_tool(
        ["xtensa-esp32-elf-size", "-A", str(elf.relative_to(esp32_root()))],
        image,
        host,
    )
    nm_output = run_xtensa_tool(
        [
            "xtensa-esp32-elf-nm",
            "-S",
            "--size-sort",
            "-t",
            "d",
            str(elf.relative_to(esp32_root())),
        ],
        image,
        host,
    )

    sections = parse_size_sections(size_output)
    capacity = app_partition_capacity()
    used = app_bin.stat().st_size
    partition_usage = None
    if capacity:
        total = int(capacity["sizeBytes"])
        free = total - used
        partition_usage = {
            "partition": capacity["partition"],
            "capacityBytes": total,
            "usedBytes": used,
            "freeBytes": free,
            "usedPercent": (used / total) * 100 if total else 0,
        }

    selection = firmware_path.name if firmware_path.name != "latest" else "latest"
    if firmware_path.is_symlink():
        try:
            selection = firmware_path.resolve().name
        except OSError:
            selection = "latest"
    report_dir = esp32_root() / DEFAULT_ANALYSIS_DIR / selection
    report: dict[str, Any] = {
        "buildDir": str(build_path.relative_to(esp32_root())),
        "firmwareDir": str(
            firmware_path.relative_to(esp32_root())
            if firmware_path.is_relative_to(esp32_root())
            else firmware_path
        ),
        "reportDir": str(report_dir.relative_to(esp32_root())),
        "artifacts": artifact_sizes(build_path, firmware_path),
        "partitionUsage": partition_usage,
        "sections": sections,
        "sectionSummary": section_groups(sections),
        "topArchives": archive_sizes(build_path, top),
        "topSymbols": parse_nm_symbols(nm_output, top),
    }
    write_analysis_outputs(report, report_dir)
    if output_format == "json":
        click.echo(json.dumps(report, indent=2))
    else:
        print_analysis_text(report)
