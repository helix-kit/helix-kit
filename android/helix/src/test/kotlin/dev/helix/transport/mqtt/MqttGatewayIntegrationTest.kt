// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.transport.mqtt

import dev.helix.protocol.core.HelixPacketHandler
import dev.helix.protocol.service.HelixServiceClient
import dev.helix.protocol.service.ServiceMatcher
import dev.helix.protocol.service.method
import dev.helix.protocol.service.schema
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeNoException
import org.junit.Test

// Drives gpio-control end to end through a WS->MQTT gateway to a simulated device;
// skips when no gateway is configured.
@Serializable
data class SetGpioRequest(val pin: Int, val high: Boolean)

@Serializable
data class ReadGpioRequest(val pin: Int? = null)

@Serializable
data class GpioPinState(val pin: Int, val level: Int)

@Serializable
data class GpioStatePayload(val pins: List<GpioPinState>)

private val setGpio = method("set-gpio", schema<SetGpioRequest>(), schema<GpioStatePayload>())
private val readGpio = method("read-gpio", schema<ReadGpioRequest>(), schema<GpioStatePayload>())

class MqttGatewayIntegrationTest {

    private val gatewayUrl: String =
        System.getProperty("helix.mqtt.gatewayUrl")
            ?: System.getenv("HELIX_MQTT_GATEWAY_URL")
            ?: "ws://127.0.0.1:24000/ws"
    private val deviceId: String =
        System.getProperty("helix.mqtt.deviceId")
            ?: System.getenv("HELIX_MQTT_DEVICE_ID")
            ?: "e2e-device-1"

    @Test
    fun `set-gpio round trips through the gateway to the device`() = runBlocking {
        val transport = MqttGatewayTransportClient(
            MqttGatewayOptions(deviceId = deviceId, gatewayUrl = gatewayUrl),
        )
        try {
            transport.connect()
        } catch (error: Exception) {
            assumeNoException("MQTT rig not reachable at $gatewayUrl", error)
        }

        val client = HelixServiceClient(
            service = "gpio-control",
            sender = { packet -> transport.send(packet) },
            timeoutMs = 10_000,
        )
        transport.subscribe(HelixPacketHandler { client.receive(it) })

        try {
            val setResult = withTimeout(12_000) { client.request(setGpio, SetGpioRequest(pin = 2, high = true)) }
            assertEquals(listOf(GpioPinState(pin = 2, level = 1)), setResult.pins)

            val readResult = withTimeout(12_000) { client.request(readGpio, ReadGpioRequest(pin = 2)) }
            assertEquals(listOf(GpioPinState(pin = 2, level = 1)), readResult.pins)

            val clearResult = withTimeout(12_000) { client.request(setGpio, SetGpioRequest(pin = 2, high = false)) }
            assertEquals(listOf(GpioPinState(pin = 2, level = 0)), clearResult.pins)
        } finally {
            transport.disconnect("test complete")
        }
    }

    @Test
    fun `async device state messages reach subscribers`() = runBlocking {
        val transport = MqttGatewayTransportClient(
            MqttGatewayOptions(deviceId = deviceId, gatewayUrl = gatewayUrl),
        )
        try {
            transport.connect()
        } catch (error: Exception) {
            assumeNoException("MQTT rig not reachable at $gatewayUrl", error)
        }

        val client = HelixServiceClient(service = "gpio-control", sender = { transport.send(it) })
        transport.subscribe(HelixPacketHandler { client.receive(it) })

        val received = kotlinx.coroutines.CompletableDeferred<GpioStatePayload>()
        client.subscribe(ServiceMatcher(method = "gpio-control-state")) { event ->
            runCatching { schema<GpioStatePayload>().parse(event.message.payload) }
                .onSuccess { if (!received.isCompleted) received.complete(it) }
        }

        try {
            client.request(setGpio, SetGpioRequest(pin = 17, high = true))
            val payload = withTimeout(12_000) { received.await() }
            assertEquals(1, payload.pins.single { it.pin == 17 }.level)
        } finally {
            transport.disconnect("test complete")
        }
    }
}
