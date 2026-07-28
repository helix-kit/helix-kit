// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.service

import dev.helix.protocol.core.HelixPacket
import dev.helix.protocol.core.HelixRequestRegistry
import dev.helix.protocol.core.RequestIdFactory
import dev.helix.protocol.core.createRequestId
import java.util.concurrent.CopyOnWriteArrayList

/** A decoded inbound service packet delivered to subscribers. */
data class ServiceEvent(
    val message: HelixMessage,
    val requestId: String?,
)

/** Optional filter for [HelixServiceClient.subscribe]. */
data class ServiceMatcher(
    val service: String? = null,
    val method: String? = null,
)

/** Correlates [request] calls by id over a transport, exposes [send], fans out to [subscribe]. */
class HelixServiceClient(
    private val service: String,
    private val sender: suspend (HelixPacket) -> Unit,
    private val createId: RequestIdFactory = createRequestId,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
) {
    private val registry = HelixRequestRegistry<HelixMessage>()
    private val subscriptions = CopyOnWriteArrayList<(ServiceEvent) -> Unit>()

    /** Feeds an inbound packet from the transport into correlation and fan-out. */
    fun receive(packet: HelixPacket) {
        val message = elementToMessageOrNull(packet.message) ?: return
        packet.requestId?.let { registry.resolve(it, message) }
        val event = ServiceEvent(message = message, requestId = packet.requestId)
        for (subscription in subscriptions) {
            subscription(event)
        }
    }

    /** Sends a typed request and suspends until the correlated response arrives. */
    suspend fun <I, O> request(method: ServiceMethod<I, O>, input: I): O {
        val payload = method.input.encode(input)
        val requestId = createId.create()
        val packet = HelixPacket(
            message = messageToElement(createServiceMessage(service, method.name, payload)),
            requestId = requestId,
        )
        val response = registry.await(requestId, timeoutMs) { sender(packet) }
        return method.output.parse(response.payload)
    }

    /** Sends a fire-and-forget async message with a validated payload. */
    suspend fun <P> send(message: ServiceAsyncMessage<P>, payload: P) {
        val packet = createServicePacket(service, message.name, message.payload.encode(payload))
        sender(packet)
    }

    /** Subscribes to inbound service events; returns a function that removes the subscription. */
    fun subscribe(
        matcher: ServiceMatcher = ServiceMatcher(service = service),
        handler: (ServiceEvent) -> Unit,
    ): () -> Unit {
        val subscription: (ServiceEvent) -> Unit = { event ->
            if (packetMatches(event.message, matcher.service, matcher.method)) {
                handler(event)
            }
        }
        subscriptions.add(subscription)
        return { subscriptions.remove(subscription) }
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS: Long = 120_000
    }
}
