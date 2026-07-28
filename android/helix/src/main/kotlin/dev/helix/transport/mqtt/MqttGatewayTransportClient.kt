// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.mqtt

import dev.helix.protocol.core.HelixPacket
import dev.helix.protocol.core.HelixPacketHandler
import dev.helix.protocol.core.HelixProtocolError
import dev.helix.protocol.core.HelixTransport
import dev.helix.protocol.core.JsonPacketCodec
import dev.helix.protocol.service.isServiceMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/**
 * WebSocket-to-MQTT-gateway implementation of [HelixTransport]. It connects to
 * the Helix gateway's `/ws` endpoint with a `deviceId` (and optional `token`),
 * and the gateway routes packets to and from the device over MQTT. Behaviour
 * mirrors the web `MqttGatewayTransportClient`.
 */
class MqttGatewayTransportClient(
    private val options: MqttGatewayOptions,
) : HelixTransport {

    private val client = defaultClient
    private val resolvedUrl = resolveGatewayUrl(options)
    private val handlers = CopyOnWriteArrayList<HelixPacketHandler>()

    private val _status = MutableStateFlow(MqttTransportStatus(gatewayUrl = resolvedUrl))
    val status: StateFlow<MqttTransportStatus> = _status.asStateFlow()

    @Volatile private var webSocket: WebSocket? = null
    @Volatile private var openResult: CompletableDeferred<Unit>? = null

    /** Opens the gateway WebSocket, suspending until connected or failed. */
    suspend fun connect() {
        if (_status.value.connectionState != MqttConnectionState.Disconnected) return

        _status.value = MqttTransportStatus(
            connectionState = MqttConnectionState.Connecting,
            gatewayUrl = resolvedUrl,
        )
        val result = CompletableDeferred<Unit>()
        openResult = result

        val request = Request.Builder().url(resolvedUrl).build()
        webSocket = client.newWebSocket(request, listener)

        try {
            withTimeout(CONNECT_TIMEOUT_MS) { result.await() }
        } catch (timeout: TimeoutCancellationException) {
            disconnect("connection timed out")
            throw HelixProtocolError("Timed out connecting to the MQTT gateway.")
        } finally {
            openResult = null
        }
    }

    override suspend fun send(packet: HelixPacket) {
        val socket = webSocket
        if (socket == null || _status.value.connectionState != MqttConnectionState.Connected) {
            throw HelixProtocolError("MQTT gateway WebSocket is not connected.")
        }
        if (!socket.send(JsonPacketCodec.encode(packet))) {
            throw HelixProtocolError("MQTT gateway WebSocket rejected the packet.")
        }
    }

    override fun subscribe(handler: HelixPacketHandler): () -> Unit {
        handlers.add(handler)
        return { handlers.remove(handler) }
    }

    override suspend fun close() {
        disconnect("transport closed")
    }

    /** Closes the gateway WebSocket. */
    fun disconnect(reason: String = "manual disconnect") {
        val socket = webSocket
        webSocket = null
        runCatching { socket?.close(NORMAL_CLOSE_CODE, reason) }
        openResult?.completeExceptionally(HelixProtocolError(reason))
        openResult = null
        _status.value = MqttTransportStatus(
            connectionState = MqttConnectionState.Disconnected,
            gatewayUrl = resolvedUrl,
        )
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            _status.value = MqttTransportStatus(
                connectionState = MqttConnectionState.Connected,
                gatewayUrl = resolvedUrl,
            )
            openResult?.complete(Unit)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val packet = try {
                JsonPacketCodec.decode(text)
            } catch (error: Exception) {
                emitError("MQTT gateway emitted invalid Helix JSON.")
                return
            }
            if (!isServiceMessage(packet.message)) return
            for (handler in handlers) {
                handler.handle(packet)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (this@MqttGatewayTransportClient.webSocket !== webSocket &&
                this@MqttGatewayTransportClient.webSocket != null
            ) {
                return
            }
            this@MqttGatewayTransportClient.webSocket = null
            val message = t.message ?: "MQTT gateway WebSocket connection failed."
            val result = openResult
            if (result != null && !result.isCompleted) {
                result.completeExceptionally(HelixProtocolError(message))
            }
            _status.value = MqttTransportStatus(
                connectionState = MqttConnectionState.Disconnected,
                gatewayUrl = resolvedUrl,
                error = message,
            )
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (this@MqttGatewayTransportClient.webSocket === webSocket) {
                this@MqttGatewayTransportClient.webSocket = null
            }
            _status.value = MqttTransportStatus(
                connectionState = MqttConnectionState.Disconnected,
                gatewayUrl = resolvedUrl,
            )
        }
    }

    private fun emitError(message: String) {
        _status.value = _status.value.copy(error = message)
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val NORMAL_CLOSE_CODE = 1000

        val defaultClient: OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .build()

        /** Adds `deviceId`/`token` query params, converting ws(s):// to http(s)://. */
        fun resolveGatewayUrl(options: MqttGatewayOptions): String {
            val httpUrl = options.gatewayUrl
                .replaceFirst("ws://", "http://")
                .replaceFirst("wss://", "https://")
                .toHttpUrl()
                .newBuilder()
                .addQueryParameter("deviceId", options.deviceId)
                .apply {
                    val token = options.token
                    if (!token.isNullOrEmpty()) addQueryParameter("token", token)
                }
                .build()
            return httpUrl.toString()
        }
    }
}
