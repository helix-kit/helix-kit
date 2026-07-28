// Blog seed manifest; each `file` is an MDX body under ./posts/, seeded newest-first (publishedAt spaced backwards from BASE_DATE in seed.mjs).
export const posts = [
  {
    slug: 'flash-esp32-from-your-browser-with-web-serial',
    file: 'flash-esp32-from-your-browser-with-web-serial.mdx',
    title: 'Flash an ESP32 From Your Browser With the Web Serial API',
    description:
      'No local toolchain required — use esptool-js and the Web Serial API to erase, write, and verify ESP32 firmware straight from a Chromium browser.',
    tags: ['ESP32', 'Web Serial', 'Firmware', 'Browser'],
    keywords: ['esptool-js', 'web serial api', 'flash esp32', 'browser flashing', 'esp32 firmware'],
  },
  {
    slug: 'talk-to-an-esp32-over-ble-with-web-bluetooth',
    file: 'talk-to-an-esp32-over-ble-with-web-bluetooth.mdx',
    title: 'Talk to an ESP32 Over BLE With Web Bluetooth',
    description:
      'Build a GATT server on an ESP32 and connect to it from a web page using the Web Bluetooth API — services, characteristics, and live notifications.',
    tags: ['ESP32', 'BLE', 'Web Bluetooth', 'Browser'],
    keywords: ['web bluetooth', 'esp32 ble', 'gatt server', 'ble characteristics', 'notifications'],
  },
  {
    slug: 'build-an-android-ble-client-with-kotlin-and-compose',
    file: 'build-an-android-ble-client-with-kotlin-and-compose.mdx',
    title: 'Build an Android BLE Client With Kotlin and Jetpack Compose',
    description:
      'Scan, connect, and exchange data with a BLE peripheral from Android — runtime permissions, GATT callbacks, and a clean Compose UI over a coroutine wrapper.',
    tags: ['Android', 'BLE', 'Kotlin', 'Jetpack Compose'],
    keywords: ['android ble', 'kotlin bluetooth', 'jetpack compose ble', 'gatt android', 'ble scanning'],
  },
  {
    slug: 'getting-started-with-esp-idf',
    file: 'getting-started-with-esp-idf.mdx',
    title: 'Getting Started With ESP-IDF: Build and Flash Your First Firmware',
    description:
      'Install the Espressif IoT Development Framework, understand the project layout, and build, flash, and monitor a real ESP32 app from the command line.',
    tags: ['ESP32', 'ESP-IDF', 'Firmware', 'C'],
    keywords: ['esp-idf', 'esp32 development', 'idf.py', 'cmake esp32', 'freertos'],
  },
  {
    slug: 'connect-your-esp32-to-mqtt-with-mosquitto',
    file: 'connect-your-esp32-to-mqtt-with-mosquitto.mdx',
    title: 'Connect Your ESP32 to MQTT With Mosquitto',
    description:
      'Stand up a Mosquitto broker, publish telemetry from an ESP32, subscribe to commands, and handle reconnects, QoS, and last will the right way.',
    tags: ['ESP32', 'MQTT', 'Mosquitto', 'IoT'],
    keywords: ['mqtt esp32', 'mosquitto broker', 'publish subscribe', 'iot telemetry', 'qos'],
  },
  {
    slug: 'wifi-provisioning-for-esp32-over-ble',
    file: 'wifi-provisioning-for-esp32-over-ble.mdx',
    title: 'Wi-Fi Provisioning for the ESP32 Over BLE',
    description:
      'Ship a headless device with no hardcoded credentials — accept Wi-Fi SSID and password over a BLE characteristic and persist them in NVS.',
    tags: ['ESP32', 'BLE', 'Provisioning', 'Wi-Fi'],
    keywords: ['wifi provisioning', 'esp32 ble provisioning', 'nvs storage', 'headless setup', 'credentials'],
  },
  {
    slug: 'over-the-air-ota-firmware-updates-on-the-esp32',
    file: 'over-the-air-ota-firmware-updates-on-the-esp32.mdx',
    title: 'Over-the-Air (OTA) Firmware Updates on the ESP32',
    description:
      'Understand the dual-app partition scheme and roll out a new firmware image to a fielded ESP32 over HTTPS — with rollback protection.',
    tags: ['ESP32', 'OTA', 'Firmware', 'Updates'],
    keywords: ['esp32 ota', 'firmware update', 'ota partition', 'rollback', 'esp_https_ota'],
  },
  {
    slug: 'secure-device-to-cloud-with-mtls-and-step-ca',
    file: 'secure-device-to-cloud-with-mtls-and-step-ca.mdx',
    title: 'Secure Device-to-Cloud With mTLS and a Private CA',
    description:
      'Run your own certificate authority with step-ca, issue client certificates to devices, and require mutual TLS on your MQTT broker and HTTP gateway.',
    tags: ['Security', 'mTLS', 'PKI', 'IoT'],
    keywords: ['mutual tls', 'step-ca', 'client certificates', 'private ca', 'mqtt tls'],
  },
  {
    slug: 'build-a-minimal-linux-image-for-your-edge-device',
    file: 'build-a-minimal-linux-image-for-your-edge-device.mdx',
    title: 'Build a Minimal Linux Image for Your Edge Device With debootstrap',
    description:
      'Skip the bloated vendor image — assemble a lean Debian rootfs with debootstrap, add a systemd service, and boot it in QEMU before it touches hardware.',
    tags: ['Linux', 'Edge', 'debootstrap', 'systemd'],
    keywords: ['debootstrap', 'minimal linux', 'edge device', 'rootfs', 'systemd service'],
  },
  {
    slug: 'peer-to-peer-browser-to-device-with-webrtc',
    file: 'peer-to-peer-browser-to-device-with-webrtc.mdx',
    title: 'Peer-to-Peer Browser-to-Device With WebRTC Data Channels',
    description:
      'Bypass the relay: open a direct WebRTC data channel between a browser and a device agent, with a tiny signaling server and STUN/TURN for NAT traversal.',
    tags: ['WebRTC', 'P2P', 'Networking', 'Go'],
    keywords: ['webrtc data channel', 'peer to peer', 'pion webrtc', 'nat traversal', 'stun turn'],
  },
];
