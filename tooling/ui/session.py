"""Drive the LVGL `ui_demo` firmware running under QEMU, from the host."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from types import TracebackType
from typing import Any, Self

from embedded.esp32.commands.apps import app_features, write_app_selection
from embedded.esp32.commands.config import (
    DEFAULT_ESP_IDF_IMAGE,
    esp32_root,
)
from embedded.esp32.commands.simulator import Esp32TcpLink, free_port
from tooling.common import REPO_ROOT

from .framebuffer import Framebuffer

UI_BUILD_DIR = ".build/qemu-ui"
UI_APP = "ui_demo"


class UiSession:
    """A booted `ui_demo` device: framebuffer in, pointer events out."""

    def __init__(
        self,
        port: int | None = None,
        image: str = DEFAULT_ESP_IDF_IMAGE,
        build_dir: str = UI_BUILD_DIR,
    ) -> None:
        self._port = port or free_port()
        self._image = image
        self._build_dir = build_dir
        self._container = f"helix-ui-qemu-{self._port}"
        self._proc: subprocess.Popen[bytes] | None = None
        self._link = Esp32TcpLink(self._port)
        self._request_id = 0
        self.frame: Framebuffer | None = None

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def start(self) -> None:
        # App selection is a generated shared component; pin it before idf.py qemu reconfigures.
        write_app_selection([UI_APP])

        serial = f"-serial tcp:0.0.0.0:{self._port},server=on,wait=on"
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            self._container,
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "-e",
            "HOME=/tmp",
            # idf.py qemu reconfigures the build dir before boot, so the feature set must be here too.
            "-e",
            f"HELIX_FEATURES={';'.join(app_features([UI_APP]))}",
            "-p",
            f"127.0.0.1:{self._port}:{self._port}",
            "-v",
            f"{REPO_ROOT}:/repo",
            "-v",
            f"{esp32_root()}:/project",
            "-w",
            "/project",
            self._image,
            "idf.py",
            "-B",
            self._build_dir,
            "qemu",
            f"--qemu-extra-args={serial}",
        ]
        self._proc = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # A failure here escapes before `with` can close the session, so clean up the container.
        try:
            self._attach()
            info = self.info()
            self.frame = Framebuffer(int(info["width"]), int(info["height"]))
            self.refresh()
        except BaseException:
            self.close()
            raise

    def _attach(self, timeout: float = 240.0, boot_timeout: float = 15.0) -> None:
        # Docker publishes the port before QEMU listens, so retry until boot bytes arrive.
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._proc is not None and self._proc.poll() is not None:
                raise RuntimeError("the QEMU container exited before the UART came up")

            link = Esp32TcpLink(self._port, connect_timeout=5.0)
            try:
                link.open()
            except RuntimeError:
                time.sleep(1.0)
                continue

            boot_deadline = time.time() + boot_timeout
            while time.time() < boot_deadline:
                link.pump()
                if link.text:
                    self._link = link
                    return
                time.sleep(0.1)

            link.close()
            time.sleep(1.0)

        raise TimeoutError(f"no boot output from the emulated UART within {timeout}s")

    def close(self) -> None:
        self._link.close()
        subprocess.run(
            ["docker", "kill", self._container],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if self._proc is not None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def _call(self, method: str, payload: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
        self._request_id += 1
        return self._link.call("ui", method, payload, f"ui-{self._request_id}", timeout=timeout)

    def info(self, timeout: float = 180.0) -> dict[str, Any]:
        """Wait for the device's UI to come up and report its geometry."""
        deadline = time.time() + timeout
        last: Exception | None = None
        while time.time() < deadline:
            # Separate handlers, not a tuple: the ESP-IDF image's py3.12 rejects py314's `except (A, B):` (PEP 758).
            try:
                info = self._call("info", {}, timeout=5.0)
            except TimeoutError as exc:  # still booting
                last = exc
                time.sleep(0.5)
                continue
            except RuntimeError as exc:  # booted, `ui` service not registered yet
                last = exc
                time.sleep(0.5)
                continue
            if info.get("ready"):
                return info
            time.sleep(0.5)
        raise TimeoutError(f"ui service never became ready within {timeout}s (last: {last})")

    def refresh(self) -> None:
        """Force a full redraw -- the host starts with no pixels at all."""
        self._call("refresh", {})

    def pointer(self, x: int, y: int, pressed: bool) -> None:
        self._call("pointer", {"x": x, "y": y, "pressed": pressed})

    def tap(self, x: int, y: int, hold: float = 0.08) -> None:
        self.pointer(x, y, pressed=True)
        time.sleep(hold)
        self.pointer(x, y, pressed=False)

    def pump(self) -> int:
        """Apply everything the device has streamed; returns rectangles applied."""
        assert self.frame is not None
        applied = 0
        for session, offset, data in self._link.poll_frames():
            if self.frame.ingest(session, offset, data):
                applied += 1
        return applied

    def settle(self, timeout: float = 60.0, quiet: float = 0.6) -> int:
        """Pump until the device stops sending for `quiet` seconds."""
        deadline = time.time() + timeout
        last_activity = time.time()
        total = 0
        while time.time() < deadline:
            applied = self.pump()
            total += applied
            if applied:
                last_activity = time.time()
            elif time.time() - last_activity >= quiet:
                break
            time.sleep(0.02)
        return total

    def screenshot(self, path: Path) -> Path:
        assert self.frame is not None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.frame.to_png())
        return path
