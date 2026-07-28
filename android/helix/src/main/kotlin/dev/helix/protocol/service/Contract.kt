// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.service

import dev.helix.protocol.core.JsonPacketCodec
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.serializer

/** Validates and (de)serializes a typed value to and from a [JsonElement]. */
class Schema<T>(private val serializer: KSerializer<T>) {
    fun parse(value: JsonElement?): T {
        requireNotNull(value) { "Missing payload for Helix schema" }
        return JsonPacketCodec.json.decodeFromJsonElement(serializer, value)
    }

    fun encode(value: T): JsonElement =
        JsonPacketCodec.json.encodeToJsonElement(serializer, value)
}

/** Builds a [Schema] for [T] from its generated serializer. */
inline fun <reified T> schema(): Schema<T> = Schema(serializer())

/** A request/response method on a service; [input]/[output] are validated, [error] is optional. */
class ServiceMethod<I, O>(
    val name: String,
    val input: Schema<I>,
    val output: Schema<O>,
    val error: Schema<*>? = null,
)

/** A device-originated async message on a service. */
class ServiceAsyncMessage<P>(
    val name: String,
    val payload: Schema<P>,
)

/** Convenience builder mirroring the web `method(...)` helper. */
fun <I, O> method(name: String, input: Schema<I>, output: Schema<O>, error: Schema<*>? = null): ServiceMethod<I, O> =
    ServiceMethod(name, input, output, error)

/** Convenience builder mirroring the web `message(...)` helper. */
fun <P> message(name: String, payload: Schema<P>): ServiceAsyncMessage<P> =
    ServiceAsyncMessage(name, payload)

/** Base class for a service contract; subclasses declare methods and messages as members. */
abstract class ServiceContract(val service: String)
