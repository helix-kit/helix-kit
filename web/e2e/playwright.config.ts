import { defineConfig } from '@playwright/test';

import { APP_PORT, BASE_URL, HEADLESS } from './serial/config';

const isCI = process.env.CI !== undefined;

// workers: 1 — the ESP32 is a single shared port, only one page may hold it.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  // A retry relaunches the browser with a fresh device handle, recovering from a
  // transient "device lost" on a marginal USB path.
  retries: Number(process.env.HELIX_E2E_RETRIES ?? 2),
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // `npm run grant` runs this once to approve the port; `test` runs the rest.
    { name: 'grant', testMatch: /grant\.setup\.ts/ },
    { name: 'webserial', testMatch: /webserial-gpio\.spec\.ts/ },
    { name: 'ble', testMatch: /ble-gpio\.spec\.ts/ },
  ],
  // Serve the minimal Vite harness, not the Next app.
  webServer: {
    command: 'pnpm run harness',
    cwd: __dirname,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: { HELIX_E2E_PORT: String(APP_PORT) },
  },
});
