// One-time grant bootstrap (`npm run grant`, headed): Playwright can't click the native chooser, so pick the ESP32 by hand once; Chrome persists the grant into the repo profile.
import { expect, test } from '../fixtures';
import { SERIAL_GPIO_ROUTE } from '../serial/config';

const GRANT_TIMEOUT_MS = 120_000;
const TEARDOWN_GRACE_MS = 10_000;

test('grant serial port to the harness profile', async ({ page }) => {
  test.setTimeout(GRANT_TIMEOUT_MS + TEARDOWN_GRACE_MS);

  await page.goto(SERIAL_GPIO_ROUTE);
  await expect(page.getByTestId('supported')).toHaveText('supported');

  const connectButton = page.getByTestId('connect');
  await expect(connectButton).toBeEnabled();

  // eslint-disable-next-line no-console
  console.log(
    '\n>>> A serial port chooser will appear. Select the ESP32 (CP210x) and click Connect. <<<\n',
  );
  await connectButton.click();

  await expect(page.getByTestId('connection-state')).toHaveText('connected', {
    timeout: GRANT_TIMEOUT_MS,
  });

  // eslint-disable-next-line no-console
  console.log('>>> Grant saved to the persistent profile. Future runs are automatic. <<<');
});
