"""End-to-end proof that a shared LVGL screen renders on an emulated ESP32 and is
driveable from the host: pixels stream out over the binary side-channel, pointer
events go back in over the `ui` service. Build the firmware first with `helix ui build`.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

from embedded.esp32.commands.config import esp32_root
from tooling.ui.session import UI_BUILD_DIR, UiSession

_FIRMWARE = esp32_root() / UI_BUILD_DIR / "esp32_firmware.bin"

pytestmark = pytest.mark.skipif(
    not shutil.which("docker") or not _FIRMWARE.exists(),
    reason=f"needs docker and a UI firmware build ({_FIRMWARE}); run `helix ui build`",
)


def _band(session: UiSession, top: int, bottom: int) -> bytes:
    """The pixels of a horizontal strip of the screen."""
    assert session.frame is not None
    stride = session.frame.width * 3
    return bytes(session.frame.pixels[top * stride : bottom * stride])


@pytest.fixture(scope="module")
def ui() -> Iterator[UiSession]:
    with UiSession() as session:
        session.settle()
        yield session


def test_screen_streams_to_the_host(ui: UiSession) -> None:
    assert ui.frame is not None
    assert (ui.frame.width, ui.frame.height) == (240, 240)
    # Six 40-line slices cover a 240px-tall screen; a lost one means broken framing/CRC.
    assert ui.frame.frames_applied >= 6
    assert ui.frame.frames_dropped == 0
    assert not ui.frame.is_blank()


def test_tapping_the_button_redraws_the_counter(ui: UiSession, tmp_path: Path) -> None:
    assert ui.frame is not None
    title_before = _band(ui, 24, 80)  # "Hello, Helix" -- static
    counter_before = _band(ui, 156, 184)  # "Taps: N" -- must change

    ui.tap(ui.frame.width // 2, ui.frame.height // 2)
    assert ui.settle() > 0, "tapping the button flushed nothing"

    assert _band(ui, 156, 184) != counter_before, "the tap counter never redrew"
    assert _band(ui, 24, 80) == title_before, "an untouched region was redrawn"
    assert ui.frame.frames_dropped == 0

    ui.screenshot(tmp_path / "tapped.png")


def test_pointer_outside_the_screen_is_rejected(ui: UiSession) -> None:
    assert ui.frame is not None
    with pytest.raises(RuntimeError, match="outside the screen"):
        ui.pointer(ui.frame.width, 0, pressed=True)
