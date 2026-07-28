"""A native window showing the device's screen, with clicks fed back to it.

Tk is in the standard library, so the viewer adds no dependency, and Tk 8.6 reads
PNG directly -- which the framebuffer can already produce. Every refresh re-encodes
the mirror and swaps the image; at a few frames a second that is far cheaper than
being clever.
"""

from __future__ import annotations

import base64
import tkinter as tk

from .session import UiSession

_POLL_MS = 30


def run_window(session: UiSession, scale: int = 2) -> None:
    frame = session.frame
    assert frame is not None

    root = tk.Tk()
    root.title("Helix UI — ESP32 (QEMU)")
    root.resizable(False, False)

    canvas = tk.Canvas(
        root,
        width=frame.width * scale,
        height=frame.height * scale,
        highlightthickness=0,
        background="#101418",
    )
    canvas.pack()

    status = tk.Label(root, text="waiting for frames…", anchor="w")
    status.pack(fill="x")

    image = tk.PhotoImage(data=base64.b64encode(frame.to_png()))
    handle = canvas.create_image(0, 0, anchor="nw", image=image.zoom(scale))
    current = [image]

    def redraw() -> None:
        photo = tk.PhotoImage(data=base64.b64encode(frame.to_png())).zoom(scale)
        canvas.itemconfigure(handle, image=photo)
        current[0] = photo  # Tk keeps no reference of its own; drop it and it blanks
        status.configure(
            text=f"{frame.width}x{frame.height} · {frame.frames_applied} rectangles"
            + (f" · {frame.frames_dropped} dropped" if frame.frames_dropped else "")
        )

    def poll() -> None:
        if session.pump():
            redraw()
        root.after(_POLL_MS, poll)

    def to_device(event: tk.Event[tk.Canvas]) -> tuple[int, int]:
        x = min(max(event.x // scale, 0), frame.width - 1)
        y = min(max(event.y // scale, 0), frame.height - 1)
        return x, y

    def on_press(event: tk.Event[tk.Canvas]) -> None:
        x, y = to_device(event)
        session.pointer(x, y, pressed=True)

    def on_release(event: tk.Event[tk.Canvas]) -> None:
        x, y = to_device(event)
        session.pointer(x, y, pressed=False)

    canvas.bind("<ButtonPress-1>", on_press)
    canvas.bind("<ButtonRelease-1>", on_release)

    redraw()
    root.after(_POLL_MS, poll)
    root.mainloop()
