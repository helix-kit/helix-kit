<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

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

---

# Build Pipeline Investigation (2026-07-04)

The sections above measured *what to turn off* to shrink firmware. The sections
below measure *how the build pipeline must be structured* so that CI can prebuild
once, an EC2 runtime container can produce fully custom firmware on demand, and
users can pick arbitrary feature/app combinations without a prebuild per
permutation. All numbers here were measured on the `helix/esp-idf:release-v5.4-lean`
image, 12 cores, ESP-IDF `release/v5.4`, against the four-app selection.

## Measured Build-Cost Model

There are two fundamentally different classes of customization, and they cost
orders of magnitude apart:

| Change | What recompiles | Wall time (warm tree) | Late-bindable? |
|---|---|---:|---|
| App selection (which apps run) | 1 file (`app_selection.c`) + final link | ~3–4 s | Yes |
| Any Kconfig / feature toggle | Everything that includes `sdkconfig.h` (1144 ninja steps) | ~44 s | No |

The app-selection number was confirmed repeatedly: swapping the selected apps in
a fresh container recompiled only `app_selection.c`, relinked `libapp_selection.a`
and `esp32_firmware.elf`, and left the ~1000 ESP-IDF objects and app archives
untouched (ninja steps `[4/9]`–`[8/9]`). Distinct selections produced distinct,
valid firmware in 13–15 s wall (of which only ~3–4 s is ninja; the rest is fixed
overhead below).

The config-change number was measured by flipping a single sdkconfig symbol on
the warm build tree and forcing a reconfigure: **1144 ninja steps, ~44 s**. This
confirms the pipeline claim above — `sdkconfig.h` is a transitive dependency of
nearly every source file, so any option invalidates the archive cache. Feature
toggles cannot be moved to the final link step.

### Fixed Overheads

- ESP-IDF env activation (`source export.sh`): **~1.6 s**.
- A no-op `idf.py build` on an up-to-date tree: seconds.
- CMake reconfigure (triggered whenever config changes or the tree is fresh):
  the dominant fixed cost of a config build, alongside the final link (~4 s).
- A long-lived worker container that sources the env once avoids paying
  activation per request.

### Staleness Gotcha

Calling `idf.py` directly after editing `sdkconfig.defaults` **silently ignores
the change** — ninja does not re-run CMake just because a defaults file is newer.
A single-symbol edit produced only 4 trivial ninja steps and the old binary. The
Helix CLI avoids this via `config.py::remove_sdkconfig_if_stale`, which deletes
the cached `build/sdkconfig` when a defaults file is newer, forcing regeneration.
Any custom-build path that bypasses the CLI must replicate this.

## ccache Is the Lever for Arbitrary Configs

The lean image already installs `ccache`. With a persistent shared cache
(`IDF_CCACHE_ENABLE=1`, `CCACHE_DIR` on a mounted volume), the cost of a config
change collapses because most files' *preprocessed* output is unchanged by a
single symbol flip:

| Scenario | Wall time |
|---|---:|
| Config change, cold ccache | ~56 s |
| Config change, warm ccache, identical config | ~19 s |
| Config change, warm ccache, one-symbol diff | ~33 s |

Measured ccache statistics on a config-change rebuild: **81.6 % hit rate**
(867 hits / 196 misses of 1063 cacheable calls), of which **97 % were
preprocessed-mode hits**. Only the ~18 % of files actually gated by the changed
option recompile. A shared ccache volume on the runtime host accumulates across
all prior builds, so common configs converge toward the warm numbers.

The IDF compile flags already include `-fmacro-prefix-map=/project=.` and
`-fmacro-prefix-map=/opt/esp/idf=/IDF`, which normalize embedded paths. This is
what makes ccache hits and build-tree relocation (below) both work.

## Why "Prebuild Every Permutation" Is Infeasible

The feature surface is combinatorial: BLE × Wi-Fi × MQTT × WebSocket × IPv6 ×
TLS-mode × SoftAP × WPA3 × log-level × assertions × newlib-nano × flash-size ×
OTA … easily 2^10+ combinations, i.e. thousands of prebuilds per push. Storage
and CI time both make this impossible. Only app selection is cheap enough to
enumerate; features are not.

## Recommended Tiered Architecture

Do not ship fixed profiles. Compose the config from fragments, hash it, and let
cost tiers fall out:

