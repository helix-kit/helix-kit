// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

import java.util.UUID

/** Produces a unique request id for a request/response correlation. */
fun interface RequestIdFactory {
    fun create(): String
}

/** Default request-id factory backed by a random UUID. */
val createRequestId: RequestIdFactory = RequestIdFactory { UUID.randomUUID().toString() }
