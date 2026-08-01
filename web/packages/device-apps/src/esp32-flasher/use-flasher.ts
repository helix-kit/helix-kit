'use client';

import { useCallback, useState } from 'react';

import {
  flashEsp32,
  type Esp32FlashProgress,
  type FlashEsp32Options,
  type FlashEsp32Result,
} from './flash';

export type Esp32FlasherState = Readonly<{
  error: string | null;
  flash: (options: FlashEsp32Options) => Promise<FlashEsp32Result>;
  flashing: boolean;
  progress: Esp32FlashProgress | null;
}>;

export const useEsp32Flasher = (): Esp32FlasherState => {
  const [flashing, setFlashing] = useState(false);
  const [progress, setProgress] = useState<Esp32FlashProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = useCallback(async (options: FlashEsp32Options) => {
    setFlashing(true);
    setProgress(null);
    setError(null);
    try {
      return await flashEsp32({
        ...options,
        onProgress: (nextProgress) => {
          setProgress(nextProgress);
          options.onProgress?.(nextProgress);
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ESP32 flashing failed.');
      throw caught;
    } finally {
      setFlashing(false);
    }
  }, []);

  return { error, flash, flashing, progress };
};
