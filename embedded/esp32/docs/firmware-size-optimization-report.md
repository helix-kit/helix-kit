# ESP32 Firmware Size Optimization Report

Date: 2026-06-28

This report captures the measured firmware-size work for the ESP32 app image.
The measurements were taken against the firmware selection:

```text
led_blinker + led_blinker_two + gpio_control + status_display
```

The baseline app image was built from the original `sdkconfig.defaults` before
size-oriented feature toggles were applied.

## What The App Binary Contains

`esp32_firmware.bin` is the actual ESP-IDF application image flashed into an app
partition at `0x20000`. It does not include the bootloader, partition table, NVS,
OTA metadata, Wi-Fi credentials, or provisioning data.

The image contains:

- ESP image headers and segment metadata
- app metadata, project version, and image digest information
- executable code placed in flash
- constants, strings, certificate bundle data, and lookup tables
- code copied to IRAM for timing/cache-sensitive paths
- initialized data copied to DRAM at boot
- Helix core runtime, services, and selected apps
- linked ESP-IDF runtime pieces required by the selected functionality

The much larger `esp32_firmware.elf` is not the flashable firmware size. It
contains debug and linker metadata. In the measured baseline, the ELF was around
9.4 MiB, with around 8.1 MiB being debug-only sections.

## Baseline

```text
app binary:          1,099,264 bytes
app partition size:  1,310,720 bytes
free space:            211,456 bytes
used:                    83.9%
```

Baseline section summary:

```text
.flash.text          757,106 bytes
.flash.rodata        235,042 bytes
.iram0.text          101,255 bytes
DRAM static           38,744 bytes
```

## Independent Optimization Measurements

Each row below was measured independently against the same baseline. The savings
are not additive because linker behavior changes when several options are
combined.

| Optimization | App Bin | Saved Vs Base |
|---|---:|---:|
| baseline | 1,099,264 | 0 |
| compiler size/release | 1,004,800 | 94,464 |
| remove MQTT WebSocket | 1,092,112 | 7,152 |
| remove IPv6 | 1,068,272 | 30,992 |
| TLS client-only | 1,090,912 | 8,352 |
| disable assertions | 1,030,224 | 69,040 |
| default logs WARN | 1,087,488 | 11,776 |
| newlib nano | 1,050,416 | 48,848 |
| common CA bundle | 1,046,800 | 52,464 |
| remove WPA3/SAE/OWE | 1,066,288 | 32,976 |
| remove SoftAP | 1,046,768 | 52,496 |
| remove Wi-Fi enterprise | 1,098,640 | 624 |
| full combined throwaway | 729,824 | 369,440 |

Section-level savings:

| Optimization | flash.text Saved | flash.rodata Saved | IRAM Saved | Static DRAM Saved |
|---|---:|---:|---:|---:|
| compiler size/release | 74,762 | 10,820 | 8,412 | 496 |
| remove MQTT WebSocket | 4,748 | 2,408 | 0 | 0 |
| remove IPv6 | 29,624 | 1,360 | 0 | 1,616 |
| TLS client-only | 8,344 | 16 | 0 | 0 |
| disable assertions | 16,860 | 40,008 | 9,508 | 2,672 |
| default logs WARN | 2,756 | 3,912 | 216 | 0 |
| newlib nano | 45,964 | 2,876 | 20 | 0 |
| common CA bundle | 0 | 52,464 | 0 | 0 |
| remove WPA3/SAE/OWE | 30,720 | 2,355 | 0 | 240 |
| remove SoftAP | 49,332 | 4,240 | 88 | 168 |
| remove Wi-Fi enterprise | 632 | 0 | 0 | 0 |
| full combined throwaway | 235,790 | 112,300 | 15,656 | 4,700 |

## Currently Applied First Pass

The first committed/default pass applies:

```text
CONFIG_COMPILER_OPTIMIZATION_SIZE=y
# CONFIG_COMPILER_OPTIMIZATION_DEBUG is not set
CONFIG_MBEDTLS_TLS_CLIENT_ONLY=y
# CONFIG_MBEDTLS_TLS_SERVER_AND_CLIENT is not set
# CONFIG_MBEDTLS_TLS_SERVER is not set
# CONFIG_MQTT_TRANSPORT_WEBSOCKET is not set
# CONFIG_MQTT_TRANSPORT_WEBSOCKET_SECURE is not set
# CONFIG_LWIP_IPV6 is not set
```

