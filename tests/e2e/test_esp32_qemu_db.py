# SPDX-License-Identifier: Apache-2.0
"""End-to-end proof of the on-device single-table store (FlashDB KVDB) in QEMU:
SQLite-like CRUD over the demo `users` table plus WHERE / ORDER BY / LIMIT /
COUNT / LIKE — driven over serial via the `db` service.

Requires the ESP-IDF QEMU image; run with `helix embedded esp32 qemu-test`.
"""

from __future__ import annotations

import pytest

from embedded.esp32.commands.simulator import open_esp32, target_available

pytestmark = pytest.mark.skipif(
    not target_available(),
    reason="requires ESP-IDF QEMU (qemu-system-xtensa + idf.py); run inside the esp-idf image",
)


def test_db_crud_and_query() -> None:
    with open_esp32() as sim:
        sim.read_until("db service started", timeout=60)

        # Clean slate (flash may retain rows from a previous run).
        sim.call("db", "deleteWhere", {}, "c0")
        assert sim.call("db", "count", {}, "c1")["count"] == 0

        # -- Create --
        alice = sim.call("db", "insert", {"name": "alice", "age": 30, "score": 9.5}, "i1")
        bob = sim.call("db", "insert", {"name": "bob", "age": 25, "score": 7.0}, "i2")
        carol = sim.call("db", "insert", {"name": "carol", "age": 40, "score": 8.0}, "i3")
        assert alice["id"] > 0 and bob["id"] > 0 and carol["id"] > 0
        assert sim.call("db", "count", {}, "c2")["count"] == 3

        # -- Read by id --
        got = sim.call("db", "get", {"id": bob["id"]}, "g1")
        assert got["name"] == "bob" and got["age"] == 25

        # -- Partial update (only age; name/score preserved) --
        upd = sim.call("db", "update", {"id": bob["id"], "age": 26}, "u1")
        assert upd["age"] == 26 and upd["name"] == "bob"

        # -- WHERE on a numeric column + ORDER BY asc --
        res = sim.call(
            "db",
            "select",
            {"where": [{"col": "age", "op": "ge", "val": 30}], "orderBy": "age"},
            "s1",
        )
        assert [r["name"] for r in res["rows"]] == ["alice", "carol"]

        # -- ORDER BY score DESC (all rows) --
        res = sim.call("db", "select", {"orderBy": "score", "desc": True}, "s2")
        assert [r["name"] for r in res["rows"]] == ["alice", "carol", "bob"]

        # -- LIKE on a text column ('carol' contains 'ar') --
        res = sim.call(
            "db", "select", {"where": [{"col": "name", "op": "like", "val": "ar"}]}, "s3"
        )
        assert [r["name"] for r in res["rows"]] == ["carol"]

        # -- LIMIT / OFFSET after ordering (ages: 26 bob, 30 alice, 40 carol) --
        res = sim.call("db", "select", {"orderBy": "age", "limit": 1, "offset": 1}, "s4")
        assert res["count"] == 1 and res["rows"][0]["name"] == "alice"

        # -- Delete by id --
        sim.call("db", "delete", {"id": alice["id"]}, "d1")
        assert sim.call("db", "count", {}, "c3")["count"] == 2

        # -- Delete by predicate (age < 30 removes bob@26) --
        dw = sim.call("db", "deleteWhere", {"where": [{"col": "age", "op": "lt", "val": 30}]}, "d2")
        assert dw["deleted"] == 1
        remaining = sim.call("db", "select", {}, "s5")
        assert remaining["count"] == 1 and remaining["rows"][0]["name"] == "carol"
