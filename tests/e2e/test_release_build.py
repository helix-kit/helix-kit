from __future__ import annotations

import os

import pytest

from tooling.release.build_worker import run_custom_build
from tooling.release.sim import ESP32_TYPE_SEED_SQL, ReleaseClient, make_ci_token_sql

# A real ESP-IDF build needs the lean image and takes minutes, so it is opt-in.
pytestmark = pytest.mark.skipif(
    not os.environ.get("HELIX_E2E_REAL_BUILD"),
    reason="set HELIX_E2E_REAL_BUILD=1 to run the real ESP-IDF custom-firmware build",
)

CONFIG = {
    "apps": ["gpio_control"],
    "features": ["no-ble"],
    "set": {},
    "chip": "esp32",
    "flashSize": "4MB",
}
SELECTOR = {"chip": "esp32", "flashSize": "4MB"}


def _count(stack, sql: str) -> int:
    return int(stack.appliance.psql(sql).stdout.strip() or "0")


def test_real_custom_firmware_build(stack) -> None:
    stack.appliance.psql(ESP32_TYPE_SEED_SQL)
    ci_secret, token_sql = make_ci_token_sql()
    stack.appliance.psql(token_sql)
    client = ReleaseClient(stack.server.public_base_url, ci_secret)

    result = run_custom_build(
        client,
        name="custom-fw-real",
        version="1.0.0-real",
        channel="custom",
        selector=SELECTOR,
        config=CONFIG,
        owner_user_id="user-real",
    )
    assert result["status"] == "built"
    assert result["releaseId"]

    # The registered release is owned (custom) and carries the real built firmware.
    assert (
        _count(
            stack,
            "SELECT count(*) FROM release WHERE name = 'custom-fw-real' "
            "AND owner_user_id = 'user-real'",
        )
        == 1
    )
    assert (
        _count(
            stack,
            "SELECT count(*) FROM build WHERE source = 'custom' AND status = 'success'",
        )
        == 1
    )
    # The app artifact stored matches the sha256 of the actual built .bin.
    assert (
        _count(
            stack,
            f"SELECT count(*) FROM artifact WHERE sha256 = '{result['appSha256']}' "
            "AND storage_mode = 'blob'",
        )
        == 1
    )
    # Four flashable roles (bootloader/partition-table/ota-data/app) linked with offsets.
    assert (
        _count(
            stack,
            "SELECT count(*) FROM variant_artifact va JOIN variant v ON va.variant_id = v.id "
            "JOIN release r ON v.release_id = r.id WHERE r.name = 'custom-fw-real'",
        )
        == 4
    )

    # Repeat same config -> Tier-0 cache hit (no rebuild, no new release).
    again = run_custom_build(
        client,
        name="custom-fw-real",
        version="1.0.0-real",
        channel="custom",
        selector=SELECTOR,
        config=CONFIG,
        owner_user_id="user-real",
    )
    assert again["status"] == "hit"
    assert _count(stack, "SELECT count(*) FROM build WHERE source = 'custom'") == 1
