import { LinuxPortForwardSurface } from './surface';

import type { DeviceApp } from '../types';

// The Linux port-forward app — expose a service reachable from a Linux device at
// a public `<session>.port.<domain>` URL, tunnelled over the Helix data plane.
// Gated on the `linux-port-forward` device feature.
export const linuxPortForwardApp: DeviceApp = {
  slug: 'linux-port-forward',
  title: 'Port forward',
  description: 'Expose a device-local service at a public URL.',
  requiredFeatures: ['linux-port-forward'],
  Surface: LinuxPortForwardSurface,
};
