'use client';

import { useCallback, useState } from 'react';

import { Button } from '@helix/design-system/components/button';
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
const TEST_PINS = [BUILTIN_LED_PIN, GPIO_PIN_16, GPIO_PIN_17, GPIO_PIN_23] as const;
const DEFAULT_CUSTOM_PIN = 16;
const ICON_CLASS_NAME = 'h-4 w-4';

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
    return 'bg-emerald-400';
  }
  if (level === 0) {
    return 'bg-zinc-500';
  }
  return 'bg-zinc-700';
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

const GpioControlSurface = () => {
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
        TEST_PINS.map((pin) => readGpioMutation.mutateAsync({ pin })),
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

  const renderPinControl = (pin: number) => {
    const level = pinLevels.get(pin) ?? null;
    const highAction = `${pin}:high`;
    const lowAction = `${pin}:low`;
    return (
      <div
        key={pin}
        className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-4 md:grid-cols-[1fr_auto]"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${levelIndicatorClassName(level)}`} />
            <h2 className="text-base font-semibold text-zinc-100">GPIO {pin}</h2>
          </div>
          <div className="mt-1 text-sm text-zinc-400">{levelLabel(level)}</div>
        </div>
        <div className="flex gap-2">
          <Button
            className="min-w-24"
            disabled={!connected || busyAction !== null}
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
            className="min-w-24"
            disabled={!connected || busyAction !== null}
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
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 border border-zinc-800 bg-zinc-950/70 p-4">
        <div>
          <div className="text-sm font-medium">GPIO state</div>
          <div className="mt-1 text-xs text-zinc-500">
            {knownPins.length > 0 ? `Known pins: ${knownPins.join(', ')}` : 'No GPIO response yet'}
          </div>
        </div>
        <Button
          disabled={!connected || busyAction !== null}
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
      </section>

      <section className="grid gap-3">{TEST_PINS.map(renderPinControl)}</section>

      <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
        <label className="grid gap-2 text-sm">
          <span className="text-zinc-400">Custom GPIO pin</span>
          <input
            className="h-10 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 outline-none focus:border-zinc-400"
            max={MAX_GPIO_PIN}
            min={MIN_GPIO_PIN}
            type="number"
            value={customPin}
            onChange={(event) => {
              setCustomPin(Number(event.target.value));
            }}
          />
        </label>
        <Button
          disabled={!connected || busyAction !== null || !Number.isInteger(customPin)}
          type="button"
          variant="outline"
          onClick={() => void setPinLevel(customPin, false)}
        >
          <Power className={ICON_CLASS_NAME} />
          Low
        </Button>
        <Button
          disabled={!connected || busyAction !== null || !Number.isInteger(customPin)}
          type="button"
          onClick={() => void setPinLevel(customPin, true)}
        >
          <Power className={ICON_CLASS_NAME} />
          High
        </Button>
      </section>

      {requestError !== null ? (
        <section className="border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {requestError}
        </section>
      ) : null}

      <section className="border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-4 py-3 text-sm font-medium">Packet log</div>
        <div className="grid max-h-72 gap-2 overflow-auto p-4">
          {packetLogs.length === 0 ? (
            <div className="text-sm text-zinc-500">No packets received.</div>
          ) : (
            packetLogs.map((entry) => (
              <pre
                key={entry.id}
                className="overflow-auto border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300"
              >
                {`${entry.timestamp}\n${JSON.stringify(entry.packet, null, 2)}`}
              </pre>
            ))
          )}
        </div>
      </section>
    </>
  );
};

export default GpioControlSurface;
