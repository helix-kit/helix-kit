from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import click


@dataclass(frozen=True)
class DirectorySizeEntry:
    path: Path
    bytes: int


@dataclass(frozen=True)
class DirectorySizeAnalysis:
    target: Path
    total_bytes: int
    entries: list[DirectorySizeEntry]


def delete_folder(folder: Path) -> None:
    if not folder.exists():
        click.echo(f"Nothing to clean: {folder}")
        return

    if not folder.is_dir():
        raise click.ClickException(f"Not a directory: {folder}")

    if os.geteuid() == 0:
        shutil.rmtree(folder)
    else:
        subprocess.run(["sudo", "rm", "-rf", str(folder)], check=True)

    click.echo(f"Deleted {folder}")


def delete_file(file: Path) -> None:
    if not file.exists():
        click.echo(f"Nothing to clean: {file}")
        return
    subprocess.run(["sudo", "rm", "-f", str(file)], check=True)
    click.echo(f"Deleted {file}")


def ensure_folder(folder: Path) -> None:
    if folder.exists() and not folder.is_dir():
        raise click.ClickException(f"Not a directory: {folder}")

    if not folder.exists():
        folder.mkdir(parents=True, exist_ok=True)
        click.echo(f"Created {folder}")


def analyze_directory_size(
    folder: Path,
    *,
    depth: int = 1,
    limit: int = 20,
) -> DirectorySizeAnalysis:
    if not folder.exists():
        raise click.ClickException(f"Directory does not exist: {folder}")

    if not folder.is_dir():
        raise click.ClickException(f"Not a directory: {folder}")

    if depth < 0:
        raise click.ClickException("Depth must be greater than or equal to 0")

    if limit < 1:
        raise click.ClickException("Limit must be greater than 0")

    result = _run_du(folder, depth, sudo=False)
    if result.returncode != 0 and os.geteuid() != 0 and "Permission denied" in result.stderr:
        result = _run_du(folder, depth, sudo=True)

    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip() or "du failed"
        raise click.ClickException(error)

    entries = _parse_du_output(result.stdout)
    target = folder.resolve()
    total = _find_total_bytes(entries, target)
    candidates = [entry for entry in entries if entry.path.resolve() != target]

    candidates = _prune_parent_dirs(
        candidates,
        dominance_threshold=0.60,
    )

    candidates = sorted(
        candidates,
        key=lambda entry: entry.bytes,
        reverse=True,
    )[:limit]

    return DirectorySizeAnalysis(
        target=target,
        total_bytes=total,
        entries=candidates,
    )


def _is_descendant(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return child.resolve() != parent.resolve()
    except ValueError:
        return False


def _prune_parent_dirs(
    entries: list[DirectorySizeEntry],
    *,
    dominance_threshold: float = 0.60,
) -> list[DirectorySizeEntry]:
    resolved_entries = [(entry, entry.path.resolve()) for entry in entries]

    keep: list[DirectorySizeEntry] = []

    for entry, path in resolved_entries:
        child_bytes = sum(
            child.bytes
            for child, child_path in resolved_entries
            if _is_descendant(child_path, path)
        )

        if child_bytes >= entry.bytes * dominance_threshold:
            continue

        keep.append(entry)

    return keep


def _run_du(folder: Path, depth: int, *, sudo: bool) -> subprocess.CompletedProcess[str]:
    cmd = [
        "du",
        "--block-size=1",
        f"--max-depth={depth}",
        str(folder),
    ]
    if sudo:
        cmd.insert(0, "sudo")

    return subprocess.run(cmd, text=True, capture_output=True, check=False)


def _parse_du_output(output: str) -> list[DirectorySizeEntry]:
    entries: list[DirectorySizeEntry] = []

    for line in output.splitlines():
        size, path = line.split(maxsplit=1)
        entries.append(DirectorySizeEntry(path=Path(path), bytes=int(size)))

    return entries


def _find_total_bytes(entries: list[DirectorySizeEntry], target: Path) -> int:
    for entry in entries:
        if entry.path.resolve() == target:
            return entry.bytes

    raise click.ClickException(f"du did not return a total for {target}")
