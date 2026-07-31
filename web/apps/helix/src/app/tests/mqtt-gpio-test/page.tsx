'use client';

import { useMemo, useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { MqttGatewayProvider, useMqttGatewayTransport } from '@helix/protocol/mqtt/react';
import { PlugZap, RotateCw, Unplug } from 'lucide-react';

import GpioControlSurface from '../../../features/gpio-control/gpio-control-surface';

const ICON_CLASS_NAME = 'h-4 w-4';
const DEFAULT_DEVICE_ID = 'helix-esp32-usb';
const DEFAULT_GATEWAY_URL = 'ws://localhost:4010/ws';

type MqttTransportShellProps = Readonly<{
  deviceId: string;
  gatewayUrl: string;
}>;

const MqttTransportShell = ({ deviceId, gatewayUrl }: MqttTransportShellProps) => {
  const mqtt = useMqttGatewayTransport();
  const connected = mqtt.connectionState === 'connected';

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-semibold">MQTT GPIO Test</h1>
            <div className="mt-1 text-sm text-zinc-400">
              ESP32 gpio-control over Helix MQTT gateway protocol
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex items-center gap-2 border px-3 py-2 text-xs uppercase ${
                connected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {mqtt.connectionState}
            </div>
            {connected ? (
              <Button type="button" variant="outline" onClick={() => void mqtt.disconnect()}>
                <Unplug className={ICON_CLASS_NAME} />
                Disconnect
              </Button>
            ) : (
              <Button
                disabled={!mqtt.supported || mqtt.connectionState === 'connecting'}
                type="button"
                onClick={() => void mqtt.connect()}
              >
                {mqtt.connectionState === 'connecting' ? (
                  <RotateCw className={`${ICON_CLASS_NAME} animate-spin`} />
                ) : (
                  <PlugZap className={ICON_CLASS_NAME} />
                )}
                Connect gateway
              </Button>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Device ID</div>
            <div className="mt-2 text-sm break-all">{deviceId}</div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Gateway</div>
            <div className="mt-2 text-sm break-all">{gatewayUrl}</div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Transport</div>
            <div className="mt-2 text-sm">MQTT gateway</div>
          </div>
        </section>

        {mqtt.error !== null ? (
          <section className="border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {mqtt.error}
          </section>
        ) : null}

        <GpioControlSurface />
      </div>
    </main>
  );
};

const MqttGpioTestPage = () => {
  const [deviceId, setDeviceId] = useState(DEFAULT_DEVICE_ID);
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [activeConfig, setActiveConfig] = useState({
    deviceId: DEFAULT_DEVICE_ID,
    gatewayUrl: DEFAULT_GATEWAY_URL,
  });
  const providerKey = useMemo(
    () => `${activeConfig.gatewayUrl}:${activeConfig.deviceId}`,
    [activeConfig.deviceId, activeConfig.gatewayUrl],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto grid w-full max-w-5xl gap-3 px-5 pt-6 md:grid-cols-[1fr_1fr_auto] md:px-8">
        <label className="grid gap-2 text-sm">
          <span className="text-zinc-400">Device ID</span>
          <input
            className="h-10 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 outline-none focus:border-zinc-400"
            value={deviceId}
            onChange={(event) => {
              setDeviceId(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="text-zinc-400">Gateway URL</span>
          <input
            className="h-10 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 outline-none focus:border-zinc-400"
            value={gatewayUrl}
            onChange={(event) => {
              setGatewayUrl(event.target.value);
            }}
          />
        </label>
        <Button
          className="self-end"
          disabled={deviceId.trim().length === 0 || gatewayUrl.trim().length === 0}
          type="button"
          onClick={() => {
            setActiveConfig({
              deviceId: deviceId.trim(),
              gatewayUrl: gatewayUrl.trim(),
            });
          }}
        >
          <PlugZap className={ICON_CLASS_NAME} />
          Apply
        </Button>
      </section>

      <MqttGatewayProvider
        key={providerKey}
        deviceId={activeConfig.deviceId}
        gatewayUrl={activeConfig.gatewayUrl}
      >
        <MqttTransportShell deviceId={activeConfig.deviceId} gatewayUrl={activeConfig.gatewayUrl} />
      </MqttGatewayProvider>
    </div>
  );
};

export default MqttGpioTestPage;
