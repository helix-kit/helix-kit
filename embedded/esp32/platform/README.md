# Helix ESP32 Platform Component

Installable ESP-IDF component for Helix platform services built on top of the
protocol component.

Public headers include:

- `helix_platform.h` for shared ESP-IDF initialization and fatal wait helpers
- `helix_provisioning.h` for generic config-domain provisioning
- `helix_ota.h` for the Helix OTA service
- `helix_config_store.h` for string config storage over NVS
- `wifi.h` for Wi-Fi connection and validation helpers
- `cloud.h` for Helix cloud config validation and MQTT startup
- `certificates.h` for cloud certificate enrollment and storage
- `health.h` for cloud health publishing

This package owns reusable Helix platform services. Firmware entrypoints decide
which services to register and when to start transports.
