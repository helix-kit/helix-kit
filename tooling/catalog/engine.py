"""Discovery and refresh: the two loops that keep the catalog growing and current.

**Discovery** takes a keyword and finds listings for it on the verified vendors, extracts
specs with the local model, and records what is missing.

Search runs against each vendor's own search endpoint rather than through Google. That is a
deliberate change from the obvious approach and it is strictly better here: the catalog only
ever accepts listings from this fixed set of vendors, so a general web search would spend most
of its results on sites that get discarded anyway - and Google blocks headless browsers
quickly, which would make the whole loop unreliable. Searching the vendors directly reaches
their entire catalogue, needs no bot evasion, and every hit is trusted by construction.

**Refresh** re-reads known offers on a schedule, deterministically, with no model involved.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote_plus

from playwright.async_api import BrowserContext

from . import db, model
from .adapters import Offer, read_offer
from .matching import prescreen
from .vendors import BY_SLUG, VENDORS, Vendor, vendor_for_url

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


@dataclass
class Found:
    vendor: Vendor
    url: str
    title: str
    offer: Offer | None = None


# --------------------------------------------------------------------------------------
# vendor-native search
# --------------------------------------------------------------------------------------

SEARCH_PATHS = {
    "shopify": "/search/suggest.json?q={q}&resources[type]=product&resources[limit]=10",
    "bigcommerce": "/search.php?search_query={q}",
    "opencart": "/index.php?route=product/search&search={q}",
    "magento": "/catalogsearch/result/?q={q}",
    "woocommerce": "/?s={q}&post_type=product",
}

# Where each platform puts result links, so a search page yields product URLs not nav links.
RESULT_SELECTORS = {
    # Each of these must be a TITLE-bearing link. On both BigCommerce and OpenCart the product
    # image is also an anchor to the same URL but has no text, and it comes first in the DOM -
    # taking it yields an empty title, which then fails matching and silently loses the offer.
    "bigcommerce": ".card-title a, li.product .card-title a",
    "opencart": ".product-thumb .caption a, .product-layout .caption h4 a",
    "magento": "a.product-item-link",
    "woocommerce": "ul.products li.product a.woocommerce-LoopProduct-link",
}


async def search_vendor(
    context: BrowserContext, vendor: Vendor, keyword: str, limit: int
) -> list[Found]:
    """Listings matching a keyword on one vendor, using that vendor's own search."""
    path = SEARCH_PATHS.get(vendor.platform)
    if path is None:
        return []
    url = vendor.base_url.rstrip("/") + path.format(q=quote_plus(keyword))
    page = await context.new_page()
    found: list[Found] = []
    try:
        response = await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        if response is None or response.status >= 400:
            return []

        if vendor.platform == "shopify":
            # Shopify's suggest endpoint answers in JSON, so no markup guessing is needed.
            data = json.loads(await page.evaluate("document.body.innerText"))
            products = (((data.get("resources") or {}).get("results") or {}).get("products")) or []
            for product in products[:limit]:
                handle = product.get("handle") or product.get("url", "").rsplit("/", 1)[-1]
                found.append(
                    Found(
                        vendor=vendor,
                        url=f"{vendor.base_url.rstrip('/')}/products/{handle}",
                        title=str(product.get("title") or "")[:300],
                    )
                )
        else:
            await page.wait_for_timeout(2500)
            selector = RESULT_SELECTORS.get(vendor.platform, "a[href]")
            links = await page.eval_on_selector_all(
                selector,
                "ns => ns.map(n => ({href: n.href, text: (n.innerText||'').trim()}))",
            )
            # Keep the best title seen per URL: a themes' image anchor and caption anchor point
            # at the same product, and only one of them carries the name.
            best: dict[str, str] = {}
            order: list[str] = []
            for link in links:
                href = (link.get("href") or "").split("#")[0]
                text = (link.get("text") or "").strip()
                if not href or href.startswith("javascript:") or vendor_for_url(href) is not vendor:
                    continue
                if href not in best:
                    order.append(href)
                    best[href] = text
                elif len(text) > len(best[href]):
                    best[href] = text
            for href in order:
                if not best[href]:
                    continue  # no title anywhere on this result; matching would fail anyway
                found.append(Found(vendor=vendor, url=href, title=best[href][:300]))
                if len(found) >= limit:
                    break
    except Exception:  # noqa: BLE001 - a vendor whose search fails simply contributes nothing
        return found
    finally:
        await page.close()
    return found


