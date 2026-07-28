// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.usbserial

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import dev.helix.protocol.core.HelixPacket
import dev.helix.protocol.core.HelixPacketHandler
import dev.helix.protocol.core.HelixProtocolError
import dev.helix.protocol.core.JsonPacketCodec
import dev.helix.protocol.service.isServiceMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.resume

/** USB-serial `HelixTransport`: an ESP32 behind a UART bridge, newline-framed serial protocol. */
class UsbSerialTransportClient(
    context: Context,
    private val options: UsbSerialTransportOptions = UsbSerialTransportOptions(),
) : dev.helix.protocol.core.HelixTransport {

    private val appContext = context.applicationContext
    private val usbManager = appContext.getSystemService(Context.USB_SERVICE) as UsbManager
    private val handlers = CopyOnWriteArrayList<HelixPacketHandler>()

    private val _status = MutableStateFlow(UsbTransportStatus())
    val status: StateFlow<UsbTransportStatus> = _status.asStateFlow()

    @Volatile private var port: UsbSerialPort? = null
    @Volatile private var ioManager: SerialInputOutputManager? = null

    private val readBuffer = StringBuilder()
    private val readLock = Any()

    /** Finds and opens an attached Helix serial device, prompting for USB permission if needed. */
    suspend fun connect() {
        if (_status.value.connectionState != UsbConnectionState.Disconnected) return
        _status.value = UsbTransportStatus(connectionState = UsbConnectionState.Connecting)

        val driver = findDriver()
        if (driver == null) {
            emitError("No USB serial device found. Plug in the ESP32 and grant access.")
            return
        }
        val device = driver.device
        if (!usbManager.hasPermission(device) && !requestPermission(device)) {
            emitError("USB permission denied for ${device.productName ?: "the device"}.")
            return
        }

        try {
            openPort(driver)
        } catch (error: Throwable) {
            teardown()
            emitError(error.message ?: "Failed to open the USB serial port.")
            return
        }

        delay(options.settleMs)
        synchronized(readLock) { readBuffer.setLength(0) }

        _status.value = UsbTransportStatus(
            connectionState = UsbConnectionState.Connected,
            deviceInfo = UsbDeviceInfo(
                productName = device.productName,
                vendorId = device.vendorId,
                productId = device.productId,
                driverName = driver.javaClass.simpleName,
            ),
        )
    }

    override suspend fun send(packet: HelixPacket) {
        val activePort = port ?: throw HelixProtocolError("USB serial transport is not connected.")
        val line = HelixSerial.INPUT_PREFIX + JsonPacketCodec.encode(packet) + "\n"
        withContext(Dispatchers.IO) {
            activePort.write(line.toByteArray(Charsets.UTF_8), options.writeTimeoutMs)
        }
    }

    override fun subscribe(handler: HelixPacketHandler): () -> Unit {
        handlers.add(handler)
        return { handlers.remove(handler) }
    }

    override suspend fun close() {
        disconnect("transport closed")
    }

    /** Closes the port and releases the connection. */
    fun disconnect(reason: String = "manual disconnect") {
        teardown()
        _status.value = UsbTransportStatus(connectionState = UsbConnectionState.Disconnected)
    }

    private fun findDriver(): UsbSerialDriver? =
        UsbSerialProber.getDefaultProber().findAllDrivers(usbManager).firstOrNull()

    private suspend fun openPort(driver: UsbSerialDriver) = withContext(Dispatchers.IO) {
        val connection = usbManager.openDevice(driver.device)
            ?: throw HelixProtocolError("Could not open the USB device connection.")
        val serialPort = driver.ports.firstOrNull()
            ?: throw HelixProtocolError("USB device exposes no serial port.")
        serialPort.open(connection)
        serialPort.setParameters(
            options.baudRate,
            8,
            UsbSerialPort.STOPBITS_1,
            UsbSerialPort.PARITY_NONE,
        )
        port = serialPort

        val manager = SerialInputOutputManager(serialPort, ioListener)
        ioManager = manager
        manager.start()
    }

    private fun teardown() {
        ioManager?.let { runCatching { it.stop() } }
        ioManager = null
        port?.let { runCatching { it.close() } }
        port = null
        synchronized(readLock) { readBuffer.setLength(0) }
    }

    private val ioListener = object : SerialInputOutputManager.Listener {
        override fun onNewData(data: ByteArray) {
            if (data.isEmpty()) return
            val lines = mutableListOf<String>()
            synchronized(readLock) {
                readBuffer.append(String(data, Charsets.UTF_8))
                var newline = readBuffer.indexOf("\n")
                while (newline >= 0) {
                    lines.add(readBuffer.substring(0, newline))
                    readBuffer.delete(0, newline + 1)
                    newline = readBuffer.indexOf("\n")
                }
            }
            for (line in lines) processLine(line)
        }

        override fun onRunError(error: Exception) {
            teardown()
            _status.value = UsbTransportStatus(
                connectionState = UsbConnectionState.Disconnected,
                error = error.message ?: "USB serial read error.",
            )
        }
    }

    private fun processLine(rawLine: String) {
        val text = rawLine.trim('\r', '\n', ' ')
        if (text.isEmpty()) return
        if (text.startsWith(HelixSerial.ERROR_PREFIX)) {
            emitError(text)
            return
        }
        val json = extractPacketJson(text) ?: return
        val packet = runCatching { JsonPacketCodec.decode(json) }.getOrNull() ?: return
        if (!isServiceMessage(packet.message)) return
        for (handler in handlers) handler.handle(packet)
    }

    private fun extractPacketJson(text: String): String? {
        val prefixIndex = text.indexOf(HelixSerial.OUTPUT_PREFIX)
        if (prefixIndex >= 0) {
            return text.substring(prefixIndex + HelixSerial.OUTPUT_PREFIX.length).trim()
        }
        val bodyIndex = text.indexOf("{\"requestId\":")
        if (bodyIndex >= 0) return text.substring(bodyIndex).trim()
        return null
    }

    private fun emitError(message: String) {
        _status.value = _status.value.copy(
            connectionState = UsbConnectionState.Disconnected,
            error = message,
        )
    }

    private suspend fun requestPermission(device: UsbDevice): Boolean =
        suspendCancellableCoroutine { continuation ->
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(receiverContext: Context, intent: Intent) {
                    if (intent.action != ACTION_USB_PERMISSION) return
                    runCatching { appContext.unregisterReceiver(this) }
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    if (continuation.isActive) continuation.resume(granted)
                }
            }

            val filter = IntentFilter(ACTION_USB_PERMISSION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                appContext.registerReceiver(receiver, filter)
            }
            continuation.invokeOnCancellation { runCatching { appContext.unregisterReceiver(receiver) } }

            // PendingIntent must be mutable on S+ so the system can fill EXTRA_PERMISSION_GRANTED.
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            }
            val pendingIntent = PendingIntent.getBroadcast(
                appContext,
                0,
                Intent(ACTION_USB_PERMISSION).setPackage(appContext.packageName),
                flags,
            )
            usbManager.requestPermission(device, pendingIntent)
        }

    private companion object {
        const val ACTION_USB_PERMISSION = "dev.helix.transport.usbserial.USB_PERMISSION"
    }
}
