# SPDX-License-Identifier: Apache-2.0
"""End-to-end proof of the durable store-and-forward event queue in QEMU (over serial).

QEMU has no broker, so events persist as `pending` and delivery is driven with the
test-only `simulate-delivery` hook. Covers persist-first, query, delivery, TTL expiry,
and retention cleanup. FlashDB is slow under QEMU, so calls use generous timeouts.
"""

from __future__ import annotations

import time

import pytest

from embedded.esp32.commands.simulator import open_esp32, target_available

pytestmark = pytest.mark.skipif(
    not target_available(),
    reason="requires ESP-IDF QEMU (qemu-system-xtensa + idf.py); run inside the esp-idf image",
)

T = 30.0  # per-call timeout; FlashDB is slow under QEMU


def test_event_queue_lifecycle() -> None:
    with open_esp32() as sim:
        sim.read_until("events service started", timeout=60)

        def ev(method, payload, rid):
            return sim.call("events", method, payload, rid, timeout=T)

        # Clean slate (flash persists across runs).
        ev("clear", {}, "e0")
        assert ev("stats", {}, "e1") == {"pending": 0, "sent": 0, "expired": 0, "total": 0}

        # -- persist-first: emit three events (default long TTL) --
        a = ev("emit", {"service": "sensor", "eventType": "temp", "payload": {"c": 21}}, "e2")
        ev("emit", {"service": "sensor", "eventType": "temp", "payload": {"c": 22}}, "e3")
        ev("emit", {"service": "door", "eventType": "opened", "payload": {}}, "e4")
        assert a["id"] > 0 and a["msgId"]
        st = ev("stats", {}, "e5")
        assert st["total"] == 3 and st["pending"] == 3 and st["sent"] == 0

        # -- query: list pending + get one detail --
        lst = ev("list", {"status": "pending"}, "e6")
        assert lst["count"] == 3
        assert {e["eventType"] for e in lst["events"]} == {"temp", "opened"}
        detail = ev("get", {"id": a["id"]}, "e7")
        assert detail["status"] == "pending"
        assert a["msgId"] in detail["envelope"]  # stored envelope carries the dedupe msgId

        # -- delivery: simulate a broker ack for `a`, then sweep to process it --
        ev("simulate-delivery", {"id": a["id"]}, "e8")
        ev("sweep", {}, "e9")
        st = ev("stats", {}, "e10")
        assert st["sent"] == 1 and st["pending"] == 2

        # -- expiry: a short-TTL event stops being retried after its deadline --
        ev("emit", {"service": "sensor", "eventType": "blip", "ttlSec": 1, "payload": {}}, "e11")
        assert ev("stats", {}, "e12")["pending"] == 3
        time.sleep(1.5)
        sw = ev("sweep", {}, "e13")  # sweep return value is authoritative for this pass
        assert sw["expired"] >= 1
        st = ev("stats", {}, "e14")
        assert st["pending"] == 2  # blip left the pending set

        # -- cleanup: delivered/expired events removed after retention (15s in QEMU) --
        time.sleep(16)
        sw = ev("sweep", {}, "e15")
        assert sw["cleaned"] >= 1
        st = ev("stats", {}, "e16")
        assert st["sent"] == 0 and st["expired"] == 0  # terminal events aged out
        assert st["pending"] == 2  # the two default-TTL events remain
