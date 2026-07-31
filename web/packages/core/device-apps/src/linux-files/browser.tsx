'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { selectedCandidatePair } from '@helix/protocol-peer';
import { useTypedDeviceService, useTypedDeviceServiceQuery } from '@helix/protocol-service/react';
import { useMqttGatewayTransport } from '@helix/transport-mqtt/react';
import { ChevronUp, Download, File as FileIcon, Folder, RefreshCw, Upload } from 'lucide-react';

import { filesControlContract, type FileEntry } from './contract';
import { downloadFile, uploadFile, type TransferContext } from './transfer';

import type { HelixStreamSession } from '@helix/protocol-stream';

import {
  openFailureMessage,
  openSession,
  useIceServers,
  type DataPlaneTransport,
  type SessionService,
} from '../data-plane';
import { HeaderPortal } from '../header-portal';

const OPEN_TIMEOUT_MS = 30_000;
const BYTES_PER_KB = 1024;
const PERCENT = 100;

const fmtBytes = (n: number): string => {
  if (n < BYTES_PER_KB) {
    return `${n} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / BYTES_PER_KB;
  let unit = 0;
  while (value >= BYTES_PER_KB && unit < units.length - 1) {
    value /= BYTES_PER_KB;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const fmtDate = (ms: number): string => new Date(ms).toLocaleString();

type Status = 'connecting' | 'opening' | 'ready' | 'error';

type Transfer = {
  id: number;
  name: string;
  direction: 'down' | 'up';
  bytes: number;
  total: number;
  done: boolean;
  error?: string;
};

const transferLabel = (item: Transfer): string => {
  if (item.error !== undefined) {
    return item.error;
  }
  const moved = fmtBytes(item.bytes);
  return item.total > 0 ? `${moved} / ${fmtBytes(item.total)}` : moved;
};

// A transfer of unknown total (0) shows nothing until it completes, not a lying bar.
const progressPercent = (item: Transfer): number => {
  if (item.total > 0) {
    return Math.min(PERCENT, (item.bytes / item.total) * PERCENT);
  }
  return item.done ? PERCENT : 0;
};

// Streaming a download straight to disk needs the File System Access API; without
// it we would have to buffer the whole file in the tab.
const canStreamToDisk = (): boolean =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

type PickerWindow = Window & {
  showSaveFilePicker: (options: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
};

export const FileBrowser = ({
  clientStreamUrl,
  deviceStreamUrl,
}: {
  clientStreamUrl: string;
  deviceStreamUrl: string;
}) => {
  const mqtt = useMqttGatewayTransport();
  const files = useTypedDeviceService(filesControlContract, { timeoutMs: OPEN_TIMEOUT_MS });

  const [transport, setTransport] = useState<DataPlaneTransport>('p2p');
  // ICE servers must be in hand before opening: a device that gathers no candidates
  // can only fail to connect.
  const { iceServers, isLoading: iceLoading } = useIceServers(transport === 'p2p');
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [icePath, setIcePath] = useState<string | null>(null);
  const [path, setPath] = useState<string>('');
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const sessionRef = useRef<string | null>(null);
  const peerSessionRef = useRef<HelixStreamSession | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Derived, not stored: storing it meant setting state from an effect and showing
  // "connecting" for the whole 20s open.
  const status: Status = ((): Status => {
    if (detail !== null) {
      return 'error';
    }
    if (ready) {
      return 'ready';
    }
    return files.isConnected ? 'opening' : 'connecting';
  })();

  const rootsQuery = useTypedDeviceServiceQuery(files, 'roots', {}, { enabled: files.isConnected });
  // Until the user navigates, show the device's first exposed root (derived, not stored).
  const currentPath = path !== '' ? path : (rootsQuery.data?.roots[0] ?? '');
  const listing = useTypedDeviceServiceQuery(
    files,
    'list',
    { path: currentPath },
    { enabled: files.isConnected && status === 'ready' && currentPath !== '' },
  );

  useEffect(() => {
    void mqtt.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportIcePath = useCallback((connection: RTCPeerConnection | null) => {
    if (connection === null) {
      setIcePath(null);
      return;
    }
    void selectedCandidatePair(connection).then((pair) => {
      setIcePath(pair === null ? null : `${pair.local}/${pair.remote}`);
      return undefined;
    });
  }, []);

  // Open the data-plane session; p2p is the default since bulk file bytes are why it exists.
  useEffect(() => {
    if (!files.isConnected || sessionRef.current !== null) {
      return;
    }
    // Opening without the ICE config is a guaranteed failure, not a degraded connection.
    if (transport === 'p2p' && iceLoading) {
      return;
    }
    const sessionId = crypto.randomUUID();
    sessionRef.current = sessionId;

    void openSession({
      service: files as unknown as SessionService,
      sessionId,
      transport,
      deviceStreamUrl,
      iceServers,
    })
      .then((session) => {
        if (sessionRef.current !== sessionId) {
          session.close();
          return undefined;
        }
        peerSessionRef.current = session.peerSession;
        closeRef.current = session.close;
        setDetail(null);
        setReady(true);
        reportIcePath(session.connection);
        return undefined;
      })
      .catch((error: unknown) => {
        if (sessionRef.current !== sessionId) {
          return;
        }
        setDetail(openFailureMessage(error, 'helix-files'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.isConnected, transport, deviceStreamUrl, reportIcePath, iceLoading, iceServers]);

  const switchTransport = useCallback((next: DataPlaneTransport) => {
    closeRef.current?.();
    closeRef.current = null;
    peerSessionRef.current = null;
    sessionRef.current = null;
    setIcePath(null);
    setReady(false);
    setDetail(null);
    setTransport(next);
  }, []);

  const context = useCallback(
    (): TransferContext => ({
      peerSession: peerSessionRef.current,
      sessionId: sessionRef.current ?? '',
      clientStreamUrl,
    }),
    [clientStreamUrl],
  );

  const nextId = useRef(0);

  const track = useCallback((name: string, direction: 'down' | 'up', total: number): number => {
    const id = nextId.current;
    nextId.current += 1;
    setTransfers((current) => [...current, { id, name, direction, bytes: 0, total, done: false }]);
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Transfer>) => {
    setTransfers((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const download = useCallback(
    async (entry: FileEntry) => {
      if (!canStreamToDisk()) {
        setDetail('This browser cannot stream downloads to disk (needs File System Access).');
        return;
      }
      const handle = await (window as unknown as PickerWindow)
        .showSaveFilePicker({ suggestedName: entry.name })
        .catch(() => null);
      if (handle === null) {
        return; // the user cancelled the save dialog
      }
      const sink = await handle.createWritable();
      const id = track(entry.name, 'down', entry.size);
      try {
        const bytes = await downloadFile(context(), entry.path, sink, (n) => {
          update(id, { bytes: n });
        });
        update(id, { bytes, done: true });
      } catch (error: unknown) {
        update(id, {
          done: true,
          error: error instanceof Error ? error.message : 'download failed',
        });
      }
    },
    [context, track, update],
  );

  const upload = useCallback(
    async (file: File) => {
      const target = `${currentPath}/${file.name}`;
      const id = track(file.name, 'up', file.size);
      try {
        const bytes = await uploadFile(context(), target, file, (n) => {
          update(id, { bytes: n });
        });
        update(id, { bytes, done: true });
        await files.invalidateQueries('list', { path: currentPath });
      } catch (error: unknown) {
        update(id, {
          done: true,
          error: error instanceof Error ? error.message : 'upload failed',
        });
      }
    },
    [context, files, currentPath, track, update],
  );

  const entries = listing.data?.entries ?? [];
  const parent = listing.data?.parent;

  return (
    <>
      <HeaderPortal>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="border-border/60 hidden items-center rounded-md border lg:inline-flex">
            <button
              className={`px-2 py-1 ${transport === 'relay' ? 'text-foreground' : 'hover:text-foreground'}`}
              title="Bytes are relayed through the cloud gateway."
              type="button"
              onClick={() => {
                switchTransport('relay');
              }}
            >
              relay
            </button>
            <button
              className={`px-2 py-1 ${transport === 'p2p' ? 'text-foreground' : 'hover:text-foreground'}`}
              title="Bytes go browser-to-device directly. No cloud bandwidth."
              type="button"
              onClick={() => {
                switchTransport('p2p');
              }}
            >
              p2p
            </button>
            {icePath === null ? null : (
              <span
                className="border-border/60 border-l px-2 py-1 font-mono"
                title="The ICE candidate pair in use"
              >
                {icePath}
              </span>
            )}
          </span>
          <span>{status}</span>
        </div>
      </HeaderPortal>

      <div className="grid gap-4">
        {detail === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {detail}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            className="border-border/60 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-40"
            disabled={parent === undefined}
            type="button"
            onClick={() => {
              if (parent !== undefined) {
                setPath(parent);
              }
            }}
          >
            <ChevronUp className="size-3.5" /> Up
          </button>
          <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {listing.data?.path ?? currentPath}
          </code>
          <button
            aria-label="Refresh"
            className="border-border/60 text-muted-foreground hover:text-foreground rounded-md border p-1"
            type="button"
            onClick={() => void files.invalidateQueries('list', { path: currentPath })}
          >
            <RefreshCw className={`size-3.5 ${listing.isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            className="border-border/60 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-40"
            disabled={status !== 'ready'}
            type="button"
            onClick={() => uploadInputRef.current?.click()}
          >
            <Upload className="size-3.5" /> Upload
          </button>
          <input
            ref={uploadInputRef}
            className="hidden"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void upload(file);
              }
              event.target.value = '';
            }}
          />
        </div>

        <div className="border-border/60 overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground bg-muted/40 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
                <th className="px-3 py-2 text-left font-medium">Modified</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td className="text-muted-foreground px-3 py-6 text-center text-xs" colSpan={4}>
                    {listing.isLoading ? 'Loading…' : 'Empty directory'}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.path} className="border-border/40 hover:bg-muted/30 border-t">
                    <td className="px-3 py-2">
                      {entry.isDir ? (
                        <button
                          className="hover:text-foreground inline-flex items-center gap-2"
                          type="button"
                          onClick={() => {
                            setPath(entry.path);
                          }}
                        >
                          <Folder className="text-brand size-4" />
                          {entry.name}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <FileIcon className="text-muted-foreground size-4" />
                          {entry.name}
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-right text-xs tabular-nums">
                      {entry.isDir ? '—' : fmtBytes(entry.size)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {fmtDate(entry.modifiedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {entry.isDir ? null : (
                        <button
                          aria-label={`Download ${entry.name}`}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={status !== 'ready'}
                          type="button"
                          onClick={() => void download(entry)}
                        >
                          <Download className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {transfers.length === 0 ? null : (
          <div className="border-border/60 grid gap-2 rounded-md border p-3">
            {transfers.map((item) => (
              <div key={item.id} className="grid gap-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-foreground truncate">
                    {item.direction === 'down' ? '↓' : '↑'} {item.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{transferLabel(item)}</span>
                </div>
                <div className="bg-muted h-1 overflow-hidden rounded">
                  <div
                    className={`h-full ${item.error === undefined ? 'bg-brand' : 'bg-destructive'}`}
                    style={{ width: `${progressPercent(item)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
