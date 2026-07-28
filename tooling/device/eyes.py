"""Give a coding agent "eyes": drive a spare rooted Android phone over adb to
wake, unlock (PIN), snap a photo with the default camera, and pull it back to a
directory the agent can read.

This is an experimental bring-up aid, not a shipped Helix feature: point the
phone at a monitor and the agent gets an on-demand still image of whatever the
display pipeline is doing.

Multiple phones can be registered (``helix device eyes add``); with no
``--device`` selector the agent auto-picks any available one, preferring an
already-attached USB device over waking a wireless one. Config (device serials +
PINs) lives in a user-level, gitignored file so no secret lands in the repo.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import click

CONFIG_PATH = Path(os.environ.get("HELIX_EYES_CONFIG", "~/.config/helix/eyes.json")).expanduser()

# Android keycodes we drive.
KEYCODE_WAKEUP = 224
KEYCODE_SLEEP = 223
KEYCODE_ENTER = 66
KEYCODE_CAMERA = 27
KEYCODE_DPAD_CENTER = 23

DEFAULT_CAMERA_DIRS = (
    "/sdcard/DCIM/Camera",
    "/sdcard/DCIM",
)


# --------------------------------------------------------------------------- #
# config
#
# Shape:
#   {"devices": [{"name": str, "serial": str, "pin": str?}, ...],
#    "out_dir": str?}
# A serial is either a USB serial (e.g. RZCX21PYBNL) or a wireless host:port.
# --------------------------------------------------------------------------- #
def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {"devices": []}
    try:
        cfg: dict[str, Any] = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"corrupt config at {CONFIG_PATH}: {exc}") from exc
    # Migrate the earlier single-device shape into the devices list.
    if "device" in cfg and "devices" not in cfg:
        entry: dict[str, Any] = {"serial": cfg.pop("device")}
        if cfg.get("pin"):
            entry["pin"] = cfg.pop("pin")
        cfg["devices"] = [entry]
    cfg.pop("pin", None)
    cfg.setdefault("devices", [])
    return cfg


def _save_config(cfg: dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    CONFIG_PATH.chmod(0o600)


def _find_entry(devices: list[dict[str, Any]], selector: str) -> dict[str, Any] | None:
    for entry in devices:
        if selector in (entry.get("name"), entry.get("serial")):
            return entry
    return None


def _upsert_device(
    cfg: dict[str, Any], serial: str, name: str | None, pin: str | None
) -> dict[str, Any]:
    entry = _find_entry(cfg["devices"], serial) or (
        _find_entry(cfg["devices"], name) if name else None
    )
    if entry is None:
        entry = {"serial": serial}
        cfg["devices"].append(entry)
    entry["serial"] = serial
    if name:
        entry["name"] = name
    if pin:
        entry["pin"] = pin
    return entry


# --------------------------------------------------------------------------- #
# adb plumbing
# --------------------------------------------------------------------------- #
def _adb(
    serial: str | None,
    *args: str,
    check: bool = True,
    timeout: int = 30,
    soft_timeout: bool = False,
) -> str:
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise click.ClickException(
            "adb not found on PATH (install Android platform-tools)"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        if soft_timeout:
            return ""
        raise click.ClickException(f"adb timed out: {' '.join(cmd)}") from exc
    if check and proc.returncode != 0:
        raise click.ClickException(
            f"adb failed ({' '.join(args)}): {proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


def _shell(serial: str | None, command: str, **kw: Any) -> str:
    return _adb(serial, "shell", command, **kw)


def _list_devices() -> list[str]:
    out = _adb(None, "devices")
    devices = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def _connect_wireless(serial: str, connect_retries: int = 6) -> bool:
    """Bring a host:port target online, absorbing Wi-Fi power-save wake latency.

    A sleeping phone drops its Wi-Fi into power-save, so the first adb connect
    after idle often lands while the radio is still waking. Retry a few times
    before giving up. Returns True if the device came online.
    """
    click.echo(f"connecting to {serial} over adb tcpip ...", err=True)
    for attempt in range(1, connect_retries + 1):
        # adb keeps offline entries around; drop them so a retry is clean.
        _adb(None, "disconnect", serial, check=False, timeout=10, soft_timeout=True)
        out = _adb(None, "connect", serial, check=False, timeout=10, soft_timeout=True)
        if ("connected" in out or "already" in out) and serial in _list_devices():
            return True
        if attempt < connect_retries:
            click.echo(f"  waking {serial} (attempt {attempt}) ...", err=True)
            time.sleep(2.0)
    return False


def _resolve_target(device: str | None, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the device entry to act on, ensuring it is online.

    With no selector, pick any available configured device: an already-online
    one (USB) first for zero latency, otherwise connect a wireless one. A
    selector matches a configured name/serial, or is treated as an ad-hoc
    serial/host:port not yet in the config. Pass ``cfg`` to have the returned
    entry be a live member of that config (so coordinate caching persists).
    """
    if cfg is None:
        cfg = _load_config()
    devices: list[dict[str, Any]] = cfg["devices"]
    online = _list_devices()

    if device:
        entry = _find_entry(devices, device) or {"serial": device}
        serial = entry["serial"]
        if serial in online:
            return entry
        if ":" in serial and _connect_wireless(serial):
            return entry
        raise click.ClickException(f"device {device!r} is not reachable")

    # Prefer a configured device that is already attached (USB / live wireless).
    for entry in devices:
        if entry["serial"] in online:
            return entry
    # Otherwise wake a configured wireless device.
    for entry in devices:
        if ":" in entry["serial"] and _connect_wireless(entry["serial"]):
            return entry
    # Fall back to a lone unconfigured device that happens to be attached.
    unconfigured = [s for s in online if not _find_entry(devices, s)]
    if not devices and len(online) == 1:
        return {"serial": online[0]}
    if unconfigured and len(online) == 1:
        return {"serial": online[0]}

    if not devices and not online:
        raise click.ClickException(
            "no devices configured or attached. Run 'helix device eyes add ...'"
        )
    names = ", ".join(e.get("name") or e["serial"] for e in devices) or "(none)"
    raise click.ClickException(
        f"no configured device is reachable (configured: {names}; online: {online or 'none'})"
    )


