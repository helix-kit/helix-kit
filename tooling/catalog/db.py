"""Database access for the catalog agent.

Every write goes through here rather than through the model. The agent proposes values; this
module decides what is actually stored, which is what keeps a 4B model's occasional confident
nonsense out of the canonical tables.

Ids match the app's own convention (`prefix_` + random suffix) so rows created here are
indistinguishable from rows created in the admin UI.
"""

from __future__ import annotations

import os
import secrets
import string
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

ALPHABET = string.ascii_lowercase + string.digits
DEFAULT_URL = "postgresql://catalog:catalog@localhost:25433/hardware_catalog"


def new_id(prefix: str) -> str:
    return f"{prefix}_{''.join(secrets.choice(ALPHABET) for _ in range(16))}"


def database_url() -> str:
    """The catalog database, from the app's own `.env` unless overridden."""
    if override := os.environ.get("CATALOG_DATABASE_URL"):
        return override
    env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "web",
        "apps",
        "hardware-catalog",
        ".env",
    )
    try:
        with open(env_path) as handle:
            for line in handle:
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return DEFAULT_URL


@contextmanager
def connect() -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(database_url(), row_factory=dict_row) as connection:
        yield connection


# --------------------------------------------------------------------------------------
# vendors
# --------------------------------------------------------------------------------------


