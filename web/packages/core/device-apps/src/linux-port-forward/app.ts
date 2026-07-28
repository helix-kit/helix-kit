import { LinuxPortForwardSurface } from './surface';

import type { DeviceApp } from '../types';

// The Linux port-forward app: expose a device-local service at a public `<session>.port.<domain>` URL over the Helix data plane.
export const linuxPortForwardApp: DeviceApp = {
  slug: 'linux-port-forward',
  title: 'Port forward',
  description: 'Expose a device-local service at a public URL.',
  requiredFeatures: ['linux-port-forward'],
  Surface: LinuxPortForwardSurface,
};
