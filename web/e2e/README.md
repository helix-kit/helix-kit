# @helix/e2e — transport hardware-in-the-loop tests

Playwright tests that drive a **real, connected ESP32** (gpio-control firmware)
through the **shared Helix transport packages** — no mocks, no polyfills. Real
bytes travel over `/dev/ttyUSB0` at 115200; the shared `SerialTransportClient` +
typed device service frame Helix JSON; the assertions observe the firmware's
live responses.

## The harness (`harness/`)

The tests do **not** run against the product Next app (those pages are
throwaway). They run against a **minimal Vite + React harness** in `harness/`
that imports only the shared packages under test:

- `@helix/protocol/serial/react` — connect / disconnect / status
- `@helix/protocol/service/react` — `useHelixTransport()` (raw transport handle)
- `@helix/protocol` — `createRequestId` + packet types

The harness is **contract-agnostic**: `RawMessagePanel` has one input (request
message JSON) and one output (received packets, verbatim). It wraps the injected
JSON in a Helix packet and calls `transport.send` / `transport.subscribe`
directly — no typed device service, no contracts, no TanStack Query. **The test
owns the payloads** (it injects the gpio-control request JSON and asserts on the
raw response). `App.tsx` renders one panel per transport (serial today; BLE /
WebSocket / MQTT slot in the same way — a provider wrapping the shared
`RawMessagePanel`). The UI is bare `data-testid` elements, so tests are
independent of styling. Tested surface = the packages that actually ship.

## How it works

Headless automation cannot click the browser's native serial **port-picker**
dialog, and the browser sandbox cannot reach `/dev/ttyUSB0` on its own. Instead
of faking anything, we use Chromium's real `navigator.serial` plus a **persistent
profile** stored in this repo (`browser-profile/`):

- **Once**, you approve the ESP32 in the native chooser (`npm run grant`).
- Chrome persists that per-origin device permission into the profile.
- **Every run after**, `navigator.serial.getPorts()` returns the port, so the
  shared transport's `selectSerialPort()` uses it directly — **no dialog** — and
  the test is fully automated. The grant is keyed to the origin
  (`localhost:3200`), which the harness serves on, so it carries across runs.

The only "fake" is nothing: this is the genuine browser Web Serial API talking
to genuine hardware. The grant is the sole manual step, and it is one-time.

## Prerequisites

- An ESP32 flashed with the `gpio-control` firmware, connected over USB.
- The user can read/write the tty (you are in the `dialout` group, or run the
  prep below). The device is a CP210x → shows up as `/dev/ttyUSB0`.
- A display: the browser runs **headed** (needed at least for the grant). On a
  headless CI box, wrap commands in `xvfb-run`.

Install once:

```bash
cd web/e2e
pnpm install                     # from web/ this is covered by the workspace
pnpm exec playwright install chromium
```

## Serial prep (the "extra command")

Opening the CP210x cleanly can require: granting tty access and disabling
hangup-on-close (so opening/closing the port doesn't reset the ESP32). This is
the app's `ESP32_LINUX_SERIAL_PREP_COMMAND`. If you're in `dialout` it's usually
unnecessary; otherwise run global setup's prep automatically:

```bash
HELIX_E2E_RUN_PREP=1 pnpm test   # runs setfacl + `stty -hupcl` via `sudo -n`
```

or do it by hand once:

```bash
sudo setfacl -m u:$USER:rw /dev/ttyUSB0
sudo stty -F /dev/ttyUSB0 115200 cs8 -cstopb -parenb cread clocal -hupcl \
  min 1 time 0 -icanon -echo -isig -ixon -ixoff ignpar -parmrk -opost
```

## Running

```bash
# 1. One-time grant — a native chooser opens; pick the ESP32 (CP210x), Connect.
pnpm run grant

# 2. The real test — auto-connects and exercises GPIO end-to-end.
pnpm test           # headed on your real display ($DISPLAY)
pnpm test:xvfb      # unattended: headed browser rendered to a virtual display
```

### Can it run headless / unattended?

Pure `headless: true` does **not** work. `navigator.serial` exists in headless
Chromium, but its `getPorts()` returns nothing and it won't enumerate real
serial devices — so the app falls through to `requestPort()` and fails with
*"No port selected by the user."* The persisted grant cannot fix this; it's a
Chromium headless device-API restriction.

To run **unattended** (CI, headless server — no visible window) use **Xvfb**,
which renders a real *headed* browser into a virtual framebuffer so the grant is
honored:

```bash
sudo apt-get install -y xvfb
pnpm test:xvfb                      # == xvfb-run -a playwright test
```

The grant (one-time, headed) is still required first; after that `test:xvfb`
needs no display and no interaction.

The grant is stored in `browser-profile/`. Commit it to share the approval with
teammates / CI on the same board model (VID:PID `0x10c4:0xea60`). Volatile cache
dirs are gitignored; the permission-bearing files are kept.

## Configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `HELIX_SERIAL_PORT` | `/dev/ttyUSB0` | tty for the optional prep step |
| `HELIX_E2E_PORT` | `3200` | app origin port (grant is keyed to it — keep stable) |
| `HELIX_E2E_BASE_URL` | `http://localhost:3200` | app base URL |
| `HELIX_E2E_PROFILE` | `./browser-profile` | persistent Chromium profile dir |
| `HELIX_USB_VID` / `HELIX_USB_PID` | `0x10c4` / `0xea60` | asserted USB ids |
| `HELIX_E2E_RUN_PREP` | unset | `1` runs setfacl + stty in global setup |
| `HELIX_E2E_HEADLESS` | unset | `1` runs headless (grant must be done first) |

## Troubleshooting

- **A chooser appears during `pnpm test`** → the grant is missing/stale. Re-run
  `pnpm run grant`. Ensure the app port hasn't changed (grant is per-origin).
- **`Web Serial unsupported`** → running headless without a prior grant, or a
  Chromium build without Web Serial. Run headed.
- **Connects then errors / no GPIO response** → the port opened but the board
  reset or another process holds it. Close other serial monitors; run the prep
  (`stty -hupcl`).