async def search_all(
    context: BrowserContext,
    keyword: str,
    per_vendor: int,
    log: Callable[[str], None] = print,
) -> list[Found]:
    results: list[Found] = []
    for vendor in VENDORS:
        if not vendor.is_active:
            continue
        hits = await search_vendor(context, vendor, keyword, per_vendor)
        log(f"    {vendor.slug:16s} {len(hits)} result(s)")
        results.extend(hits)
        await asyncio.sleep(1.0 / max(vendor.requests_per_second, 0.1))
    return results


# --------------------------------------------------------------------------------------
# discovery
# --------------------------------------------------------------------------------------


async def page_text(context: BrowserContext, url: str) -> str:
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        return str(await page.evaluate("document.body.innerText"))
    except Exception:  # noqa: BLE001
        return ""
    finally:
        await page.close()


def resolve_product(
    connection: Any, title: str, use_model: bool, log: Callable[[str], None] = print
) -> dict[str, Any] | None:
    """Find the catalog product a listing refers to, or None.

    Deliberately conservative, and layered: a wrong match writes a vendor's price onto the
    wrong board and looks entirely correct in the UI afterwards.

    The deterministic prescreen runs first and is final. It exists because the model approved
    both of the real-world mistakes this agent has made - an antenna kit as a Compute Module 4,
    and a ROCK 5B+ as a ROCK 5B - each with "high" confidence. The model therefore only gets to
    veto a candidate that already passed, never to rescue one.
    """
    candidate = db.find_product_by_name(connection, title)
    if candidate is None:
        return None

    allowed, reason = prescreen(candidate["name"], title)
    if not allowed:
        log(f"    x rejected   {title[:44]:44s} ({reason})")
        return None

    if not use_model:
        return candidate

    try:
        verdict = model.confirm_match(candidate["name"], title)
    except model.ModelError as error:
        log(f"      match check failed ({error}); leaving unmatched")
        return None
    if verdict and verdict.get("same_product") and verdict.get("confidence") == "high":
        return candidate
    return None


async def discover(
    keyword: str,
    *,
    per_vendor: int = 5,
    use_model: bool = True,
    log: Callable[[str], None] = print,
) -> dict[str, int]:
    """One discovery pass for a keyword: search, read offers, attach them to products."""
    from playwright.async_api import async_playwright

    stats: dict[str, int] = {
        "searched": 0,
        "offers": 0,
        "matched": 0,
        "unmatched": 0,
        "failed": 0,
        "changed": 0,
    }

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT, locale="en-IN")
        try:
            log(f"  searching {keyword!r} across verified vendors")
            hits = await search_all(context, keyword, per_vendor, log=log)
            stats["searched"] = len(hits)

            with db.connect() as connection:
                for hit in hits:
                    page = await context.new_page()
                    try:
                        offer = await read_offer(page, hit.vendor, hit.url)
                    except Exception as error:  # noqa: BLE001
                        stats["failed"] += 1
                        log(
                            f"    - {hit.vendor.slug}: {type(error).__name__}: "
                            f"{str(error)[:44]} {hit.url[:44]}"
                        )
                        continue
                    finally:
                        await page.close()

                    stats["offers"] += 1
                    title = offer.title or hit.title
                    product = resolve_product(connection, title, use_model, log=log)
                    if product is None:
                        stats["unmatched"] += 1
                        log(f"    ? unmatched  {title[:56]}")
                        continue

                    source_id = db.upsert_source(
                        connection, offer.url, title=title, publisher=hit.vendor.name
                    )
                    vendor_row = db.vendor_id(connection, hit.vendor.slug)
                    if vendor_row is None:
                        continue
                    written = db.upsert_offer(
                        connection,
                        vendor_row_id=vendor_row,
                        product_id=product["id"],
                        variant_id=None,
                        offer=offer,
                        source_id=source_id,
                    )
                    stats["matched"] += 1
                    stats["changed"] += 1 if written.changed else 0
                    rupees = f"{offer.amount_minor / 100:,.2f}" if offer.amount_minor else "?"
                    log(
                        f"    {'+' if written.created else '~'} {hit.vendor.slug:14s} "
                        f"₹{rupees:>10s} {offer.stock_status:12s} "
                        f"qty={offer.stock_quantity if offer.stock_quantity is not None else '-'} "
                        f"-> {product['name'][:34]}"
                    )
                    await asyncio.sleep(1.0 / max(hit.vendor.requests_per_second, 0.1))
        finally:
            await browser.close()
    return stats


