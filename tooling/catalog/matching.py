"""Decide whether a vendor listing really is a given catalog product.

This is the highest-risk step in the whole agent. A wrong match writes a vendor's price onto
the wrong board, and unlike a missing row it looks perfectly fine in the UI. Two real failures
from the first run motivate everything here, both approved by the model with "high" confidence:

  "RASPBERRY-PI SC0480 Antenna Kit ... Compute Module 4"  ->  Compute Module 4   (₹808 antenna)
  "Radxa ROCK 5B+"                                        ->  ROCK 5B           (different board)

The model accepted both because the product's name appears verbatim in the listing title. So
the guards below run in code, *before* the model is consulted, and the model can only ever
reject - never rescue - a candidate.
"""

from __future__ import annotations

import re

# A listing whose title contains one of these is an add-on, no matter which board it names.
ACCESSORY_TERMS = (
    "antenna",
    "case",
    "casing",
    "enclosure",
    "heatsink",
    "heat sink",
    "cooler",
    "cooling",
    "fan",
    "cable",
    "adapter",
    "adaptor",
    "power supply",
    "psu",
    "charger",
    "sd card",
    "micro sd",
    "sdcard",
    "bundle",
    "kit for",
    "mount",
    "bracket",
    "stand",
    "screw",
    "standoff",
    "spacer",
    "connector",
    "camera module",
    "display module",
    "screen",
    "keyboard",
    "mouse",
    "hat ",
    " hat",
    "shield",
    "expansion board",
    "carrier board",
    "breakout",
    "dongle",
    "converter",
    "adapter board",
    "battery",
    "rtc battery",
    "adhesive",
    "thermal pad",
    "adapter kit",
    "starter kit",
    "accessory",
    "spare",
)

# Tokens that distinguish one board from a near neighbour. If the two names disagree on any of
# these, they are different products even when everything else matches.
MODEL_MARKERS = (
    "plus",
    "pro",
    "max",
    "ultra",
    "lite",
    "mini",
    "nano",
    "zero",
    "compute",
    "cm",
    "w",
    "wh",
    "a",
    "b",
    "s",
    "t",
    "e",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
    "1",
)

# A model-marker "+" is attached to the token before it ("ROCK 5B+"). A spaced "+" is a
# conjunction between specs ("4GB Ram + 32GB eMMC") and says nothing about the model -
# treating the two alike rejected a legitimate Radxa CM5 listing.
PLUS_RE = re.compile(r"\w\+")
NOISE = {
    "buy",
    "online",
    "india",
    "free",
    "shipping",
    "official",
    "genuine",
    "original",
    "with",
    "for",
    "the",
    "and",
    "model",
    "board",
    "single",
    "computer",
    "sbc",
    "new",
    "latest",
    "version",
    "ram",
    "gb",
    "mb",
    "lpddr",
    "lpddr4",
    "lpddr5",
    "ddr4",
    "ddr5",
    "no",
    "emmc",
    "wifi",
    "bluetooth",
    "in",
    "of",
    "by",
    "from",
    "at",
    "to",
}


def normalise(text: str) -> list[str]:
    """Lower-case alphanumeric tokens, with marketing words removed."""
    cleaned = "".join(
        character.lower() if character.isalnum() or character.isspace() else " "
        for character in text
    )
    return [word for word in cleaned.split() if word not in NOISE]


def looks_like_accessory(title: str) -> str | None:
    """The accessory term that disqualifies this title, if any."""
    lowered = f" {title.lower()} "
    for term in ACCESSORY_TERMS:
        if term in lowered:
            return term
    return None


def plus_mismatch(catalog_name: str, listing_title: str) -> bool:
    """Whether exactly one of the two names carries a '+' / 'plus' marker.

    ROCK 5B and ROCK 5B+ are genuinely different boards, and the '+' is the only thing that
    says so - it survives neither tokenisation nor a language model's judgement.
    """

    def has_marker(text: str) -> bool:
        return bool(PLUS_RE.search(text)) or bool(re.search(r"\bplus\b", text, re.I))

    return has_marker(catalog_name) != has_marker(listing_title)


def marker_conflict(catalog_name: str, listing_title: str) -> str | None:
    """A distinguishing token present in the catalog name but absent from the listing."""
    catalog_tokens = set(normalise(catalog_name))
    listing_tokens = set(normalise(listing_title))
    for token in catalog_tokens:
        if token in MODEL_MARKERS and token not in listing_tokens:
            return token
    return None


# A listing that merely *contains* the part is not that part. "Lyra Pi A ... Based On Luckfox
# Core3506" is a different board built on the Core3506, and matching it puts another product's
# price on the part.
DERIVATIVE_RE = re.compile(
    r"\b(based\s+on|powered\s+by|built\s+(?:on|around)|compatible\s+with|designed\s+for|"
    r"for\s+use\s+with|works\s+with)\b",
    re.I,
)


def is_derivative(listing_title: str) -> str | None:
    """The phrase marking this listing as a different product built on the target, if any."""
    match = DERIVATIVE_RE.search(listing_title)
    return match.group(0) if match else None


def missing_model_token(catalog_name: str, listing_title: str) -> str | None:
    """A distinctive catalog token absent from the listing.

    Model identifiers mix letters and digits - "core3506", "rk3588", "5b", "cm5". If the
    catalog name carries one and the listing does not, they are different parts, however much
    the surrounding marketing words overlap.
    """
    listing_tokens = set(normalise(listing_title))
    for token in normalise(catalog_name):
        if any(character.isdigit() for character in token) and token not in listing_tokens:
            return token
    return None


# A listing names the product it sells at the FRONT of the title; parts it merely contains
# appear later, after a comma or a spec list. "Luckfox Lyra Pi A Linux Micro Development Board
# 8GB eMMC, Core3506 Core Board" sells a Lyra Pi A that *contains* a Core3506 - the token is
# present, and no "based on" phrase gives it away, so position is the only reliable signal.
HEAD_TOKENS = 5


def head_mismatch(catalog_name: str, listing_title: str) -> str | None:
    """A catalog model identifier that appears only in the tail of the listing title."""
    head = set(normalise(listing_title)[:HEAD_TOKENS])
    for token in normalise(catalog_name):
        if any(character.isdigit() for character in token) and token not in head:
            return token
    return None


def prescreen(catalog_name: str, listing_title: str) -> tuple[bool, str]:
    """Deterministic verdict on a candidate match, before any model is involved.

    Returns (allowed, reason). `allowed` False means reject outright - the model is not asked,
    because on both real failures it answered "yes, high confidence".
    """
    accessory = looks_like_accessory(listing_title)
    if accessory is not None:
        return False, f"accessory term {accessory!r}"

    if plus_mismatch(catalog_name, listing_title):
        return False, "'+' / Plus present on only one side"

    conflict = marker_conflict(catalog_name, listing_title)
    if conflict is not None:
        return False, f"catalog token {conflict!r} missing from the listing"

    missing = missing_model_token(catalog_name, listing_title)
    if missing is not None:
        return False, f"model identifier {missing!r} absent from the listing"

    derivative = is_derivative(listing_title)
    if derivative is not None:
        return False, f"derivative phrasing {derivative.lower()!r}"

    buried = head_mismatch(catalog_name, listing_title)
    if buried is not None:
        return False, f"model identifier {buried!r} appears only later in the title"

    return True, "passed prescreen"
