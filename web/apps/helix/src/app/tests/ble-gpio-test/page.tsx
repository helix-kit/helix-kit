'use client';

import { Button } from '@helix-hq/design-system/components/button';
import { GpioControls } from '@helix-hq/device-apps';
import { HelixEsp32BleProvider, useBleTransport } from '@helix-hq/protocol/ble';
import { Bluetooth, Unplug } from 'lucide-react';

const ICON_CLASS_NAME = 'h-4 w-4';

const BleTransportShell = () => {
  const bluetooth = useBleTransport();
  const connected = bluetooth.connectionState === 'connected';

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-semibold">BLE GPIO Test</h1>
            <div className="mt-1 text-sm text-zinc-400">
              ESP32 gpio-control over Helix BLE protocol
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
              {bluetooth.connectionState}
            </div>
            {connected ? (
              <Button type="button" variant="outline" onClick={() => void bluetooth.disconnect()}>
                <Unplug className={ICON_CLASS_NAME} />
                Disconnect
              </Button>
            ) : (
              <Button
                disabled={!bluetooth.supported || bluetooth.connectionState === 'connecting'}
                type="button"
                onClick={() => void bluetooth.connect()}
              >
                <Bluetooth
                  className={
                    bluetooth.connectionState === 'connecting'
                      ? `${ICON_CLASS_NAME} animate-pulse`
                      : ICON_CLASS_NAME
                  }
                />
                Connect BLE
              </Button>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Browser</div>
            <div className="mt-2 text-sm">
              {bluetooth.supported ? 'Web Bluetooth ready' : 'Unsupported'}
            </div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Device</div>
            <div className="mt-2 text-sm break-all">{bluetooth.deviceName ?? 'Not selected'}</div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Transport</div>
            <div className="mt-2 text-sm">BLE</div>
          </div>
        </section>

        {bluetooth.deviceInfo !== null ? (
          <pre className="overflow-auto border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300">
            {JSON.stringify(bluetooth.deviceInfo, null, 2)}
          </pre>
        ) : null}

        {bluetooth.error !== null ? (
          <section className="border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {bluetooth.error}
          </section>
        ) : null}

        <GpioControls />
      </div>
    </main>
  );
};

const BleGpioTestPage = () => (
  <HelixEsp32BleProvider>
    <BleTransportShell />
  </HelixEsp32BleProvider>
);

export default BleGpioTestPage;
