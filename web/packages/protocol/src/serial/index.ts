import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix-hq/protocol';
import { isServiceMessage, type HelixMessage } from '@helix-hq/protocol/service';

export type SerialPortInfo = Readonly<{
  usbProductId?: number;
  usbVendorId?: number;
}>;

export type SerialPortFilter = Readonly<{
  bluetoothServiceClassId?: number | string;
  usbProductId?: number;
  usbVendorId?: number;
}>;

export type SerialPortOpenOptions = Readonly<{
  baudRate: number;
  bufferSize?: number;
  dataBits?: 7 | 8; // eslint-disable-line no-magic-numbers
  flowControl?: 'hardware' | 'none';
  parity?: 'even' | 'none' | 'odd';
  stopBits?: 1 | 2;
}>;

export type SerialPort = Readonly<{
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close: () => Promise<void>;
  getInfo: () => SerialPortInfo;
  open: (options: SerialPortOpenOptions) => Promise<void>;
  setSignals?: (signals: { dataTerminalReady?: boolean; requestToSend?: boolean }) => Promise<void>;
}>;

export type WebSerial = Readonly<{
  getPorts: () => Promise<SerialPort[]>;
  requestPort: (options?: { filters?: readonly SerialPortFilter[] }) => Promise<SerialPort>;
}>;

type SerialNavigator = Navigator & { readonly serial?: WebSerial };

export type SerialConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export type SerialTransportStatusEvent =
  | { type: 'connecting' }
  | { portInfo: SerialPortInfo; type: 'connected' }
  | { reason?: string; type: 'disconnected' }
  | { message: string; type: 'error' };

export type SerialSignalState = Readonly<{
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
}>;

export type SerialTransportClientOptions = Readonly<{
  baudRate?: number;
  bufferSize?: number;
  errorPrefix?: string;
  filters?: readonly SerialPortFilter[];
  inputPrefix?: string;
  openSignals?: SerialSignalState | null;
  outputPrefix?: string;
  port?: SerialPort;
}>;

const DEFAULT_OPEN_SIGNALS: SerialSignalState = {
  dataTerminalReady: false,
  requestToSend: false,
};

type StatusHandler = (event: SerialTransportStatusEvent) => void;

export const DEFAULT_SERIAL_BAUD_RATE = 115_200;
export const DEFAULT_SERIAL_BUFFER_BYTES = 4096;
export const HELIX_SERIAL_INPUT_PREFIX = 'SERVICE ';
export const HELIX_SERIAL_OUTPUT_PREFIX = 'HELIX_RESPONSE ';
export const HELIX_SERIAL_ERROR_PREFIX = 'HELIX_ERROR ';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const getWebSerial = (): WebSerial | null =>
  typeof navigator === 'undefined' ? null : ((navigator as SerialNavigator).serial ?? null);

export const isWebSerialSupported = (): boolean => getWebSerial() !== null;

const matchesFilter = (port: SerialPort, filter: SerialPortFilter): boolean => {
  const info = port.getInfo();
  return (
    (filter.usbVendorId === undefined || filter.usbVendorId === info.usbVendorId) &&
    (filter.usbProductId === undefined || filter.usbProductId === info.usbProductId)
  );
};

export const selectSerialPort = async (
  serial: WebSerial,
  filters: readonly SerialPortFilter[] = [],
): Promise<SerialPort> => {
  const authorizedPorts = await serial.getPorts();
  const authorizedPort = authorizedPorts.find(
    (port) => filters.length === 0 || filters.some((filter) => matchesFilter(port, filter)),
  );
  return authorizedPort ?? serial.requestPort(filters.length === 0 ? undefined : { filters });
};

const extractJsonObject = (line: string): string | null => {
  for (let start = line.indexOf('{'); start >= 0; start = line.indexOf('{', start + 1)) {
    let depth = 0;
    let escaped = false;
    let quoted = false;
    for (let index = start; index < line.length; index += 1) {
      const character = line[index];
      if (quoted) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          quoted = false;
        }
        continue;
      }
      if (character === '"') {
        quoted = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          return line.slice(start, index + 1);
        }
      }
    }
  }
  return null;
};

