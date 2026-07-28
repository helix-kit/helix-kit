<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

The plan is to make a complete 360 system for edge and embedded IOT devices.

Components for the Helix System:
    - Secure Linux Based OS for x86 and arm platforms, like Jetson Nano, Raspberry Pi, and x86 Desktops.
        - Very minimal OS with limited set of libraries, all optimized for the particular use-case, no bloat
        - Secure Shell access to end users
        - Fully manageable over MQTTs #
        - Runtime Manager, Cloud Comm, and other device services for core utilities. #
        - Platform specific apps, like AI/ML for Jetson, IoT apps for Raspberry Pi etc.
        - Kiosk Mode
    - Firmware for embedded devices ESP32 for now, using esp-idf as base, with support for 
        - OTA #
        - MQTT/BLE/Serial Communication Layer #
        - Secure MQTTs Certs Provisioning #
        - Visual flow editor that compiles to device firmware via UI editor
        - ESP32 Flash Utility via Cloud UI #
    - Cloud Platform
        - Core Framework
            - Flow Editor #
            - Firmware flasher #
            - BLE and WebSerial for talking with embedded devices directly, and linux devices also
            - Shared communication protocol layer #
            - Event based flow triggers and notifications system #
            - Single gateway service that sits between users and edge devices, and communicates over MQTTs #
            - Vercel ChatSDK support for Bots that sits in user's chat apps, and talk to devices
            - JSON Rendered PDF and Email Reporting Infra
            - Package release and OTA support for various devices, with CI/CD support #
            - Core UI templates for the core services on each platform #
        - Actual App
            - NextJS Based #
            - Drizzle/Postgresql for DB #
            - Kafka for message broker #
            - Mosquitto for MQTTs #
            - OpenFGA for auth #
    - Appliance for cloud platform
        - Package everything in the cloud setup into a single docker container, that can be installed on-premise infra of any customer #
        - Should be lightweight and fully feature rich, with everything included. #
