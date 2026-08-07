"""LM Studio lifecycle and schema-constrained extraction.

The tool owns the whole stack, so it starts the daemon and loads the model itself rather than
expecting a human to have done it. Two things learned the hard way shape this:

- If nothing is loaded, LM Studio JIT-loads on the first request at the model's DEFAULT context
  (8192), which is too small for a real extraction prompt and fails mid-run. So the model is
  always loaded explicitly with a known context.
- On a 4 GiB card, nemotron-3-nano-4b fits at 32768 and fails to load at 49152. Anything
  larger has to run CPU-only, at roughly a quarter of the speed.

Extraction is always `response_format: json_schema` with `strict`. A 4B model asked for prose
will happily invent a plausible spec sheet; constrained to a schema, and told to omit anything
not present in the text, it is markedly better behaved. Nothing here reads a price - that is
`adapters.py`, deterministically.
"""

from __future__ import annotations

import json
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "nvidia/nemotron-3-nano-4b"

# Measured on this box's GTX 1650 (4 GiB): 32768 loads at ~3.5 GiB, 49152 does not load.
GPU_SAFE_CONTEXT = 32768


class ModelError(RuntimeError):
    pass


def _run(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)


def server_up() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/models", timeout=5) as response:
            return bool(response.status == 200)
    except Exception:  # noqa: BLE001
        return False


def ensure_server(log: Callable[[str], None] = print) -> None:
    if server_up():
        return
    log("starting LM Studio server ...")
    result = _run(["lms", "server", "start"], timeout=120)
    for _ in range(30):
        if server_up():
            log("  server up")
            return
        time.sleep(1)
    raise ModelError(f"could not start LM Studio server: {result.stderr.strip()[:200]}")


def loaded_models() -> list[dict[str, Any]]:
    result = _run(["lms", "ps", "--json"], timeout=60)
    if result.returncode != 0:
        return []
    try:
        return list(json.loads(result.stdout or "[]"))
    except json.JSONDecodeError:
        return []


def ensure_model(
    model: str = DEFAULT_MODEL,
    context: int = GPU_SAFE_CONTEXT,
    log: Callable[[str], None] = print,
) -> None:
    """Load the model at a known context, on the GPU when it fits there.

    Never relies on JIT loading: that silently uses the model's default 8192 window, which
    truncates extraction prompts and produces confident, incomplete answers.
    """
    ensure_server(log=log)
    for entry in loaded_models():
        identifier = entry.get("modelKey") or entry.get("identifier") or ""
        if model in str(identifier) and int(entry.get("contextLength") or 0) >= context:
            log(f"  {model} already loaded at {entry.get('contextLength')}")
            return

    log(f"loading {model} at context {context} ...")
    result = _run(
        ["lms", "load", model, "--gpu", "max", "-c", str(context), "--identifier", "catalog"],
        timeout=900,
    )
    if result.returncode != 0:
        log("  GPU load failed, falling back to CPU (slower but correctness is unchanged)")
        result = _run(
            ["lms", "load", model, "--gpu", "off", "-c", str(context), "--identifier", "catalog"],
            timeout=1800,
        )
        if result.returncode != 0:
            raise ModelError(f"could not load {model}: {result.stderr.strip()[:300]}")
    log("  model ready")


def unload_all(log: Callable[[str], None] = print) -> None:
    _run(["lms", "unload", "--all"], timeout=120)
    log("  models unloaded")


def complete_json(
    prompt: str,
    schema: dict[str, Any],
    *,
    model: str = "catalog",
    max_tokens: int = 1500,
    timeout: int = 1800,
) -> dict[str, Any] | None:
    """One schema-constrained completion. Returns None rather than raising on a bad answer."""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "strict": True, "schema": schema},
        },
    }
    request = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise ModelError(f"HTTP {error.code}: {error.read()[:200].decode()}") from error
    except Exception as error:  # noqa: BLE001
        raise ModelError(f"{type(error).__name__}: {error}") from error

    content = payload["choices"][0]["message"]["content"]
    try:
        return dict(json.loads(content))
    except json.JSONDecodeError:
        return None


# --------------------------------------------------------------------------------------
# extraction schemas
# --------------------------------------------------------------------------------------

# Only fields a vendor listing can actually support. Deliberately excludes price and stock:
# those come from the adapters, exactly so a model can never invent one.
SPEC_SCHEMA = {
    "type": "object",
    "properties": {
        "is_single_board_computer": {"type": "boolean"},
        "product_name": {"type": "string"},
        "manufacturer": {"type": "string"},
        "soc_name": {"type": "string"},
        "cpu_cores": {"type": "integer"},
        "cpu_core_name": {"type": "string"},
        "cpu_max_clock_mhz": {"type": "integer"},
        "gpu_name": {"type": "string"},
        "npu_tops": {"type": "number"},
        "ram_gb": {"type": "number"},
        "ram_type": {"type": "string"},
        "storage_note": {"type": "string"},
        "ethernet": {"type": "string"},
        "wireless": {"type": "string"},
        "usb_ports": {"type": "string"},
        "video_outputs": {"type": "string"},
        "form_factor": {"type": "string"},
        "quoted_evidence": {"type": "string"},
    },
    "required": ["is_single_board_computer", "product_name", "quoted_evidence"],
}

SPEC_PROMPT = """You extract hardware specifications from an Indian electronics
retailer's product page.

Rules, in order of importance:
1. Use ONLY facts stated in the page text below. Never use prior knowledge about the product.
2. If a field is not stated, OMIT it entirely. Do not guess, and do not infer from the name.
3. is_single_board_computer: true only for a complete board or module (SBC, dev board, MCU
   board). False for cables, cases, sensors, displays, power supplies and other accessories.
4. quoted_evidence: copy a short verbatim fragment from the page that supports the SoC or CPU
   values. If the page does not state them, return an empty string.
5. Ignore anything about price, stock, shipping, warranty or offers.

Page text:
---
{page}
---

Return JSON only."""


def extract_specs(page_text: str, max_chars: int = 9000) -> dict[str, Any] | None:
    """Board specs from a listing, or None if the model produced nothing usable."""
    return complete_json(SPEC_PROMPT.format(page=page_text[:max_chars]), SPEC_SCHEMA)


MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "same_product": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason": {"type": "string"},
    },
    "required": ["same_product", "confidence", "reason"],
}

MATCH_PROMPT = """Decide whether these two names refer to the SAME hardware product.

Catalog entry: {catalog}
Vendor listing: {listing}

They are the same only if they are the same board from the same maker. Treat different RAM
sizes, different storage options, or a different revision as the SAME product (those are
variants), but a different model number or a different maker as DIFFERENT.

An accessory, case, cable or bundle is never the same as the board itself.

If you are not sure, answer false with low confidence.

Return JSON only."""


def confirm_match(catalog_name: str, listing_title: str) -> dict[str, Any] | None:
    """Second opinion on a fuzzy product match. Used to reject, never to invent."""
    return complete_json(
        MATCH_PROMPT.format(catalog=catalog_name, listing=listing_title),
        MATCH_SCHEMA,
        max_tokens=400,
    )
