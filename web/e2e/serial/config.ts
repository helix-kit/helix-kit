import path from 'node:path';

const DEFAULT_PORT = 3200;
const DEFAULT_USB_VENDOR_ID = 0x10c4; // Silicon Labs CP210x
const DEFAULT_USB_PRODUCT_ID = 0xea60;

const E2E_ROOT = path.resolve(__dirname, '..');

// Persistent Chromium profile in the repo so the one-time serial grant survives across runs.
export const BROWSER_PROFILE_DIR =
  process.env.HELIX_E2E_PROFILE ?? path.join(E2E_ROOT, 'browser-profile');

// Keep this stable: the serial grant is keyed by origin (scheme + host + port).
export const APP_PORT = Number(process.env.HELIX_E2E_PORT ?? DEFAULT_PORT);
export const BASE_URL = process.env.HELIX_E2E_BASE_URL ?? `http://localhost:${APP_PORT}`;

export const SERIAL_GPIO_ROUTE = '/';
export const BLE_GPIO_ROUTE = '/#ble';

export const SERIAL_PORT_PATH = process.env.HELIX_SERIAL_PORT ?? '/dev/ttyUSB0';

const USB_VENDOR_ID = Number(process.env.HELIX_USB_VID ?? DEFAULT_USB_VENDOR_ID);
const USB_PRODUCT_ID = Number(process.env.HELIX_USB_PID ?? DEFAULT_USB_PRODUCT_ID);

const HEX_RADIX = 16;
const USB_ID_WIDTH = 4;
const formatUsbId = (value: number): string =>
  `0x${value.toString(HEX_RADIX).padStart(USB_ID_WIDTH, '0')}`;

export const EXPECTED_USB_LABEL = `${formatUsbId(USB_VENDOR_ID)}:${formatUsbId(USB_PRODUCT_ID)}`;

// Defaults ON: a USB re-enumeration recreates /dev/ttyUSB0 and wipes the ACL + `-hupcl` line setting, so re-apply every run.
export const RUN_SERIAL_PREP = process.env.HELIX_E2E_RUN_PREP !== '0';

// Headed by default; the grant flow needs a real window (or Xvfb).
export const HEADLESS = process.env.HELIX_E2E_HEADLESS === '1';
