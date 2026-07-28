import { LinuxShellSurface } from './surface';

import type { DeviceApp } from '../types';

export const linuxShellApp: DeviceApp = {
  slug: 'linux-shell',
  title: 'Shell',
  description: 'Open an interactive terminal to this device.',
  requiredFeatures: ['linux-shell'],
  fullBleed: true,
  Surface: LinuxShellSurface,
};