Measured result for this pass:

```text
before app bin: 1,099,264 bytes
after app bin:    967,536 bytes
saved:            131,728 bytes
free in slot:     343,184 bytes
```

This keeps MQTTS and HTTPS OTA/download behavior intact.

## Feature Impact Notes

### Compiler Size/Release

Builds the firmware with size/release optimization instead of debug
optimization. This should preserve functional behavior, but debug stepping and
some debug-time inspection become less convenient.

### MQTT WebSocket Removal

Removes MQTT-over-WebSocket transports. The ESP32 still uses direct MQTTS over
TCP/TLS. This is safe as long as the broker exposes normal MQTT TLS endpoints.

### IPv6 Removal

Removes IPv6 code from lwIP. The device continues to work on IPv4 Wi-Fi networks.
It will not work on IPv6-only networks.

### TLS Client-Only

Keeps TLS client support and removes TLS server support. This preserves outbound
MQTTS and HTTPS OTA/download. It removes the ability for the ESP32 firmware to
host its own TLS server.

### Assertions Disabled

Removes assertion code and assertion strings. This saves significant flash, but
reduces diagnostics when internal invariants fail. Better suited for production
release profiles than development profiles.

### WARN Logs

Changes default logs from INFO to WARN. This saves strings and some code, but
reduces serial visibility during normal operation.

### Newlib Nano

Uses smaller libc printf/scanf formatting. This saves meaningful code size.
Functional impact depends on formatting needs; advanced float/locale/format
behavior should be checked before making this the only release default.

### Common CA Bundle

Uses the common Mozilla CA bundle instead of the full bundle. This saves
certificate rodata. It changes what public certificate authorities the device
trusts.

Longer term, the preferred Helix production model is to provision our own root
CA in NVS and trust only the appliance/cloud certificate chain instead of
shipping broad public CA bundles in firmware.

### WPA3/SAE/OWE Removal

Removes newer WPA3/SAE/OWE Wi-Fi authentication support. WPA2 personal networks
continue to work. WPA3-only networks may not.

### SoftAP Removal

Removes support for ESP32-created Wi-Fi access points. This is compatible with
USB/NVS provisioning, but not with captive-portal or AP-mode provisioning.

### Wi-Fi Enterprise Removal

Removes corporate/RADIUS-style Wi-Fi support. The measured size saving is small
in this firmware, so this is not a priority optimization by itself.

## Where These Toggles Sit In The Build Pipeline

SDK feature toggles sit before component archive generation, not at final binary
link time.

```text
sdkconfig / Kconfig options
    -> compile ESP-IDF/core/app components
    -> component archives: libcore.a, libmqtt.a, liblwip.a, libmbedtls.a, ...
    -> final app-selection link
    -> esp32_firmware.elf
    -> esp32_firmware.bin
```

The dynamic app selection system is late-bound:

```text
generated/app_selection.c
    -> small selector object
    -> final link
```

That means app permutations are cheap to relink. Examples:

```text
led_blinker only
gpio_control + status_display
led_blinker + led_blinker_two + gpio_control + status_display
```

Feature toggles are earlier and require rebuilding affected archives:

```text
CONFIG_COMPILER_OPTIMIZATION_SIZE
CONFIG_LWIP_IPV6
CONFIG_MQTT_TRANSPORT_WEBSOCKET
CONFIG_MBEDTLS_TLS_CLIENT_ONLY
CONFIG_NEWLIB_NANO_FORMAT
CONFIG_ESP_WIFI_SOFTAP_SUPPORT
CONFIG_ESP_WIFI_ENABLE_WPA3_SAE
```

These affect how ESP-IDF source files are compiled into object files and static
archives. They cannot safely be changed only during the final `.bin` packaging
step.

## Recommended Build Model

Use build profiles for SDK feature sets and app selections for final firmware
composition.

Example profile layer:

```text
dev
release-small
release-full-wifi
release-debuggable
```

Example app-selection layer:

```text
core-only
gpio_control
gpio_control + status_display
led_blinker + led_blinker_two + gpio_control + status_display
```

The `.a` cache should be keyed by build profile. Final firmware outputs should
be keyed by both profile and app selection.

```text
out/profiles/release-small/lib/
out/firmware/release-small/gpio_control+status_display/
```

This preserves cheap final relinks for app combinations while keeping SDK-level
feature choices explicit and reproducible.

