'use client';

import { MqttGatewayProvider } from '@helix-hq/protocol/mqtt/react';

import { GpioControls } from './controls';

import type { DeviceAppSurfaceProps } from '../types';

import { getStreamConfig } from '../data-plane';
import { useClientOnly } from '../use-client-only';

// GPIO surface on the device page: the controls driven over the MQTT gateway control plane (no data plane — every request is one small JSON packet).
export const GpioControlSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading GPIO control…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <GpioControls />
    </MqttGatewayProvider>
  );
};
