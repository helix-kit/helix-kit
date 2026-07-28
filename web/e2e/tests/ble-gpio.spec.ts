// Real ESP32 over Web Bluetooth through the shared transport packages. The test
// injects raw request JSON and asserts on the raw response — the harness knows
// nothing about gpio. No grant/profile: the native BLE chooser is driven via
// CDP DeviceAccess (which, unlike Web Serial, covers Web Bluetooth).
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { BLE_GPIO_ROUTE } from '../serial/config';

const GPIO_SERVICE = 'gpio-control';
const DEVICE_NAME_PREFIX = 'Helix ESP32';
const BLE_DISCONNECT = 'ble-disconnect';
const TEST_PIN = 2;
const CONNECT_ATTEMPTS = 3;
const REQUEST_ATTEMPTS = 4;

const readGpio = JSON.stringify({
  service: GPIO_SERVICE,
  method: 'read-gpio',
  payload: { pin: TEST_PIN },
});
const setGpio = (high: boolean) =>
  JSON.stringify({ service: GPIO_SERVICE, method: 'set-gpio', payload: { pin: TEST_PIN, high } });

type PromptDevice = { id: string; name?: string };
type DevicePrompted = { id: string; devices: PromptDevice[] };
type RawCdpSession = {
  send: (method: string, params?: unknown) => Promise<unknown>;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

// The BLE chooser populates asynchronously as devices are discovered, so
// deviceRequestPrompted re-fires with a growing list; select on first match.
const autoSelectHelixDevice = async (page: Page): Promise<void> => {
  const cdp = (await page.context().newCDPSession(page)) as unknown as RawCdpSession;
  await cdp.send('DeviceAccess.enable');
  let selected = false;
  cdp.on('DeviceAccess.deviceRequestPrompted', (payload) => {
    const event = payload as DevicePrompted;
    const device = event.devices.find((candidate) =>
      (candidate.name ?? '').startsWith(DEVICE_NAME_PREFIX),
    );
    if (device !== undefined && !selected) {
      selected = true;
      void cdp.send('DeviceAccess.selectPrompt', { id: event.id, deviceId: device.id });
    }
  });
};

const connectToDevice = async (page: Page): Promise<void> => {
  const state = page.getByTestId('ble-connection-state');
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    await page.getByTestId('ble-connect').click();
    try {
      await expect(state).toHaveText('connected', { timeout: 20_000 });
      return;
    } catch {
      // GATT connect can flake; disconnect if needed and retry.
      if ((await page.getByTestId(BLE_DISCONNECT).count()) > 0) {
        await page.getByTestId(BLE_DISCONNECT).click();
      }
    }
  }
  await expect(state).toHaveText('connected');
};

const sendAndExpectLevel = async (page: Page, requestJson: string, level: 0 | 1): Promise<void> => {
  const lastReceived = page.getByTestId('last-received');
  // eslint-disable-next-line security/detect-non-literal-regexp -- `level` is a typed 0 | 1, not user input
  const expected = new RegExp(`gpio-control-state.*"level":${level}`);
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    await page.getByTestId('request-input').fill(requestJson);
    await page.getByTestId('send').click();
    try {
      await expect(lastReceived).toHaveText(expected, { timeout: 6_000 });
      return;
    } catch {
      // Notification not in yet — retry.
    }
  }
  await expect(lastReceived).toHaveText(expected);
};

test('drives real ESP32 GPIO over Web Bluetooth via shared transport packages', async ({
  page,
}) => {
  await autoSelectHelixDevice(page);
  await page.goto(BLE_GPIO_ROUTE);

  await test.step('harness exposes Web Bluetooth', async () => {
    await expect(page.getByTestId('ble-supported')).toHaveText('supported');
  });

  await test.step('connect to the advertising ESP32 (chooser via CDP)', async () => {
    await connectToDevice(page);
    await expect(page.getByTestId('ble-device-name')).toContainText(DEVICE_NAME_PREFIX);
  });

  await test.step('inject raw read request, read live state back', async () => {
    await sendAndExpectLevel(page, setGpio(false), 0);
    await sendAndExpectLevel(page, readGpio, 0);
  });

  await test.step('inject raw set requests, toggle GPIO on real hardware', async () => {
    await sendAndExpectLevel(page, setGpio(true), 1);
    await sendAndExpectLevel(page, setGpio(false), 0);
  });

  await test.step('firmware responses appear in the received log', async () => {
    await expect(page.getByTestId('received-log')).toContainText('gpio-control-state');
  });

  await test.step('clean disconnect', async () => {
    await page.getByTestId(BLE_DISCONNECT).click();
    await expect(page.getByTestId('ble-connection-state')).toHaveText('disconnected');
  });
});
