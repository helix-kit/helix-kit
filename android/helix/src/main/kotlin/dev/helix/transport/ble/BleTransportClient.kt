// SPDX-License-Identifier: AGPL-3.0-only
@file:SuppressLint("MissingPermission")

package dev.helix.transport.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Build
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Android BLE (GATT) implementation of [HelixTransport]. It scans for a Helix
 * ESP32, connects, enables response notifications, and moves [HelixPacket]
 * values over the command/response characteristics. Behaviour mirrors the web
 * `@helix/transport-ble` client.
 *
 * Callers must hold the runtime BLE permissions (BLUETOOTH_SCAN /
 * BLUETOOTH_CONNECT on API 31+, location on older) before calling [connect].
 */
class BleTransportClient(
    context: Context,
    private val options: BleTransportOptions = BleTransportOptions(),
) : HelixTransport {

    private val appContext = context.applicationContext
    private val handlers = CopyOnWriteArrayList<HelixPacketHandler>()

    private val _status = MutableStateFlow(BleTransportStatus())
    val status: StateFlow<BleTransportStatus> = _status.asStateFlow()

    private val writeMutex = Mutex()

    @Volatile private var bluetoothGatt: BluetoothGatt? = null
    @Volatile private var commandCharacteristic: BluetoothGattCharacteristic? = null
    @Volatile private var connectResult: CompletableDeferred<Unit>? = null
    @Volatile private var writeCompletion: CompletableDeferred<Unit>? = null
    @Volatile private var pendingDeviceName: String? = null
    @Volatile private var scanning = false

    /** Scans for and connects to a Helix ESP32, suspending until ready or error. */
    suspend fun connect() {
        if (_status.value.connectionState != BleConnectionState.Disconnected) return

        val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (adapter == null) {
            emitError("Bluetooth is not available on this device.")
            return
        }
        if (!adapter.isEnabled) {
            emitError("Bluetooth is turned off.")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            emitError("Bluetooth LE scanning is unavailable.")
            return
        }

        _status.value = BleTransportStatus(connectionState = BleConnectionState.Connecting)
        val result = CompletableDeferred<Unit>()
        connectResult = result

        scanning = true
        scanner.startScan(scanCallback)
        try {
            withTimeout(CONNECT_TIMEOUT_MS) { result.await() }
        } catch (timeout: TimeoutCancellationException) {
            stopScan(scanner)
            teardownGatt()
            emitError("Timed out finding a Helix device.")
        } catch (error: Throwable) {
            stopScan(scanner)
            teardownGatt()
            emitError(error.message ?: "BLE connection failed.")
        } finally {
            stopScan(scanner)
            connectResult = null
        }
    }

    override suspend fun send(packet: HelixPacket) {
        val bytes = JsonPacketCodec.encode(packet).toByteArray(Charsets.UTF_8)
        if (bytes.size > options.maxCommandBytes) {
            throw HelixProtocolError(
                "BLE packet is ${bytes.size} bytes; keep it under ${options.maxCommandBytes} bytes.",
            )
        }
        writeMutex.withLock {
            val gatt = bluetoothGatt ?: throw HelixProtocolError("BLE transport is not connected.")
            val command = commandCharacteristic
                ?: throw HelixProtocolError("BLE command characteristic is not available.")
            val completion = CompletableDeferred<Unit>()
            writeCompletion = completion
            val started = writeCommand(gatt, command, bytes)
            if (!started) {
                writeCompletion = null
                throw HelixProtocolError("BLE write could not be started.")
            }
            try {
                withTimeout(WRITE_TIMEOUT_MS) { completion.await() }
            } finally {
                writeCompletion = null
            }
        }
    }

    override fun subscribe(handler: HelixPacketHandler): () -> Unit {
        handlers.add(handler)
        return { handlers.remove(handler) }
    }

    override suspend fun close() {
        disconnect("transport closed")
    }

    /** Disconnects and releases the GATT connection. */
    fun disconnect(reason: String = "disconnected") {
        teardownGatt()
        connectResult?.completeExceptionally(HelixProtocolError(reason))
        connectResult = null
        _status.value = BleTransportStatus(connectionState = BleConnectionState.Disconnected)
    }

    // --- scanning ---------------------------------------------------------

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!scanning) return
            val device = result.device
            val name = device.name ?: result.scanRecord?.deviceName
            val advertisesService = result.scanRecord?.serviceUuids
                ?.any { it.uuid == options.serviceUuid } == true
            val matchesName = name?.startsWith(options.deviceNamePrefix) == true
            if (!advertisesService && !matchesName) return

            scanning = false
            pendingDeviceName = name ?: device.address
            bluetoothGatt = device.connectGatt(appContext, false, gattCallback)
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            connectResult?.completeExceptionally(HelixProtocolError("BLE scan failed ($errorCode)."))
        }
    }

    private fun stopScan(scanner: android.bluetooth.le.BluetoothLeScanner?) {
        if (!scanning) return
        scanning = false
        runCatching { scanner?.stopScan(scanCallback) }
    }

    // --- GATT callback ----------------------------------------------------

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothGatt.STATE_CONNECTED -> {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failConnect("BLE connection error ($status).")
                        return
                    }
                    if (!gatt.requestMtu(REQUESTED_MTU)) {
                        gatt.discoverServices()
                    }
                }

                BluetoothGatt.STATE_DISCONNECTED -> {
                    teardownGatt()
                    val result = connectResult
                    if (result != null && !result.isCompleted) {
                        result.completeExceptionally(HelixProtocolError("Device disconnected."))
                    } else {
                        _status.value = BleTransportStatus(connectionState = BleConnectionState.Disconnected)
                    }
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnect("BLE service discovery failed ($status).")
                return
            }
            val service = gatt.getService(options.serviceUuid)
            if (service == null) {
                failConnect("Helix BLE service not found on device.")
                return
            }
            commandCharacteristic = service.getCharacteristic(options.commandUuid)
            val response = service.getCharacteristic(options.responseUuid)
            if (commandCharacteristic == null || response == null) {
                failConnect("Helix BLE characteristics not found on device.")
                return
            }
            gatt.setCharacteristicNotification(response, true)
            val cccd = response.getDescriptor(HelixBle.CCCD_UUID)
            if (cccd == null) {
                // No CCCD: proceed without notifications negotiation.
                readInfoOrFinish(gatt, service)
                return
            }
            writeDescriptor(gatt, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        }

        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int,
        ) {
            val service = gatt.getService(options.serviceUuid) ?: return
            readInfoOrFinish(gatt, service)
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            if (characteristic.uuid != options.commandUuid) return
            val completion = writeCompletion ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                completion.complete(Unit)
            } else {
                completion.completeExceptionally(HelixProtocolError("BLE write failed ($status)."))
            }
        }

        // API 33+ delivers bytes directly.
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            handleResponse(characteristic, value)
        }

        @Deprecated("Kept for API < 33", ReplaceWith(""))
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            @Suppress("DEPRECATION")
            handleResponse(characteristic, characteristic.value ?: ByteArray(0))
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) {
            if (characteristic.uuid == options.infoUuid) {
                finishConnect(parseDeviceInfo(String(value, Charsets.UTF_8)))
            }
        }

        @Deprecated("Kept for API < 33", ReplaceWith(""))
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            if (characteristic.uuid == options.infoUuid) {
                @Suppress("DEPRECATION")
                val raw = String(characteristic.value ?: ByteArray(0), Charsets.UTF_8)
                finishConnect(parseDeviceInfo(raw))
            }
        }
    }

    private fun readInfoOrFinish(
        gatt: BluetoothGatt,
        service: android.bluetooth.BluetoothGattService,
    ) {
        val infoUuid = options.infoUuid
        val info = if (infoUuid != null) service.getCharacteristic(infoUuid) else null
        if (info == null || !gatt.readCharacteristic(info)) {
            finishConnect(null)
        }
    }

    private fun finishConnect(deviceInfo: BleDeviceInfo?) {
        _status.value = BleTransportStatus(
            connectionState = BleConnectionState.Connected,
            deviceName = pendingDeviceName,
            deviceInfo = deviceInfo,
        )
        connectResult?.complete(Unit)
    }

    private fun failConnect(message: String) {
        teardownGatt()
        val result = connectResult
        if (result != null && !result.isCompleted) {
            result.completeExceptionally(HelixProtocolError(message))
        } else {
            emitError(message)
        }
    }

    private fun handleResponse(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        if (characteristic.uuid != options.responseUuid) return
        val wire = String(value, Charsets.UTF_8)
        val packet = try {
            JsonPacketCodec.decode(wire)
        } catch (error: Exception) {
            emitError("BLE notification contained invalid Helix JSON.")
            return
        }
        if (!isServiceMessage(packet.message)) return
        for (handler in handlers) {
            handler.handle(packet)
        }
    }

    private fun teardownGatt() {
        commandCharacteristic = null
        writeCompletion?.completeExceptionally(HelixProtocolError("BLE disconnected."))
        writeCompletion = null
        bluetoothGatt?.let { gatt ->
            runCatching { gatt.disconnect() }
            runCatching { gatt.close() }
        }
        bluetoothGatt = null
    }

    private fun emitError(message: String) {
        _status.value = _status.value.copy(
            connectionState = if (bluetoothGatt == null) {
                BleConnectionState.Disconnected
            } else {
                _status.value.connectionState
            },
            error = message,
        )
    }

    private fun writeCommand(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        bytes: ByteArray,
    ): Boolean {
        val writeType = if (
            characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
        ) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(characteristic, bytes, writeType) == BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                characteristic.writeType = writeType
                characteristic.value = bytes
                gatt.writeCharacteristic(characteristic)
            }
        }
    }

    private fun writeDescriptor(
        gatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        value: ByteArray,
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(descriptor, value)
        } else {
            @Suppress("DEPRECATION")
            run {
                descriptor.value = value
                gatt.writeDescriptor(descriptor)
            }
        }
    }

    private fun parseDeviceInfo(raw: String): BleDeviceInfo {
        val json = try {
            JsonPacketCodec.json.parseToJsonElement(raw) as? JsonObject
        } catch (error: Exception) {
            null
        } ?: return BleDeviceInfo(raw = raw)

        fun str(key: String) = (json[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun int(key: String) = (json[key] as? JsonPrimitive)?.intOrNull

        return BleDeviceInfo(
            deviceId = str("deviceId"),
            mtuHint = int("mtuHint"),
            profileId = str("profileId"),
            serviceUuid = str("serviceUuid"),
            raw = raw,
        )
    }

    private companion object {
        const val REQUESTED_MTU = 512
        const val CONNECT_TIMEOUT_MS = 30_000L
        const val WRITE_TIMEOUT_MS = 10_000L
    }
}
