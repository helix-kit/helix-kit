// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.service

import dev.helix.protocol.core.HelixPacket
import dev.helix.protocol.core.JsonPacketCodec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The service-layer message carried inside [HelixPacket.message]. The device
 * service broker dispatches by [service] and [method]; [payload] is the
 * method-specific body and must never contain protocol metadata.
 */
@Serializable
data class HelixMessage(
    val service: String,
    val method: String,
    val payload: JsonElement? = null,
)

/** Builds a [HelixMessage], omitting [payload] when null (matching the web SDK). */
fun createServiceMessage(service: String, method: String, payload: JsonElement? = null): HelixMessage =
    HelixMessage(service = service, method = method, payload = payload)

/** Wraps a [HelixMessage] into a [HelixPacket] with no request id (async send). */
fun createServicePacket(service: String, method: String, payload: JsonElement? = null): HelixPacket =
    HelixPacket(message = messageToElement(createServiceMessage(service, method, payload)))

internal fun messageToElement(message: HelixMessage): JsonElement =
    JsonPacketCodec.json.encodeToJsonElement(HelixMessage.serializer(), message)

internal fun elementToMessageOrNull(element: JsonElement): HelixMessage? =
    try {
        JsonPacketCodec.json.decodeFromJsonElement(HelixMessage.serializer(), element)
    } catch (error: Exception) {
        null
    }

/** True when [value] carries a service message shape (string service + method). */
fun isServiceMessage(value: JsonElement?): Boolean {
    if (value !is JsonObject) return false
    val service = value["service"]
    val method = value["method"]
    return service is JsonPrimitive && service.isString &&
        method is JsonPrimitive && method.isString
}

/** True when [message] matches the optional [service]/[method] filter. */
fun packetMatches(message: HelixMessage, service: String? = null, method: String? = null): Boolean =
    (service == null || message.service == service) &&
        (method == null || message.method == method)
