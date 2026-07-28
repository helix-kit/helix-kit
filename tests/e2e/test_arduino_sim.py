# SPDX-License-Identifier: Apache-2.0
"""End-to-end tests for the Arduino/AVR firmware under the QEMU simulator.

These boot a real compiled sketch inside qemu-system-avr and drive its emulated
USART over a socket -- the same serial path a physical board would expose --
asserting the Helix serial protocol round-trips. They are self-contained (no
appliance/server) and skip cleanly where the AVR toolchain is not installed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from embedded.arduino.commands.simulator import (
    BOARDS,
    SerialSimulator,
    compile_sketch,
    tools_available,
)

pytestmark = pytest.mark.skipif(
    not tools_available(),
    reason="requires arduino-cli and qemu-system-avr (Ubuntu: qemu-system-misc)",
)

# The Leonardo target is not QEMU-emulable; exercise the two emulable boards.
SIM_BOARDS = ["mega2560", "uno"]


@pytest.mark.parametrize("board", SIM_BOARDS)
def test_serial_echo_round_trip(board: str) -> None:
    """qemu USART <-> host round-trips both directions on every emulable board."""
    elf = compile_sketch("qemu_smoke", board)
    with SerialSimulator(elf, BOARDS[board]["machine"]) as sim:
        sim.read_until("QEMU_SMOKE ready")  # boot banner (needs wait=on)
        sim.send_line("ping-42")
        out = sim.read_until("ECHO ping-42")
    assert "ECHO ping-42" in out


@pytest.fixture(scope="module")
def helix_node_elf() -> Path:
    """Compile the real FreeRTOS + Helix-core firmware once for all node tests."""
    return compile_sketch("helix_node", "mega2560")


def _gpio_request(request_id: str, pin: int, high: bool) -> str:
    return "SERVICE " + json.dumps(
        {
            "requestId": request_id,
            "message": {
                "service": "gpio-control",
                "method": "set-gpio",
                "payload": {"pin": pin, "high": high},
            },
        }
    )


def test_helix_node_gpio_control(helix_node_elf: Path) -> None:
    """The real firmware runs the shared Helix dispatcher on FreeRTOS over serial.

    Drives gpio-control the same way a cloud command would and asserts the
    HELIX_RESPONSE produced by the ESP32-shared endpoint/dispatcher/cJSON core.
    """
    with SerialSimulator(helix_node_elf, BOARDS["mega2560"]["machine"]) as sim:
        sim.read_until("HELIX_NODE ready")
        sim.send_line(_gpio_request("gpio-e2e-1", pin=13, high=True))
        payload = sim.read_line_with_prefix("HELIX_RESPONSE ")

    reply = json.loads(payload)
    assert reply["requestId"] == "gpio-e2e-1"
    message = reply["message"]
    assert message["service"] == "gpio-control"
    assert message["method"] == "gpio-control-state"
    pins = message["payload"]["pins"]
    assert pins[0]["pin"] == 13
    assert pins[0]["level"] == 1


def test_helix_node_task_survives_multiple_requests(helix_node_elf: Path) -> None:
    """The FreeRTOS transport task keeps serving (not one-shot): three in a row."""
    with SerialSimulator(helix_node_elf, BOARDS["mega2560"]["machine"]) as sim:
        sim.read_until("HELIX_NODE ready")
        seen = []
        for i in range(3):
            sim.send_line(_gpio_request(f"seq-{i}", pin=13, high=bool(i % 2)))
            payload = sim.read_line_with_prefix("HELIX_RESPONSE ")
            seen.append(json.loads(payload)["requestId"])
        # a crash/reset would reprint the boot banner; it must appear exactly once
        assert sim.text.count("HELIX_NODE ready") == 1
    assert seen == ["seq-0", "seq-1", "seq-2"]


def test_helix_node_bad_json_reports_error(helix_node_elf: Path) -> None:
    """Malformed input yields a HELIX_ERROR line, not a crash, hang, or reset."""
    with SerialSimulator(helix_node_elf, BOARDS["mega2560"]["machine"]) as sim:
        sim.read_until("HELIX_NODE ready")
        sim.send_line("SERVICE {not valid json")
        out = sim.read_until("HELIX_ERROR")
    assert "HELIX_ERROR" in out
