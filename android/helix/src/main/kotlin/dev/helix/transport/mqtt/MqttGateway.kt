// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.mqtt

/** Connection options for [MqttGatewayTransportClient] (Helix packets over WebSocket to the MQTT gateway). */
data class MqttGatewayOptions(
    val deviceId: String,
    val gatewayUrl: String = DEFAULT_GATEWAY_URL,
    val token: String? = null,
) {
    companion object {
        const val DEFAULT_GATEWAY_PORT = 4010
        const val DEFAULT_GATEWAY_PATH = "/ws"

        // 10.0.2.2 is the host loopback from the Android emulator; override for device/JVM.
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
