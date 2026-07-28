import { LinuxFilesSurface } from './surface';

import type { DeviceApp } from '../types';

// Linux file-browser app; gated on the `linux-files` device feature.
export const linuxFilesApp: DeviceApp = {
  slug: 'linux-files',
  title: 'Files',
  description: 'Browse, download and upload files on this device.',
  requiredFeatures: ['linux-files'],
  Surface: LinuxFilesSurface,
};