def _pin_for(entry: dict[str, Any], explicit: str | None) -> str | None:
    return explicit or os.environ.get("HELIX_EYES_PIN") or entry.get("pin")


# --------------------------------------------------------------------------- #
# device actions
# --------------------------------------------------------------------------- #
def _screen_size(serial: str) -> tuple[int, int]:
    out = _shell(serial, "wm size")
    # e.g. "Physical size: 1080x2400" (may also carry an Override size line).
    line = out.strip().splitlines()[-1]
    dims = line.split(":")[-1].strip()
    w, h = dims.split("x")
    return int(w), int(h)


def _is_locked(serial: str) -> bool | None:
    """Best-effort keyguard check; None if it can't be determined."""
    out = _shell(serial, "dumpsys window", check=False)
    for token in ("mDreamingLockscreen=true", "mShowingDream=true", "isStatusBarKeyguard=true"):
        if token in out:
            return True
    if "mDreamingLockscreen=false" in out:
        return False
    return None


def _wake(serial: str) -> None:
    _shell(serial, f"input keyevent {KEYCODE_WAKEUP}")


def _sleep(serial: str) -> None:
    _shell(serial, f"input keyevent {KEYCODE_SLEEP}")


def _unlock(serial: str, pin: str | None) -> None:
    _wake(serial)
    time.sleep(0.6)
    w, h = _screen_size(serial)
    # Swipe up from the lower third to the upper third to dismiss the keyguard.
    _shell(serial, f"input swipe {w // 2} {int(h * 0.8)} {w // 2} {int(h * 0.25)} 250")
    time.sleep(0.6)
    if pin:
        _shell(serial, f"input text {pin}")
        time.sleep(0.3)
        _shell(serial, f"input keyevent {KEYCODE_ENTER}")
        time.sleep(1.0)


