// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.protocol.core

/** Moves [HelixPacket] values over a concrete medium (WebSocket, MQTT, BLE, Serial, gateway). */
interface HelixTransport {
    /** Sends a packet over the medium. */
    suspend fun send(packet: HelixPacket)

    /** Registers a handler for inbound packets; returns a function that removes it. */
    fun subscribe(handler: HelixPacketHandler): () -> Unit

    /** Releases transport resources. Optional for stateless transports. */
    suspend fun close() {}
}