def sync_vendors(connection: psycopg.Connection[Any], vendors: Any) -> tuple[int, int]:
    """Push the code-side vendor registry into the database.

    The registry in `vendors.py` is the source of truth because its fields are operational -
    selectors and strategies that were measured. The table exists so offers can reference a
    vendor row and so the admin UI can show them.
    """
    inserted = updated = 0
    with connection.cursor() as cursor:
        for vendor in vendors:
            cursor.execute("select id from vendor where slug = %s", (vendor.slug,))
            existing = cursor.fetchone()
            values = (
                vendor.name,
                vendor.base_url,
                "IN",
                "INR",
                vendor.platform,
                vendor.fetch_strategy,
                vendor.price_selector,
                vendor.stock_selector,
                vendor.publishes_stock_count,
                vendor.sitemap_url,
                vendor.requires_browser,
                int(round(vendor.requests_per_second)) or 1,
                vendor.prices_include_tax,
                vendor.is_active,
                vendor.notes,
            )
            if existing:
                cursor.execute(
                    """update vendor set name=%s, base_url=%s, country_code=%s, currency_code=%s,
                       platform=%s, fetch_strategy=%s, price_selector=%s, stock_selector=%s,
                       publishes_stock_count=%s, sitemap_url=%s, requires_browser=%s,
                       requests_per_second=%s, prices_include_tax=%s, is_active=%s, notes=%s,
                       updated_at=now() where id=%s""",
                    (*values, existing["id"]),
                )
                updated += 1
            else:
                cursor.execute(
                    """insert into vendor (id, slug, name, base_url, country_code, currency_code,
                       platform, fetch_strategy, price_selector, stock_selector,
                       publishes_stock_count, sitemap_url, requires_browser, requests_per_second,
                       prices_include_tax, is_active, notes)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (new_id("vnd"), vendor.slug, *values),
                )
                inserted += 1
    connection.commit()
    return inserted, updated


def vendor_id(connection: psycopg.Connection[Any], slug: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute("select id from vendor where slug = %s", (slug,))
        row = cursor.fetchone()
        return str(row["id"]) if row else None


# --------------------------------------------------------------------------------------
# sources
# --------------------------------------------------------------------------------------


def upsert_source(
    connection: psycopg.Connection[Any],
    url: str,
    *,
    title: str = "",
    publisher: str = "",
    source_type: str = "distributor_page",
    trust_rank: int = 20,
) -> str:
    """A citable document. Deduped on the canonical URL so re-reading a page reuses the row."""
    canonical = url.split("?")[0].split("#")[0].rstrip("/")
    with connection.cursor() as cursor:
        cursor.execute("select id from source where canonical_url = %s", (canonical,))
        row = cursor.fetchone()
        if row:
            cursor.execute(
                "update source set retrieved_at = now(), title = coalesce(nullif(%s,''), title) "
                "where id = %s",
                (title, row["id"]),
            )
            connection.commit()
            return str(row["id"])
        identifier = new_id("src")
        cursor.execute(
            """insert into source (id, url, canonical_url, type, title, publisher, trust_rank)
               values (%s,%s,%s,%s,%s,%s,%s)""",
            (identifier, url, canonical, source_type, title[:300], publisher, trust_rank),
        )
    connection.commit()
    return identifier


# --------------------------------------------------------------------------------------
# offers
# --------------------------------------------------------------------------------------


@dataclass
class OfferWrite:
    changed: bool
    created: bool
    offer_id: str
    previous_amount: int | None = None


def upsert_offer(
    connection: psycopg.Connection[Any],
    *,
    vendor_row_id: str,
    product_id: str,
    variant_id: str | None,
    offer: Any,
    source_id: str | None,
) -> OfferWrite:
    """Store the current offer, and snapshot it only when something actually moved.

    Writing a snapshot on every poll would record the polling interval rather than the price
    history, so a row lands only on a real change - which is what makes "when did this drop?"
    answerable later.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "select id, amount_minor, stock_status, stock_quantity from vendor_offer "
            "where vendor_id = %s and url = %s",
            (vendor_row_id, offer.url),
        )
        existing = cursor.fetchone()

        if existing is None:
            offer_id = new_id("vof")
            cursor.execute(
                """insert into vendor_offer (id, vendor_id, product_id, variant_id, url,
                   vendor_sku, title, currency_code, amount_minor, list_amount_minor,
                   stock_status, stock_quantity, in_stock, source_id, confidence, verified_at,
                   last_seen_at, notes)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'high',now(),now(),%s)""",
                (
                    offer_id,
                    vendor_row_id,
                    product_id,
                    variant_id,
                    offer.url,
                    offer.sku[:120],
                    offer.title[:300],
                    offer.currency,
                    offer.amount_minor,
                    offer.list_amount_minor,
                    offer.stock_status,
                    offer.stock_quantity,
                    offer.in_stock,
                    source_id,
                    offer.price_conflict,
                ),
            )
            _snapshot(cursor, offer_id, offer)
            connection.commit()
            return OfferWrite(changed=True, created=True, offer_id=offer_id)

        offer_id = existing["id"]
        moved = (
            existing["amount_minor"] != offer.amount_minor
            or existing["stock_status"] != offer.stock_status
            or existing["stock_quantity"] != offer.stock_quantity
        )
        cursor.execute(
            """update vendor_offer set product_id=%s, variant_id=%s, vendor_sku=%s, title=%s,
               currency_code=%s, amount_minor=%s, list_amount_minor=%s, stock_status=%s,
               stock_quantity=%s, in_stock=%s, last_seen_at=now(), consecutive_failures=0,
               last_error='', source_id=coalesce(%s, source_id), verified_at=now(),
               notes=%s, updated_at=now() where id=%s""",
            (
                product_id,
                variant_id,
                offer.sku[:120],
                offer.title[:300],
                offer.currency,
                offer.amount_minor,
                offer.list_amount_minor,
                offer.stock_status,
                offer.stock_quantity,
                offer.in_stock,
                source_id,
                offer.price_conflict,
                offer_id,
            ),
        )
        if moved:
            _snapshot(cursor, offer_id, offer)
    connection.commit()
    return OfferWrite(
        changed=moved,
        created=False,
        offer_id=offer_id,
        previous_amount=existing["amount_minor"],
    )