def _ensure_unlocked(serial: str, pin: str | None) -> None:
    """Wake the screen, and run the full unlock only if the keyguard is up.

    Skipping the swipe+PIN sequence when already unlocked saves ~2.5s per snap.
    """
    _wake(serial)
    if _is_locked(serial) is not False:
        _unlock(serial, pin)


def _newest_media(serial: str, globs: str) -> tuple[str, str] | None:
    """(path, mtime-token) of the newest camera file matching globs, or None."""
    for d in DEFAULT_CAMERA_DIRS:
        pattern = " ".join(f"{d}/{g}" for g in globs.split())
        out = _shell(serial, f"ls -t {pattern} 2>/dev/null | head -1", check=False)
        path = out.strip()
        if path:
            stat = _shell(serial, f"stat -c %Y '{path}'", check=False).strip()
            return path, stat
    return None


def _newest_photo(serial: str) -> tuple[str, str] | None:
    return _newest_media(serial, "*.jpg *.jpeg")


def _newest_video(serial: str) -> tuple[str, str] | None:
    return _newest_media(serial, "*.mp4 *.3gp *.mkv")


# The stock camera opens on whichever lens was last used and ignores the
# camera-facing intent extras, so we drive its on-screen controls instead:
# read the accessibility tree, tap the switch-camera button by its content-desc,
# then tap the shutter. This is resolution-independent and works over the secure
# camera surface (the buttons are real views, only the preview is a surface).
CAMERA_COMPONENT = "com.sec.android.app.camera/.Camera"  # Samsung stock camera
STILL_IMAGE_ACTION = "android.media.action.STILL_IMAGE_CAMERA"
UI_DUMP_PATH = "/sdcard/helix_eyes_ui.xml"


def _dump_ui(serial: str) -> str:
    _shell(serial, f"uiautomator dump {UI_DUMP_PATH} 2>/dev/null", check=False)
    return _shell(serial, f"cat {UI_DUMP_PATH} 2>/dev/null", check=False)


def _find_button(xml: str, needles: tuple[str, ...]) -> tuple[int, int] | None:
    """Center (x, y) of the first node whose content-desc/text contains a needle."""
    for tag in re.findall(r"<node\b[^>]*>", xml):
        attrs = " ".join(
            m.group(1).lower() for m in re.finditer(r'(?:content-desc|text)="([^"]*)"', tag)
        )
        if any(n in attrs for n in needles):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
            if b:
                x1, y1, x2, y2 = (int(g) for g in b.groups())
                return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def _open_camera(serial: str, settle: float) -> None:
    """Open the stock camera, skipping the intent chooser a work profile adds."""
    out = _shell(serial, f"am start -n {CAMERA_COMPONENT}", check=False)
    if "Error" in out or "Exception" in out:
        _shell(serial, f"am start -a {STILL_IMAGE_ACTION}", check=False)
    time.sleep(settle)


def _tap(serial: str, xy: list[int]) -> None:
    _shell(serial, f"input tap {xy[0]} {xy[1]}")


def _detect_camera_ui(
    serial: str,
) -> tuple[tuple[int, int] | None, tuple[int, int] | None, str | None]:
    """One uiautomator dump -> (shutter, switch, current-facing).

    The switch button's content-desc names the lens it switches TO, so
    'Switch to rear camera' being present means the front lens is active.
    """
    xml = _dump_ui(serial)
    shutter = _find_button(xml, ("take picture", "shutter", "capture"))
    switch = _find_button(xml, ("switch to rear camera", "switch to back camera"))
    facing: str | None = "front" if switch else None
    if switch is None:
        switch = _find_button(xml, ("switch to front camera",))
        facing = "back" if switch else None
    return shutter, switch, facing


