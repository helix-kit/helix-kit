'use client';

import { MqttGatewayProvider } from '@helix/transport-mqtt/react';

import { shellContract } from './generated/shell';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { StreamTerminal } from '../shared/terminal';
import { useClientOnly } from '../use-client-only';

// The Linux remote-shell surface: a full terminal to the device over the Helix
// gateway (control) + data plane (bytes, relayed or peer-to-peer). Gated on the
// `linux-shell` feature.
export const LinuxShellSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  // null on the server and during hydration, then the browser-derived URLs.
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading terminal…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <StreamTerminal
        clientStreamUrl={config.client}
        contract={shellContract}
        deviceStreamUrl={config.device}
        failureTag="helix-shell"
        p2pEnabled
        sessionsLabel="Shell sessions"
        storageNamespace="shell"
      />
    </MqttGatewayProvider>
  );
};
