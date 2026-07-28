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
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/** Opens a raw [UsbSerialPort] to an attached ESP32/USB-UART bridge, handling discovery + permission. */
object UsbSerialConnection {

    /** Result of opening a port, exposing device metadata alongside the port. */
    data class Opened(
        val port: UsbSerialPort,
        val device: UsbDevice,
    )

    /** Finds the first USB serial device, requests permission if needed, and opens it at [baudRate]-8N1. */
    suspend fun open(context: Context, baudRate: Int = 115_200): Opened {
        val appContext = context.applicationContext
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val driver = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager).firstOrNull()
            ?: throw IllegalStateException("No USB serial device found. Plug in the ESP32.")
        val device = driver.device
        if (!usbManager.hasPermission(device) && !requestPermission(appContext, usbManager, device)) {
            throw IllegalStateException("USB permission denied for ${device.productName ?: "the device"}.")
        }

        return withContext(Dispatchers.IO) {
            val connection = usbManager.openDevice(device)
                ?: throw IllegalStateException("Could not open the USB device connection.")
            val port = driver.ports.firstOrNull()
                ?: throw IllegalStateException("USB device exposes no serial port.")
            port.open(connection)
            port.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            Opened(port, device)
        }
    }

    private suspend fun requestPermission(
        context: Context,
        usbManager: UsbManager,
        device: UsbDevice,
    ): Boolean = suspendCancellableCoroutine { continuation ->
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context, intent: Intent) {
                if (intent.action != ACTION_USB_PERMISSION) return
                runCatching { context.unregisterReceiver(this) }
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                if (continuation.isActive) continuation.resume(granted)
            }
        }
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        continuation.invokeOnCancellation { runCatching { context.unregisterReceiver(receiver) } }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
            flags,
        )
        usbManager.requestPermission(device, pendingIntent)
    }

    private const val ACTION_USB_PERMISSION = "dev.helix.transport.usbserial.USB_PERMISSION"
}
