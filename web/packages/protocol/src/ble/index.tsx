'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  assertHelixPacket,
  jsonPacketCodec,
  type HelixPacket,
  type HelixPacketHandler,
  type HelixTransport,
} from '@helix/protocol';
import { isServiceMessage, type HelixMessage } from '@helix/protocol/service';
import { HelixTransportProvider } from '@helix/protocol/service/react';

export type BluetoothServiceUUID = number | string;
export type BluetoothCharacteristicUUID = number | string;

export type BluetoothLEScanFilter = Readonly<{
  name?: string;
  namePrefix?: string;
  services?: readonly BluetoothServiceUUID[];
}>;

export type RequestDeviceOptions = Readonly<{
  acceptAllDevices?: boolean;
  filters?: readonly BluetoothLEScanFilter[];
  optionalServices?: readonly BluetoothServiceUUID[];
}>;

type BluetoothRemoteGATTCharacteristic = EventTarget & {
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};

type BluetoothRemoteGATTService = {
  getCharacteristic(
    characteristic: BluetoothCharacteristicUUID,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
};

type BluetoothRemoteGATTServer = {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
};

type BluetoothDevice = EventTarget & {
  readonly gatt?: BluetoothRemoteGATTServer;
  readonly id: string;
  readonly name?: string;
};

type BluetoothNavigator = Navigator & {
  readonly bluetooth?: {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  };
};

export type BleConnectionState = 'connected' | 'connecting' | 'disconnected';

export type BleDeviceInfo = Readonly<{
  deviceId?: string;
  mtuHint?: number;
  profileId?: string;
  raw: string;
  serviceUuid?: string;
}>;

export type BleTransportStatusEvent =
  | { type: 'connecting' }
  | { deviceInfo: BleDeviceInfo | null; deviceName: string | null; type: 'connected' }
  | { reason?: string; type: 'disconnected' }
  | { message: string; type: 'error' };

export type BleTransportClientOptions = Readonly<{
  commandCharacteristicUuid: BluetoothCharacteristicUUID;
  infoCharacteristicUuid?: BluetoothCharacteristicUUID;
  maxCommandBytes?: number;
  requestDeviceOptions: RequestDeviceOptions;
  responseCharacteristicUuid: BluetoothCharacteristicUUID;
  serviceUuid: BluetoothServiceUUID;
}>;

export type BleTransportProviderProps = BleTransportClientOptions &
  Readonly<{
    children: ReactNode;
    timeoutMs?: number;
  }>;

export type BleTransportContextValue = Readonly<{
  connect: () => Promise<void>;
  connectionState: BleConnectionState;
  deviceInfo: BleDeviceInfo | null;
  deviceName: string | null;
  disconnect: () => Promise<void>;
  error: string | null;
  supported: boolean;
  transport: HelixTransport<HelixMessage>;
}>;

type StatusHandler = (event: BleTransportStatusEvent) => void;

const CHARACTERISTIC_VALUE_CHANGED_EVENT = 'characteristicvaluechanged';
const GATT_SERVER_DISCONNECTED_EVENT = 'gattserverdisconnected';
const DEFAULT_MAX_COMMAND_BYTES = 700;

export const HELIX_ESP32_BLE_SERVICE_UUID = '8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0001';
export const HELIX_ESP32_BLE_COMMAND_UUID = '8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0002';
export const HELIX_ESP32_BLE_RESPONSE_UUID = '8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0003';
export const HELIX_ESP32_BLE_INFO_UUID = '8f64b6a0-0f42-4eaa-9f3b-4a8f7c3d0004';

export const HELIX_ESP32_BLE_REQUEST_DEVICE_OPTIONS: RequestDeviceOptions = {
  filters: [{ namePrefix: 'Helix ESP32' }],
  optionalServices: [HELIX_ESP32_BLE_SERVICE_UUID],
};

export const HELIX_ESP32_BLE_TRANSPORT_OPTIONS = {
  commandCharacteristicUuid: HELIX_ESP32_BLE_COMMAND_UUID,
  infoCharacteristicUuid: HELIX_ESP32_BLE_INFO_UUID,
  requestDeviceOptions: HELIX_ESP32_BLE_REQUEST_DEVICE_OPTIONS,
  responseCharacteristicUuid: HELIX_ESP32_BLE_RESPONSE_UUID,
  serviceUuid: HELIX_ESP32_BLE_SERVICE_UUID,
} satisfies BleTransportClientOptions;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const getBluetoothNavigator = (): BluetoothNavigator | null =>
  typeof navigator === 'undefined' ? null : (navigator as BluetoothNavigator);

export const isWebBluetoothSupported = (): boolean =>
  getBluetoothNavigator()?.bluetooth !== undefined;

const decodeValue = (value: DataView): string => {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return textDecoder.decode(bytes);
};

const encodeValue = (value: string): ArrayBuffer => {
  const encoded = textEncoder.encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
};

const parseDeviceInfo = (raw: string): BleDeviceInfo => {
  try {
    const parsed = JSON.parse(raw) as Partial<BleDeviceInfo>;
    return {
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : undefined,
      mtuHint: typeof parsed.mtuHint === 'number' ? parsed.mtuHint : undefined,
      profileId: typeof parsed.profileId === 'string' ? parsed.profileId : undefined,
      raw,
      serviceUuid: typeof parsed.serviceUuid === 'string' ? parsed.serviceUuid : undefined,
    };
  } catch {
    return { raw };
  }
};

export class BleTransportClient implements HelixTransport<HelixMessage> {
  readonly #handlers = new Set<HelixPacketHandler<HelixMessage>>();
  readonly #options: BleTransportClientOptions;
  readonly #statusHandlers = new Set<StatusHandler>();
  #commandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  #device: BluetoothDevice | null = null;
  #responseCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  #server: BluetoothRemoteGATTServer | null = null;

  constructor(options: BleTransportClientOptions) {
    this.#options = options;
  }

  async connect(): Promise<void> {
    if (this.#server?.connected === true) {
      return;
    }

    const bluetooth = getBluetoothNavigator()?.bluetooth;
    if (bluetooth === undefined) {
      this.#emitStatus({
        message: 'Web Bluetooth is not available in this browser.',
        type: 'error',
      });
      return;
    }

    this.#emitStatus({ type: 'connecting' });
    try {
      const device = await bluetooth.requestDevice(this.#options.requestDeviceOptions);
      this.#device = device;
      device.addEventListener(GATT_SERVER_DISCONNECTED_EVENT, this.#handleDisconnect);

      const server = await device.gatt?.connect();
      if (server === undefined) {
        throw new Error('Selected BLE device has no GATT server.');
      }

      this.#server = server;
      const service = await server.getPrimaryService(this.#options.serviceUuid);
      this.#commandCharacteristic = await service.getCharacteristic(
        this.#options.commandCharacteristicUuid,
      );
      this.#responseCharacteristic = await service.getCharacteristic(
        this.#options.responseCharacteristicUuid,
      );
      this.#responseCharacteristic.addEventListener(
        CHARACTERISTIC_VALUE_CHANGED_EVENT,
        this.#handleNotification,
      );
      await this.#responseCharacteristic.startNotifications();

      const deviceInfo = await this.#readDeviceInfo(service);
      this.#emitStatus({
        deviceInfo,
        deviceName: device.name ?? device.id,
        type: 'connected',
      });
    } catch (error) {
      this.#emitStatus({
        message: error instanceof Error ? error.message : 'BLE connection failed.',
        type: 'error',
      });
      await this.disconnect('connection failed');
    }
  }

  async close(): Promise<void> {
    await this.disconnect('transport closed');
  }

  async disconnect(reason = 'disconnected'): Promise<void> {
    try {
      if (this.#responseCharacteristic !== null) {
        await this.#responseCharacteristic.stopNotifications();
        this.#responseCharacteristic.removeEventListener(
          CHARACTERISTIC_VALUE_CHANGED_EVENT,
          this.#handleNotification,
        );
      }
    } catch {
      // Notification shutdown can fail if the device already disconnected.
    }

    this.#device?.removeEventListener(GATT_SERVER_DISCONNECTED_EVENT, this.#handleDisconnect);
    if (this.#server?.connected === true) {
      this.#server.disconnect();
    }

    this.#commandCharacteristic = null;
    this.#responseCharacteristic = null;
    this.#server = null;
    this.#device = null;
    this.#emitStatus({ reason, type: 'disconnected' });
  }

  async send(packet: HelixPacket<HelixMessage>): Promise<void> {
    if (this.#commandCharacteristic === null || this.#server?.connected !== true) {
      this.#emitStatus({ message: 'BLE command characteristic is not connected.', type: 'error' });
      return;
    }

    const data = encodeValue(jsonPacketCodec.encode(packet));
    const maxCommandBytes = this.#options.maxCommandBytes ?? DEFAULT_MAX_COMMAND_BYTES;
    if (data.byteLength > maxCommandBytes) {
      this.#emitStatus({
        message: `BLE packet is ${data.byteLength} bytes; keep it under ${maxCommandBytes} bytes.`,
        type: 'error',
      });
      return;
    }

    try {
      if (this.#commandCharacteristic.writeValueWithoutResponse !== undefined) {
        await this.#commandCharacteristic.writeValueWithoutResponse(data);
        return;
      }
      await this.#commandCharacteristic.writeValue(data);
    } catch (error) {
      this.#emitStatus({
        message: error instanceof Error ? error.message : 'BLE write failed.',
        type: 'error',
      });
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

  readonly #handleDisconnect = () => {
    this.#device?.removeEventListener(GATT_SERVER_DISCONNECTED_EVENT, this.#handleDisconnect);
    this.#commandCharacteristic = null;
    this.#responseCharacteristic = null;
    this.#server = null;
    this.#device = null;
    this.#emitStatus({ reason: 'device disconnected', type: 'disconnected' });
  };

  readonly #handleNotification = (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (characteristic.value === undefined) {
      return;
    }

    try {
      const packet = assertHelixPacket(jsonPacketCodec.decode(decodeValue(characteristic.value)));
      if (!isServiceMessage(packet.message)) {
        this.#emitStatus({ message: 'BLE notification was not a service packet.', type: 'error' });
        return;
      }

      for (const handler of this.#handlers) {
        handler(packet as HelixPacket<HelixMessage>);
      }
    } catch {
      this.#emitStatus({
        message: 'BLE notification contained invalid Helix JSON.',
        type: 'error',
      });
    }
  };

  async #readDeviceInfo(service: BluetoothRemoteGATTService): Promise<BleDeviceInfo | null> {
    if (this.#options.infoCharacteristicUuid === undefined) {
      return null;
    }

    try {
      const infoCharacteristic = await service.getCharacteristic(
        this.#options.infoCharacteristicUuid,
      );
      return parseDeviceInfo(decodeValue(await infoCharacteristic.readValue()));
    } catch {
      return null;
    }
  }

  #emitStatus(event: BleTransportStatusEvent): void {
    for (const handler of this.#statusHandlers) {
      handler(event);
    }
  }
}