def _snapshot(cursor: Any, offer_id: str, offer: Any) -> None:
    cursor.execute(
        """insert into vendor_offer_snapshot (id, offer_id, amount_minor, list_amount_minor,
           stock_status, stock_quantity) values (%s,%s,%s,%s,%s,%s)""",
        (
            new_id("vos"),
            offer_id,
            offer.amount_minor,
            offer.list_amount_minor,
            offer.stock_status,
            offer.stock_quantity,
        ),
    )


def record_failure(connection: psycopg.Connection[Any], offer_id: str, message: str) -> None:
    """A failed read must be visible, not silently leave a stale price looking current."""
    with connection.cursor() as cursor:
        cursor.execute(
            """update vendor_offer set last_error_at = now(), last_error = %s,
               consecutive_failures = consecutive_failures + 1, updated_at = now()
               where id = %s""",
            (message[:300], offer_id),
        )
    connection.commit()


def offers_due(
    connection: psycopg.Connection[Any], limit: int, max_age_hours: int
) -> list[dict[str, Any]]:
    """Offers not refreshed recently, oldest first, skipping ones that keep failing."""
    with connection.cursor() as cursor:
        cursor.execute(
            """select o.id, o.url, o.product_id, o.variant_id, o.amount_minor, o.stock_status,
                      v.slug as vendor_slug
               from vendor_offer o join vendor v on v.id = o.vendor_id
               where v.is_active
                 and o.consecutive_failures < 5
                 and o.last_seen_at < now() - make_interval(hours => %s)
               order by o.last_seen_at asc limit %s""",
            (max_age_hours, limit),
        )
        return list(cursor.fetchall())


# --------------------------------------------------------------------------------------
# products
# --------------------------------------------------------------------------------------


def find_product_by_name(connection: psycopg.Connection[Any], name: str) -> dict[str, Any] | None:
    """Match a vendor's listing title to an existing product.

    Vendor titles are noisy ("Buy Radxa Rock 5B+ 8GB LPDDR5 RAM No eMMC | Free Shipping"), so
    this is a containment test in both directions on a normalised string rather than equality.
    A miss returns None and the caller decides - it never guesses a product.
    """
    cleaned = " ".join(
        word
        for word in "".join(
            character.lower() if character.isalnum() or character.isspace() else " "
            for character in name
        ).split()
        if word not in {"buy", "online", "india", "free", "shipping", "with", "for", "the"}
    )
    if len(cleaned) < 4:
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            """select id, name, slug from product
               where lower(name) = %s
                  or position(lower(name) in %s) > 0
               order by length(name) desc limit 1""",
            (cleaned, cleaned),
        )
        return cursor.fetchone()


def catalog_counts(connection: psycopg.Connection[Any]) -> dict[str, int]:
    tables = (
        "product",
        "silicon",
        "vendor",
        "vendor_offer",
        "vendor_offer_snapshot",
        "price_estimate",
        "product_link",
        "product_image",
        "source",
    )
    counts: dict[str, int] = {}
    with connection.cursor() as cursor:
        for table in tables:
            cursor.execute(f"select count(*) as n from {table}")  # noqa: S608 - fixed list
            row = cursor.fetchone()
            counts[table] = int(row["n"]) if row else 0
    return counts


def products_for_brands(
    connection: psycopg.Connection[Any], brand_patterns: list[str], limit: int | None = None
) -> list[dict[str, Any]]:
    """Catalog products whose manufacturer matches any of the given patterns.

    Sweeping from the product side is what makes matching reliable: the target is known up
    front, so a listing is checked against *that* product rather than reverse-looked-up from a
    noisy vendor title.
    """
    clauses = " or ".join(["lower(m.name) like %s"] * len(brand_patterns))
    query = f"""select p.id, p.name, p.slug, m.name as manufacturer
                from product p join manufacturer m on m.id = p.manufacturer_id
                where {clauses}
                order by m.name, p.name"""  # noqa: S608 - clause count is derived, values bound
    with connection.cursor() as cursor:
        cursor.execute(
            query + (f" limit {int(limit)}" if limit else ""),
            [f"%{pattern.lower()}%" for pattern in brand_patterns],
        )
        return list(cursor.fetchall())


