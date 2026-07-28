from __future__ import annotations

from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT
from tooling.reports import cli_docs as cli_docs_report
from tooling.reports import cloc as cloc_report


@click.group()
def reports() -> None:
    """Generate repository metric reports."""


@reports.command("cloc")
@click.option(
    "--output",
    "-o",
    type=click.Path(dir_okay=False, path_type=Path),
    default=REPO_ROOT / "reports" / "cloc.md",
    show_default=True,
    help="Markdown report destination.",
)
def cloc_cmd(output: Path) -> None:
    """cloc line-count breakdown of the whole repo, bucketed by subsystem and category."""
    try:
        console = cloc_report.generate(output)
    except RuntimeError as exc:
        raise click.ClickException(str(exc)) from exc

    click.echo(console)
    click.echo(f"\nMarkdown report written to {output}")


@reports.command("cli-docs")
@click.option(
    "--output",
    "-o",
    type=click.Path(dir_okay=False, path_type=Path),
    default=REPO_ROOT / "reports" / "cli-reference.md",
    show_default=True,
    help="Markdown report destination.",
)
def cli_docs_cmd(output: Path) -> None:
    """Introspect the whole `helix` CLI and document every command, flag, and default."""
    # Imported lazily: tooling.cli imports this module, so a top-level import would cycle.
    from tooling.cli import cli

    console = cli_docs_report.generate(cli, output)
    click.echo(console)
    click.echo(f"\nMarkdown report written to {output}")
