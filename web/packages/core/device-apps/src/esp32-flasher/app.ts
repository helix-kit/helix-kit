import { Esp32FlasherSurface } from './surface';

import type { DeviceApp } from '../types';

// The ESP32 flashing utility — flash firmware to a locally-connected ESP32 over
// Web Serial. Gated on the `esp-flasher` device feature.
export const esp32FlasherApp: DeviceApp = {
  slug: 'esp-flasher',
  title: 'ESP Flasher',
  description: 'Flash ESP32 firmware over USB (Web Serial).',
  requiredFeatures: ['esp-flasher'],
  Surface: Esp32FlasherSurface,
};
