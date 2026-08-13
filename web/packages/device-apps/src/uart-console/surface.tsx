'use client';

import { MqttGatewayProvider } from '@helix-hq/protocol/mqtt/react';

import { consoleContract } from './generated/console';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { StreamTerminal } from '../shared/terminal';
import { useClientOnly } from '../use-client-only';

// UART console surface: a terminal to a device's serial console bridged by an ESP32 running the `console` firmware; rides the HelixStream data plane, relay-only.
export const UartConsoleSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading console…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <StreamTerminal
        clientStreamUrl={config.client}
        contract={consoleContract}
        deviceStreamUrl={config.device}
        failureTag="helix-uart-console"
        p2pEnabled={false}
        sessionsLabel="Console sessions"
        storageNamespace="uart-console"
      />
    </MqttGatewayProvider>
  );
};