# --------------------------------------------------------------------------------------
# refresh
# --------------------------------------------------------------------------------------


async def refresh(
    *, limit: int = 60, max_age_hours: int = 8, log: Callable[[str], None] = print
) -> dict[str, int]:
    """Re-read the oldest known offers. No model involved - purely deterministic."""
    from playwright.async_api import async_playwright

    stats: dict[str, int] = {"checked": 0, "changed": 0, "failed": 0}
    with db.connect() as connection:
        due = db.offers_due(connection, limit, max_age_hours)

    if not due:
        log("  nothing due")
        return stats

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT, locale="en-IN")
        try:
            with db.connect() as connection:
                for row in due:
                    vendor = BY_SLUG.get(row["vendor_slug"])
                    if vendor is None or not vendor.is_active:
                        continue
                    refresh_vendor_row = db.vendor_id(connection, vendor.slug)
                    if refresh_vendor_row is None:
                        continue
                    page = await context.new_page()
                    try:
                        offer = await read_offer(page, vendor, row["url"])
                    except Exception as error:  # noqa: BLE001
                        stats["failed"] += 1
                        db.record_failure(connection, row["id"], f"{type(error).__name__}: {error}")
                        continue
                    finally:
                        await page.close()

                    written = db.upsert_offer(
                        connection,
                        vendor_row_id=refresh_vendor_row,
                        product_id=row["product_id"],
                        variant_id=row["variant_id"],
                        offer=offer,
                        source_id=None,
                    )
                    stats["checked"] += 1
                    if written.changed:
                        stats["changed"] += 1
                        before = row["amount_minor"]
                        moved = (
                            f"₹{before / 100:,.2f} -> ₹{offer.amount_minor / 100:,.2f}"
                            if before and offer.amount_minor and before != offer.amount_minor
                            else f"{row['stock_status']} -> {offer.stock_status}"
                        )
                        log(f"    changed {vendor.slug:14s} {moved}")
                    await asyncio.sleep(1.0 / max(vendor.requests_per_second, 0.1))
        finally:
            await browser.close()
    return stats


# --------------------------------------------------------------------------------------
# background loop
# --------------------------------------------------------------------------------------


async def run_loop(
    keywords: list[str],
    *,
    interval_seconds: int,
    per_vendor: int,
    refresh_limit: int,
    max_age_hours: int,
    iterations: int | None,
    log: Callable[[str], None] = print,
) -> None:
    """Alternate discovery and refresh forever, pacing to stay a polite guest.

    Refresh runs every cycle; discovery advances through the keyword list one per cycle, so a
    long keyword list never starves the price data of attention.
    """
    cycle = 0
    while iterations is None or cycle < iterations:
        cycle += 1
        started = time.time()
        log(f"\n=== cycle {cycle} ===")

        if keywords:
            keyword = keywords[(cycle - 1) % len(keywords)]
            log(f"  discovery: {keyword!r}")
            try:
                stats = await discover(keyword, per_vendor=per_vendor, log=log)
                log(f"  discovery: {stats}")
            except Exception as error:  # noqa: BLE001 - a bad cycle must not kill the loop
                log(f"  discovery failed: {type(error).__name__}: {error}")

        log("  refresh:")
        try:
            stats = await refresh(limit=refresh_limit, max_age_hours=max_age_hours, log=log)
            log(f"  refresh: {stats}")
        except Exception as error:  # noqa: BLE001
            log(f"  refresh failed: {type(error).__name__}: {error}")

        if iterations is not None and cycle >= iterations:
            break
        elapsed = time.time() - started
        nap = max(interval_seconds - elapsed, 5)
        log(f"  sleeping {nap:.0f}s")
        await asyncio.sleep(nap)


