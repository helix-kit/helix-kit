import {
  esp32FlasherApp,
  linuxFilesApp,
  linuxPortForwardApp,
  linuxShellApp,
  uartConsoleApp,
  type DeviceApp,
} from '@helix/device-apps';

export const deviceApps: readonly DeviceApp[] = [
  esp32FlasherApp,
  linuxShellApp,
  uartConsoleApp,
  linuxPortForwardApp,
  linuxFilesApp,
];

export const getDeviceApp = (slug: string): DeviceApp | null =>
  deviceApps.find((app) => app.slug === slug) ?? null;
