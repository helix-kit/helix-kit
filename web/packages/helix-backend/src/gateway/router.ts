import type { HelixPacket } from '@helix/protocol';
import type { HelixMessage } from '@helix/protocol/service';

export type GatewayConnectionContext<TAuth = unknown> = Readonly<{
  auth: TAuth;
  connectionId: string;
  deviceId: string;
}>;

export type GatewayClient<TAuth = unknown> = Readonly<{
  context: GatewayConnectionContext<TAuth>;
  send: (packet: HelixPacket<HelixMessage>) => void | Promise<void>;
}>;

export type DevicePacketSender = (
  deviceId: string,
  packet: HelixPacket<HelixMessage>,
) => void | Promise<void>;

type RequestOwner = Readonly<{
  connectionId: string;
  expiresAt: number;
}>;

const DEFAULT_REQUEST_OWNER_TTL_MS = 120_000;

const requestOwnerKey = (deviceId: string, requestId: string): string =>
  `${deviceId.length}:${deviceId}${requestId}`;

// sessionId marks a long-lived sub-session (shell/tunnel/WebRTC peer) owned by one browser; the gateway routes by it without knowing what the session IS, which is how SDP/ICE trickle through the control plane with no dedicated signaling channel.
const sessionIdOf = (packet: HelixPacket<HelixMessage>): string | null => {
  const { payload } = packet.message;
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const { sessionId } = payload as { sessionId?: unknown };
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
};

export class GatewayRouter<TAuth = unknown> {
  readonly #clients = new Map<string, GatewayClient<TAuth>>();
  readonly #requestOwnerTtlMs: number;
  readonly #requestOwners = new Map<string, RequestOwner>();
  // sessionId -> the connection that owns it. Keyed per device, like requests.
  readonly #sessionOwners = new Map<string, string>();
  readonly #sendToDevice: DevicePacketSender;

  constructor(sendToDevice: DevicePacketSender, requestOwnerTtlMs = DEFAULT_REQUEST_OWNER_TTL_MS) {
    this.#sendToDevice = sendToDevice;
    this.#requestOwnerTtlMs = requestOwnerTtlMs;
  }

  addClient(client: GatewayClient<TAuth>): void {
    this.#clients.set(client.context.connectionId, client);
  }

  removeClient(connectionId: string): void {
    this.#clients.delete(connectionId);
    for (const [key, owner] of this.#requestOwners.entries()) {
      if (owner.connectionId === connectionId) {
        this.#requestOwners.delete(key);
      }
    }
    for (const [key, owner] of this.#sessionOwners.entries()) {
      if (owner === connectionId) {
        this.#sessionOwners.delete(key);
      }
    }
  }

  async receiveFromClient(connectionId: string, packet: HelixPacket<HelixMessage>): Promise<void> {
    const client = this.#clients.get(connectionId);
    if (client === undefined) {
      return;
    }

    const { deviceId } = client.context;
    // Learn ownership from the client that talks about the session; not an authz check (any browser authorized for the device may manage its sessions).
    const sessionId = sessionIdOf(packet);
    if (sessionId !== null) {
      const key = requestOwnerKey(deviceId, sessionId);
      const owner = this.#sessionOwners.get(key);
      // The client that opens a session keeps it, so a second tab closing someone else's session can't steal its pushes.
      if (owner === undefined || !this.#clients.has(owner)) {
        this.#sessionOwners.set(key, connectionId);
      }
    }

    if (packet.requestId !== undefined) {
      this.#requestOwners.set(requestOwnerKey(deviceId, packet.requestId), {
        connectionId,
        expiresAt: Date.now() + this.#requestOwnerTtlMs,
      });
    }

    await this.#sendToDevice(deviceId, packet);
  }

  async receiveFromDevice(deviceId: string, packet: HelixPacket<HelixMessage>): Promise<void> {
    if (packet.requestId !== undefined) {
      const ownerKey = requestOwnerKey(deviceId, packet.requestId);
      const requestOwner = this.#requestOwners.get(ownerKey);
      if (requestOwner !== undefined) {
        if (requestOwner.expiresAt <= Date.now()) {
          this.#requestOwners.delete(ownerKey);
        } else {
          const owner = this.#clients.get(requestOwner.connectionId);
          if (owner?.context.deviceId === deviceId) {
            await owner.send(packet);
            return;
          }
        }
      }
    }

    // Session-scoped: deliver only to the owning browser, else it broadcasts to every tab watching the device.
    const sessionId = sessionIdOf(packet);
    if (sessionId !== null) {
      const owner = this.#sessionOwners.get(requestOwnerKey(deviceId, sessionId));
      const client = owner === undefined ? undefined : this.#clients.get(owner);
      if (client?.context.deviceId === deviceId) {
        await client.send(packet);
        return;
      }
    }

    await this.broadcastFromDevice(deviceId, packet);
  }

  async broadcastFromDevice(deviceId: string, packet: HelixPacket<HelixMessage>): Promise<void> {
    const sends: Array<void | Promise<void>> = [];
    for (const client of this.#clients.values()) {
      if (client.context.deviceId === deviceId) {
        sends.push(client.send(packet));
      }
    }

    await Promise.all(sends);
  }
}
