"""Reassemble a device's LVGL screen from the rectangles it streams to the host.

The device flushes each dirty rectangle onto the binary side-channel as one
logical stream: `session` is the frame id, `offset` the byte position within that
frame, and the bytes are an 8-byte bounds header followed by RGB565 pixels (see
ui/include/helix_ui_display_stream.h). Chunks can be dropped -- a log line
spliced into a frame fails its CRC and never arrives -- so a frame is applied
only once every byte of it is present.

Click-free so both `helix ui` and the pytest e2e suite can drive it.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

RECT_HEADER_BYTES = 8


@dataclass
class _PendingFrame:
    x1: int
    y1: int
    x2: int
    y2: int
    total: int
    chunks: dict[int, bytes] = field(default_factory=dict)

    @property
    def received(self) -> int:
        return sum(len(chunk) for chunk in self.chunks.values())

    def payload(self) -> bytes | None:
        """The pixel bytes, or None while chunks are still missing or overlapping."""
        buffer = bytearray(self.total)
        seen = bytearray(self.total)
        for offset, chunk in self.chunks.items():
            end = offset + len(chunk)
            if end > self.total:
                return None
            buffer[offset:end] = chunk
            for index in range(offset, end):
                seen[index] = 1
        if not all(seen):
            return None
        return bytes(buffer[RECT_HEADER_BYTES:])


class Framebuffer:
    """An RGB888 mirror of the device's screen, fed by streamed rectangles."""

    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.pixels = bytearray(width * height * 3)
        self.frames_applied = 0
        self.frames_dropped = 0
        self._pending: dict[int, _PendingFrame] = {}

    def ingest(self, session: int, offset: int, data: bytes) -> bool:
        """Feed one side-channel chunk. True when it completed a rectangle."""
        if offset == 0:
            if len(data) < RECT_HEADER_BYTES:
                return False
            x1, y1, x2, y2 = struct.unpack_from("<HHHH", data, 0)
            if x2 < x1 or y2 < y1 or x2 >= self.width or y2 >= self.height:
                return False
            total = RECT_HEADER_BYTES + (x2 - x1 + 1) * (y2 - y1 + 1) * 2
            self._pending[session] = _PendingFrame(x1, y1, x2, y2, total)

        frame = self._pending.get(session)
        if frame is None:
            # A chunk whose header was lost; the rectangle it belonged to is gone.
            self.frames_dropped += 1
            return False

        frame.chunks[offset] = data
        if frame.received < frame.total:
            return False

        payload = frame.payload()
        del self._pending[session]
        if payload is None:
            self.frames_dropped += 1
            return False

        self._blit(frame, payload)
        self.frames_applied += 1
        return True

    def _blit(self, frame: _PendingFrame, payload: bytes) -> None:
        width = frame.x2 - frame.x1 + 1
        for row in range(frame.y2 - frame.y1 + 1):
            source = row * width * 2
            target = ((frame.y1 + row) * self.width + frame.x1) * 3
            for column in range(width):
                value = payload[source + column * 2] | (payload[source + column * 2 + 1] << 8)
                # RGB565 -> RGB888, replicating the high bits into the low ones so
                # white stays white instead of drifting to 0xF8.
                red = (value >> 11) & 0x1F
                green = (value >> 5) & 0x3F
                blue = value & 0x1F
                index = target + column * 3
                self.pixels[index] = (red << 3) | (red >> 2)
                self.pixels[index + 1] = (green << 2) | (green >> 4)
                self.pixels[index + 2] = (blue << 3) | (blue >> 2)

    def to_png(self) -> bytes:
        """Encode the mirror as a PNG (stdlib only -- no Pillow in the toolchain)."""
        raw = bytearray()
        stride = self.width * 3
        for row in range(self.height):
            raw.append(0)  # filter type: none
            raw += self.pixels[row * stride : (row + 1) * stride]

        def chunk(tag: bytes, payload: bytes) -> bytes:
            body = tag + payload
            return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

        header = struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
            + chunk(b"IEND", b"")
        )

    def is_blank(self) -> bool:
        return not any(self.pixels)
