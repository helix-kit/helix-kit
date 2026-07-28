import 'server-only';

import { createStorageProviderFromEnv } from '@helix/backend/storage/factory';

import type { StorageProvider } from '@helix/backend/storage/interface';

const globalForStorage = globalThis as unknown as { helixStorage?: StorageProvider };

export const storage: StorageProvider =
  globalForStorage.helixStorage ??
  createStorageProviderFromEnv(process.env as Record<string, string | undefined>);

if (process.env['NODE_ENV'] !== 'production') {
  globalForStorage.helixStorage = storage;
}
