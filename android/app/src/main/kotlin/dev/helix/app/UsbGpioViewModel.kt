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
import dev.helix.transport.usbserial.UsbConnectionState
import dev.helix.transport.usbserial.UsbDeviceInfo
import dev.helix.transport.usbserial.UsbSerialTransportClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class UsbGpioUiState(
    val connectionState: UsbConnectionState = UsbConnectionState.Disconnected,
    val deviceInfo: UsbDeviceInfo? = null,
    val error: String? = null,
    val pinLevels: Map<Int, Int> = emptyMap(),
    val busyAction: String? = null,
    val log: List<PacketLogEntry> = emptyList(),
) {
    val connected: Boolean get() = connectionState == UsbConnectionState.Connected
}

/** Drives the ESP32 `gpio-control` service over the USB-serial transport (mirrors [BleGpioViewModel]). */
class UsbGpioViewModel(application: Application) : AndroidViewModel(application) {

    private val transport = UsbSerialTransportClient(application)
    private val client = HelixServiceClient(
        service = GpioControlContract.service,
        sender = { packet -> transport.send(packet) },
        timeoutMs = REQUEST_TIMEOUT_MS,
    )

    private val _ui = MutableStateFlow(UsbGpioUiState())
    val ui: StateFlow<UsbGpioUiState> = _ui.asStateFlow()

    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)
    private var logCounter = 0L

    init {
        transport.subscribe(HelixPacketHandler { packet -> client.receive(packet) })

        viewModelScope.launch {
            transport.status.collect { status ->
                _ui.update {
                    it.copy(
                        connectionState = status.connectionState,
                        deviceInfo = status.deviceInfo,
                        error = status.error ?: it.error,
                    )
                }
            }
        }

        client.subscribe { event ->
            appendLog(event.message)
            if (event.message.method == GpioControlContract.state.name) {
                runCatching { GpioControlContract.state.payload.parse(event.message.payload) }
                    .onSuccess(::applyPayload)
            }
        }
    }

    fun connect() {
        viewModelScope.launch {
            _ui.update { it.copy(error = null) }
            runCatching { transport.connect() }
                .onFailure { error -> _ui.update { it.copy(error = error.message ?: "USB connection failed.") } }
        }
    }

    fun disconnect() {
        transport.disconnect("manual disconnect")
        _ui.update { it.copy(pinLevels = emptyMap()) }
    }

    fun setPin(pin: Int, high: Boolean) {
        val action = "$pin:${if (high) "high" else "low"}"
        runRequest(action) {
            applyPayload(client.request(GpioControlContract.setGpio, SetGpioRequest(pin = pin, high = high)))
        }
    }

    fun refresh() {
        runRequest("refresh") {
            for (pin in TEST_PINS) {
                applyPayload(client.request(GpioControlContract.readGpio, ReadGpioRequest(pin = pin)))
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
            for (pinState in payload.pins) {
                levels[pinState.pin] = if (pinState.level == 0) 0 else 1
            }
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
        transport.disconnect("view model cleared")
    }

    private companion object {
        const val REQUEST_TIMEOUT_MS = 10_000L
        const val MAX_LOG_ENTRIES = 12
        val TEST_PINS = listOf(2, 16, 17, 23)
    }
}