# Extracted fields worth proposing, mapped to where they belong. Price and stock are absent on
# purpose: those are read deterministically by the adapters and must never come from a model.
SPEC_FIELDS = (
    ("soc_name", "soc_name"),
    ("cpu_core_name", "cpu_core_name"),
    ("cpu_cores", "cpu_cores"),
    ("cpu_max_clock_mhz", "cpu_max_clock_mhz"),
    ("gpu_name", "gpu_name"),
    ("npu_tops", "npu_tops"),
    ("ram_gb", "ram_gb"),
    ("ram_type", "ram_type"),
    ("ethernet", "ethernet"),
    ("wireless", "wireless"),
    ("usb_ports", "usb_ports"),
    ("video_outputs", "video_outputs"),
    ("form_factor", "form_factor"),
)


async def propose_specs(
    context: BrowserContext,
    connection: Any,
    product: dict[str, Any],
    url: str,
    source_id: str | None,
    log: Callable[[str], None] = print,
) -> int:
    """Read specs off a vendor listing and record them as claims for review.

    Nothing here touches a canonical row. Every value lands in `claim` as `proposed`, carrying
    the page it came from and the verbatim fragment supporting it - which is the only reason it
    is safe to let a 4B model near spec data at all.

    A reading with no supporting quote is discarded outright: without evidence there is no way
    to tell a real spec from a confident invention.
    """
    text = await page_text(context, url)
    if len(text) < 200:
        return 0

    try:
        extracted = model.extract_specs(text)
    except model.ModelError as error:
        log(f"      spec extraction failed: {error}")
        return 0
    if extracted is None:
        return 0

    # An accessory's page describes the board it fits, not itself.
    if not extracted.get("is_single_board_computer"):
        return 0

    evidence = str(extracted.get("quoted_evidence") or "").strip()
    if len(evidence) < 12:
        return 0
    # The quote has to actually appear on the page, or it was invented.
    if evidence[:40].lower() not in text.lower():
        log("      spec evidence not found on the page; discarded")
        return 0

    proposed = 0
    for key, field_path in SPEC_FIELDS:
        value = extracted.get(key)
        if value is None or value == "" or value == 0:
            continue
        if db.upsert_claim(
            connection,
            entity_table="product",
            entity_id=product["id"],
            field_path=field_path,
            value_text=str(value),
            quoted_text=evidence,
            source_id=source_id,
        ):
            proposed += 1
    return proposed


