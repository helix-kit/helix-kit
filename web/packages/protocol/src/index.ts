export type HelixPacket<TMessage = unknown> = Readonly<{
  message: TMessage;
  requestId?: string;
}>;

export type HelixPacketDraft<TMessage = unknown> = Readonly<{
  message: TMessage;
  requestId?: string;
}>;

export type HelixPacketCodec<TWire = string> = Readonly<{
  decode: (wire: TWire) => HelixPacket;
  encode: (packet: HelixPacket) => TWire;
}>;

export type HelixPacketHandler<TMessage = unknown> = (packet: HelixPacket<TMessage>) => void;

export type HelixTransport<TMessage = unknown> = Readonly<{
  close?: () => void | Promise<void>;
  send: (packet: HelixPacket<TMessage>) => void | Promise<void>;
  subscribe: (handler: HelixPacketHandler<TMessage>) => () => void;
}>;

export type RequestIdFactory = () => string;

export type PendingRequest<TMessage = unknown> = Readonly<{
  reject: (error: Error) => void;
  resolve: (message: TMessage) => void;
  timeout: ReturnType<typeof setTimeout>;
}>;

export class HelixProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelixProtocolError';
  }
}

export class HelixRequestTimeoutError extends HelixProtocolError {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Timed out waiting for Helix response ${requestId}`);
    this.name = 'HelixRequestTimeoutError';
    this.requestId = requestId;
  }
}

let requestCounter = 0;
const REQUEST_ID_RADIX = 36;

export const createRequestId: RequestIdFactory = () => {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  requestCounter += 1;
  return `helix-${Date.now().toString(REQUEST_ID_RADIX)}-${requestCounter.toString(
    REQUEST_ID_RADIX,
  )}`;
};

export const jsonPacketCodec: HelixPacketCodec = {
  decode: (wire: string): HelixPacket => {
    const parsed: unknown = JSON.parse(wire);
    return assertHelixPacket(parsed);
  },
  encode: (packet: HelixPacket): string => JSON.stringify(packet),
};

export const isHelixPacket = (value: unknown): value is HelixPacket => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<HelixPacket>;
  return (
    'message' in candidate &&
    (candidate.requestId === undefined || typeof candidate.requestId === 'string')
  );
};

export const assertHelixPacket = (value: unknown): HelixPacket => {
  if (!isHelixPacket(value)) {
    throw new HelixProtocolError('Invalid Helix packet');
  }

  return value;
};

export class HelixRequestRegistry<TMessage = unknown> {
  readonly #pending = new Map<string, PendingRequest<TMessage>>();

  create(requestId: string, timeoutMs: number): Promise<TMessage> {
    if (this.#pending.has(requestId)) {
      return Promise.reject(new HelixProtocolError(`Duplicate Helix request id ${requestId}`));
    }

    return new Promise<TMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new HelixRequestTimeoutError(requestId));
      }, timeoutMs);

      this.#pending.set(requestId, {
        reject,
        resolve,
        timeout,
      });
    });
  }

  rejectAll(error: Error): void {
    for (const [requestId, pending] of this.#pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.#pending.delete(requestId);
    }
  }

  resolve(requestId: string, message: TMessage): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.#pending.delete(requestId);
    pending.resolve(message);
    return true;
  }

  size(): number {
    return this.#pending.size;
  }
}
