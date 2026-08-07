"""`helix catalog` - grow and maintain the hardware catalog for the Indian market.

One entry point for the whole thing: it starts the LM Studio daemon, loads the model, and runs
the discovery and refresh loops itself. Nothing here expects a human to have prepared the
environment first.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys

import click

from . import db, engine, model
from .vendors import VENDORS


@click.group()
def catalog() -> None:
    """Hardware catalog research agent and vendor price/stock adapters (India)."""


@catalog.command("vendors")
@click.option("--sync/--no-sync", default=True, help="Write the registry into the database.")
def vendors_command(sync: bool) -> None:
    """List the verified vendors and how each is read."""
    click.echo(f"{'slug':16s} {'platform':13s} {'strategy':15s} {'stock':7s} active  notes")
    for vendor in VENDORS:
        click.echo(
            f"{vendor.slug:16s} {vendor.platform:13s} {vendor.fetch_strategy:15s} "
            f"{'count' if vendor.publishes_stock_count else 'bool':7s} "
            f"{'yes' if vendor.is_active else 'NO ':6s}  {vendor.notes[:58]}"
        )
    if sync:
        with db.connect() as connection:
            inserted, updated = db.sync_vendors(connection, VENDORS)
        click.echo(f"\nsynced: {inserted} inserted, {updated} updated")


@catalog.command("status")
def status_command() -> None:
    """Row counts, offer freshness, and recent price movement."""
    with db.connect() as connection:
        counts = db.catalog_counts(connection)
        click.echo("rows:")
        for table, count in counts.items():
            click.echo(f"  {table:24s} {count:>7d}")

        with connection.cursor() as cursor:
            cursor.execute("""select v.slug, count(*) as offers,
                          count(*) filter (where o.stock_status = 'in_stock') as in_stock,
                          count(*) filter (where o.stock_status = 'backorder') as backorder,
                          count(*) filter (where o.stock_status = 'out_of_stock') as out_of_stock,
                          max(o.last_seen_at) as newest
                   from vendor_offer o join vendor v on v.id = o.vendor_id
                   group by v.slug order by offers desc""")
            rows = cursor.fetchall()
            if rows:
                click.echo("\noffers by vendor:")
                click.echo(
                    f"  {'vendor':16s} {'total':>6s} {'in':>5s} {'back':>5s} {'out':>5s}  newest"
                )
                for row in rows:
                    click.echo(
                        f"  {row['slug']:16s} {row['offers']:>6d} {row['in_stock']:>5d} "
                        f"{row['backorder']:>5d} {row['out_of_stock']:>5d}  "
                        f"{row['newest']:%Y-%m-%d %H:%M}"
                    )

            cursor.execute("""select v.slug, o.title, s.amount_minor, s.observed_at
                   from vendor_offer_snapshot s
                   join vendor_offer o on o.id = s.offer_id
                   join vendor v on v.id = o.vendor_id
                   order by s.observed_at desc limit 8""")
            recent = cursor.fetchall()
            if recent:
                click.echo("\nlatest observations:")
                for row in recent:
                    amount = f"₹{row['amount_minor'] / 100:,.2f}" if row["amount_minor"] else "-"
                    click.echo(
                        f"  {row['observed_at']:%m-%d %H:%M} {row['slug']:14s} "
                        f"{amount:>12s}  {(row['title'] or '')[:44]}"
                    )


@catalog.command("discover")
@click.argument("keyword")
@click.option("--per-vendor", default=5, show_default=True, help="Listings to take per vendor.")
@click.option(
    "--model/--no-model",
    "use_model",
    default=True,
    help="Use the local model to confirm fuzzy product matches.",
)
def discover_command(keyword: str, per_vendor: int, use_model: bool) -> None:
    """Find listings for KEYWORD across the verified vendors and record them.

    KEYWORD is a board name, an SoC, or a brand - "rock 5b", "rk3588", "raspberry pi".
    """
    if use_model:
        model.ensure_model(log=lambda message: click.echo(message))
    stats = asyncio.run(
        engine.discover(
            keyword,
            per_vendor=per_vendor,
            use_model=use_model,
            log=lambda message: click.echo(message),
        )
    )
    click.echo(f"\n{stats}")


@catalog.command("refresh")
@click.option("--limit", default=60, show_default=True, help="Offers to re-read this pass.")
@click.option(
    "--max-age-hours", default=8, show_default=True, help="Only re-read offers older than this."
)
def refresh_command(limit: int, max_age_hours: int) -> None:
    """Re-read prices and stock for known offers. No model involved."""
    stats = asyncio.run(
        engine.refresh(
            limit=limit, max_age_hours=max_age_hours, log=lambda message: click.echo(message)
        )
    )
    click.echo(f"\n{stats}")


@catalog.command("run")
@click.argument("keywords", nargs=-1)
@click.option(
    "--interval",
    default=1800,
    show_default=True,
    help="Seconds between cycles. Conservative by default, to stay welcome.",
)
@click.option("--per-vendor", default=5, show_default=True)
@click.option("--refresh-limit", default=40, show_default=True)
@click.option("--max-age-hours", default=8, show_default=True)
@click.option(
    "--iterations", default=None, type=int, help="Stop after N cycles (default: forever)."
)
@click.option("--background", is_flag=True, help="Detach and keep running after this shell exits.")
@click.option("--log-file", default="catalog-agent.log", show_default=True)
def run_command(
    keywords: tuple[str, ...],
    interval: int,
    per_vendor: int,
    refresh_limit: int,
    max_age_hours: int,
    iterations: int | None,
    background: bool,
    log_file: str,
) -> None:
    """Run the agent: start LM Studio, load the model, then discover and refresh on a loop.

    KEYWORDS seed discovery - one is taken per cycle, cycling through the list. With none, the
    agent only refreshes the prices and stock it already knows about.

        helix catalog run "rock 5b" rk3588 "raspberry pi"
    """
    if background:
        # Detached so it survives the shell, with output tailable.
        arguments = [
            sys.executable,
            "-m",
            "tooling.cli",
            "catalog",
            "run",
            *keywords,
            "--interval",
            str(interval),
            "--per-vendor",
            str(per_vendor),
            "--refresh-limit",
            str(refresh_limit),
            "--max-age-hours",
            str(max_age_hours),
        ]
        if iterations is not None:
            arguments += ["--iterations", str(iterations)]
        with open(log_file, "ab") as handle:
            process = subprocess.Popen(
                arguments,
                stdout=handle,
                stderr=handle,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                cwd=os.getcwd(),
            )
        click.echo(f"agent running in background (pid {process.pid}), logging to {log_file}")
        click.echo(f"  tail -f {log_file}      # watch")
        click.echo(f"  kill {process.pid}      # stop")
        return

    def log(message: str) -> None:
        click.echo(message)
        sys.stdout.flush()

    with db.connect() as connection:
        db.sync_vendors(connection, VENDORS)

    if keywords:
        model.ensure_model(log=log)

    log(f"agent starting: {len(keywords)} keyword(s), {interval}s between cycles")
    try:
        asyncio.run(
            engine.run_loop(
                list(keywords),
                interval_seconds=interval,
                per_vendor=per_vendor,
                refresh_limit=refresh_limit,
                max_age_hours=max_age_hours,
                iterations=iterations,
                log=log,
            )
        )
    except KeyboardInterrupt:
        log("\nstopped")


@catalog.command("model")
@click.option("--unload", is_flag=True, help="Unload instead of loading.")
@click.option("--context", default=model.GPU_SAFE_CONTEXT, show_default=True)
def model_command(unload: bool, context: int) -> None:
    """Start the LM Studio daemon and load the extraction model."""
    if unload:
        model.unload_all(log=lambda message: click.echo(message))
        return
    model.ensure_model(context=context, log=lambda message: click.echo(message))


# The five board families this catalog is being grown around, mapped to the manufacturer names
# actually stored in the database.
BRAND_PATTERNS = {
    "radxa": "radxa",
    "raspberry": "raspberry",
    "banana": "banana",
    "luckfox": "luckfox",
    "orange": "xunlong",
}


@catalog.command("sweep")
@click.option(
    "--brands",
    default="radxa,raspberry,banana,luckfox,orange",
    show_default=True,
    help="Comma-separated brand keys to sweep.",
)
@click.option("--per-vendor", default=4, show_default=True)
@click.option("--limit", default=None, type=int, help="Only sweep the first N products.")
@click.option("--model/--no-model", "use_model", default=True)
@click.option(
    "--extract/--no-extract",
    default=True,
    help="Also propose missing specs from listings, as reviewable claims.",
)
@click.option("--background", is_flag=True, help="Detach and keep running after this shell exits.")
@click.option("--log-file", default="catalog-sweep.log", show_default=True)
def sweep_command(
    brands: str,
    per_vendor: int,
    limit: int | None,
    use_model: bool,
    extract: bool,
    background: bool,
    log_file: str,
) -> None:
    """Fill in vendor offers, prices, stock and links for every board of the given brands.

    Sweeps from the product side, so each listing is checked against a known target rather
    than reverse-matched from a vendor title.
    """
    keys = [key.strip().lower() for key in brands.split(",") if key.strip()]
    unknown = [key for key in keys if key not in BRAND_PATTERNS]
    if unknown:
        raise click.BadParameter(f"unknown brand(s): {', '.join(unknown)}")
    patterns = [BRAND_PATTERNS[key] for key in keys]

    if background:
        arguments = [
            sys.executable,
            "-m",
            "tooling.cli",
            "catalog",
            "sweep",
            "--brands",
            brands,
            "--per-vendor",
            str(per_vendor),
        ]
        if limit is not None:
            arguments += ["--limit", str(limit)]
        if not use_model:
            arguments += ["--no-model"]
        if not extract:
            arguments += ["--no-extract"]
        with open(log_file, "ab") as handle:
            process = subprocess.Popen(
                arguments,
                stdout=handle,
                stderr=handle,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                cwd=os.getcwd(),
            )
        click.echo(f"sweep running in background (pid {process.pid}) -> {log_file}")
        click.echo(f"  tail -f {log_file}")
        click.echo(f"  kill {process.pid}")
        return

    def log(message: str) -> None:
        click.echo(message)
        sys.stdout.flush()

    with db.connect() as connection:
        db.sync_vendors(connection, VENDORS)
    if use_model:
        model.ensure_model(log=log)

    totals = asyncio.run(
        engine.sweep(
            patterns,
            per_vendor=per_vendor,
            use_model=use_model,
            limit=limit,
            log=log,
        )
    )
    click.echo(f"\n{totals}")
