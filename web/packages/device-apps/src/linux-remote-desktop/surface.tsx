'use client';

import { MqttGatewayProvider } from '@helix-hq/protocol/mqtt/react';

import { RemoteDesktop } from './desktop';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { useClientOnly } from '../use-client-only';

// The Linux remote-desktop surface: a VNC server on the device, rendered in the
// browser over the Helix gateway + data plane. No gateway service in the middle —
// RFB rides the same tunnel the port-forward app already opens.
export const LinuxRemoteDesktopSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading desktop…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <RemoteDesktop clientStreamUrl={config.client} deviceStreamUrl={config.device} />
    </MqttGatewayProvider>
  );
};
