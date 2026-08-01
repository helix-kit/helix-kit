'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Progress } from '@helix/design-system/components/progress';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, RefreshCw, Usb } from 'lucide-react';

import { type Esp32FirmwareManifest } from './flash';
import { useEsp32Flasher } from './use-flasher';

import type { EspFlasherRouter } from './router';
import type { DeviceAppSurfaceProps } from '../types';

import { useDeviceAppApi } from '../trpc';

// ESP32 flashing surface: resolves the device's entitled firmware, lets the user pick one, and flashes it over Web Serial.
export const Esp32FlasherSurface = ({ deviceId }: DeviceAppSurfaceProps) => {
  const api = useDeviceAppApi<EspFlasherRouter>('espFlasher');
  const firmwaresQuery = useQuery(api.getFirmwares.queryOptions({ deviceId }));
  const firmwares = useMemo(() => firmwaresQuery.data ?? [], [firmwaresQuery.data]);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selected =
    firmwares.find((firmware) => firmware.variantId === selectedVariantId) ?? firmwares[0] ?? null;

  const { error, flash, flashing, progress } = useEsp32Flasher();
  const [log, setLog] = useState<readonly string[]>([]);

  // useSyncExternalStore returns the server snapshot (false) during SSR, then the real value after hydration, without a mismatch.
  const webSerialSupported = useSyncExternalStore(
    () => () => {},
    () => typeof navigator !== 'undefined' && 'serial' in navigator,
    () => false,
  );

  const onFlash = useCallback(async () => {
    if (selected === null) {
      return;
    }
    setLog([]);
    try {
      await flash({
        manifest: selected.manifest as Esp32FirmwareManifest,
        onLog: (message) => {
          setLog((prev) => [...prev, message]);
        },
      });
    } catch {
      // surfaced via the hook's `error` state
    }
  }, [flash, selected]);

  return (
    <div className="grid gap-6">
      {webSerialSupported ? null : (
        <div className="border-destructive/40 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <CircleAlert className="size-4 shrink-0" />
          Web Serial isn&apos;t available in this browser. Use Chrome or Edge over HTTPS or
          localhost.
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div className="grid gap-1">
            <CardTitle className="text-base">Firmware</CardTitle>
            <CardDescription>
              Firmware resolved for this device from its profiles. Select one to flash.
            </CardDescription>
          </div>
          <Button
            aria-label="Refresh"
            className="size-8"
            disabled={firmwaresQuery.isFetching}
            size="icon"
            variant="ghost"
            onClick={() => {
              void firmwaresQuery.refetch();
            }}
          >
            <RefreshCw className={firmwaresQuery.isFetching ? 'animate-spin' : ''} />
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2">
          {firmwaresQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Resolving firmware…</p>
          ) : null}
          {!firmwaresQuery.isLoading && firmwares.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No firmware resolves for this device. Assign a profile with an esp32-firmware track.
            </p>
          ) : null}
          {firmwares.map((firmware) => {
            const isSelected = selected?.variantId === firmware.variantId;
            return (
              <button
                key={firmware.variantId}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                  isSelected ? 'border-brand bg-accent' : 'border-border/60 hover:bg-accent/50'
                }`}
                type="button"
                onClick={() => {
                  setSelectedVariantId(firmware.variantId);
                }}
              >
                <div className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">{firmware.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {firmware.manifest.artifacts.length} artifact(s) · {firmware.manifest.flashSize}
                  </span>
                </div>
                {firmware.featureSet === null ? null : (
                  <Badge className="ml-auto font-normal" variant="secondary">
                    {firmware.featureSet}
                  </Badge>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flash</CardTitle>
          <CardDescription>
            Device <span className="font-mono">{deviceId}</span>. Connect the ESP32 over USB and
            flash the selected firmware.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button
            className="w-fit"
            disabled={selected === null || flashing || !webSerialSupported}
            onClick={() => {
              void onFlash();
            }}
          >
            <Usb />
            {flashing ? 'Flashing…' : 'Select port & flash'}
          </Button>

          {progress === null ? null : (
            <div className="grid gap-1">
              <div className="text-muted-foreground flex justify-between text-xs">
                <span className="truncate">{progress.artifact.name}</span>
                <span className="tabular-nums">{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} />
            </div>
          )}

          {error === null ? null : <p className="text-destructive text-xs">{error}</p>}

          {log.length === 0 ? null : (
            <pre className="bg-muted/50 max-h-48 overflow-auto rounded-md p-3 text-xs">
              {log.join('\n')}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