const BleTransportContext = createContext<BleTransportContextValue | null>(null);

export const BleTransportProvider = ({
  children,
  commandCharacteristicUuid,
  infoCharacteristicUuid,
  maxCommandBytes,
  requestDeviceOptions,
  responseCharacteristicUuid,
  serviceUuid,
}: BleTransportProviderProps) => {
  const [connectionState, setConnectionState] = useState<BleConnectionState>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<BleDeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = isWebBluetoothSupported();

  const client = useMemo(
    () =>
      new BleTransportClient({
        commandCharacteristicUuid,
        infoCharacteristicUuid,
        maxCommandBytes,
        requestDeviceOptions,
        responseCharacteristicUuid,
        serviceUuid,
      }),
    [
      commandCharacteristicUuid,
      infoCharacteristicUuid,
      maxCommandBytes,
      requestDeviceOptions,
      responseCharacteristicUuid,
      serviceUuid,
    ],
  );

  useEffect(() => {
    const unsubscribe = client.onStatus((event) => {
      switch (event.type) {
        case 'connecting':
          setConnectionState('connecting');
          setError(null);
          break;
        case 'connected':
          setConnectionState('connected');
          setDeviceInfo(event.deviceInfo);
          setDeviceName(event.deviceName);
          setError(null);
          break;
        case 'disconnected':
          setConnectionState('disconnected');
          setDeviceInfo(null);
          setDeviceName(null);
          break;
        case 'error':
          setError(event.message);
          break;
      }
    });

    return () => {
      unsubscribe();
      void client.disconnect('provider unmounted');
    };
  }, [client]);

  const value = useMemo<BleTransportContextValue>(
    () => ({
      connect: () => client.connect(),
      connectionState,
      deviceInfo,
      deviceName,
      disconnect: () => client.disconnect('manual disconnect'),
      error,
      supported,
      transport: client,
    }),
    [client, connectionState, deviceInfo, deviceName, error, supported],
  );

  return (
    <BleTransportContext.Provider value={value}>
      <HelixTransportProvider
        isConnected={connectionState === 'connected'}
        transport={client}
        transportName="ble"
      >
        {children}
      </HelixTransportProvider>
    </BleTransportContext.Provider>
  );
};

export const HelixEsp32BleProvider = ({
  children,
  maxCommandBytes,
}: Readonly<{ children: ReactNode; maxCommandBytes?: number }>) => (
  <BleTransportProvider {...HELIX_ESP32_BLE_TRANSPORT_OPTIONS} maxCommandBytes={maxCommandBytes}>
    {children}
  </BleTransportProvider>
);

export const useBleTransport = (): BleTransportContextValue => {
  const context = useContext(BleTransportContext);
  if (context === null) {
    throw new Error('useBleTransport must be used within a BleTransportProvider.');
  }

  return context;
};
