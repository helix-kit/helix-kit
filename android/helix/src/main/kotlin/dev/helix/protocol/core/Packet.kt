// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The core transport-neutral Helix wire packet; [message] is opaque, [requestId] is protocol metadata. */
@Serializable
data class HelixPacket(
    val message: JsonElement,
    @SerialName("requestId") val requestId: String? = null,
)

/** Receives decoded packets from a transport. */
fun interface HelixPacketHandler {
    fun handle(packet: HelixPacket)
}

/** Base type for all protocol-level failures. */
open class HelixProtocolError(message: String) : RuntimeException(message)

/** Thrown when a request does not receive a correlated response in time. */
class HelixRequestTimeoutError(val requestId: String) :
    HelixProtocolError("Timed out waiting for Helix response $requestId")

/** True when [value] has the shape of a [HelixPacket]. */
fun isHelixPacket(value: JsonElement?): Boolean {
    if (value !is JsonObject) return false
    if ("message" !in value) return false
    val requestId = value["requestId"]
    return requestId == null ||
        (requestId is kotlinx.serialization.json.JsonPrimitive && requestId.isString) ||
        requestId is kotlinx.serialization.json.JsonNull
}

/** Encodes and decodes [HelixPacket] values to and from a wire representation. */
object JsonPacketCodec {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    fun encode(packet: HelixPacket): String = json.encodeToString(HelixPacket.serializer(), packet)

    fun decode(wire: String): HelixPacket {
        val element = try {
            json.parseToJsonElement(wire)
        } catch (error: Exception) {
            throw HelixProtocolError("Invalid Helix packet: ${error.message}")
        }
        if (!isHelixPacket(element)) {
            throw HelixProtocolError("Invalid Helix packet")
        }
        return json.decodeFromJsonElement(HelixPacket.serializer(), element)
    }
}
