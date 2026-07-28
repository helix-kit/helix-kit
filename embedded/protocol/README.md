<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Helix protocol core (shared)

The platform-agnostic heart of the Helix device protocol, shared **verbatim** by
the ESP32 and Arduino firmware — packet parsing (`helix_protocol`), the JSON
helpers (`helix_json`), the binary side-channel (`helix_binary_channel`), the
service dispatcher (`helix_service_dispatcher`), and the transport-neutral
endpoint router (`helix_service_endpoint`). The transport interface
(`helix_transport.h`) lives here; concrete transports do not.

This directory is consumed by both build systems from one source of truth:

- **ESP-IDF** — an IDF component (`CMakeLists.txt` + `idf_component.yml`).
  `embedded/esp32/core` adds it via `EXTRA_COMPONENT_DIRS`; the ESP transports
  (`embedded/esp32/transports`) and `platform`/`main` `REQUIRES protocol`.
- **Arduino** — an Arduino library (`library.properties`); the build passes
  `--library embedded/protocol`. No symlinks.

## Dependency contract

The core speaks four things the platform must provide:

| Contract | ESP-IDF | Arduino |
|----------|---------|---------|
| `cJSON.h` | `json` component | vendored in `HelixEspCompat` |
| `esp_err.h` / `esp_log.h` | native | shimmed in `HelixEspCompat` |
| `freertos/*` (semaphore) | native | forwarded to the FreeRTOS library |
| `strlcpy` | libc | AVR libc |

Keeping this ESP-IDF-shaped contract means the core compiles **unmodified** on
both platforms; the non-ESP platform supplies the small compat layer rather than
the core carrying `#ifdef`s. Concrete transports are platform-specific:
`embedded/esp32/transports` (serial/MQTT/WebSocket/BLE) and the AVR serial
transport in `embedded/arduino/helix_node`.
