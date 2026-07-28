#!/usr/bin/env python3
"""Fullscreen WebKitGTK kiosk that switches between screens on keypress."""

from __future__ import annotations

import argparse

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
try:
    gi.require_version("WebKit2", "4.1")
except ValueError:
    gi.require_version("WebKit2", "4.0")

from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

DEFAULT_URLS = [
    "http://127.0.0.1:8080/#/home",
    "http://127.0.0.1:8080/#/metrics",
    "http://127.0.0.1:8080/#/info",
]


# PyGObject ships no type info: Gtk.Window is Any, so subclassing it cannot be checked.
class KioskShell(Gtk.Window):  # type: ignore[misc]
    def __init__(self, urls: list[str], fullscreen: bool) -> None:
        super().__init__(title="Helix Kiosk")
        self.set_default_size(1280, 720)
        self.urls = urls
        self.index = 0
        self.connect("destroy", Gtk.main_quit)
        self.connect("key-press-event", self._on_key_press)

        self.webview = WebKit2.WebView()
        # The kiosk may come up before the site server is ready; keep retrying instead of parking on an error page.
        self.webview.connect("load-failed", self._on_load_failed)
        self.add(self.webview)
        self.show_all()
        self._load(0)
        if fullscreen:
            # On a bare kiosk X session (no WM) fullscreen() has nothing to honor it, so also size to the monitor.
            self.fullscreen()
            self._fill_monitor()

    def _fill_monitor(self) -> None:
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        if monitor is None:
            return
        geo = monitor.get_geometry()
        self.set_decorated(False)
        self.move(geo.x, geo.y)
        self.resize(geo.width, geo.height)

    def _load(self, index: int) -> None:
        self.index = index % len(self.urls)
        self.webview.load_uri(self.urls[self.index])

    def _on_load_failed(
        self, _webview: WebKit2.WebView, _event: object, _uri: str, _error: object
    ) -> bool:
        GLib.timeout_add(1500, self._retry)
        return True

    def _retry(self) -> bool:
        self.webview.load_uri(self.urls[self.index])
        return False

    def _on_key_press(self, _widget: Gtk.Widget, event: Gdk.EventKey) -> bool:
        # With a single URL the switching keys would swallow the user's typing, so pass everything through.
        if len(self.urls) <= 1:
            return False
        key = Gdk.keyval_name(event.keyval)
        if key and key.isdigit() and key != "0":
            wanted = int(key) - 1
            if 0 <= wanted < len(self.urls):
                self._load(wanted)
            return True
        if key in {"n", "N", "Right", "space"}:
            self._load(self.index + 1)
            return True
        if key in {"p", "P", "Left"}:
            self._load(self.index - 1)
            return True
        if key == "F5":
            self.webview.reload()
            return True
        if key in {"q", "Q", "Escape", "F12"}:
            self.close()
            return True
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        dest="urls",
        action="append",
        help="URL to add to the switch list (repeatable). Defaults to the local React site.",
    )
    parser.add_argument("--windowed", action="store_true")
    args = parser.parse_args()

    urls = args.urls if args.urls else DEFAULT_URLS
    KioskShell(urls, fullscreen=not args.windowed)
    Gtk.main()


if __name__ == "__main__":
    main()
