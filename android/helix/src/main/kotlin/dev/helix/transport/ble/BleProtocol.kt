// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.ble

import java.util.UUID

/** Helix ESP32 BLE GATT identifiers (match the web `@helix/transport-ble` constants). */
object HelixBle {
    val SERVICE_UUID: UUID = UUID.fromString("8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0001")
    val COMMAND_UUID: UUID = UUID.fromString("8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0002")
    val RESPONSE_UUID: UUID = UUID.fromString("8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0003")
    val INFO_UUID: UUID = UUID.fromString("8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0004")

    /** Client Characteristic Configuration Descriptor (standard). */
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    const val DEVICE_NAME_PREFIX: String = "Helix ESP32"
    const val DEFAULT_MAX_COMMAND_BYTES: Int = 700
}

/** Options for [BleTransportClient]. Defaults target the Helix ESP32 firmware. */
data class BleTransportOptions(
    val serviceUuid: UUID = HelixBle.SERVICE_UUID,
    val commandUuid: UUID = HelixBle.COMMAND_UUID,
    val responseUuid: UUID = HelixBle.RESPONSE_UUID,
    val infoUuid: UUID? = HelixBle.INFO_UUID,
    val deviceNamePrefix: String = HelixBle.DEVICE_NAME_PREFIX,
    val maxCommandBytes: Int = HelixBle.DEFAULT_MAX_COMMAND_BYTES,
)

/** Parsed device descriptor from the BLE info characteristic. */
data class BleDeviceInfo(
    val deviceId: String? = null,
    val mtuHint: Int? = null,
    val profileId: String? = null,
    val serviceUuid: String? = null,
    val raw: String,
)

enum class BleConnectionState { Disconnected, Connecting, Connected }

/** Snapshot of the BLE transport's observable state. */
data class BleTransportStatus(
    val connectionState: BleConnectionState = BleConnectionState.Disconnected,
    val deviceName: String? = null,
    val deviceInfo: BleDeviceInfo? = null,
    val error: String? = null,
)