def _prepare_camera(
    cfg: dict[str, Any], entry: dict[str, Any], serial: str, facing: str, redetect: bool
) -> list[int] | None:
    """Make the requested lens active; return cached shutter coords (or None).

    Coordinates and the last-known facing are cached per device, so the common
    case (same phone, same lens) needs no uiautomator dump at all — the dumps
    are what made a capture take ~25s, as they stall waiting for the live camera
    preview to go idle.
    """
    ui: dict[str, Any] = entry.get("ui") or {}
    changed = False
    if redetect or "shutter" not in ui or "switch" not in ui or entry.get("facing") is None:
        shutter, switch, detected = _detect_camera_ui(serial)
        ui = entry.setdefault("ui", {})
        if shutter:
            ui["shutter"] = list(shutter)
        ui["switch"] = list(switch) if switch else None
        if detected:
            entry["facing"] = detected
        changed = True

    if ui.get("switch") and entry.get("facing") != facing:
        _tap(serial, ui["switch"])
        entry["facing"] = facing
        changed = True
        time.sleep(1.2)

    if changed:
        _save_config(cfg)
    return ui.get("shutter")


def _tap_or_key(serial: str, needles: tuple[str, ...]) -> bool:
    """Tap a button found by content-desc; fall back to the hardware camera key."""
    tap = _find_button(_dump_ui(serial), needles)
    if tap:
        _shell(serial, f"input tap {tap[0]} {tap[1]}")
        return True
    _shell(serial, f"input keyevent {KEYCODE_CAMERA}")
    return False


def _wait_for_new(
    serial: str,
    before_path: str | None,
    newest: Callable[[str], tuple[str, str] | None],
    timeout: float,
) -> str | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.7)
        now = newest(serial)
        if now and now[0] != before_path:
            return now[0]
    return None


def _capture(
    cfg: dict[str, Any],
    entry: dict[str, Any],
    settle: float,
    timeout: float,
    facing: str,
    redetect: bool,
) -> str:
    serial = entry["serial"]
    before = _newest_photo(serial)
    before_path = before[0] if before else None
    _open_camera(serial, settle)
    shutter = _prepare_camera(cfg, entry, serial, facing, redetect)
    if shutter:
        _tap(serial, shutter)
    else:
        _shell(serial, f"input keyevent {KEYCODE_CAMERA}")
    path = _wait_for_new(serial, before_path, _newest_photo, timeout)
    if path:
        return path
    raise click.ClickException(
        "no new photo appeared after the shutter. Open the camera manually once "
        "to grant permissions, or pass --redetect if the camera layout changed."
    )


def _ensure_video_mode(serial: str) -> None:
    """Switch the stock camera into video mode if it is not already."""
    xml = _dump_ui(serial)
    if _find_button(xml, ("record video", "start recording")):
        return
    tap = _find_button(xml, ("video",))
    if tap:
        _shell(serial, f"input tap {tap[0]} {tap[1]}")
        time.sleep(1.5)


def _record(
    cfg: dict[str, Any],
    entry: dict[str, Any],
    duration: float,
    settle: float,
    facing: str,
    redetect: bool,
) -> str:
    """Record a camera video of ~duration seconds and return its remote path.

    Drives the stock camera UI: pick the lens, switch to video mode, tap record,
    wait the duration, tap stop, then wait for the file size to settle.
    """
    serial = entry["serial"]
    before = _newest_video(serial)
    before_path = before[0] if before else None
    _open_camera(serial, settle)
    _prepare_camera(cfg, entry, serial, facing, redetect)
    _ensure_video_mode(serial)
    time.sleep(0.8)

    _tap_or_key(serial, ("record video", "start recording", "record"))
    started = _wait_for_new(serial, before_path, _newest_video, 5.0)
    if started is None:
        raise click.ClickException(
            "recording did not start. Open the camera in video mode once to grant " "permissions."
        )

    time.sleep(duration)
    if not _tap_or_key(serial, ("stop recording", "stop")):
        pass  # keyevent fallback already sent

    # Wait for the container to finalize: size stable across two reads.
    last = -1
    for _ in range(20):
        time.sleep(0.7)
        size_out = _shell(serial, f"stat -c %s '{started}'", check=False).strip()
        size = int(size_out) if size_out.isdigit() else -1
        if size > 0 and size == last:
            break
        last = size
    return started


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
@click.group()
def eyes() -> None:
    """Drive a spare rooted Android phone as an on-demand camera for the agent."""


