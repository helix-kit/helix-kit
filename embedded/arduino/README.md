<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Arduino / AVR firmware and simulator

Helix on AVR runs the **same** Helix service protocol as the ESP32, but **serial
only** — the AVR targets have no WiFi/BLE, so MQTT/WebSocket/BLE transports do
not apply. Firmware is developed against a **QEMU simulator** so it can be built
and driven with no physical board, mirroring the ESP32's QEMU loop.

## Layout

- `helix_node/` — **the firmware.** FreeRTOS + the ESP32-shared Helix core
  (dispatcher/endpoint/protocol) over a serial transport, with a `gpio-control`
  service. Runs services exactly as the ESP32 does.
- `helix_serial_echo/` — the original single-file sketch (Arduino Leonardo,
  native-USB); a hand-rolled echo, not the dispatcher. Kept for real-hardware
  Web Serial e2e.
- `qemu_smoke/` — minimal serial round-trip (`ECHO <line>`).
- `qemu_timer/` — bare Timer1 CTC probe; shows QEMU fires the 16-bit timer.
- `qemu_freertos/` — two-task FreeRTOS probe (proves preemption under QEMU).
- `qemu_helix_core/` — probe that runs the Helix core in-memory (no RTOS/task).
- `libraries/` — repo-vendored Arduino libraries (see below).
- `commands/` — the `helix embedded arduino` CLI plus `simulator.py`, the
  click-free build/run/serial core shared by the CLI and the e2e tests.

## Where the protocol code comes from

The Helix protocol core is **not** vendored or symlinked here — it lives once, in
the shared, platform-agnostic `embedded/protocol/` (see its README), and the
Arduino build consumes it in place via `arduino-cli --library embedded/protocol`.
The same directory is an ESP-IDF component for the ESP32 build.

## Vendored libraries (`libraries/`)

Builds add `--libraries embedded/arduino/libraries` (plus `--library
embedded/protocol` for the shared core) so firmware is reproducible without
depending on the user's global Arduino libraries:

- `FreeRTOS/` — the `feilipu/Arduino_FreeRTOS_Library` kernel (v11.1.0-3, MIT),
  **patched** to drive the RTOS tick from Timer1 instead of the watchdog (search
  `HELIX PATCH`; see the tick note below).
- `HelixEspCompat/` — the ESP-IDF compatibility layer that lets the shared core
  build on AVR: a vendored **cJSON** 1.7.19 (the exact version the ESP32 firmware
  uses, MIT), `esp_err.h`/`esp_log.h` stand-ins, and `freertos/*` headers
  forwarding to the FreeRTOS library. ESP-IDF provides all of this natively, so
  the shim exists only on the Arduino side.

The AVR firmware supplies its own serial transport + service wiring in the sketch
(`helix_node.ino`); the ESP transports live in `embedded/esp32/transports`.

## Tooling (`helix embedded arduino`)

`qemu-system-avr` emulates the ATmega USART and exposes it as a host chardev, so
a sketch's `Serial` becomes a socket/stdio we can drive. QEMU can emulate these
AVRs (the Leonardo's ATmega32u4 + native-USB CDC is **not** emulable):

| board (`--board`) | Arduino FQBN                     | QEMU machine | SRAM |
|-------------------|----------------------------------|--------------|------|
| `mega2560` (def)  | `arduino:avr:mega`               | `mega2560`   | 8 KB |
| `uno`             | `arduino:avr:uno`                | `uno`        | 2 KB |
| `mega1280`        | `arduino:avr:mega:cpu=atmega1280`| `mega`       | 8 KB |

```sh
helix embedded arduino build helix_node            # compile only, print ELF
helix embedded arduino run   helix_node            # serial <-> terminal (Ctrl-A X quits)
helix embedded arduino run   helix_node --tcp 5678 # serial as a TCP server
helix embedded arduino smoke                       # echo + helix_node protocol round-trip
helix embedded arduino test                        # the pytest e2e suite
helix embedded arduino flash helix_node --port /dev/ttyACM0   # real board
```

Drive `helix_node` over serial with the Helix framing:

```
in:   SERVICE {"requestId":"1","message":{"service":"gpio-control","method":"set-gpio","payload":{"pin":13,"high":true}}}
out:  HELIX_RESPONSE {"requestId":"1","message":{"service":"gpio-control","method":"gpio-control-state","payload":{"pins":[{"pin":13,"level":1}]}}}
```

A sketch argument is a directory path or a bare name under `embedded/arduino/`.
Requires `qemu-system-avr` (Debian/Ubuntu: `qemu-system-misc`) and the
`arduino:avr` core (`arduino-cli core install arduino:avr`).

QEMU's serial is a plain host chardev (like a USB-UART bridge, no USB VID/PID or
DTR), so the **browser** Web Serial e2e still needs real hardware; the QEMU loop
is CLI/socket-driven.

## E2E tests

`tests/e2e/test_arduino_sim.py` boots real compiled sketches in QEMU and asserts
the serial protocol round-trips: echo on mega2560 + uno, and against `helix_node`
a `gpio-control` `SERVICE`→`HELIX_RESPONSE` exchange, multi-request task
survival, and a malformed-input `HELIX_ERROR`. Self-contained (no appliance);
skips where the AVR toolchain is absent. Run via `helix embedded arduino test`.

## The FreeRTOS tick gotcha (WDT vs Timer1)

`qemu-system-avr` (10.2) emulates the USART, GPIO and the **16-bit timers**, but
**not the watchdog timer interrupt**. The feilipu FreeRTOS port drives its RTOS
tick from `WDT_vect` by default (`portUSE_WDTO = WDTO_15MS`); under QEMU that
interrupt never fires, so `vTaskDelay()` never wakes and tasks hang after their
first blocking call. The vendored `FreeRTOS/` copy is patched (`portUSE_TIMER1`
in `FreeRTOSConfig.h`, plus `port.c`/`FreeRTOSVariant.h`) to drive the tick from
Timer1 CTC (`TIMER1_COMPA_vect`) at 1000 Hz, which QEMU fires reliably and also
works on real hardware (it reserves Timer1). Undefine `portUSE_TIMER1` to fall
back to the watchdog tick.

## Notes for `helix_node`

- The Helix headers are plain C (no `extern "C"` guards), so the C++ `.ino`
  wraps them in `extern "C" { … }`.
- The transport task drains `Serial` continuously (napping only when idle) so
  the AVR core's 64-byte RX ring buffer never overflows on a full packet, and
  uses a generous stack (cJSON parse/print are deeply recursive).
- `set-gpio` reports the *commanded* level: on real AVR a `digitalRead` of an
  output pin reads back, but QEMU does not model output-pin readback.
