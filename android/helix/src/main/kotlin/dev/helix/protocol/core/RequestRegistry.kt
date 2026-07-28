// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.util.concurrent.ConcurrentHashMap

/**
 * Correlates outstanding requests to their responses by [requestId], with a
 * per-request timeout. Concurrent requests route independently by id.
 *
 * [T] is the message type carried by a resolved response (the service layer
 * uses `HelixMessage`).
 */
class HelixRequestRegistry<T> {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<T>>()

    /**
     * Registers [requestId], runs [onRegistered] (typically the transport send),
     * then suspends until a response arrives or [timeoutMs] elapses. Running the
     * send after registration closes the race where a fast response would arrive
     * before the request was pending. Throws [HelixRequestTimeoutError] on
     * timeout and [HelixProtocolError] on a duplicate id.
     */
    suspend fun await(
        requestId: String,
        timeoutMs: Long,
        onRegistered: suspend () -> Unit = {},
    ): T {
        val deferred = CompletableDeferred<T>()
        if (pending.putIfAbsent(requestId, deferred) != null) {
            throw HelixProtocolError("Duplicate Helix request id $requestId")
        }
        return try {
            withTimeout(timeoutMs) {
                onRegistered()
                deferred.await()
            }
        } catch (error: TimeoutCancellationException) {
            throw HelixRequestTimeoutError(requestId)
        } finally {
            pending.remove(requestId)
        }
    }

    /** Resolves a pending request. Returns true when [requestId] was pending. */
    fun resolve(requestId: String, message: T): Boolean {
        val deferred = pending.remove(requestId) ?: return false
        return deferred.complete(message)
    }

    /** Fails every pending request with [error] and clears the registry. */
    fun rejectAll(error: Throwable) {
        val entries = pending.entries.toList()
        pending.clear()
        for ((_, deferred) in entries) {
            deferred.completeExceptionally(error)
        }
    }

    fun size(): Int = pending.size
}
