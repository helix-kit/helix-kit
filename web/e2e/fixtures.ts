/* eslint-disable react-hooks/rules-of-hooks -- `use` here is the Playwright fixture callback, not the React hook */
// Persistent Chromium profile: the persisted per-origin grant lets navigator.serial reconnect without the port-picker dialog (grant once via `npm run grant`).
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

import { BROWSER_PROFILE_DIR, HEADLESS } from './serial/config';

export type SerialFixtures = {
  context: BrowserContext;
  page: Page;
};

export const test = base.extend<SerialFixtures>({
  context: async ({ viewport }, use) => {
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      headless: HEADLESS,
      viewport: viewport ?? { width: 1280, height: 900 },
      args: ['--no-first-run', '--no-default-browser-check', '--enable-features=WebBluetooth'],
    });
    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export const { expect } = test;
