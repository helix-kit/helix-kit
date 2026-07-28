from __future__ import annotations

import os

import click

from tooling.appliance.config import ServerMode
from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

WEB_ROOT = REPO_ROOT / "web"
E2E_TEST_PATH = "tests/e2e"


@click.group()
def e2e() -> None:
    """Run Helix end-to-end tests (appliance-backed and browser)."""


@e2e.command("run")
@click.option(
    "--mode",
    type=click.Choice([m.value for m in ServerMode]),
    default=ServerMode.HOST.value,
    help="How helix-server runs against the appliance infra.",
)
@click.option("--keep", is_flag=True, help="Leave the appliance running after the tests.")
@click.option("--build", "build_image", is_flag=True, help="Build the appliance image if missing.")
@click.option("-k", "keyword", default=None, help="Only run tests matching this pytest expression.")
def e2e_run(mode: str, keep: bool, build_image: bool, keyword: str | None) -> None:
    """Boot a fresh appliance and run the appliance-backed e2e suite."""
    env = {
        **os.environ,
        "HELIX_E2E_MODE": mode,
        "HELIX_E2E_KEEP": "1" if keep else "",
        "HELIX_E2E_BUILD": "1" if build_image else "",
    }
    command = ["pytest", E2E_TEST_PATH, "-v"]
    if keyword is not None:
        command += ["-k", keyword]
    run(command, cwd=REPO_ROOT, env=env)


@e2e.command("browser")
@click.option("--headed", is_flag=True, help="Run with a visible browser (needs a display).")
def e2e_browser(headed: bool) -> None:
    """Run the hardware-in-the-loop browser (Playwright) tests."""
    command = ["pnpm", "--filter", "@helix/e2e", "test:headed" if headed else "test"]
    run(command, cwd=WEB_ROOT)
