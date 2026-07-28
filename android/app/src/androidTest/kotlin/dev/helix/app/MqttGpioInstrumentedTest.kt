// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import dev.helix.app.gpio.GpioControlContract
import dev.helix.app.gpio.ReadGpioRequest
import dev.helix.app.gpio.SetGpioRequest
import dev.helix.protocol.core.HelixPacketHandler
import dev.helix.protocol.service.HelixServiceClient
import dev.helix.transport.mqtt.MqttGatewayOptions
import dev.helix.transport.mqtt.MqttGatewayTransportClient
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeNoException
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

/**
 * Runs the MQTT-gateway transport on a real Android runtime (emulator/device),
 * driving gpio-control end to end through the gateway to the dummy device. The
 * rig runs on the host; `10.0.2.2` is the host loopback as seen from the
 * emulator. Skips when the gateway is unreachable.
 */
@RunWith(AndroidJUnit4::class)
class MqttGpioInstrumentedTest {

    // Overridable via `-e gatewayUrl …`/`-e deviceId …`. Default targets the
    // appliance gateway (HOST-mode public HTTP port 24000) on the host loopback
    // as seen from the emulator; with `adb reverse tcp:24000 tcp:24000`, pass
    // `ws://127.0.0.1:24000/ws`.
    private val args = InstrumentationRegistry.getArguments()
    private val gatewayUrl = args.getString("gatewayUrl") ?: "ws://10.0.2.2:24000/ws"
    private val deviceId = args.getString("deviceId") ?: "e2e-device-1"

    @Test
    fun setGpioRoundTripsOverMqttGateway() = runBlocking {
        val transport = MqttGatewayTransportClient(
            MqttGatewayOptions(deviceId = deviceId, gatewayUrl = gatewayUrl),
        )
        try {
            transport.connect()
        } catch (error: Exception) {
            assumeNoException("MQTT rig not reachable at $gatewayUrl", error)
        }

        val client = HelixServiceClient(
            service = GpioControlContract.service,
            sender = { packet -> transport.send(packet) },
            timeoutMs = 10_000,
        )
        transport.subscribe(HelixPacketHandler { client.receive(it) })

        try {
            val setResult = withTimeout(12_000) {
                client.request(GpioControlContract.setGpio, SetGpioRequest(pin = 23, high = true))
            }
            assertEquals(1, setResult.pins.single { it.pin == 23 }.level)

            val readResult = withTimeout(12_000) {
                client.request(GpioControlContract.readGpio, ReadGpioRequest(pin = 23))
            }
            assertEquals(1, readResult.pins.single { it.pin == 23 }.level)
        } finally {
            transport.disconnect("test complete")
        }
    }
}
