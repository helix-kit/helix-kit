# Helix ESP32 transports component

ESP-IDF component with the ESP-only Helix transports. The platform-agnostic
protocol core they carry lives in the shared `protocol` component
(`embedded/protocol`); this component `REQUIRES protocol`.

Public headers:

- `helix_transport_serial.h` — newline-framed UART transport
- `helix_transport_mqtt.h` — MQTT transport
- `helix_transport_websocket.h` — HTTP/WebSocket transport
- `helix_transport_ble.h` — BLE GATT transport (with `helix_ble_profile.h`)

This package does not own Wi-Fi, provisioning, credentials, cloud identity, OTA,
application services, or app lifecycle — nor the protocol core itself.

## Use in an ESP-IDF project

```cmake
idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES protocol transports
)
```

```c
#include "helix_service_endpoint.h"   // from protocol
#include "helix_transport_serial.h"   // from transports
```