def upsert_product_link(
    connection: psycopg.Connection[Any],
    *,
    product_id: str,
    url: str,
    label: str,
    kind: str = "distributor",
    source_id: str | None = None,
) -> bool:
    """A vendor's page as a first-class link on the product. Returns True when newly added.

    Offers hold the commercial terms; this exists so the link also shows up in the catalog UI
    alongside the datasheet and the vendor's own product page.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "select id from product_link where product_id = %s and url = %s", (product_id, url)
        )
        if cursor.fetchone():
            cursor.execute(
                "update product_link set last_checked_at = now(), is_broken = false "
                "where product_id = %s and url = %s",
                (product_id, url),
            )
            connection.commit()
            return False
        cursor.execute(
            """insert into product_link (id, product_id, kind, url, label, region_code,
               last_checked_at, source_id, confidence, verified_at)
               values (%s,%s,%s,%s,%s,'IN',now(),%s,'high',now())""",
            (new_id("plk"), product_id, kind, url, label[:120], source_id),
        )
    connection.commit()
    return True


def offer_exists(connection: psycopg.Connection[Any], product_id: str, vendor_slug: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """select 1 from vendor_offer o join vendor v on v.id = o.vendor_id
               where o.product_id = %s and v.slug = %s limit 1""",
            (product_id, vendor_slug),
        )
        return cursor.fetchone() is not None


def product_gaps(connection: psycopg.Connection[Any], product_id: str) -> set[str]:
    """Which descriptive fields this product is still missing.

    Extraction only ever fills gaps. Overwriting a curated value with a 4B model's reading of
    a shop listing would trade good data for worse.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "select summary, description, width_mm, length_mm, weight_g from product where id = %s",
            (product_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return set()
        gaps = {name for name, value in row.items() if value is None or value == ""}

        # A board with no silicon attached is missing the most important fact about it.
        cursor.execute("select 1 from product_silicon where product_id = %s limit 1", (product_id,))
        if cursor.fetchone() is None:
            gaps.add("soc_name")
        return gaps


def upsert_claim(
    connection: psycopg.Connection[Any],
    *,
    entity_table: str,
    entity_id: str,
    field_path: str,
    value_text: str,
    quoted_text: str,
    source_id: str | None,
    confidence: str = "low",
) -> bool:
    """Record a proposed value with its evidence. Returns True when newly proposed.

    Deliberately writes to `claim`, never to the canonical row. Everything a language model
    produces lands here as `proposed`, attached to the page it came from and the verbatim
    fragment supporting it, so a wrong reading is visible and reversible rather than silently
    becoming the catalog's answer.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """select id, value_text from claim
               where entity_table = %s and entity_id = %s and field_path = %s
                 and source_id is not distinct from %s""",
            (entity_table, entity_id, field_path, source_id),
        )
        existing = cursor.fetchone()
        if existing is not None:
            if existing["value_text"] == value_text:
                return False
            cursor.execute(
                "update claim set value_text = %s, quoted_text = %s, updated_at = now() "
                "where id = %s",
                (value_text, quoted_text[:600], existing["id"]),
            )
            connection.commit()
            return False

        cursor.execute(
            """insert into claim (id, source_id, entity_table, entity_id, field_path, value_text,
               confidence, status, asserted_by_kind, asserted_by_id, quoted_text, notes)
               values (%s,%s,%s,%s,%s,%s,%s,'proposed','agent','catalog-agent',%s,%s)""",
            (
                new_id("clm"),
                source_id,
                entity_table,
                entity_id,
                field_path,
                value_text,
                confidence,
                quoted_text[:600],
                "proposed by the catalog agent from a vendor listing; needs review",
            ),
        )
    connection.commit()
    return True


def claim_counts(connection: psycopg.Connection[Any]) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute("select status, count(*) as n from claim group by status")
        return {row["status"]: row["n"] for row in cursor.fetchall()}
