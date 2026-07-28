// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

/**
 * Moves [HelixPacket] values over a concrete medium (WebSocket, MQTT, BLE,
 * Serial, or a custom gateway). Transport connection state and framing rules
 * are transport-internal and are never part of the Helix packet.
 */
interface HelixTransport {
    /** Sends a packet over the medium. */
    suspend fun send(packet: HelixPacket)

    /**
     * Registers a handler for inbound packets. Returns a function that removes
     * the handler when invoked.
     */
    fun subscribe(handler: HelixPacketHandler): () -> Unit

    /** Releases transport resources. Optional for stateless transports. */
    suspend fun close() {}
}
