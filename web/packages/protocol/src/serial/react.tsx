'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { HelixTransportProvider } from '@helix-hq/protocol/service/react';

import {
  isWebSerialSupported,
  SerialTransportClient,
  type SerialConnectionState,
  type SerialPortInfo,
  type SerialTransportClientOptions,
} from '.';

export type SerialTransportProviderProps = SerialTransportClientOptions &
  Readonly<{
    autoConnect?: boolean;
    children: ReactNode;
  }>;

export type SerialTransportContextValue = Readonly<{
  connect: () => Promise<void>;
  connectionState: SerialConnectionState;
  disconnect: () => Promise<void>;
  error: string | null;
  portInfo: SerialPortInfo | null;
  supported: boolean;
}>;

const SerialTransportContext = createContext<SerialTransportContextValue | null>(null);
const subscribeSerialSupport = (): (() => void) => () => undefined;

export const SerialTransportProvider = ({
  autoConnect = false,
  baudRate,
  bufferSize,
  children,
  errorPrefix,
  filters,
  inputPrefix,
  openSignals,
  outputPrefix,
  port,
}: SerialTransportProviderProps) => {
  const [connectionState, setConnectionState] = useState<SerialConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);
  const supported = useSyncExternalStore(
    subscribeSerialSupport,
    () => isWebSerialSupported() || port !== undefined,
    () => port !== undefined,
  );
  const client = useMemo(
    () =>
      new SerialTransportClient({
        baudRate,
        bufferSize,
        errorPrefix,
        filters,
        inputPrefix,
        openSignals,
        outputPrefix,
        port,
      }),
    [baudRate, bufferSize, errorPrefix, filters, inputPrefix, openSignals, outputPrefix, port],
  );

  useEffect(() => {
    const unsubscribe = client.onStatus((event) => {
      setConnectionState(event.type);
      if (event.type === 'connected') {
        setError(null);
        setPortInfo(event.portInfo);
      } else if (event.type === 'disconnected') {
        setPortInfo(null);
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
    if (autoConnect) {
      void client.connect();
    }
    return () => {
      unsubscribe();
      void client.disconnect('provider unmounted');
    };
  }, [autoConnect, client]);

  const value = useMemo<SerialTransportContextValue>(
    () => ({
      connect: () => client.connect(),
      connectionState,
      disconnect: () => client.disconnect(),
      error,
      portInfo,
      supported,
    }),
    [client, connectionState, error, portInfo, supported],
  );

  return (
    <SerialTransportContext.Provider value={value}>
      <HelixTransportProvider
        isConnected={connectionState === 'connected'}
        transport={client}
        transportName="serial"
      >
        {children}
      </HelixTransportProvider>
    </SerialTransportContext.Provider>
  );
};

export const useSerialTransport = (): SerialTransportContextValue => {
  const context = useContext(SerialTransportContext);
  if (context === null) {
    throw new Error('useSerialTransport must be used within a SerialTransportProvider.');
  }
  return context;
};
