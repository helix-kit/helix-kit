'use client';

import { useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { WebSocketProvider, useWebSocketTransport } from '@helix/protocol/websocket/react';
import { PlugZap, RotateCw, Unplug } from 'lucide-react';

import GpioControlSurface from '../../../features/gpio-control/gpio-control-surface';

const DEFAULT_WEBSOCKET_URL = 'ws://192.168.1.39/helix';
const ICON_CLASS_NAME = 'h-4 w-4';

const WebSocketTransportShell = () => {
  const websocket = useWebSocketTransport();
  const connected = websocket.connectionState === 'connected';

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-semibold">WebSocket GPIO Test</h1>
            <div className="mt-1 text-sm text-zinc-400">
              ESP32 gpio-control over direct Helix WebSocket
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-2 border px-3 py-2 text-xs uppercase ${connected ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {websocket.connectionState}
            </div>
            {connected ? (
              <Button type="button" variant="outline" onClick={websocket.disconnect}>
                <Unplug className={ICON_CLASS_NAME} />
                Disconnect
              </Button>
            ) : (
              <Button
                disabled={!websocket.supported || websocket.connectionState === 'connecting'}
                type="button"
                onClick={() => void websocket.connect()}
              >
                {websocket.connectionState === 'connecting' ? (
                  <RotateCw className={`${ICON_CLASS_NAME} animate-spin`} />
                ) : (
                  <PlugZap className={ICON_CLASS_NAME} />
                )}
                Connect
              </Button>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Device endpoint</div>
            <div className="mt-2 text-sm break-all">{websocket.url}</div>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs text-zinc-500 uppercase">Transport</div>
            <div className="mt-2 text-sm">Direct WebSocket</div>
          </div>
        </section>

        {websocket.error !== null ? (
          <section className="border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {websocket.error}
          </section>
        ) : null}

        <GpioControlSurface />
      </div>
    </main>
  );
};

const WebSocketGpioTestPage = () => {
  const [url, setUrl] = useState(DEFAULT_WEBSOCKET_URL);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_WEBSOCKET_URL);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto grid w-full max-w-5xl gap-3 px-5 pt-6 md:grid-cols-[1fr_auto] md:px-8">
        <label className="grid gap-2 text-sm">
          <span className="text-zinc-400">WebSocket URL</span>
          <input
            className="h-10 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 outline-none focus:border-zinc-400"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        </label>
        <Button
          className="self-end"
          disabled={url.trim().length === 0}
          type="button"
          onClick={() => {
            setActiveUrl(url.trim());
          }}
        >
          <PlugZap className={ICON_CLASS_NAME} />
          Apply
        </Button>
      </section>

      <WebSocketProvider key={activeUrl} url={activeUrl}>
        <WebSocketTransportShell />
      </WebSocketProvider>
    </div>
  );
};

export default WebSocketGpioTestPage;
