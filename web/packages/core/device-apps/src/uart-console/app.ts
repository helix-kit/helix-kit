import { UartConsoleSurface } from './surface';

import type { DeviceApp } from '../types';

export const uartConsoleApp: DeviceApp = {
  slug: 'uart-console',
  title: 'UART Console',
  description: 'Attach to a target device’s serial console via an ESP32 bridge.',
  requiredFeatures: ['uart-console'],
  fullBleed: true,
  Surface: UartConsoleSurface,
};