@eyes.command()
@click.option("--serial", "--device", "serial", required=True, help="adb serial or host:port.")
@click.option("--name", help="Friendly name to select this device by.")
@click.option("--pin", help="Lock-screen PIN for this device.")
def add(serial: str, name: str | None, pin: str | None) -> None:
    """Add or update a device in the config (chmod 600, gitignored)."""
    cfg = _load_config()
    _upsert_device(cfg, serial, name, pin)
    _save_config(cfg)
    _print_devices(cfg)


@eyes.command()
@click.argument("selector")
def remove(selector: str) -> None:
    """Remove a configured device by name or serial."""
    cfg = _load_config()
    entry = _find_entry(cfg["devices"], selector)
    if entry is None:
        raise click.ClickException(f"no configured device matches {selector!r}")
    cfg["devices"].remove(entry)
    _save_config(cfg)
    _print_devices(cfg)


@eyes.command(name="config")
@click.option("--out-dir", type=click.Path(), required=True, help="Default photo output dir.")
def set_config(out_dir: str) -> None:
    """Set global options (default output directory)."""
    cfg = _load_config()
    cfg["out_dir"] = str(Path(out_dir).expanduser())
    _save_config(cfg)
    _print_devices(cfg)


@eyes.command(name="devices")
def list_devices_cmd() -> None:
    """List configured devices and whether each is currently attached."""
    _print_devices(_load_config())


def _print_devices(cfg: dict[str, Any]) -> None:
    online = _list_devices()
    click.echo(f"config: {CONFIG_PATH}")
    if cfg.get("out_dir"):
        click.echo(f"out_dir: {cfg['out_dir']}")
    if not cfg["devices"]:
        click.echo("(no devices configured)")
        return
    for entry in cfg["devices"]:
        serial = entry["serial"]
        mark = "online" if serial in online else "offline"
        label = entry.get("name") or "-"
        pin = "pin" if entry.get("pin") else "no-pin"
        click.echo(f"  [{mark:7}] {label:12} {serial}  ({pin})")


@eyes.command()
@click.option("--device", help="Select a configured device by name/serial.")
def status(device: str | None) -> None:
    """Show the resolved device and whether the screen is locked."""
    entry = _resolve_target(device)
    serial = entry["serial"]
    locked = _is_locked(serial)
    state = {True: "locked", False: "unlocked", None: "unknown"}[locked]
    click.echo(f"device: {entry.get('name') or serial} ({serial})\nscreen: {state}")


@eyes.command()
@click.option("--device", help="Select a configured device by name/serial.")
@click.option("--pin", help="Lock-screen PIN (overrides config/env).")
def unlock(device: str | None, pin: str | None) -> None:
    """Wake and unlock the phone."""
    entry = _resolve_target(device)
    _unlock(entry["serial"], _pin_for(entry, pin))
    locked = _is_locked(entry["serial"])
    click.echo("unlocked" if locked is False else "unlock sent (state unconfirmed)")


@eyes.command(name="sleep")
@click.option("--device", help="Select a configured device by name/serial.")
def sleep_cmd(device: str | None) -> None:
    """Put the phone's screen back to sleep."""
    _sleep(_resolve_target(device)["serial"])
    click.echo("asleep")