- **Config = base fragment + selected feature fragments.** Keep a library:
  `sdkconfig.defaults` (base) + `features/<name>.defaults`. A user's selection
  becomes an ordered fragment list →
  `SDKCONFIG_DEFAULTS="sdkconfig.defaults;features/no-ble.defaults;…"` → the hash
  of the resolved config is the cache key.
- **Tier 0 — output cache:** key `sha(resolved-sdkconfig + app-selection + source-rev)`.
  Identical request → serve the stored bundle, **~0 s**.
- **Tier 1 — same config, different apps:** relink against that config's warm
  tree → **~4 s**.
- **Tier 2 — new config:** copy base tree, build with the shared ccache →
  **~20–35 s**. Fully arbitrary.

CI's job shrinks to: build a *few* warm trees (e.g. `full`, `minimal`) as Tier-1
seeds, seed the ccache with a handful of representative configs, and ship the
bundle + ccache seed. It does not enumerate permutations.

## CI Prebuild → EC2 Runtime Packaging (validated end-to-end)

The whole pipeline was run: prebuild → package → extract to a clean path with no
link to the source repo → build custom firmware in a fresh container from only
the packaged artifacts. It works.

### The Reuse Artifact Is the Ninja Tree, Not `out/lib`

`prebuild` copies component archives to `core/out/lib/*.a`, but **nothing consumes
them** — `link` runs a full `idf.py build`. The actual reuse comes from preserving
the `.build/dynamic` ninja tree (142 MB). Incremental relink against that tree is
what makes custom builds fast. `out/lib` is currently a dead artifact for the
fast-build path.

### Mount Contract (paths are container paths, not host paths)

The build tree bakes only container paths, so it relocates cleanly across
containers as long as this layout is reproduced:

| Container path | Source |
|---|---|
| `/opt/esp/idf` | Provided by the image (not in the bundle) |
| `/project` | `embedded/esp32/core` (source **plus `.build/dynamic`**) |
| `/repo` | Trimmed repo root: `embedded/` package (incl. `protocol/` + `platform/` C components referenced as `/repo/embedded/esp32/...`), plus `tooling/`, `linux/`, `pyproject.toml` for the CLI |

Run recipe:

```bash
docker run --rm \
  -e IN_ESP_IDF_DOCKER=1 -e HELIX_ESP32_ROOT=/project -e PYTHONPATH=/repo -e HOME=/tmp \
  -e IDF_CCACHE_ENABLE=1 -e CCACHE_DIR=/ccache \
  -v $BUNDLE:/repo:ro -v $REQUEST_COPY/core:/project -v $CCACHE:/ccache \
  -w /repo helix/esp-idf:release-v5.4-lean \
  python -m tooling.cli embedded esp32 link <app...>
```

### Bundle Manifest and Sizes

- Package = the three mounts above minus junk. **143 MB raw / 38 MB gzipped**,
  entirely `.build/dynamic` (142 MB); everything else is < 1 MB.
- Prune from `core/`: all `.build/*` except `dynamic`, and `out/{analysis,firmware,vscode}`.
- `out/lib` is not required for the relink path.

### Per-Request Isolation

Every `link` mutates the shared `.build/dynamic`; concurrent requests would clobber
each other. Validated pattern: mount the bundle **read-only** at `/repo`, give each
request its own copy of `core` at `/project`. The copy is trivially cheap
(`cp -a core` measured at **0.16 s** locally; `cp --reflink=auto` for CoW on
supporting filesystems). Output lands in the per-request dir; the bundle is untouched.

The produced bundle (`out/firmware/<selection>/`) is exactly what `flash.py` and
the web flasher consume: `bootloader.bin`, `partition-table.bin`,
`ota_data_initial.bin`, `esp32_firmware.bin`, `flash_args`, `flasher_args.json`,
`manifest.json`.

## Feature Gating Implemented (2026-07-04)

Before this work the transports were **unconditionally compiled and started** —
`app_main.c` includes and starts BLE/serial/WebSocket, with no `#ifdef` guards and
no Helix Kconfig symbols. This was proven: setting `CONFIG_BT_ENABLED=n` broke the
build with `fatal error: host/ble_gap.h: No such file or directory` and
`esp_bt.h: No such file or directory`, because the BLE header pulls NimBLE headers
directly. Feature toggles therefore require code guards, not just flags.

### What Was Added

