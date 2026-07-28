<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Browser Transport E2E Testing (Web Serial, and beyond)

How Helix verifies its browser transport packages end-to-end against real
hardware, what does and does not work for automating them, and the open
questions for running these tests in CI.

This documents findings as of Playwright 1.61 / bundled Chromium 149 / system
Google Chrome 150 on Linux (X11 + Wayland host, CP210x ESP32 DevKit).

## Goal

Prove that the shared transport packages (`@helix/transport-serial`, and later
BLE / WebSocket / MQTT) actually connect, send, and read against a real device
**in a real browser**, driving the same code paths a user would. No mocks of the
transport logic; the only thing ever substituted is the parts of the browser a
test cannot drive.

## The harness (`web/e2e/`)

The tests do **not** run against the product app (those pages are temporary).
They run against a minimal Vite + React harness in `web/e2e/harness/` that
imports only the packages under test:

- `@helix/transport-serial/react` — Web Serial connect / disconnect / status
- `@helix/transport-ble` — Web Bluetooth connect / disconnect / status
- `@helix/protocol-service/react` — `useHelixTransport()` (raw transport handle)
- `@helix/protocol-core` — `createRequestId` + packet types

The harness is **contract-agnostic**. `RawMessagePanel` has one input (request
message JSON) and one output (received packets, verbatim). It wraps the injected
JSON in a Helix packet and calls `transport.send` / `transport.subscribe`
directly — no typed device service, no contracts, no TanStack Query. **The test
owns the payloads**: the spec injects a `gpio-control` request and asserts on the
raw response. The UI is bare `data-testid` elements, so tests are independent of
styling. Adding a transport = adding a panel (a provider wrapping the shared
`RawMessagePanel`).

One transport renders per page, chosen by URL hash (`/` → serial, `/#ble` →
BLE), so the two `RawMessagePanel`s never share `data-testid`s. Playwright's
`webServer` serves this harness on `http://localhost:3200`. Runners:
`pnpm --filter @helix/e2e test` (serial), `test:ble` (BLE, under Xvfb). Lint +
typecheck are enabled on the package and pass under `turbo run lint typecheck`.

## Web Serial vs Web Bluetooth — what each needs

Both drive the **same** `RawMessagePanel` and assert on the same raw firmware
responses; only getting *connected* differs.

| | Web Serial | Web Bluetooth |
|---|---|---|
| Chooser automation | ❌ CDP `DeviceAccess` does not cover serial | ✅ CDP `DeviceAccess` **does** cover Bluetooth |
| Grant / profile needed | Yes (persistent grant, or Chrome+policy) | **No** — chooser handled programmatically each run |
| Browser | bundled Chromium (grant) or system Chrome (policy) | bundled Chromium + `--enable-features=WebBluetooth` |
| Board reset on connect | Yes (DTR/RTS → EN) | No |
| Extra host setup | tty prep (`setfacl` + `stty -hupcl`) | Bluetooth adapter + BlueZ, board advertising `Helix ESP32 …` |

**BLE is the cleaner of the two to automate.** `navigator.bluetooth.requestDevice`
opens a native chooser, but CDP `DeviceAccess.deviceRequestPrompted` fires for it
(it re-fires with a growing device list as the scan discovers devices) and
`DeviceAccess.selectPrompt({id, deviceId})` picks the `Helix ESP32` device with
no click, no grant, and no committed profile. Verified: full GATT connect + raw
`gpio-control` round-trip over the command/response characteristics. `test:ble`
runs headed under Xvfb, fully unattended.

## Arduino (native-USB) over Web Serial

The Helix serial protocol ports to Arduino unchanged. The sketch lives at
`embedded/arduino/helix_serial_echo/` — it speaks the same newline framing
(`SERVICE …` in, `HELIX_RESPONSE …` out) and emulates `gpio-control` on real
digital pins, so the same harness drives it (route `/#arduino`). Verified
end-to-end on an Arduino Leonardo (`2341:8036`, `/dev/ttyACM0`).

Two differences from the ESP32 mattered, both now handled:

1. **DTR polarity (opposite of the ESP32).** The Leonardo's native USB CDC sends
   nothing unless **DTR is asserted** — with DTR deasserted the read simply
   hangs. The ESP32 DevKit is the reverse: DTR must be **deasserted** or its
   auto-reset circuit holds it in reset. The shared transport now takes an
   `openSignals` option (`@helix/transport-serial`); default deasserts DTR/RTS
   (ESP32), and the harness's `/#arduino` panel passes
   `{ dataTerminalReady: true, requestToSend: true }`.
2. **brltty hijacks the port.** Ubuntu's `brltty` (braille display driver) claims
   Arduino CDC devices via a udev-triggered transient service, which makes
   Chrome's Web Serial read fail with *"The device has been lost."* (raw
   `pyserial` intermittently dodges it by timing). Fix: `sudo systemctl mask
   brltty.service brltty-udev.service`. A `ModemManager` ignore rule
   (`/etc/udev/rules.d/99-helix-arduino.rules`,
   `ATTRS{idVendor}=="2341", ENV{ID_MM_DEVICE_IGNORE}="1"`) is also good hygiene,
   though MM was not the active cause here.

Unlike the ESP32, opening the Leonardo does **not** reset it (native USB; only a
1200-baud touch enters the bootloader), so there is no boot-window race. The
Arduino appears as `/dev/ttyACM*` (not `/dev/ttyUSB*`); the harness serial
filters include the Arduino VIDs (`0x2341`, `0x2a03`).

## The core constraint

Headless automation cannot drive two things:

1. The browser's **native serial port-picker** dialog (a native GTK bubble, not
   page DOM). Playwright cannot click it.
2. The browser sandbox cannot reach `/dev/ttyUSB0` on its own.

Everything else — the transport client, packet framing, the actual bytes on the
wire at 115200 — is real. The question is only how to get past (1) and (2)
without faking the transport.

## Approaches evaluated

| Approach | Result | Notes |
|---|---|---|
| `navigator.serial` polyfill bridged to a Node `serialport` | works, but rejected | Real bytes, but the browser Web Serial API itself is faked. Kept in reserve for CI/QEMU only. |
| Real `navigator.serial`, **persistent profile** with one-time grant | ✅ works | Grant the port once by hand; Chrome persists the per-origin device permission; later runs auto-connect via `getPorts()`. Requires either committing the profile or a per-dev one-time grant. |
| `headless: true` | ❌ fails | `navigator.serial` exists, but `getPorts()` is empty and it will not enumerate real devices → falls to `requestPort()` → "No port selected by the user." Chromium headless device-API restriction; the grant cannot fix it. |
| Headed under **Xvfb** (virtual framebuffer) | ✅ works | Real headed browser, no visible window. Grant honored. This is the unattended/CI-capable form of the persistent-profile approach. `pnpm test:xvfb`. |
| **CDP `DeviceAccess.selectPrompt`** (select port programmatically) | ❌ tested, does not work | `DeviceAccess.deviceRequestPrompted` never fires for the serial chooser (`promptFired=false`, hung at `connecting`). The domain covers WebUSB/Bluetooth, not Web Serial in this build. |
| OS-level click of the chooser (`xdotool` under Xvfb) | possible, not recommended | Fragile: native bubble, coordinate/version dependent. |
| Managed policy `SerialAllowAllPortsForUrls` + **bundled Chromium** | ❌ tested, ignored | Playwright's bundled Chromium does not honor managed policies ([playwright#32324](https://github.com/microsoft/playwright/issues/32324)). |
| Managed policy `SerialAllowAllPortsForUrls` + **system Google Chrome** | ✅ tested, works | Fresh profile, **no grant, no committed profile, no chooser** — `getPorts()` auto-returns the port and the app connects. |

### The winning chooser-free path

System Google Chrome (`channel: 'chrome'`) plus a one-line managed policy:

```json
// /etc/opt/chrome/policies/managed/helix-serial.json
{ "SerialAllowAllPortsForUrls": ["http://localhost:3200"] }
```

`navigator.serial.getPorts()` then auto-returns the port for that origin, so the
transport's `selectSerialPort()` uses it directly — no grant, no committed
profile, no dialog — headed under Xvfb, fully unattended. Cost: requires system
Chrome installed and a one-time policy file (`sudo`, or a setup script). The
policy grants all serial ports to a single test origin, which is acceptable.

