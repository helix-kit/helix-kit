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
import {
  useTypedDeviceService,
  useTypedDeviceServiceMutation,
  useTypedDeviceServiceSubscription,
} from '@helix/protocol/service/react';
import { Power, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';

import { MAX_GPIO_PIN, MIN_GPIO_PIN, gpioControlContract, type GpioStatePayload } from './contract';

import type { HelixPacket } from '@helix/protocol';
import type { HelixMessage } from '@helix/protocol/service';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOG_ENTRIES = 12;
const BUILTIN_LED_PIN = 2;
const GPIO_PIN_16 = 16;
const GPIO_PIN_17 = 17;
const GPIO_PIN_23 = 23;
const PRESET_PINS = [BUILTIN_LED_PIN, GPIO_PIN_16, GPIO_PIN_17, GPIO_PIN_23] as const;
const DEFAULT_CUSTOM_PIN = 16;
const ICON_CLASS_NAME = 'size-4';
const CUSTOM_PIN_INPUT_ID = 'helix-gpio-custom-pin';

type PacketLogEntry = Readonly<{
  id: number;
  packet: HelixPacket<HelixMessage>;
  timestamp: string;
}>;

let packetLogId = 0;

const formatTime = (): string =>
  new Intl.DateTimeFormat('en-US', { timeStyle: 'medium' }).format(new Date());

const levelLabel = (level: number | null): string => {
  if (level === 1) {
    return 'High';
  }
  if (level === 0) {
    return 'Low';
  }
  return 'Unknown';
};

const levelIndicatorClassName = (level: number | null): string => {
  if (level === 1) {
    return 'bg-emerald-500';
  }
  if (level === 0) {
    return 'bg-muted-foreground/40';
  }
  return 'bg-muted-foreground/20';
};

const applyGpioPayload = (
  payload: GpioStatePayload,
  currentLevels: ReadonlyMap<number, number>,
): Map<number, number> => {
  const nextLevels = new Map(currentLevels);
  for (const pinState of payload.pins) {
    nextLevels.set(pinState.pin, pinState.level === 0 ? 0 : 1);
  }
  return nextLevels;
};

// Read/drive a device's GPIO pins over whatever Helix transport the surrounding provider supplies (MQTT gateway on the device page; BLE/serial/WebSocket on the transport test pages).
export const GpioControls = () => {
  const gpioControl = useTypedDeviceService(gpioControlContract, { timeoutMs: REQUEST_TIMEOUT_MS });
  const readGpioMutation = useTypedDeviceServiceMutation(gpioControl, 'readGpio');
  const setGpioMutation = useTypedDeviceServiceMutation(gpioControl, 'setGpio');
  const [pinLevels, setPinLevels] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [customPin, setCustomPin] = useState(DEFAULT_CUSTOM_PIN);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [packetLogs, setPacketLogs] = useState<readonly PacketLogEntry[]>([]);

  const connected = gpioControl.isConnected;
  const knownPins = [...pinLevels.keys()].sort((left, right) => left - right);

  useTypedDeviceServiceSubscription(gpioControl, (packet) => {
    setPacketLogs((currentLogs) => [
      {
        id: packetLogId++,
        packet,
        timestamp: formatTime(),
      },
      ...currentLogs.slice(0, MAX_LOG_ENTRIES - 1),
    ]);
  });

  const applyPayload = useCallback((payload: GpioStatePayload) => {
    setPinLevels((currentLevels) => applyGpioPayload(payload, currentLevels));
  }, []);

  const refreshPins = useCallback(async () => {
    setBusyAction('refresh');
    setRequestError(null);
    try {
      const responses = await Promise.all(
        PRESET_PINS.map((pin) => readGpioMutation.mutateAsync({ pin })),
      );
      for (const response of responses) {
        applyPayload(response);
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'GPIO refresh failed.');
    } finally {
      setBusyAction(null);
    }
  }, [applyPayload, readGpioMutation]);

  const setPinLevel = useCallback(
    async (pin: number, high: boolean) => {
      const action = `${pin}:${high ? 'high' : 'low'}`;
      setBusyAction(action);
      setRequestError(null);
      try {
        const response = await setGpioMutation.mutateAsync({ high, pin });
        applyPayload(response);
      } catch (error) {
        setRequestError(error instanceof Error ? error.message : `GPIO ${pin} update failed.`);
      } finally {
        setBusyAction(null);
      }
    },
    [applyPayload, setGpioMutation],
  );

  const pinDisabled = !connected || busyAction !== null;

  const renderPinControl = (pin: number) => {
    const level = pinLevels.get(pin) ?? null;
    const highAction = `${pin}:high`;
    const lowAction = `${pin}:low`;
    return (
      <div
        key={pin}
        className="border-border/60 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
      >
        <span className={`size-2.5 rounded-full ${levelIndicatorClassName(level)}`} />
        <div className="grid gap-0.5">
          <span className="text-sm font-medium">GPIO {pin}</span>
          <span className="text-muted-foreground text-xs">{levelLabel(level)}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            disabled={pinDisabled}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void setPinLevel(pin, false)}
          >
            <ToggleLeft
              className={
                busyAction === lowAction ? `${ICON_CLASS_NAME} animate-pulse` : ICON_CLASS_NAME
              }
            />
            Low
          </Button>
          <Button
            disabled={pinDisabled}
            size="sm"
            type="button"
            onClick={() => void setPinLevel(pin, true)}
          >
            <ToggleRight
              className={
                busyAction === highAction ? `${ICON_CLASS_NAME} animate-pulse` : ICON_CLASS_NAME
              }
            />
            High
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pins</CardTitle>
          <CardDescription>
            {knownPins.length > 0 ? `Known pins: ${knownPins.join(', ')}` : 'No GPIO response yet.'}
          </CardDescription>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? 'default' : 'secondary'}>
              {connected ? 'Connected' : 'Disconnected'}
            </Badge>
            <Button
              disabled={pinDisabled}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void refreshPins()}
            >
              <RefreshCw
                className={
                  busyAction === 'refresh' ? `${ICON_CLASS_NAME} animate-spin` : ICON_CLASS_NAME
                }
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">{PRESET_PINS.map(renderPinControl)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Any pin</CardTitle>
          <CardDescription>
            Drive a pin outside the presets. GPIO {MIN_GPIO_PIN}–{MAX_GPIO_PIN}; the firmware
            rejects the flash-connected pins 6–11.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2 text-sm">
            <Label className="text-muted-foreground" htmlFor={CUSTOM_PIN_INPUT_ID}>
              Pin
            </Label>
            <Input
              className="w-28"
              id={CUSTOM_PIN_INPUT_ID}
              max={MAX_GPIO_PIN}
              min={MIN_GPIO_PIN}
              type="number"
              value={customPin}
              onChange={(event) => {
                setCustomPin(Number(event.target.value));
              }}
            />
          </div>
          <Button
            disabled={pinDisabled || !Number.isInteger(customPin)}
            type="button"
            variant="outline"
            onClick={() => void setPinLevel(customPin, false)}
          >
            <Power className={ICON_CLASS_NAME} />
            Low
          </Button>
          <Button
            disabled={pinDisabled || !Number.isInteger(customPin)}
            type="button"
            onClick={() => void setPinLevel(customPin, true)}
          >
            <Power className={ICON_CLASS_NAME} />
            High
          </Button>
        </CardContent>
      </Card>

      {requestError === null ? null : (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
          {requestError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packet log</CardTitle>
          <CardDescription>
            The last {MAX_LOG_ENTRIES} packets received from the device.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-h-72 gap-2 overflow-auto">
          {packetLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No packets received.</p>
          ) : (
            packetLogs.map((entry) => (
              <pre
                key={entry.id}
                className="border-border/60 bg-muted/40 overflow-auto rounded-md border p-3 text-xs"
              >
                {`${entry.timestamp}\n${JSON.stringify(entry.packet, null, 2)}`}
              </pre>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};
