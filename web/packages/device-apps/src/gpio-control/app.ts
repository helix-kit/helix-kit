import { GpioControlSurface } from './surface';

import type { DeviceApp } from '../types';

export const gpioControlApp: DeviceApp = {
  slug: 'gpio-control',
  title: 'GPIO Control',
  description: 'Read and drive the GPIO pins on a device running the `gpio_control` app.',
  requiredFeatures: ['gpio-control'],
  Surface: GpioControlSurface,
};
