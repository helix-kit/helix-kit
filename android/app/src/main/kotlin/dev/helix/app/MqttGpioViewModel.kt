// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.helix.app.gpio.GpioControlContract
import dev.helix.app.gpio.GpioStatePayload
import dev.helix.app.gpio.ReadGpioRequest
import dev.helix.app.gpio.SetGpioRequest
import dev.helix.app.ui.PacketLogEntry
import dev.helix.protocol.core.HelixPacketHandler
import dev.helix.protocol.service.HelixMessage
import dev.helix.protocol.service.HelixServiceClient
import dev.helix.transport.mqtt.MqttConnectionState
import dev.helix.transport.mqtt.MqttGatewayOptions
import dev.helix.transport.mqtt.MqttGatewayTransportClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class MqttUiState(
    val connectionState: MqttConnectionState = MqttConnectionState.Disconnected,
    val gatewayUrl: String = MqttGatewayOptions.DEFAULT_GATEWAY_URL,
    val deviceId: String = "test-esp32",
    val error: String? = null,
    val pinLevels: Map<Int, Int> = emptyMap(),
    val busyAction: String? = null,
    val log: List<PacketLogEntry> = emptyList(),
) {
    val connected: Boolean get() = connectionState == MqttConnectionState.Connected
}

class MqttGpioViewModel(application: Application) : AndroidViewModel(application) {

    private val _ui = MutableStateFlow(MqttUiState())
    val ui: StateFlow<MqttUiState> = _ui.asStateFlow()

    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)
    private var logCounter = 0L

    private var transport: MqttGatewayTransportClient? = null
    private var client: HelixServiceClient? = null
    private var statusJob: Job? = null

    fun onGatewayUrlChange(value: String) = _ui.update { it.copy(gatewayUrl = value) }
    fun onDeviceIdChange(value: String) = _ui.update { it.copy(deviceId = value) }

    fun connect() {
        disconnect()
        val current = _ui.value
        val mqtt = MqttGatewayTransportClient(
            MqttGatewayOptions(deviceId = current.deviceId.trim(), gatewayUrl = current.gatewayUrl.trim()),
        )
        val service = HelixServiceClient(
            service = GpioControlContract.service,
            sender = { packet -> mqtt.send(packet) },
            timeoutMs = REQUEST_TIMEOUT_MS,
        )
        mqtt.subscribe(HelixPacketHandler { packet -> service.receive(packet) })
        service.subscribe { event ->
            appendLog(event.message)
            if (event.message.method == GpioControlContract.state.name) {
                runCatching { GpioControlContract.state.payload.parse(event.message.payload) }
                    .onSuccess(::applyPayload)
            }
        }
        transport = mqtt
        client = service

        statusJob = viewModelScope.launch {
            mqtt.status.collect { status ->
                _ui.update {
                    it.copy(connectionState = status.connectionState, error = status.error ?: it.error)
                }
            }
        }
        viewModelScope.launch {
            _ui.update { it.copy(error = null) }
            runCatching { mqtt.connect() }
                .onFailure { error -> _ui.update { it.copy(error = error.message ?: "MQTT connection failed.") } }
        }
    }

    fun disconnect() {
        transport?.disconnect("manual disconnect")
        statusJob?.cancel()
        statusJob = null
        transport = null
        client = null
        _ui.update { it.copy(connectionState = MqttConnectionState.Disconnected, pinLevels = emptyMap()) }
    }

    fun setPin(pin: Int, high: Boolean) {
        val action = "$pin:${if (high) "high" else "low"}"
        runRequest(action) {
            val service = client ?: return@runRequest
            applyPayload(service.request(GpioControlContract.setGpio, SetGpioRequest(pin = pin, high = high)))
        }
    }

    fun refresh() {
        runRequest("refresh") {
            val service = client ?: return@runRequest
            for (pin in GpioTestPins.ALL) {
                applyPayload(service.request(GpioControlContract.readGpio, ReadGpioRequest(pin = pin)))
            }
        }
    }

    private fun runRequest(action: String, block: suspend () -> Unit) {
        if (_ui.value.busyAction != null) return
        viewModelScope.launch {
            _ui.update { it.copy(busyAction = action, error = null) }
            runCatching { block() }
                .onFailure { error -> _ui.update { it.copy(error = error.message ?: "GPIO request failed.") } }
            _ui.update { it.copy(busyAction = null) }
        }
    }

    private fun applyPayload(payload: GpioStatePayload) {
        _ui.update { state ->
            val levels = state.pinLevels.toMutableMap()
            for (pinState in payload.pins) levels[pinState.pin] = if (pinState.level == 0) 0 else 1
            state.copy(pinLevels = levels)
        }
    }

    private fun appendLog(message: HelixMessage) {
        val entry = PacketLogEntry(
            id = logCounter++,
            timestamp = timeFormat.format(Date()),
            json = dev.helix.protocol.core.JsonPacketCodec.json.encodeToString(message),
        )
        _ui.update { it.copy(log = (listOf(entry) + it.log).take(MAX_LOG_ENTRIES)) }
    }

    override fun onCleared() {
        disconnect()
    }

    private companion object {
        const val REQUEST_TIMEOUT_MS = 10_000L
        const val MAX_LOG_ENTRIES = 12
    }
}

object GpioTestPins {
    val ALL = listOf(2, 16, 17, 23)
}
