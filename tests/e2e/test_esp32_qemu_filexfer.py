# SPDX-License-Identifier: Apache-2.0
"""End-to-end proof that the generic file-transfer service works over serial in QEMU:
JSON control plane (begin/commit/stat) + binary data side-channel, writing to the FAT
`storage` partition. Requires Espressif's QEMU; run with `helix embedded esp32 qemu-test`.
"""

from __future__ import annotations

import hashlib
import time

import pytest

from embedded.esp32.commands.simulator import open_esp32, target_available

pytestmark = pytest.mark.skipif(
    not target_available(),
    reason="no ESP32 target available (set HELIX_ESP32_TARGET=qemu inside the esp-idf image, "
    "or =serial with a board on HELIX_ESP32_PORT)",
)


def _pattern(n: int) -> bytes:
    return bytes((i * 37 + 11) & 0xFF for i in range(n))


def test_file_transfer_stores_file_with_correct_sha() -> None:
    payload = _pattern(3000)
    sha = hashlib.sha256(payload).hexdigest()

    with open_esp32() as sim:
        sim.read_until("file-transfer service started")

        begin = sim.call(
            "file",
            "begin",
            {"dest": "fs:proof.bin", "size": len(payload), "sha256": sha},
            "begin-1",
        )
        session = begin["session"]
        max_chunk = begin["maxChunk"]
        assert session > 0
        assert max_chunk > 0

        offset = 0
        while offset < len(payload):
            chunk = payload[offset : offset + max_chunk]
            sim.send_chunk(session, offset, chunk)
            offset += len(chunk)
            time.sleep(0.02)  # pace sends so the RX FIFO drains (QEMU proof)

        commit = sim.call("file", "commit", {"session": session}, "commit-1")
        assert commit["ok"] is True
        assert commit["size"] == len(payload)
        assert commit["sha256"] == sha

        # Independently read the stored file back off the FAT partition.
        stat = sim.call("file", "stat", {"dest": "fs:proof.bin"}, "stat-1")
        assert stat["exists"] is True
        assert stat["size"] == len(payload)
        assert stat["sha256"] == sha


def test_commit_rejects_corrupted_transfer() -> None:
    payload = _pattern(1500)
    wrong_sha = hashlib.sha256(payload + b"x").hexdigest()

    with open_esp32() as sim:
        sim.read_until("file-transfer service started")

        begin = sim.call(
            "file",
            "begin",
            {"dest": "fs:bad.bin", "size": len(payload), "sha256": wrong_sha},
            "begin-2",
        )
        session = begin["session"]

        offset = 0
        while offset < len(payload):
            chunk = payload[offset : offset + begin["maxChunk"]]
            sim.send_chunk(session, offset, chunk)
            offset += len(chunk)
            time.sleep(0.02)

        with pytest.raises(RuntimeError, match="sha256 mismatch"):
            sim.call("file", "commit", {"session": session}, "commit-2")
