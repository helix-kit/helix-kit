// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolCoreTest {

    @Test
    fun `round trips a packet with a request id`() {
        val packet = HelixPacket(
            message = buildJsonObject {
                put("service", "gpio-control")
                put("method", "set-gpio")
            },
            requestId = "req-123",
        )
        val decoded = JsonPacketCodec.decode(JsonPacketCodec.encode(packet))
        assertEquals("req-123", decoded.requestId)
        assertEquals(packet.message, decoded.message)
    }

    @Test
    fun `omits request id when absent`() {
        val wire = JsonPacketCodec.encode(HelixPacket(message = buildJsonObject { put("a", 1) }))
        assertFalse(wire.contains("requestId"))
        assertNull(JsonPacketCodec.decode(wire).requestId)
    }

    @Test(expected = HelixProtocolError::class)
    fun `rejects a packet without a message`() {
        JsonPacketCodec.decode("{\"requestId\":\"x\"}")
    }

    @Test
    fun `concurrent requests route by request id`() = runTest {
        val registry = HelixRequestRegistry<String>()
        val first = async { registry.await("a", 1_000) }
        val second = async { registry.await("b", 1_000) }
        // Let both coroutines register before responses arrive.
        runCurrent()

        assertTrue(registry.resolve("b", "second"))
        assertTrue(registry.resolve("a", "first"))

        assertEquals("first", first.await())
        assertEquals("second", second.await())
        assertEquals(0, registry.size())
    }

    @Test
    fun `times out when no response arrives`() = runTest {
        val registry = HelixRequestRegistry<String>()
        try {
            registry.await("late", 50)
            throw AssertionError("expected timeout")
        } catch (error: HelixRequestTimeoutError) {
            assertEquals("late", error.requestId)
        }
        assertEquals(0, registry.size())
    }

    @Test
    fun `rejects a duplicate resolve`() {
        val registry = HelixRequestRegistry<String>()
        assertFalse(registry.resolve("missing", "value"))
    }
}