@eyes.command()
@click.option("--device", help="Select a configured device by name/serial.")
@click.option("--pin", help="Lock-screen PIN (overrides config/env).")
@click.option("--out", "out_dir", type=click.Path(), help="Directory to save the photo into.")
@click.option("--name", help="Base filename (without extension).")
@click.option("--settle", default=2.5, help="Seconds to let the camera focus before shutter.")
@click.option("--timeout", default=9.0, help="Seconds to wait for the captured file.")
@click.option(
    "--camera",
    type=click.Choice(["back", "front"]),
    default="back",
    help="Which lens to use (default back — the one facing the monitor).",
)
@click.option("--redetect", is_flag=True, help="Re-scan the camera UI (use if the layout changed).")
@click.option("--no-unlock", is_flag=True, help="Assume already awake/unlocked.")
@click.option("--stay-awake", is_flag=True, help="Do not re-sleep the phone afterwards.")
def snap(
    device: str | None,
    pin: str | None,
    out_dir: str | None,
    name: str | None,
    settle: float,
    timeout: float,
    camera: str,
    redetect: bool,
    no_unlock: bool,
    stay_awake: bool,
) -> None:
    """Wake, unlock, take a photo, and pull it here. Prints the saved path."""
    cfg = _load_config()
    entry = _resolve_target(device, cfg)
    serial = entry["serial"]
    click.echo(f"using {entry.get('name') or serial}", err=True)

    if not no_unlock:
        _ensure_unlocked(serial, _pin_for(entry, pin))

    remote = _capture(cfg, entry, settle=settle, timeout=timeout, facing=camera, redetect=redetect)

    dest_dir = Path(out_dir or cfg.get("out_dir") or ".").expanduser()
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = name or f"eyes-{stamp}"
    ext = Path(remote).suffix or ".jpg"
    dest = dest_dir / f"{base}{ext}"

    _adb(serial, "pull", remote, str(dest))

    if not stay_awake:
        _sleep(serial)

    click.echo(str(dest.resolve()))


@eyes.command()
@click.option("--duration", "-d", type=float, required=True, help="Recording length in seconds.")
@click.option("--device", help="Select a configured device by name/serial.")
@click.option("--pin", help="Lock-screen PIN (overrides config/env).")
@click.option("--out", "out_dir", type=click.Path(), help="Directory to save the video into.")
@click.option("--name", help="Base filename (without extension).")
@click.option("--settle", default=2.5, help="Seconds to let the camera open before recording.")
@click.option(
    "--camera",
    type=click.Choice(["back", "front"]),
    default="back",
    help="Which lens to use (default back — the one facing the monitor).",
)
@click.option("--redetect", is_flag=True, help="Re-scan the camera UI (use if the layout changed).")
@click.option("--no-unlock", is_flag=True, help="Assume already awake/unlocked.")
@click.option("--stay-awake", is_flag=True, help="Do not re-sleep the phone afterwards.")
def record(
    duration: float,
    device: str | None,
    pin: str | None,
    out_dir: str | None,
    name: str | None,
    settle: float,
    camera: str,
    redetect: bool,
    no_unlock: bool,
    stay_awake: bool,
) -> None:
    """Record a camera video of the given duration and pull it here."""
    cfg = _load_config()
    entry = _resolve_target(device, cfg)
    serial = entry["serial"]
    click.echo(f"using {entry.get('name') or serial}, recording {duration}s ...", err=True)

    if not no_unlock:
        _ensure_unlocked(serial, _pin_for(entry, pin))

    remote = _record(cfg, entry, duration=duration, settle=settle, facing=camera, redetect=redetect)

    dest_dir = Path(out_dir or cfg.get("out_dir") or ".").expanduser()
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = name or f"eyes-{stamp}"
    ext = Path(remote).suffix or ".mp4"
    dest = dest_dir / f"{base}{ext}"

    _adb(serial, "pull", remote, str(dest))

    if not stay_awake:
        _sleep(serial)

    click.echo(str(dest.resolve()))
