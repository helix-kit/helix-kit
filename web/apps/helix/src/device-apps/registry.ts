import {
  esp32FlasherApp,
  gpioControlApp,
  linuxFilesApp,
  linuxPortForwardApp,
  linuxRemoteDesktopApp,
  linuxShellApp,
  uartConsoleApp,
  type DeviceApp,
} from '@helix-hq/device-apps';

export const deviceApps: readonly DeviceApp[] = [
  esp32FlasherApp,
  linuxShellApp,
  uartConsoleApp,
  linuxPortForwardApp,
  linuxRemoteDesktopApp,
  linuxFilesApp,
  gpioControlApp,
];

export const getDeviceApp = (slug: string): DeviceApp | null =>
  deviceApps.find((app) => app.slug === slug) ?? null;
