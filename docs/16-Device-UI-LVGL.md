<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 16 — Common Device UI: LVGL on an Emulated Device

Date: 2026-07-14

A device UI written once and run anywhere Helix runs: the same LVGL screen
renders on an ESP32 panel, in the QEMU emulator, and (next) on a Linux device.
This document covers the first slice — a hello-world screen with a button,
rendering on an emulated ESP32 and driveable from the host.

## The problem QEMU poses

Espressif's QEMU emulates the ESP32 faithfully but has **no display**. A UI stack
that assumes a panel therefore cannot be exercised in emulation at all, which
would leave the one piece of the system a developer most wants to *see* as the
only piece that needs hardware to try.

The way out is to treat the host as the panel. LVGL renders on the emulated
device exactly as it would on real silicon; what changes is where the pixels go.
The flushed rectangles leave over the Helix protocol and are reassembled by a
host viewer, and clicks travel back the other way as pointer events. Nothing
about the screen, the widget tree, or LVGL's rendering is special-cased for the
emulator — only the driver underneath them is.

## Architecture

```
ui/screens/*.c          the UI itself: pure LVGL, no driver/OS/transport calls
   |                    (helix_ui_screen_fn -- the piece that is portable)
ui/src/helix_ui.c       LVGL wiring: display, partial render buffer, input queue
   |
ui/include/helix_ui_display.h        the display seam
   |                                 (init + flush(rect, RGB565); nothing else)
   +-- helix_ui_display_stream.c     ships rectangles to a host  <-- this slice
   +-- (future) an SPI panel driver on real hardware
   +-- (future) a Linux framebuffer / SDL driver
   |
ui/port/esp32/          the OS port: FreeRTOS task, esp_timer clock, and the sink
                        that hands frames to the binary side-channel
```

The core owns no task and no clock: a port supplies the millisecond clock and
pumps `helix_ui_run()` in a loop. That is what keeps `ui/` compilable outside
ESP-IDF, so a Linux port is a new `port/`, not a fork.

### Pixels out: the binary side-channel, in reverse

A 240×240 RGB565 frame is ~115 KB, far past the JSON packet caps, so display
frames do not travel on the message layer. They use the binary side-channel that
file transfer already introduced (`helix_binary_channel`) — which until now only
ran host→device. This work made it **bidirectional**:

- `helix_transport_t` gained a `send_binary` hook, left NULL by transports that
  carry no binary framing.
- `helix_service_endpoint_binary_transport()` returns the first attached transport
  that has one, so a service can stream bytes without naming a transport.
- The serial transport implements it with the *same* frame layout it already
  parses inbound (`0x02 ver session offset len payload crc32`).

Each flushed rectangle is one logical stream: `session` is a rolling frame id,
`offset` the byte position within it, and the payload is an 8-byte bounds header
followed by RGB565 pixels. The host applies a rectangle only once every byte of
it has arrived.

ESP-IDF's logs share UART0 with the frame stream and are not covered by the
transport's TX lock, so a log line can slice a frame in half. The host
resynchronises on the frame marker and validates the CRC, so a damaged frame
costs exactly one rectangle — the next redraw restores it. The `ui` feature keeps
the log level at WARN so this is rare.

### Input in: an ordinary service

Pointer input is not special. The `ui` service (`ui/contracts/ui.json`) exposes
`info`, `refresh` and `pointer`; the handler pushes events onto a lock-free
single-producer/single-consumer queue that LVGL's input device drains on the UI
task. `refresh` exists because the host starts with no pixels: it invalidates the
screen so the next pump re-flushes everything.

## Running it

```sh
helix ui build                  # firmware: the ui_demo app, LVGL, for QEMU
helix ui sim                    # boot it in QEMU, open the screen in a window
helix ui shot --out shot.png    # same, headless: capture a PNG (--tap to click first)
```

`sim` opens a native Tk window (no new dependency) showing the device's screen;
clicking sends `ui.pointer` and the device redraws. Espressif's QEMU only exists
inside the ESP-IDF image, so the emulator runs in the container with its UART
published on a TCP port, and the viewer attaches to that from the host.

## Feature gating: why `HELIX_FEATURES` exists

ESP-IDF compiles **every component it can see**, whether or not anything requires
it. Adding LVGL to the tree would therefore have made every firmware build in the
repository pay for it (~350 KB of flash and a few hundred source files).

So the UI component is kept out of the component list entirely unless the build
asks for it. `helix` passes the enabled feature fragments to CMake as
`HELIX_FEATURES`, and `core/CMakeLists.txt` only adds `ui/` when `ui` is among
them. It travels in the **environment**, not a cache variable, because ESP-IDF
resolves component requirements in a separate CMake process that inherits the
environment but neither the project's variables nor its cache — and `ui_demo`,
which guards its own `REQUIRES` on the flag, is evaluated in both passes.

Apps declare what they need, so nobody has to remember the flag:

```json
{ "name": "ui_demo", "component": "ui_demo", ..., "features": ["ui", "no-storage"] }
```

`helix embedded esp32 link ui_demo` enables both fragments on its own. `no-storage`
drops the FAT partition, file transfer, FlashDB and the event queue — roughly the
50 KB that LVGL needs to fit inside the 1.25 MB app partition.

## Tests

`tests/e2e/test_ui_lvgl.py` boots the firmware in QEMU and asserts the whole loop:
the screen streams (six 40-line slices, none dropped), tapping the button redraws
the counter *and leaves the rest of the screen alone*, and an out-of-bounds
pointer is rejected. It runs on the host (unlike the other `esp32_qemu` tests,
which run inside the image) because it drives the emulator through Docker:

```sh
helix ui build && pytest tests/e2e/test_ui_lvgl.py
```

## Cost and limits

| | |
| --- | --- |
| Firmware | 0x133f70 (~1.20 MB), 4% free in the app partition |
| Screen | 240×240 RGB565, configurable (`CONFIG_HELIX_UI_WIDTH`/`HEIGHT`) |
| Render buffer | 40 lines (~19 KB), so a full frame is six flushes |
| Full redraw | ~1.7 s over the emulated UART; incremental redraws are a few rectangles |

The full-frame time is a property of the UART, not of LVGL — a real panel driver
writes to a bus instead. It is comfortable for a UI that redraws on interaction
and would need dirty-rectangle compression to drive animation over the wire.

## What is next

- **A real panel driver** (SPI ILI9341/ST7789) implementing the same
  `helix_ui_display_t`, so the same screens run on hardware.
- **A Linux port** (`ui/port/linux`) over SDL or the framebuffer, which is what
  makes "common device UI" true rather than aspirational.
- **Remote UI**: the streaming driver is transport-agnostic; over MQTT or
  WebSocket it becomes a device screen you can watch (and drive) from the cloud.