- **Kconfig symbols** in `core/main/Kconfig.projbuild`, menu "Transports":
  `HELIX_TRANSPORT_SERIAL` (default y), `HELIX_TRANSPORT_BLE`
  (`depends on BT_ENABLED && BT_NIMBLE_ENABLED`), `HELIX_TRANSPORT_WEBSOCKET`
  (`depends on HTTPD_WS_SUPPORT`), `HELIX_TRANSPORT_MQTT` (default y).
- **`#if` guards** wrapping the five transport sources in `protocol/src/`
  (including their NimBLE / esp-mqtt / http-server includes), the transport start
  helpers and call sites in `app_main.c`, the MQTT validation path and
  `cloud_start_mqtt` in `cloud.c` (stub returns `ESP_ERR_NOT_SUPPORTED` when off),
  and the heartbeat publish + `health_start` in `health.c`.
- **Feature fragments** `core/features/{no-ble,no-mqtt,no-websocket}.defaults`.

Because the IDF flags include `-Wno-error=unused-variable`,
`-Wno-error=unused-but-set-variable`, and `-Wno-error=unused-function`, code left
unreferenced by a disabled transport is a warning, not a build failure — only
references to now-absent symbols must be guarded.

### Measured Savings (four-app selection, edited source)

| Build | App bin (bytes) | Saved vs full |
|---|---:|---:|
| full (all transports) | 1,209,536 | 0 |
| no-BLE (Bluetooth off) | 996,016 | 213,520 (17.7 %) |
| no-MQTT | 1,165,360 | 44,176 (3.7 %) |
| no-WebSocket | 1,186,368 | 23,168 (1.9 %) |
| serial-only (no BLE + MQTT + WebSocket) | 929,312 | 280,224 (23.2 %) |

The full build is **byte-identical** to the pre-change firmware (0x1274c0), i.e.
zero regression when all transports are enabled. Removing Bluetooth is by far the
largest single transport saving (~208 KB) and, critically, now builds where it
previously failed to compile.

## Known Gaps / Required Follow-ups

- **Wi-Fi is still always-on.** Gating it cascades into OTA, cloud, time-sync, and
  provisioning; it needs its own guarding pass before a no-network firmware is
  possible.
- **`link` takes only app names.** It needs a `--config`/`--profile` parameter to
  pass composed `SDKCONFIG_DEFAULTS`, and the build dir + outputs should be keyed
  by config-hash (`.build/<hash>/`, `out/firmware/<hash>/<selection>/`).
- **Flash-size is hardcoded.** `build.py::copy_firmware_outputs` writes
  `--flash_size 4MB` and fixed offsets; supporting 8/16 MB or a factory-only
  (larger app partition, no-OTA) layout requires deriving these from the selected
  partition table / `flasher_args.json`. The partition table is fixed at 4 MB with
  3 × 1.25 MB slots (`partitions_4mb.csv`).
- **Provenance is lost in the bundle.** Custom builds run without `.git`, so
  `source_revision()` yields `"revision": "unknown", "dirty": true`. CI must stamp
  the real commit into a bundle file that `link` reads.
- **`out/lib` is unused.** Either wire a link-only flow that consumes the prebuilt
  `.a` archives, or drop the copy step and rely solely on the `.build/dynamic` tree.

## Customization Surface to Expose

Grouped by axis, with approximate savings from the measurements above and in the
independent-optimization table:

- **Transports:** BLE (~208 KB, implemented), MQTT (~44 KB, implemented),
  WebSocket (~23 KB, implemented), Wi-Fi (follow-up), serial (always on).
- **Network:** IPv6 (~31 KB), SoftAP (~52 KB), WPA3/SAE/OWE (~33 KB),
  Wi-Fi enterprise (~0.6 KB).
- **TLS / certs:** client-only (~8 KB), CA bundle full vs common-Mozilla (~52 KB)
  vs provisioned-own-CA.
- **Size / diagnostics profile:** opt-size vs debug (~94 KB), assertions off
  (~69 KB), logs WARN (~12 KB), newlib-nano (~49 KB).
- **Flash size / partitions:** 4/8/16 MB; factory-only vs OTA layout.
- **OTA:** on / off.

Each maps to an sdkconfig fragment; the resolver composes base + selected
fragments into the `SDKCONFIG_DEFAULTS` list that keys the Tier-2 build.
