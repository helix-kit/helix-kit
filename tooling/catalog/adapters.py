"""Read live price and stock from a vendor listing, without a language model anywhere.

Price and stock are structured data on a known set of sites. Routing them through a 4B model
would add hallucination risk to the one thing that has to be exact, so every number here comes
from a product feed or from the element the page designates as the price.

Three strategies, chosen per vendor by measurement rather than assumption:

  shopify_json    /products.json - reports paise directly, so no float ever touches a price
  jsonld          schema.org Product/Offer, cross-checked against the rendered price element
  html            the DOM only, for vendors that publish no usable structured data

Every reader returns an `Offer`, or raises. Silence is never treated as success.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from playwright.async_api import Page

from .vendors import Vendor

NUMBER_RE = re.compile(r"([0-9][0-9,]*(?:\.[0-9]{1,2})?)")
# "1168 in stock", "Only 3 left", "5 available" - the count phrasings actually seen in the wild.
QTY_RES = (
    re.compile(r"(\d[\d,]*)\s+in\s+stock", re.I),
    re.compile(r"only\s+(\d[\d,]*)\s+(?:left|remaining)", re.I),
    re.compile(r"(\d[\d,]*)\s+(?:items?\s+)?(?:left|remaining|available)", re.I),
)
BACKORDER_RE = re.compile(r"back\s*order|pre[\s-]?order", re.I)
OUT_RE = re.compile(r"sold\s*out|out of stock|currently unavailable|notify me", re.I)
IN_RE = re.compile(r"in stock|available|add to cart", re.I)


@dataclass
class Offer:
    """One vendor's current terms for one listing."""

    url: str
    title: str = ""
    sku: str = ""
    currency: str = "INR"
    """Minor units (paise). None when no price could be read - never guessed."""
    amount_minor: int | None = None
    list_amount_minor: int | None = None
    stock_status: str = "unknown"
    """Only set where the vendor publishes a real number; most do not."""
    stock_quantity: int | None = None
    in_stock: bool | None = None
    """Which strategy produced this, for auditing a suspect row later."""
    via: str = ""
    """Set when the structured price and the rendered price disagreed."""
    price_conflict: str = ""


def to_minor(value: object) -> int | None:
    """Rupees (possibly '₹12,499.00') to paise. Parsed via Decimal - never float arithmetic."""
    if value is None:
        return None
    from decimal import Decimal, InvalidOperation

    text = str(value).replace(",", "").replace("​", "").strip()
    match = NUMBER_RE.search(text)
    if match is None:
        return None
    try:
        return int((Decimal(match.group(1)) * 100).to_integral_value())
    except InvalidOperation, ValueError:
        return None


def read_stock_text(text: str) -> tuple[str, int | None]:
    """Normalise a vendor's stock wording into (status, count).

    Order matters: back-order pages usually also contain the words "add to cart", so the more
    specific signals are tested first.
    """
    if not text:
        return "unknown", None

    quantity = None
    for pattern in QTY_RES:
        match = pattern.search(text)
        if match:
            quantity = int(match.group(1).replace(",", ""))
            break

    if BACKORDER_RE.search(text):
        return "backorder", quantity
    if OUT_RE.search(text):
        return "out_of_stock", quantity
    if quantity is not None:
        return ("in_stock" if quantity > 0 else "out_of_stock"), quantity
    if IN_RE.search(text):
        return "in_stock", None
    return "unknown", None


def walk(node: object) -> Any:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


def jsonld_product(blocks: list[str]) -> dict[str, Any]:
    """The first schema.org Product/Offer in a page's JSON-LD blocks."""
    for block in blocks:
        try:
            data = json.loads((block or "").strip())
        except json.JSONDecodeError:
            continue
        for node in walk(data):
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if "Product" not in [str(t) for t in types]:
                continue
            offers = node.get("offers")
            offers = [offers] if isinstance(offers, dict) else (offers or [])
            for offer in offers:
                if not isinstance(offer, dict):
                    continue
                spec = offer.get("priceSpecification") or {}
                return {
                    "name": node.get("name") or "",
                    "sku": node.get("sku") or node.get("mpn") or "",
                    "price": offer.get("price") or spec.get("price"),
                    "currency": offer.get("priceCurrency") or spec.get("priceCurrency") or "INR",
                    "availability": str(offer.get("availability", "")).rsplit("/", 1)[-1],
                }
    return {}


# --------------------------------------------------------------------------------------
# Shopify
# --------------------------------------------------------------------------------------


def shopify_offer_from_product(base_url: str, product: dict[str, Any]) -> Offer:
    """Build an offer from one entry of `/products.json`.

    Shopify's feed quotes prices in the store's minor unit already, so this is the one path
    where the number needs no parsing at all.
    """
    variant = (product.get("variants") or [{}])[0]
    price = variant.get("price")
    # /products.json gives "9.00"; /products/<handle>.js gives 900. Handle both.
    amount = (
        to_minor(price) if isinstance(price, str) else (int(price) if price is not None else None)
    )
    compare = variant.get("compare_at_price")
    list_amount = (
        to_minor(compare) if isinstance(compare, str) else (int(compare) if compare else None)
    )

    available = variant.get("available")
    quantity = variant.get("inventory_quantity")  # Shopify hides this publicly; kept if present.
    status = "in_stock" if available else "out_of_stock"
    if available is None:
        status = "unknown"

    return Offer(
        url=f"{base_url.rstrip('/')}/products/{product.get('handle', '')}",
        title=str(product.get("title") or "")[:300],
        sku=str(variant.get("sku") or ""),
        amount_minor=amount,
        list_amount_minor=list_amount if list_amount and list_amount != amount else None,
        stock_status=status,
        stock_quantity=quantity if isinstance(quantity, int) else None,
        in_stock=bool(available) if available is not None else None,
        via="shopify_json",
    )


