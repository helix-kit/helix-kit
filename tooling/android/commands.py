# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

import click

from tooling.android import deps as deps_mod
from tooling.common.paths import REPO_ROOT


@click.group()
def android() -> None:
    """Android SDK/app maintenance."""


@android.command("deps")
@click.option(
    "--apply",
    "apply_",
    is_flag=True,
    help="Write the resolved latest versions back to the version catalog.",
)
@click.option(
    "--include-prerelease",
    is_flag=True,
    help="Consider alpha/beta/rc/eap builds, not just stable releases.",
)
@click.option(
    "--timeout",
    type=float,
    default=15.0,
    show_default=True,
    help="Per-request Maven metadata fetch timeout, in seconds.",
)
def deps_cmd(apply_: bool, include_prerelease: bool, timeout: float) -> None:
    """Check the Android version catalog for newer library/plugin releases."""
    click.echo(f"Checking {deps_mod.VERSION_CATALOG.relative_to(REPO_ROOT)} ...")
    updates = deps_mod.check_updates(include_prerelease=include_prerelease, timeout=timeout)

    _print_table(updates)

    outdated = [u for u in updates if u.outdated]
    errors = [u for u in updates if u.error]

    click.echo()
    if errors:
        click.echo(f"{len(errors)} entr{'y' if len(errors) == 1 else 'ies'} could not be resolved.")

    if not outdated:
        click.echo("All referenced dependencies are up to date.")
        return

    click.echo(f"{len(outdated)} update{'s' if len(outdated) != 1 else ''} available.")

    if not apply_:
        click.echo("Run with --apply to write these versions to the catalog.")
        return

    written = deps_mod.apply_updates(updates)
    click.echo()
    for u in written:
        click.echo(f"  {u.key}: {u.current} -> {u.latest}")
    click.echo(
        f"Updated {len(written)} version{'s' if len(written) != 1 else ''} in "
        f"{deps_mod.VERSION_CATALOG.relative_to(REPO_ROOT)}."
    )
    click.echo("Now run a Gradle build to verify: cd android && ./gradlew :app:assembleDebug")


def _print_table(updates: list[deps_mod.DepUpdate]) -> None:
    rows = [
        (
            u.key,
            u.kind,
            u.current,
            (u.latest or "?") if not u.error else "-",
            _status(u),
        )
        for u in updates
    ]
    headers = ("catalog key", "kind", "current", "latest", "status")
    widths = [
        max(len(headers[i]), max((len(r[i]) for r in rows), default=0)) for i in range(len(headers))
    ]

    def fmt(cells: tuple[str, ...]) -> str:
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    click.echo()
    click.echo(fmt(headers))
    click.echo("  ".join("-" * w for w in widths))
    for row in rows:
        click.echo(fmt(row))


def _status(u: deps_mod.DepUpdate) -> str:
    if u.error:
        return f"error: {u.error}"
    if u.outdated:
        return "update available"
    return "up to date"
