import os
import shlex
import subprocess
from collections.abc import Mapping
from pathlib import Path

import click


def run_script(script: Path, env: Mapping[str, str] | None = None) -> None:
    if not script.exists():
        raise click.ClickException(f"Script does not exist: {script}")

    if not script.is_file():
        raise click.ClickException(f"Not a script file: {script}")

    cmd = ["bash", str(script)]
    script_env = os.environ.copy()
    if env is not None:
        script_env.update(env)

    click.echo("+ " + shlex.join(cmd))
    subprocess.run(cmd, check=True, env=script_env)