async def read_shopify(page: Page, vendor: Vendor, url: str) -> Offer:
    """One Shopify listing, read from its own `.js` document rather than the rendered theme."""
    handle = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
    endpoint = f"{vendor.base_url.rstrip('/')}/products/{handle}.js"
    response = await page.goto(endpoint, wait_until="domcontentloaded", timeout=45000)
    if response is None or response.status != 200:
        raise RuntimeError(f"shopify .js returned {response.status if response else 'no response'}")
    data = json.loads(await page.evaluate("document.body.innerText"))
    variant = (data.get("variants") or [{}])[0]
    return Offer(
        url=url,
        title=str(data.get("title") or "")[:300],
        sku=str(variant.get("sku") or ""),
        amount_minor=int(variant["price"]) if variant.get("price") is not None else None,
        list_amount_minor=(
            int(variant["compare_at_price"]) if variant.get("compare_at_price") else None
        ),
        stock_status="in_stock" if variant.get("available") else "out_of_stock",
        stock_quantity=(
            variant.get("inventory_quantity")
            if isinstance(variant.get("inventory_quantity"), int)
            else None
        ),
        in_stock=bool(variant.get("available")),
        via="shopify_js",
    )


# --------------------------------------------------------------------------------------
# JSON-LD and DOM
# --------------------------------------------------------------------------------------


async def _designated_price(page: Page, selector: str) -> int | None:
    """The price the page marks as the price, using the vendor's specific selector."""
    if not selector:
        return None
    for part in [s.strip() for s in selector.split(",") if s.strip()]:
        try:
            element = await page.query_selector(part)
            if element is None:
                continue
            raw = await element.get_attribute("content")
            if raw is None:
                raw = await element.inner_text()
            amount = to_minor(raw)
            if amount:
                return amount
        except Exception:  # noqa: BLE001, S112 - a selector that errors just does not apply
            continue
    return None


async def _stock(page: Page, vendor: Vendor) -> tuple[str, int | None]:
    """Availability from the vendor's own stock element.

    Deliberately does NOT fall back to the whole page. Body text says "Add to Cart" on a
    sold-out product and contains the quantity input's "1", which once produced a confident
    `in_stock qty=1` for an item the vendor's own JSON-LD reported as out of stock.
    """
    for part in [s.strip() for s in vendor.stock_selector.split(",") if s.strip()]:
        try:
            element = await page.query_selector(part)
            if element is None:
                continue
            status, quantity = read_stock_text(await element.inner_text())
            if status != "unknown" or quantity is not None:
                # A count is only meaningful from a vendor that publishes one.
                return status, (quantity if vendor.publishes_stock_count else None)
        except Exception:  # noqa: BLE001, S112
            continue
    return "unknown", None


async def read_page_offer(page: Page, vendor: Vendor, url: str) -> Offer:
    """A listing on a non-Shopify vendor: JSON-LD where present, cross-checked against the DOM.

    When both exist and disagree the DOM wins - it is what the customer is shown - and the
    disagreement is recorded rather than discarded, because a persistent conflict means the
    vendor's structured data has gone stale and the adapter should be revisited.
    """
    response = await page.goto(url, wait_until="domcontentloaded", timeout=60000)
    if response is not None and response.status >= 400:
        raise RuntimeError(f"HTTP {response.status}")
    await page.wait_for_timeout(2500)

    structured: dict[str, Any] = {}
    if vendor.fetch_strategy in {"jsonld", "browser_jsonld"}:
        blocks = await page.eval_on_selector_all(
            'script[type="application/ld+json"]', "ns => ns.map(n => n.textContent)"
        )
        structured = jsonld_product(blocks)

    ld_amount = to_minor(structured.get("price")) if structured else None
    dom_amount = await _designated_price(page, vendor.price_selector)
    status, quantity = await _stock(page, vendor)

    conflict = ""
    if ld_amount and dom_amount and ld_amount != dom_amount:
        conflict = f"jsonld={ld_amount} dom={dom_amount}"

    # Stock resolves the opposite way round to price: the structured claim wins. Rendered text
    # is a poor availability signal because "Add to Cart" survives on sold-out pages, whereas
    # schema.org states availability unambiguously.
    availability = (structured.get("availability") or "").lower()
    if availability:
        if "outofstock" in availability or "soldout" in availability:
            status = "out_of_stock"
        elif "backorder" in availability or "preorder" in availability:
            status = "backorder"
        elif "instock" in availability:
            # Keep a DOM-derived count, which is richer than the enum, but take the state here.
            status = "in_stock"

    amount = dom_amount or ld_amount
    if amount is None:
        raise RuntimeError("no price found via JSON-LD or the designated price element")

    title = structured.get("name") or ""
    if not title:
        try:
            title = (await page.title()) or ""
        except Exception:  # noqa: BLE001
            title = ""

    return Offer(
        url=url,
        title=str(title)[:300],
        sku=str(structured.get("sku") or ""),
        currency=str(structured.get("currency") or "INR"),
        amount_minor=amount,
        stock_status=status,
        stock_quantity=quantity if vendor.publishes_stock_count else quantity,
        in_stock=None if status == "unknown" else status in {"in_stock", "backorder"},
        via="jsonld+dom" if ld_amount else "dom",
        price_conflict=conflict,
    )


async def read_offer(page: Page, vendor: Vendor, url: str) -> Offer:
    """Read one listing using whichever strategy this vendor was measured to support."""
    if vendor.fetch_strategy == "shopify_json":
        return await read_shopify(page, vendor, url)
    return await read_page_offer(page, vendor, url)
