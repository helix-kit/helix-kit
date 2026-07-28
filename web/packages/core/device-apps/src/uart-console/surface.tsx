'use client';

import { MqttGatewayProvider } from '@helix/transport-mqtt/react';

import { consoleContract } from './generated/console';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { StreamTerminal } from '../shared/terminal';
import { useClientOnly } from '../use-client-only';

// The UART console surface: a terminal to a target device's serial console,
// bridged by an ESP32 running the Helix `console` firmware. Rides the same
// HelixStream data plane as the Linux shell, but relay-only (the bridge has no
// WebRTC). Gated on the `uart-console` feature.
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
