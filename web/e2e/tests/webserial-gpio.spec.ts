// Real ESP32 over Web Serial through the shared transport packages; inject raw
// request JSON, assert on the raw response. Prerequisite: `npm run grant` once.
// Retries exist because opening the CP210x resets the ESP32 (DTR/RTS), dropping
// requests during its ~1.5-2s boot.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { EXPECTED_USB_LABEL, SERIAL_GPIO_ROUTE } from '../serial/config';

const GPIO_SERVICE = 'gpio-control';
const CONNECTION_STATE = 'connection-state';
const TEST_PIN = 2;
const CONNECT_ROUNDS = 6;
const REQUEST_ATTEMPTS = 5;
const BOOT_SETTLE_MS = 2500;

const readGpio = JSON.stringify({
  service: GPIO_SERVICE,
  method: 'read-gpio',
  payload: { pin: TEST_PIN },
});
const setGpio = (high: boolean) =>
  JSON.stringify({ service: GPIO_SERVICE, method: 'set-gpio', payload: { pin: TEST_PIN, high } });

const isConnected = async (page: Page): Promise<boolean> =>
  (await page.getByTestId('disconnect').count()) > 0;

const ensureConnected = async (page: Page): Promise<void> => {
  for (let round = 1; round <= CONNECT_ROUNDS; round += 1) {
    if (await isConnected(page)) {
      return;
    }
    await page.getByTestId('connect').click();
    try {
      await expect(page.getByTestId(CONNECTION_STATE)).toHaveText('connected', {
        timeout: 8_000,
      });
      await page.waitForTimeout(BOOT_SETTLE_MS); // let firmware finish booting
      return;
    } catch {
      // open failed / device momentarily gone — loop and retry.
    }
  }
  await expect(page.getByTestId(CONNECTION_STATE)).toHaveText('connected');
};

const sendAndExpectLevel = async (page: Page, requestJson: string, level: 0 | 1): Promise<void> => {
  const lastReceived = page.getByTestId('last-received');
  // eslint-disable-next-line security/detect-non-literal-regexp -- `level` is a typed 0 | 1, not user input
  const expected = new RegExp(`gpio-control-state.*"level":${level}`);
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    await ensureConnected(page);
    await page.getByTestId('request-input').fill(requestJson);
    await page.getByTestId('send').click();
    try {
      await expect(lastReceived).toHaveText(expected, { timeout: 5_000 });
      return;
    } catch {
      // No response yet (booting) or link dropped — retry / reconnect.
    }
  }
  await expect(lastReceived).toHaveText(expected);
};

test('drives real ESP32 GPIO over Web Serial via shared transport packages', async ({ page }) => {
  await page.goto(SERIAL_GPIO_ROUTE);

  await test.step('harness exposes Web Serial', async () => {
    await expect(page.getByTestId('supported')).toHaveText('supported');
  });

  await test.step('auto-connect to the pre-granted ESP32 (no chooser)', async () => {
    await ensureConnected(page);
    // Prove we bound to a real CP210x UART bridge, not some other serial device.
    await expect(page.getByTestId('port-info')).toHaveText(EXPECTED_USB_LABEL);
  });

  await test.step('inject raw read request, read live state back', async () => {
    await sendAndExpectLevel(page, setGpio(false), 0); // known state first
    await sendAndExpectLevel(page, readGpio, 0);
  });

  await test.step('inject raw set requests, toggle GPIO on real hardware', async () => {
    await sendAndExpectLevel(page, setGpio(true), 1);
    await sendAndExpectLevel(page, setGpio(false), 0);
  });

  await test.step('firmware responses appear in the received log', async () => {
    await expect(page.getByTestId('received-log')).toContainText('gpio-control-state');
  });

  await test.step('clean disconnect releases the port', async () => {
    await page.getByTestId('disconnect').click();
    await expect(page.getByTestId(CONNECTION_STATE)).toHaveText('disconnected');
  });
});
