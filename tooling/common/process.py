from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import click


def _resolve_executable(command: list[str]) -> list[str]:
    if os.name != "nt" or not command:
        return command
    resolved = shutil.which(command[0])
    if resolved is None:
        return command
    return [resolved, *command[1:]]


def run(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    click.echo("+ " + " ".join(command))
    result = subprocess.run(
        _resolve_executable(command),
        cwd=cwd,
        env=env,
        text=True,
        capture_output=capture_output,
        check=False,
    )
    if check and result.returncode != 0:
        message = result.stderr or result.stdout or f"command failed: {' '.join(command)}"
        raise click.ClickException(message.strip())
    return result