### Decision on committing a browser profile

Because Chrome + policy needs **no** profile, committing one is unnecessary and
undesirable (bulky, machine-specific). `browser-profile/` stays gitignored. Two
supported modes:

- **Local dev:** bundled Chromium + one-time `pnpm run grant` (profile stays
  local), or the Chrome + policy setup.
- **CI / unattended:** system Chrome + policy + Xvfb. No grant, no profile.

## The recurring hardware gotcha: prep lapse on re-enumeration

Opening the CP210x toggles DTR/RTS, which **resets the ESP32** (it then needs
~1.5–2 s to boot; requests sent mid-boot are lost, and the transport does not
retry them — so the spec retries). On a marginal USB path (e.g. behind a cheap
hub) the reset current-spike can also re-enumerate the device, which Chrome
reports as "The device has been lost."

Crucially, **a USB re-enumeration recreates `/dev/ttyUSB0` fresh and wipes both**
the `setfacl` ACL and the `stty -hupcl` line setting. Without `-hupcl`, closing
the port resets the board again. The harness therefore re-applies the prep on
**every** run in `global-setup.ts` (best-effort, `sudo -n`, non-fatal):

```
setfacl -m u:$USER:rw /dev/ttyUSB0
stty -F /dev/ttyUSB0 115200 ... -hupcl ...
```

For reliable runs, prefer connecting the board directly rather than through a
hub.

## Open question: ESP32 in QEMU for CI

Goal: run the firmware in QEMU (MQTT already worked there previously) and expose
its serial to a real browser Web Serial session, **without firmware/app code
changes**, so CI can exercise serial without physical hardware.

Findings:

- The classic ESP32 has **no native USB**; QEMU exposes UART0 as a host chardev
  (pty / socket / TCP), **not** a USB device. Chrome's Web Serial does not
  enumerate ptys.
- To make the browser see a QEMU-backed port as a real serial device, bridge
  QEMU's UART to a **virtual USB-serial gadget**:
  `dummy_hcd` (virtual USB device controller) + `g_serial` / `usb_f_acm` →
  a real `/dev/ttyACM0` the browser enumerates; `socat` links QEMU's UART
  socket ↔ `/dev/ttyGS0`. No firmware/app changes: firmware talks UART0 as
  usual, the app calls `navigator.serial` as usual.
- **Blocker found on this host:** `g_serial` / `usb_f_acm` are present, but
  `dummy_hcd` is **not** (`Module dummy_hcd not found`). Without it (or a real
  device controller, which CI servers lack) the gadget cannot bind. `dummy_hcd`
  ships in `linux-modules-extra-$(uname -r)` and is not guaranteed on a given
  runner — so this route needs a privileged runner and a module install, and may
  not be portable.

### Pragmatic CI fallback

Inject a **test-only `navigator.serial` polyfill** (Playwright `addInitScript`)
that bridges to QEMU's TCP-UART socket. This changes **zero app/firmware code** —
the app still calls `navigator.serial`; only the test harness swaps the browser's
transport plumbing (unavoidable in headless CI regardless). It is the polyfill
rejected for *real* hardware, but scoped to QEMU-CI it is defensible since there
is no real USB there anyway. It exercises everything above the port's raw byte
I/O.

### To validate before committing to QEMU

- `dummy_hcd` availability on the target CI runner (if pursuing the real-gadget
  route).
- Whether Espressif's QEMU emulates the GPIO peripheral registers well enough
  that `set-gpio` / `read-gpio` round-trip. The transport test only needs a
  `gpio-control-state` response, so register-level emulation is likely enough.
- UART framing at 115200 through the QEMU chardev.

## Recommendations

1. Do **not** commit a browser profile; keep `browser-profile/` gitignored.
2. Add a setup script for the Chrome + policy mode and a harness "CI mode"
   (`channel: 'chrome'` + policy + Xvfb) alongside the local bundled-Chromium +
   grant mode.
3. For QEMU, prototype the **polyfill-to-QEMU-UART** bridge first (portable, no
   privileged modules); treat the `dummy_hcd` gadget as a "real USB" upgrade only
   where a privileged runner is available.
