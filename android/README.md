<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Helix Android

The Android client for Helix devices. The protocol layers and transports ship as
one installable SDK module (`:helix`), consumed by the `:app` — mirroring the
web workspace's "installable package + main app" split.

## Modules

| Module  | Kind                | Mirrors (web)                          | Purpose |
| ------- | ------------------- | -------------------------------------- | ------- |
| `helix` | Android library     | `@helix/protocol` | The Helix Android SDK — one module, four packages (below) |
| `app`   | Android application | `web/apps/helix`                       | Compose app: home chooser → BLE / MQTT GPIO screens, wiring transport → typed service client → UI |

The `:helix` SDK is a single module (published as `dev.helix:helix`) containing:

| Package                       | Mirrors (web)             | Purpose |
| ----------------------------- | ------------------------- | ------- |
| `dev.helix.protocol.core`     | `@helix/protocol`    | `HelixPacket`, JSON codec, request registry + timeouts, request-id factory, transport interface |
| `dev.helix.protocol.service`  | `@helix/protocol/service` | `HelixMessage`, contract DSL (`method`/`message`/`schema`), `HelixServiceClient` |
| `dev.helix.transport.ble`     | `@helix/protocol/ble`    | Android BLE (GATT) transport to a Helix ESP32, matching the same service/characteristic UUIDs |
| `dev.helix.transport.mqtt`    | `@helix/protocol/mqtt`   | WebSocket→MQTT-gateway transport (OkHttp) to `ws://host/ws?deviceId=…`; the gateway bridges to the broker on `helix/device/<id>/in\|out` |

The protocol and MQTT code is plain Kotlin (it runs on the JVM in local unit
tests); BLE needs the Android platform, so the whole SDK ships as one Android
library. The plan is to collapse the web `@helix/protocol`
packages into a single package the same way.

## Protocol parity with the web client

- Wire packet: `{ "message": { "service", "method", "payload?" }, "requestId?" }`,
  JSON-encoded — identical to the web `jsonPacketCodec`.
- Requests correlate by `requestId`; async device messages carry no `requestId`.
- BLE service/characteristic UUIDs and the `Helix ESP32` name prefix match
  `HELIX_ESP32_BLE_*` in `@helix/protocol/ble`, so the same firmware works with
  either client.

## Build

The project uses the Gradle wrapper. It expects an Android SDK (set in
`local.properties`) and pins the Gradle daemon to a Java 17+ JVM in
`gradle.properties` (`org.gradle.java.home`) — adjust that path for your machine.

```bash
cd android
./gradlew :helix:testDebugUnitTest    # SDK unit + MQTT integration tests
./gradlew :app:assembleDebug          # debug APK
./gradlew :helix:publishToMavenLocal  # publish the SDK (dev.helix:helix)
```

## Runtime notes

- BLE requires `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` at runtime on Android 12+
  (contributed by the `:helix` SDK manifest); the app requests them before
  scanning. On older versions it requests `ACCESS_FINE_LOCATION`.
- The GPIO screen mirrors the web BLE GPIO test page: connect, toggle test pins
  (2, 16, 17, 23) or a custom pin, refresh state, and watch the packet log.

## MQTT transport

The `dev.helix.transport.mqtt` package connects over a WebSocket to the Helix
gateway, which bridges Helix packets to/from the MQTT broker — the same model as
the web `@helix/protocol/mqtt`. The app's **home screen offers both BLE GPIO and MQTT
GPIO**; the MQTT screen mirrors the web mqtt-gpio-test page (gateway URL +
device ID, connect, toggle pins, packet log).

### End-to-end test

The transport is verified against the **real appliance gateway** (mosquitto +
helix-server) with the shared gpio-control device simulator — no bespoke rig.
The check lives in the Python e2e suite and runs the SDK's own Gradle
integration test as the client:

```bash
uv run helix e2e run -k android_mqtt
```

This boots the appliance, provisions a device, starts the gpio simulator
(`tests/e2e/_gateway.py` `gpio_device_session`), then drives
`:helix`'s `MqttGatewayIntegrationTest` against `ws://127.0.0.1:24000/ws` and
asserts the device saw the client's commands. The test skips when the Android
SDK isn't configured.

The Gradle integration test also runs standalone against any Helix gateway
(passed as a Gradle property, or `HELIX_MQTT_GATEWAY_URL`); with neither set it
skips, so `./gradlew check` stays green without a gateway:

```bash
./gradlew :helix:testDebugUnitTest -PmqttGatewayUrl=ws://127.0.0.1:24000/ws -PmqttDeviceId=e2e-device-1
```

On an emulator, reach the host appliance via `adb reverse tcp:24000 tcp:24000`
and pass `-Pandroid.testInstrumentationRunnerArguments.gatewayUrl=ws://127.0.0.1:24000/ws`
to `:app:connectedDebugAndroidTest`.

## Roadmap

USB-serial (via OTG) and ESP32 flashing are not yet ported; add them as sibling
`transport-*` modules to keep parity with the web workspace.
