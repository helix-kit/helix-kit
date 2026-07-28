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

/**
 * Drives the gpio-control service end to end through a Helix WS->MQTT gateway to
 * a simulated device. The gateway URL comes from the `mqttGatewayUrl` Gradle
 * property (or `HELIX_MQTT_GATEWAY_URL`); the appliance-backed e2e
 * (`helix e2e run -k android_mqtt`) supplies it and the device simulator. When
 * no gateway is configured the test skips rather than fails, so `./gradlew
 * check` stays green standalone.
 */
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

    // Set by the appliance-backed e2e (`helix e2e run`) via Gradle properties;
    // the appliance gateway's public HTTP port in HOST mode is 24000.
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
            // set-gpio pin 2 high -> device reports level 1
            val setResult = withTimeout(12_000) { client.request(setGpio, SetGpioRequest(pin = 2, high = true)) }
            assertEquals(listOf(GpioPinState(pin = 2, level = 1)), setResult.pins)

            // read-gpio pin 2 reflects the new level
            val readResult = withTimeout(12_000) { client.request(readGpio, ReadGpioRequest(pin = 2)) }
            assertEquals(listOf(GpioPinState(pin = 2, level = 1)), readResult.pins)

            // set-gpio pin 2 low -> level 0
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
            // Any request produces a gpio-control-state response the subscription also sees.
            client.request(setGpio, SetGpioRequest(pin = 17, high = true))
            val payload = withTimeout(12_000) { received.await() }
            assertEquals(1, payload.pins.single { it.pin == 17 }.level)
        } finally {
            transport.disconnect("test complete")
        }
    }
}
