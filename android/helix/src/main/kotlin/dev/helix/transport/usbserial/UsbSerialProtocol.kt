// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.usbserial

/**
 * Framing constants for the Helix ESP32 serial command transport. These match
 * `embedded/esp32/transports/include/helix_transport_serial.h` and the Python
 * host driver (`tooling/device/serial.py`), so an ESP32 running the Helix
 * firmware is reachable over USB from the phone exactly as it is from the CLI.
 *
 * The wire framing is newline-delimited text on UART0: the host sends
 * `SERVICE <compact-json-packet>\n`; the device replies with
 * `HELIX_RESPONSE <json>\n` (both responses and async service messages) and
 * signals dispatch failures with `HELIX_ERROR <name>\n`. UART0 also carries
 * ESP-IDF log lines, which are ignored.
 */
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
    /**
     * Milliseconds to drain and discard boot/log noise after the port opens
     * before the transport is considered ready. Mirrors the CLI `--boot-wait`.
     */
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
