'use client';

import { useCallback, useState } from 'react';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Input } from '@helix/design-system/components/input';
import { Label } from '@helix/design-system/components/label';
import { useTypedDeviceService, useTypedDeviceServiceQuery } from '@helix/protocol-service/react';
import { MqttGatewayProvider } from '@helix/transport-mqtt/react';
import { ExternalLink, Play, RefreshCw, Square } from 'lucide-react';

import { portForwardControlContract } from './contract';

import type { DeviceAppSurfaceProps } from '../types';

import { formatAge, useNow } from '../session-format';
import { useClientOnly } from '../use-client-only';

const OPEN_TIMEOUT_MS = 15_000;
const LIST_POLL_MS = 3000;

const gatewayWsUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_GATEWAY_WS_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

const deviceStreamUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_HELIX_DEVICE_STREAM_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  return `wss://${window.location.hostname}:4001/stream/device`;
};

const publicUrl = (sessionId: string): string =>
  `https://${sessionId}.port.${window.location.hostname}`;

type StreamConfig = { gateway: string; device: string };

// The URLs derive from `window.location`, so they can only be built in the
// browser. Memoised at module scope: useClientOnly compares snapshots by
// identity, so this must return the same object every call.
let cachedConfig: StreamConfig | null = null;
const getStreamConfig = (): StreamConfig =>
  (cachedConfig ??= { gateway: gatewayWsUrl(), device: deviceStreamUrl() });

const PortForwardPanel = ({ deviceStream }: { deviceStream: string }) => {
  const pf = useTypedDeviceService(portForwardControlContract, { timeoutMs: OPEN_TIMEOUT_MS });
  const sessionsQuery = useTypedDeviceServiceQuery(
    pf,
    'list',
    {},
    { refetchInterval: LIST_POLL_MS },
  );
  const now = useNow();
  const [target, setTarget] = useState('127.0.0.1:8080');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    const sessionId = crypto.randomUUID();
    const sep = deviceStream.includes('?') ? '&' : '?';
    const dataUrl = `${deviceStream}${sep}session=${encodeURIComponent(sessionId)}`;
    try {
      await pf.request('open', { sessionId, target: target.trim(), dataUrl });
      await pf.invalidateQueries('list', {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to open the forward');
    } finally {
      setBusy(false);
    }
  }, [pf, target, deviceStream]);

  const stop = useCallback(
    async (sessionId: string) => {
      setClosing((prev) => new Set(prev).add(sessionId));
      try {
        await pf.request('close', { sessionId });
      } catch {
        /* the tunnel is torn down regardless */
      }
      await pf.invalidateQueries('list', {});
      setClosing((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    },
    [pf],
  );

  const sessions = [...(sessionsQuery.data?.sessions ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Port forward</CardTitle>
        <CardDescription>
          Expose a TCP/HTTP service reachable from this device at a public URL. The device must
          allow the target.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Label htmlFor="pf-target">Target (host:port on the device)</Label>
        <div className="flex gap-2">
          <Input
            className="font-mono"
            id="pf-target"
            placeholder="127.0.0.1:8080"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          />
          <Button disabled={busy || target.trim() === ''} onClick={() => void start()}>
            <Play />
            {busy ? 'Opening…' : 'Start'}
          </Button>
        </div>
        {error === null ? null : <p className="text-destructive text-xs">{error}</p>}
      </CardContent>
      <CardContent className="grid gap-2 pt-0">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>Active forwards ({sessions.length})</span>
          <button
            aria-label="Refresh sessions"
            className="hover:text-foreground inline-flex items-center gap-1"
            type="button"
            onClick={() => void pf.invalidateQueries('list', {})}
          >
            <RefreshCw className={`size-3.5 ${sessionsQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {sessionsQuery.isError ? sessionsQuery.error.message : 'No open forwards.'}
          </p>
        ) : (
          <ul className="grid gap-2">
            {sessions.map((session) => {
              const url = publicUrl(session.sessionId);
              const isClosing = closing.has(session.sessionId);
              return (
                <li
                  key={session.sessionId}
                  className="border-border/60 grid gap-2 rounded-md border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid min-w-0 gap-1">
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-500" />
                        Forwarding{' '}
                        <span className="text-foreground font-mono">{session.target}</span>
                      </div>
                      <a
                        className="text-brand inline-flex items-center gap-1.5 truncate font-mono text-sm hover:underline"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {url}
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                    </div>
                    <Button
                      className="shrink-0"
                      disabled={isClosing}
                      size="sm"
                      variant="outline"
                      onClick={() => void stop(session.sessionId)}
                    >
                      <Square />
                      {isClosing ? 'Stopping…' : 'Stop'}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="font-normal" variant="secondary">
                      {session.connections}{' '}
                      {session.connections === 1 ? 'connection' : 'connections'}
                    </Badge>
                    <Badge className="font-normal" variant="secondary">
                      up {formatAge(session.createdAt, now)}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <CardContent className="pt-0">
        <Badge className="font-normal" variant="secondary">
          {`device dials ${deviceStream.replace(/\?.*$/, '')}`}
        </Badge>
      </CardContent>
    </Card>
  );
};

// The Linux port-forward surface: open public tunnels to services reachable from
// the device and manage every open forward (details + close any). Control rides
// the gateway; the bytes ride the data plane. Gated on the `linux-port-forward`
// feature.
export const LinuxPortForwardSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  // null on the server and during hydration, then the browser-derived URLs.
  const config = useClientOnly(getStreamConfig);

  if (config === null) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <MqttGatewayProvider deviceId={deviceId} gatewayUrl={config.gateway}>
      <PortForwardPanel deviceStream={config.device} />
    </MqttGatewayProvider>
  );
};
