import { Esp32FlasherSurface } from './surface';

import type { DeviceApp } from '../types';

// ESP32 firmware flasher over Web Serial; gated on the `esp-flasher` device feature.
export const esp32FlasherApp: DeviceApp = {
  slug: 'esp-flasher',
  title: 'ESP Flasher',
  description: 'Flash ESP32 firmware over USB (Web Serial).',
  requiredFeatures: ['esp-flasher'],
  Surface: Esp32FlasherSurface,
};
