"""The verified Indian vendor list, and how each one is read.

Every field here was established by probing the live sites (see `docs/21`), not assumed. That
matters because the difference between a JSON feed and scraped HTML is the difference between
an exact price and a guess, and because a generic `.price` selector reliably picks up
related-product rails and discount badges instead of the actual price.

Prices are never read by a language model. They come from a product feed or from the element
the page itself designates as the price, which is what keeps them exact.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Vendor:
    slug: str
    name: str
    base_url: str
    platform: str
    fetch_strategy: str
    """CSS selector for THE price. Specific on purpose - see the module docstring."""
    price_selector: str = ""
    """Selector holding availability, and a count where the vendor publishes one."""
    stock_selector: str = ""
    publishes_stock_count: bool = False
    sitemap_url: str = ""
    requires_browser: bool = False
    requests_per_second: float = 1.0
    prices_include_tax: bool = True
    is_active: bool = True
    """Search-result hostnames that belong to this vendor, for attributing a discovered link."""
    hostnames: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""


# Shopify stores all read the same way: `/products.json` reports paise directly, so no float
# ever touches a price, and the feed is the same data the cart charges from.
def _shopify(slug: str, name: str, base_url: str, *hostnames: str) -> Vendor:
    return Vendor(
        slug=slug,
        name=name,
        base_url=base_url,
        platform="shopify",
        fetch_strategy="shopify_json",
        price_selector=".price-item--regular",
        hostnames=hostnames,
    )


VENDORS: tuple[Vendor, ...] = (
    _shopify(
        "robocraze", "Robocraze", "https://robocraze.com", "robocraze.com", "www.robocraze.com"
    ),
    _shopify(
        "thinkrobotics",
        "ThinkRobotics",
        "https://thinkrobotics.com",
        "thinkrobotics.com",
        "www.thinkrobotics.com",
    ),
    _shopify(
        "quartzcomponents",
        "Quartz Components",
        "https://quartzcomponents.com",
        "quartzcomponents.com",
        "www.quartzcomponents.com",
    ),
    _shopify("tanotis", "Tanotis", "https://tanotis.com", "tanotis.com", "www.tanotis.com"),
    _shopify(
        "silverline",
        "Silverline Electronics",
        "https://silverlineelectronics.in",
        "silverlineelectronics.in",
        "www.silverlineelectronics.in",
    ),
    # BigCommerce. The only vendor here that publishes a real stock number: `.productView__stock`
    # renders "1168 in stock". Its Open Graph price tag matched the rendered price on every
    # product sampled.
    Vendor(
        slug="evelta",
        name="Evelta Electronics",
        base_url="https://evelta.com",
        platform="bigcommerce",
        fetch_strategy="jsonld",
        price_selector='meta[property="product:price:amount"], .productView-price .price',
        stock_selector=".productView__stock, .form-field--stock",
        publishes_stock_count=True,
        sitemap_url="https://evelta.com/xmlsitemap.php?type=products&page=1",
        hostnames=("evelta.com", "www.evelta.com"),
        notes="Publishes an exact stock count; JSON-LD verified exact on 4/4 sampled products.",
    ),
    # OpenCart. JSON-LD verified exact; `.product-price` is the real price, while a bare
    # `.price` matches the related-products rail.
    Vendor(
        slug="hubtronics",
        name="Hubtronics",
        base_url="https://hubtronics.in",
        platform="opencart",
        fetch_strategy="jsonld",
        price_selector=".product-price, .price-group .price-normal",
        stock_selector=".product-stock, .stock",
        hostnames=("hubtronics.in", "www.hubtronics.in"),
        notes=(
            "Prices incl. GST; related-product tiles also carry .price, "
            "hence the specific selector."
        ),
    ),
    # Magento. Emits no Product JSON-LD, but the standard Magento markup is stable, and this is
    # the vendor that distinguishes Back Order from In Stock.
    Vendor(
        slug="tannatechbiz",
        name="Tanna TechBiz",
        base_url="https://tannatechbiz.com",
        platform="magento",
        fetch_strategy="html",
        price_selector=(
            "[data-price-type=finalPrice] .price, .price-wrapper .price, "
            ".product-info-price .price"
        ),
        stock_selector=".stock.available, .stock.unavailable, .stock",
        sitemap_url="https://tannatechbiz.com/product.html",
        hostnames=("tannatechbiz.com", "www.tannatechbiz.com"),
        notes=(
            "Reports 'In Stock' / 'Back Order'; no product JSON-LD, " "so the DOM is authoritative."
        ),
    ),
    # BLOCKED, and honestly recorded as such rather than shipped as a broken adapter.
    # Plain HTTP gets 403; a real headless browser gets HTTP 200 carrying only nav chrome
    # (~791 bytes, no product body), and both sitemaps return 200 with zero <loc> entries.
    # That is a bot challenge answering everything, not a URL problem. Left inactive: it needs
    # either a challenge-solving session or a residential/official feed, which is a decision
    # for the repo owner rather than something to work around quietly.
    Vendor(
        slug="robu",
        name="Robu.in",
        base_url="https://robu.in",
        platform="woocommerce",
        fetch_strategy="browser_jsonld",
        price_selector=".summary .price .woocommerce-Price-amount, .woocommerce-Price-amount",
        stock_selector=".stock, .availability",
        requires_browser=True,
        requests_per_second=0.4,
        is_active=False,
        hostnames=("robu.in", "www.robu.in"),
        notes=(
            "BLOCKED by bot protection: nav-only HTML and empty sitemaps. "
            "Inactive until a route exists."
        ),
    ),
)

BY_SLUG: dict[str, Vendor] = {vendor.slug: vendor for vendor in VENDORS}

_BY_HOST: dict[str, Vendor] = {host: vendor for vendor in VENDORS for host in vendor.hostnames}


def vendor_for_url(url: str) -> Vendor | None:
    """The vendor a URL belongs to, or None if it is not one we trust.

    This is the gate that keeps unverified marketplace listings out of the catalog: a search
    result that does not map to a known vendor is discarded rather than written.
    """
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    if host in _BY_HOST:
        return _BY_HOST[host]
    # Accept sub-domains of a known vendor, but never a look-alike domain that merely ends
    # with the same string.
    for known, vendor in _BY_HOST.items():
        if host.endswith("." + known):
            return vendor
    return None


def is_trusted(url: str) -> bool:
    return vendor_for_url(url) is not None
