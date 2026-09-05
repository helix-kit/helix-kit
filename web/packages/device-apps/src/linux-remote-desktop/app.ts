import { LinuxRemoteDesktopSurface } from './surface';

import type { DeviceApp } from '../types';

// The Linux remote-desktop app: view and control a VNC server on the device from the
// browser. It rides the port-forward service rather than adding a device app of its
// own, so a device already forwarding ports needs no new code to serve a desktop.
export const linuxRemoteDesktopApp: DeviceApp = {
  slug: 'linux-remote-desktop',
  title: 'Remote desktop',
  description: 'View and control the device screen over VNC.',
  requiredFeatures: ['linux-port-forward'],
  fullBleed: true,
  Surface: LinuxRemoteDesktopSurface,
};