export class SerialTransportClient implements HelixTransport<HelixMessage> {
  readonly #handlers = new Set<HelixPacketHandler<HelixMessage>>();
  readonly #options: SerialTransportClientOptions;
  readonly #statusHandlers = new Set<StatusHandler>();
  #port: SerialPort | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #readTask: Promise<void> | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: SerialTransportClientOptions = {}) {
    this.#options = options;
  }

  async connect(): Promise<void> {
    if (this.#port !== null) {
      return;
    }
    const serial = getWebSerial();
    if (serial === null && this.#options.port === undefined) {
      this.#emitStatus({ message: 'Web Serial is not available in this browser.', type: 'error' });
      return;
    }

    this.#emitStatus({ type: 'connecting' });
    try {
      const port =
        this.#options.port ?? (await selectSerialPort(serial as WebSerial, this.#options.filters));
      await port.open({
        baudRate: this.#options.baudRate ?? DEFAULT_SERIAL_BAUD_RATE,
        bufferSize: this.#options.bufferSize ?? DEFAULT_SERIAL_BUFFER_BYTES,
        flowControl: 'none',
      });
      const { openSignals } = this.#options;
      if (openSignals !== null) {
        await port.setSignals?.(openSignals ?? DEFAULT_OPEN_SIGNALS).catch(() => undefined);
      }
      if (port.readable === null || port.writable === null) {
        await port.close();
        throw new Error('Serial port did not expose readable and writable streams.');
      }

      this.#port = port;
      this.#reader = port.readable.getReader();
      this.#readTask = this.#readLoop(this.#reader);
      this.#emitStatus({ portInfo: port.getInfo(), type: 'connected' });
    } catch (error) {
      this.#emitStatus({
        message: error instanceof Error ? error.message : 'Serial connection failed.',
        type: 'error',
      });
      await this.disconnect('connection failed');
    }
  }

  async close(): Promise<void> {
    await this.disconnect('transport closed');
  }

  async disconnect(reason = 'manual disconnect'): Promise<void> {
    const reader = this.#reader;
    const port = this.#port;
    this.#reader = null;
    this.#port = null;
    await reader?.cancel().catch(() => undefined);
    try {
      reader?.releaseLock();
    } catch {
      // The read loop can release the lock first when the device disconnects.
    }
    await this.#writeQueue.catch(() => undefined);
    await this.#readTask?.catch(() => undefined);
    this.#readTask = null;
    await port?.close().catch(() => undefined);
    this.#emitStatus({ reason, type: 'disconnected' });
  }

  async send(packet: HelixPacket<HelixMessage>): Promise<void> {
    const writeTask = this.#writeQueue.then(
      () => this.#writePacket(packet),
      () => this.#writePacket(packet),
    );
    this.#writeQueue = writeTask.catch(() => undefined);
    await writeTask;
  }

  async #writePacket(packet: HelixPacket<HelixMessage>): Promise<void> {
    const writable = this.#port?.writable;
    if (writable === null || writable === undefined) {
      throw new Error('Serial transport is not connected.');
    }
    const writer = writable.getWriter();
    try {
      const prefix = this.#options.inputPrefix ?? HELIX_SERIAL_INPUT_PREFIX;
      await writer.write(textEncoder.encode(`${prefix}${jsonPacketCodec.encode(packet)}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  subscribe(handler: HelixPacketHandler<HelixMessage>): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.#statusHandlers.add(handler);
    return () => {
      this.#statusHandlers.delete(handler);
    };
  }

  #emitStatus(event: SerialTransportStatusEvent): void {
    for (const handler of this.#statusHandlers) {
      handler(event);
    }
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    const errorPrefix = this.#options.errorPrefix ?? HELIX_SERIAL_ERROR_PREFIX;
    if (trimmed.startsWith(errorPrefix)) {
      this.#emitStatus({ message: trimmed.slice(errorPrefix.length).trim(), type: 'error' });
      return;
    }
    const outputPrefix = this.#options.outputPrefix ?? HELIX_SERIAL_OUTPUT_PREFIX;
    const packetJson = extractJsonObject(
      trimmed.startsWith(outputPrefix) ? trimmed.slice(outputPrefix.length) : trimmed,
    );
    if (packetJson === null) {
      return;
    }
    try {
      const packet = assertHelixPacket(jsonPacketCodec.decode(packetJson));
      if (!isServiceMessage(packet.message)) {
        return;
      }
      for (const handler of this.#handlers) {
        handler(packet as HelixPacket<HelixMessage>);
      }
    } catch {
      this.#emitStatus({ message: 'Serial response contained invalid Helix JSON.', type: 'error' });
    }
  }

  async #readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    let buffer = '';
    try {
      while (this.#reader === reader) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += textDecoder.decode(result.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          this.#handleLine(line);
        }
      }
    } catch (error) {
      if (this.#reader === reader) {
        this.#emitStatus({
          message: error instanceof Error ? error.message : 'Serial read failed.',
          type: 'error',
        });
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Cancellation can release the reader before the loop exits.
      }
    }
  }
}
