// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.service

import dev.helix.protocol.core.HelixPacket
import dev.helix.protocol.core.JsonPacketCodec
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@Serializable
data class SetGpioRequest(val pin: Int, val high: Boolean)

@Serializable
data class GpioPinState(val pin: Int, val level: Int)

@Serializable
data class GpioStatePayload(val pins: List<GpioPinState>)

private val setGpio = method(
    name = "set-gpio",
    input = schema<SetGpioRequest>(),
    output = schema<GpioStatePayload>(),
)

private val stateMessage = message(name = "gpio-control-state", payload = schema<GpioStatePayload>())

class ServiceClientTest {

    @Test
    fun `request correlates a device response by request id`() = runTest {
        lateinit var client: HelixServiceClient
        // A loopback "device" that echoes a state response with the same request id.
        client = HelixServiceClient(
            service = "gpio-control",
            sender = { packet ->
                val requestId = requireNotNull(packet.requestId)
                val response = HelixPacket(
                    message = messageToElement(
                        createServiceMessage(
                            service = "gpio-control",
                            method = "gpio-control-state",
                            payload = schema<GpioStatePayload>()
                                .encode(GpioStatePayload(listOf(GpioPinState(2, 1)))),
                        ),
                    ),
                    requestId = requestId,
                )
                client.receive(response)
            },
        )

        val result = client.request(setGpio, SetGpioRequest(pin = 2, high = true))
        assertEquals(listOf(GpioPinState(2, 1)), result.pins)
    }

    @Test
    fun `subscribe receives async device messages and filters by method`() = runTest {
        val sent = mutableListOf<HelixPacket>()
        val client = HelixServiceClient(service = "gpio-control", sender = { sent.add(it) })

        val received = mutableListOf<GpioStatePayload>()
        client.subscribe(ServiceMatcher(method = "gpio-control-state")) { event ->
            received.add(schema<GpioStatePayload>().parse(event.message.payload))
        }

        client.receive(
            HelixPacket(
                message = messageToElement(
                    createServiceMessage(
                        "gpio-control",
                        "gpio-control-state",
                        schema<GpioStatePayload>().encode(GpioStatePayload(listOf(GpioPinState(4, 0)))),
                    ),
                ),
            ),
        )
        client.receive(
            HelixPacket(
                message = messageToElement(createServiceMessage("gpio-control", "other")),
            ),
        )

        assertEquals(1, received.size)
        assertEquals(listOf(GpioPinState(4, 0)), received.single().pins)
    }

    @Test
    fun `send omits payload framing metadata and request id`() = runTest {
        val sent = mutableListOf<HelixPacket>()
        val client = HelixServiceClient(service = "gpio-control", sender = { sent.add(it) })

        client.send(stateMessage, GpioStatePayload(listOf(GpioPinState(2, 1))))

        val packet = sent.single()
        assertNull(packet.requestId)
        val wire = JsonPacketCodec.encode(packet)
        assertEquals(false, wire.contains("requestId"))
    }
}
