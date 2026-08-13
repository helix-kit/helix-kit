'use client';

import { MqttGatewayProvider } from '@helix-hq/protocol/mqtt/react';

import { FileBrowser } from './browser';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { useClientOnly } from '../use-client-only';

export const LinuxFilesSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading files…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <FileBrowser clientStreamUrl={config.client} deviceStreamUrl={config.device} />
    </MqttGatewayProvider>
  );
};
