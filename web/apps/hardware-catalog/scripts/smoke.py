#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""End-to-end smoke test for the hardware catalog API.

Drives the real tRPC surface over HTTP: writes a small but structurally complete slice of the
graph (two SoCs with heterogeneous engines, an accelerator with per-precision throughput, an
asymmetric codec pair, a board carrying two chips in different roles), reads it back through
the comparison and detail endpoints, and asserts the shapes that the data model exists to
preserve.

This is a *test harness*, not a seed script: everything it creates is deleted again unless
`--keep` is passed. Run it against a dev server on :3100.

    python3 scripts/smoke.py [--keep] [--base http://localhost:3100]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

created: list[tuple[str, str]] = []


class SmokeError(RuntimeError):
    pass


def call(base: str, path: str, payload: dict[str, Any], *, mutation: bool) -> Any:
    url = f"{base}/api/trpc/{path}"
    if mutation:
        request = urllib.request.Request(
            url,
            data=json.dumps({"json": payload}).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
    else:
        query = urllib.parse.quote(json.dumps({"json": payload}))
        request = urllib.request.Request(f"{url}?input={query}", method="GET")

    try:
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise SmokeError(f"{path} -> HTTP {error.code}: {error.read()[:500].decode()}") from error

    if "error" in body:
        raise SmokeError(f"{path} -> {json.dumps(body['error'])[:500]}")
    return body["result"]["data"]["json"]


def create(base: str, router: str, values: dict[str, Any]) -> str:
    row = call(base, f"{router}.create", values, mutation=True)
    created.append((router, row["id"]))
    return row["id"]


def cleanup(base: str) -> None:
    for router, row_id in reversed(created):
        try:
            call(base, f"{router}.delete", {"id": row_id}, mutation=True)
        except SmokeError as error:  # best effort; cascades may have removed it already
            print(f"  cleanup skipped {router}/{row_id}: {error}")


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeError(message)
    print(f"  ok  {message}")


def run(base: str) -> None:
    print("→ taxonomy")
    allwinner = create(
        base,
        "manufacturers",
        {"slug": "smoke-allwinner", "name": "Allwinner (smoke)", "designsSilicon": True},
    )
    radxa = create(
        base,
        "manufacturers",
        {"slug": "smoke-radxa", "name": "Radxa (smoke)", "designsProducts": True},
    )
    armv8 = create(
        base,
        "architectures",
        {
            "slug": "smoke-armv8a",
            "name": "Armv8-A (smoke)",
            "family": "arm",
            "profile": "application",
            "bits": 64,
            "extensions": ["NEON"],
        },
    )
    rv64 = create(
        base,
        "architectures",
        {
            "slug": "smoke-rv64",
            "name": "RV64 (smoke)",
            "family": "riscv",
            "profile": "microcontroller",
            "bits": 64,
        },
    )

    a76 = create(
        base,
        "coreDesigns",
        {
            "slug": "smoke-cortex-a76",
            "name": "Cortex-A76 (smoke)",
            "kind": "cpu",
            "architectureId": armv8,
            "executionOrder": "out_of_order",
        },
    )
    a55 = create(
        base,
        "coreDesigns",
        {
            "slug": "smoke-cortex-a55",
            "name": "Cortex-A55 (smoke)",
            "kind": "cpu",
            "architectureId": armv8,
            "executionOrder": "in_order",
        },
    )
    e902 = create(
        base,
        "coreDesigns",
        {
            "slug": "smoke-e902",
            "name": "XuanTie E902 (smoke)",
            "kind": "cpu",
            "architectureId": rv64,
        },
    )
    npu = create(
        base, "coreDesigns", {"slug": "smoke-npu", "name": "Vivante VIP (smoke)", "kind": "npu"}
    )

    print("→ silicon: heterogeneous engines on one die (finding 1)")
    a733 = create(
        base,
        "siliconEntity",
        {
            "slug": "smoke-a733",
            "name": "A733 (smoke)",
            "kind": "soc",
            "manufacturerId": allwinner,
            "partFamily": "A7xx",
            "processNodeNm": 6,
        },
    )
    big = create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": a733,
            "kind": "cpu",
            "role": "application",
            "coreDesignId": a76,
            "label": "big cluster",
            "coreCount": 2,
            "maxClockMhz": 2000,
        },
    )
    create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": a733,
            "kind": "cpu",
            "role": "application",
            "coreDesignId": a55,
            "label": "little cluster",
            "coreCount": 6,
            "maxClockMhz": 1800,
        },
    )
    create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": a733,
            "kind": "cpu",
            "role": "always_on",
            "coreDesignId": e902,
            "label": "always-on RISC-V",
            "coreCount": 1,
            "maxClockMhz": 200,
        },
    )
    npu_unit = create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": a733,
            "kind": "npu",
            "role": "accelerator",
            "coreDesignId": npu,
            "label": "NPU",
            "coreCount": 1,
        },
    )

    print("→ accelerator throughput carries its precision (finding 8)")
    create(
        base,
        "acceleratorPerformance",
        {"computeUnitId": npu_unit, "precision": "int8", "value": "3", "unit": "tops"},
    )
    create(
        base,
        "acceleratorPerformance",
        {"computeUnitId": npu_unit, "precision": "int16", "value": "1.5", "unit": "tops"},
    )

    print("→ mutually exclusive engines (finding 1: RP2350 / SG2002 shape)")
    sg = create(
        base,
        "siliconEntity",
        {
            "slug": "smoke-sg2002",
            "name": "SG2002 (smoke)",
            "kind": "soc",
            "manufacturerId": allwinner,
        },
    )
    create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": sg,
            "kind": "cpu",
            "role": "application",
            "coreDesignId": a55,
            "label": "main core (Arm)",
            "coreCount": 1,
            "maxClockMhz": 1000,
            "alternativeGroup": "main-core",
            "isDefaultAlternative": True,
        },
    )
    create(
        base,
        "siliconComputeUnits",
        {
            "siliconId": sg,
            "kind": "cpu",
            "role": "application",
            "coreDesignId": e902,
            "label": "main core (RISC-V)",
            "coreCount": 1,
            "maxClockMhz": 1000,
            "alternativeGroup": "main-core",
        },
    )

    print("→ encode ≠ decode (finding 9)")
    create(base, "siliconMediaCodecs", {"siliconId": sg, "format": "h264", "direction": "decode"})
    create(base, "siliconMediaCodecs", {"siliconId": sg, "format": "h264", "direction": "encode"})
    create(base, "siliconMediaCodecs", {"siliconId": sg, "format": "h265", "direction": "encode"})

    print("→ in-package memory is a silicon fact (finding 2)")
    create(
        base,
        "siliconMemorySupport",
        {
            "siliconId": sg,
            "kind": "dram",
            "standard": "DDR3",
            "mounting": "in_package_sip",
            "capacityMb": 256,
        },
    )
    create(
        base,
        "siliconMemorySupport",
        {
            "siliconId": a733,
            "kind": "dram",
            "standard": "LPDDR4X",
            "mounting": "on_board_soldered",
            "maxCapacityMb": 16384,
        },
    )

    create(
        base,
        "siliconInterfaces",
        {"siliconId": a733, "kind": "usb", "count": 3, "version": "USB 2.0"},
    )
    create(
        base,
        "siliconInterfaces",
        {"siliconId": a733, "kind": "mipi_csi", "count": 2, "version": "CSI-2 4-lane", "lanes": 4},
    )
    create(
        base,
        "siliconRadios",
        {
            "siliconId": a733,
            "standard": "wifi",
            "generation": "Wi-Fi 6",
            "specName": "802.11ax",
            "bands": ["2.4 GHz"],
        },
    )

    print("→ one design, many ordering codes (finding 6)")
    create(
        base,
        "siliconVariants",
        {
            "siliconId": a733,
            "orderingCode": "SMOKE-A733-C",
            "temperatureGrade": "commercial",
            "tempMinC": 0,
            "tempMaxC": 70,
        },
    )
    create(
        base,
        "siliconVariants",
        {
            "siliconId": a733,
            "orderingCode": "SMOKE-A733-J",
            "temperatureGrade": "industrial",
            "tempMinC": -40,
            "tempMaxC": 85,
        },
    )

    print("→ a board carries several chips in different roles (finding 4)")
    board = create(
        base,
        "productEntity",
        {
            "slug": "smoke-cubie-a7z",
            "name": "Cubie A7Z (smoke)",
            "tier": "board",
            "manufacturerId": radxa,
            "familyName": "Cubie",
        },
    )
    create(base, "productSilicon", {"productId": board, "siliconId": a733, "role": "application"})
    create(
        base,
        "productSilicon",
        {"productId": board, "siliconId": sg, "role": "coprocessor", "interconnect": "SDIO"},
    )
    create(
        base,
        "productExposedInterfaces",
        {
            "productId": board,
            "kind": "usb",
            "count": 1,
            "version": "USB 2.0",
            "providedBySiliconId": a733,
            "connectorDescription": "USB-C",
        },
    )

    print("\n→ read back")
    compare = call(
        base, "silicon.compare", {"slugs": ["smoke-a733", "smoke-sg2002"]}, mutation=False
    )
    expect(len(compare) == 2, "compare returns both parts, in the requested order")
    expect(
        [p["slug"] for p in compare] == ["smoke-a733", "smoke-sg2002"],
        "comparison column order matches the request",
    )

    first = compare[0]
    expect(len(first["computeUnits"]) == 4, "A733 reports 4 distinct engines, not one core count")
    roles = {u["role"] for u in first["computeUnits"]}
    expect("always_on" in roles and "accelerator" in roles, "engine roles survive the round trip")

    perf = [p for u in first["computeUnits"] for p in u["performance"]]
    expect(
        {p["precision"] for p in perf} == {"int8", "int16"},
        "accelerator throughput is stored per precision",
    )

    second = compare[1]
    groups = {u["alternativeGroup"] for u in second["computeUnits"] if u["alternativeGroup"]}
    expect(groups == {"main-core"}, "mutually exclusive engines share an alternative group")
    defaults = [u for u in second["computeUnits"] if u["isDefaultAlternative"]]
    expect(len(defaults) == 1, "exactly one alternative is marked default")

    codecs = {(c["format"], c["direction"]) for c in second["codecs"]}
    expect(
        ("h265", "encode") in codecs and ("h265", "decode") not in codecs,
        "H.265 encode-only is representable",
    )

    mounting = {m["mounting"] for m in second["memory"]}
    expect(mounting == {"in_package_sip"}, "SiP memory is recorded as a silicon fact")

    detail = call(base, "products.detail", {"slug": "smoke-cubie-a7z"}, mutation=False)
    expect(len(detail["silicon"]) == 2, "the board reports both chips it carries")
    expect(
        {s["role"] for s in detail["silicon"]} == {"application", "coprocessor"},
        "each chip keeps its role",
    )

    gap = {g["kind"]: g for g in detail["capabilityGap"]}
    expect(
        gap["usb"]["siliconProvides"] == 3 and gap["usb"]["productExposes"] == 1,
        "capability vs exposure gap is computed (3 provided, 1 routed)",
    )
    expect(
        gap["mipi_csi"]["productExposes"] == 0,
        "silicon capability with no board exposure is visible",
    )

    boards = call(base, "products.bySilicon", {"siliconSlug": "smoke-a733"}, mutation=False)
    expect(
        len(boards) == 1 and boards[0]["role"] == "application",
        "walking from silicon to its boards returns the role",
    )

    filtered = call(
        base, "silicon.list", {"coreKinds": ["npu"], "minAcceleratorTops": 2}, mutation=False
    )
    expect(
        any(p["slug"] == "smoke-a733" for p in filtered["items"]),
        "filter by engine kind + minimum int8 TOPS finds the part",
    )
    filtered_high = call(base, "silicon.list", {"minAcceleratorTops": 10}, mutation=False)
    expect(
        all(p["slug"] != "smoke-a733" for p in filtered_high["items"]),
        "the TOPS floor actually excludes",
    )

    by_core = call(base, "silicon.list", {"coreDesignIds": [a76]}, mutation=False)
    expect(
        [p["slug"] for p in by_core["items"]] == ["smoke-a733"],
        "filter by core design finds only parts carrying it",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3100")
    parser.add_argument("--keep", action="store_true", help="leave the written rows in place")
    args = parser.parse_args()

    try:
        run(args.base)
    except SmokeError as error:
        print(f"\nFAILED: {error}", file=sys.stderr)
        if not args.keep:
            cleanup(args.base)
        return 1

    if args.keep:
        print(f"\nPASS — {len(created)} rows kept")
    else:
        print("\n→ cleanup")
        cleanup(args.base)
        print(f"PASS — {len(created)} rows written and removed")
    return 0


if __name__ == "__main__":
    import urllib.parse

    sys.exit(main())