async def sweep_product(
    context: BrowserContext,
    connection: Any,
    product: dict[str, Any],
    *,
    per_vendor: int,
    use_model: bool,
    extract: bool = True,
    log: Callable[[str], None] = print,
) -> dict[str, int]:
    """Find every verified vendor stocking one known product, and record their terms.

    Targeted matching: the product is known before searching, so each candidate listing is
    tested against *that* product. This is materially safer than reverse-looking-up a product
    from a vendor title, which is how an antenna kit once became a Compute Module 4.
    """
    tally = {"offers": 0, "links": 0, "rejected": 0, "failed": 0, "claims": 0}
    hits = await search_all(context, product["name"], per_vendor, log=lambda _: None)

    for hit in hits:
        allowed, reason = prescreen(product["name"], hit.title)
        if not allowed:
            tally["rejected"] += 1
            continue

        # The listing may name a MORE specific product that is itself in the catalog:
        # "Luckfox Pico Max" is not "Luckfox Pico", and "Core1106 Smart 86 Box" is not
        # "Core1106". `find_product_by_name` returns the longest catalog name contained in the
        # title, so if that is a different product this listing belongs to that one instead.
        best = db.find_product_by_name(connection, hit.title)
        if best is not None and best["id"] != product["id"]:
            tally["rejected"] += 1
            log(f"      x {hit.title[:38]:38s} (more specific: {best['name'][:26]})")
            continue
        if use_model:
            try:
                verdict = model.confirm_match(product["name"], hit.title)
            except model.ModelError:
                tally["rejected"] += 1
                continue
            confirmed = bool(
                verdict and verdict.get("same_product") and verdict.get("confidence") == "high"
            )
            if not confirmed:
                tally["rejected"] += 1
                continue

        page = await context.new_page()
        try:
            offer = await read_offer(page, hit.vendor, hit.url)
        except Exception:  # noqa: BLE001 - one unreadable listing must not stop the sweep
            tally["failed"] += 1
            continue
        finally:
            await page.close()

        source_id = db.upsert_source(
            connection, offer.url, title=offer.title or hit.title, publisher=hit.vendor.name
        )
        vendor_row = db.vendor_id(connection, hit.vendor.slug)
        if vendor_row is None:
            continue
        db.upsert_offer(
            connection,
            vendor_row_id=vendor_row,
            product_id=product["id"],
            variant_id=None,
            offer=offer,
            source_id=source_id,
        )
        tally["offers"] += 1
        if db.upsert_product_link(
            connection,
            product_id=product["id"],
            url=offer.url,
            label=hit.vendor.name,
            source_id=source_id,
        ):
            tally["links"] += 1

        rupees = f"{offer.amount_minor / 100:,.2f}" if offer.amount_minor else "?"
        quantity = offer.stock_quantity if offer.stock_quantity is not None else "-"
        log(f"      {hit.vendor.slug:16s} ₹{rupees:>10s} {offer.stock_status:12s} qty={quantity}")

        # Only worth reading a listing for specs when the catalog is actually missing some.
        if extract and use_model and db.product_gaps(connection, product["id"]):
            claims = await propose_specs(
                context, connection, product, offer.url, source_id, log=log
            )
            if claims:
                tally["claims"] += claims
                log(f"        proposed {claims} spec claim(s) for review")
        await asyncio.sleep(1.0 / max(hit.vendor.requests_per_second, 0.1))

    return tally


async def sweep(
    brand_patterns: list[str],
    *,
    per_vendor: int = 4,
    use_model: bool = True,
    extract: bool = True,
    limit: int | None = None,
    log: Callable[[str], None] = print,
) -> dict[str, int]:
    """Walk every catalog product of the given brands, filling in vendor offers and links."""
    from playwright.async_api import async_playwright

    totals = {"products": 0, "offers": 0, "links": 0, "claims": 0, "rejected": 0, "failed": 0}

    with db.connect() as connection:
        products = db.products_for_brands(connection, brand_patterns, limit)
    log(f"  {len(products)} product(s) to sweep")

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT, locale="en-IN")
        try:
            with db.connect() as connection:
                for index, product in enumerate(products, start=1):
                    log(f"  [{index}/{len(products)}] {product['name'][:52]}")
                    try:
                        tally = await sweep_product(
                            context,
                            connection,
                            product,
                            per_vendor=per_vendor,
                            use_model=use_model,
                            log=log,
                        )
                    except Exception as error:  # noqa: BLE001 - keep the sweep going
                        log(f"      failed: {type(error).__name__}: {str(error)[:60]}")
                        totals["failed"] += 1
                        continue
                    totals["products"] += 1
                    for key, value in tally.items():
                        totals[key] = totals.get(key, 0) + value
        finally:
            await browser.close()
    return totals
