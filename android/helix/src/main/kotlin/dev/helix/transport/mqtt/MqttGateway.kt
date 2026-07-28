// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.mqtt

/**
 * Connection options for [MqttGatewayTransportClient]. Mirrors the web
 * `MqttGatewayTransportClientOptions`: the client speaks Helix packets over a
 * WebSocket to the gateway, which bridges them to/from the MQTT broker on
 * `helix/device/<deviceId>/in` and `.../out`.
 */
data class MqttGatewayOptions(
    val deviceId: String,
    val gatewayUrl: String = DEFAULT_GATEWAY_URL,
    val token: String? = null,
) {
    companion object {
        const val DEFAULT_GATEWAY_PORT = 4010
        const val DEFAULT_GATEWAY_PATH = "/ws"

        /**
         * Default gateway URL. `10.0.2.2` is the host loopback as seen from the
         * Android emulator; override for a device or a JVM run (`127.0.0.1`).
         */
        const val DEFAULT_GATEWAY_URL = "ws://10.0.2.2:$DEFAULT_GATEWAY_PORT$DEFAULT_GATEWAY_PATH"
    }
}

enum class MqttConnectionState { Disconnected, Connecting, Connected }

/** Snapshot of the MQTT-gateway transport's observable state. */
data class MqttTransportStatus(
    val connectionState: MqttConnectionState = MqttConnectionState.Disconnected,
    val gatewayUrl: String? = null,
    val error: String? = null,
)
