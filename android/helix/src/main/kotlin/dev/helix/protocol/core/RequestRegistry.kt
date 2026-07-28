// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.util.concurrent.ConcurrentHashMap

/** Correlates outstanding requests to their responses by [requestId], with a per-request timeout. */
class HelixRequestRegistry<T> {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<T>>()

    /** Registers [requestId], runs [onRegistered] then awaits the response (send-after-register closes the fast-response race). */
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
