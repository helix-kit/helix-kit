'use client';

import { useState } from 'react';

import { Button } from '@helix-hq/design-system/components/button';
import { Textarea } from '@helix-hq/design-system/components/textarea';
import { GpioControls } from '@helix-hq/device-apps';
import {
  ESP32_LINUX_SERIAL_PREP_COMMAND,
  ESP32_SERIAL_PORT_FILTERS,
} from '@helix-hq/device-apps/esp32-flasher';
import { SerialTransportProvider, useSerialTransport } from '@helix-hq/protocol/serial/react';
import { Check, Copy, PlugZap, RotateCw, Unplug } from 'lucide-react';

const ICON_CLASS_NAME = 'h-4 w-4';
const HEX_RADIX = 16;
const PREP_COPY_RESET_DELAY_MS = 1500;
const USB_ID_WIDTH = 4;

const formatUsbId = (value: number | undefined): string =>
  value === undefined ? 'unknown' : `0x${value.toString(HEX_RADIX).padStart(USB_ID_WIDTH, '0')}`;

const SerialTransportShell = () => {
  const serial = useSerialTransport();
  const [prepCopied, setPrepCopied] = useState(false);
  const connected = serial.connectionState === 'connected';

  const copyPrepCommand = async () => {
    await navigator.clipboard.writeText(ESP32_LINUX_SERIAL_PREP_COMMAND);
    setPrepCopied(true);
    window.setTimeout(() => {
      setPrepCopied(false);
    }, PREP_COPY_RESET_DELAY_MS);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-semibold">Serial GPIO Test</h1>
            <div className="mt-1 text-sm text-zinc-400">
              ESP32 gpio-control over Helix Web Serial
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-2 border px-3 py-2 text-xs uppercase ${
                connected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {serial.connectionState}
            </div>
            {connected ? (
              <Button type="button" variant="outline" onClick={() => void serial.disconnect()}>
                <Unplug className={ICON_CLASS_NAME} />
                Disconnect
              </Button>
            ) : (
              <Button
                disabled={!serial.supported || serial.connectionState === 'connecting'}
                type="button"
                onClick={() => void serial.connect()}
              >
                {serial.connectionState === 'connecting' ? (
                  <RotateCw className={`${ICON_CLASS_NAME} animate-spin`} />
                ) : (
                  <PlugZap className={ICON_CLASS_NAME} />
                )}
                Connect
              </Button>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Browser</div>
            <div className="mt-2 text-sm">
              {serial.supported ? 'Web Serial ready' : 'Web Serial unsupported'}
            </div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">USB device</div>
            <div className="mt-2 text-sm">
              {serial.portInfo === null
                ? 'Not selected'
                : `${formatUsbId(serial.portInfo.usbVendorId)}:${formatUsbId(
                    serial.portInfo.usbProductId,
                  )}`}
            </div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Transport</div>
            <div className="mt-2 text-sm">Web Serial at 115200 baud</div>
          </div>
        </section>

        {serial.error !== null ? (
          <section className="border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {serial.error}
          </section>
        ) : null}

        <section className="border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Linux CP210x prep command</h2>
              <div className="mt-1 text-xs text-zinc-500">
                Run once when Web Serial cannot open the ESP32 USB port.
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => void copyPrepCommand()}>
              {prepCopied ? (
                <Check className={ICON_CLASS_NAME} />
              ) : (
                <Copy className={ICON_CLASS_NAME} />
              )}
              {prepCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Textarea
            className="mt-3 min-h-24 resize-none border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-200"
            readOnly
            value={ESP32_LINUX_SERIAL_PREP_COMMAND}
          />
        </section>

        <GpioControls />
      </div>
    </main>
  );
};

const SerialGpioTestPage = () => (
  <SerialTransportProvider filters={ESP32_SERIAL_PORT_FILTERS}>
    <SerialTransportShell />
  </SerialTransportProvider>
);

export default SerialGpioTestPage;
