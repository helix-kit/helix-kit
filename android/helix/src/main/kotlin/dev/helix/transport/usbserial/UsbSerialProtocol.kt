// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.usbserial

/** Framing constants for the Helix ESP32 serial command transport (newline-delimited UART0). */
object HelixSerial {
    const val INPUT_PREFIX: String = "SERVICE "
    const val OUTPUT_PREFIX: String = "HELIX_RESPONSE "
    const val ERROR_PREFIX: String = "HELIX_ERROR "

    const val DEFAULT_BAUD_RATE: Int = 115_200

    /** Silicon Labs CP210x — the bridge on the reference ESP32 dev board. */
    const val VID_SILICON_LABS: Int = 0x10C4

    /** WCH CH340/CH341 — the other common ESP32 dev-board bridge. */
    const val VID_WCH: Int = 0x1A86

    /** FTDI FT232 family. */
    const val VID_FTDI: Int = 0x0403

    /** Espressif native USB (ESP32-S2/S3/C3 CDC-ACM). */
    const val VID_ESPRESSIF: Int = 0x303A
}

/** Options for [UsbSerialTransportClient]. Defaults target the Helix ESP32. */
data class UsbSerialTransportOptions(
    val baudRate: Int = HelixSerial.DEFAULT_BAUD_RATE,
    /** Serial write timeout in milliseconds. */
    val writeTimeoutMs: Int = 2_000,
    /** Milliseconds to drain boot/log noise after the port opens before ready. */
    val settleMs: Long = 300,
)

/** Identifies the attached USB serial adapter (best-effort, from USB metadata). */
data class UsbDeviceInfo(
    val productName: String? = null,
    val vendorId: Int = 0,
    val productId: Int = 0,
    val driverName: String? = null,
) {
    /** Human-readable label, e.g. "CP2102 USB to UART Bridge". */
    val label: String
        get() = productName ?: driverName ?: String.format("USB %04x:%04x", vendorId, productId)
}

enum class UsbConnectionState { Disconnected, Connecting, Connected }

/** Snapshot of the USB serial transport's observable state. */
data class UsbTransportStatus(
    val connectionState: UsbConnectionState = UsbConnectionState.Disconnected,
    val deviceInfo: UsbDeviceInfo? = null,
    val error: String? = null,
)
