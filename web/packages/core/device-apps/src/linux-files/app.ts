import { LinuxFilesSurface } from './surface';

import type { DeviceApp } from '../types';

// The Linux file-browser app — browse, download and upload files on a Linux device.
// Gated on the `linux-files` device feature.
export const linuxFilesApp: DeviceApp = {
  slug: 'linux-files',
  title: 'Files',
  description: 'Browse, download and upload files on this device.',
  requiredFeatures: ['linux-files'],
  Surface: LinuxFilesSurface,
};
