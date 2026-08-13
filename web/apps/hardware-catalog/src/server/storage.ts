import 'server-only';

import { createStorageProviderFromEnv } from '@helix-hq/backend/storage/factory';

import { env } from '@/lib/env';

import type { StorageProvider } from '@helix-hq/backend/storage/interface';

/**
 * Object storage, shared with the rest of Helix: the same provider factory, the same production
 * bucket, the same CloudFront asset host. The catalog only ever writes under its own prefix.
 */

/**
 * CloudFront fronts the bucket with `OriginPath=/public`, so publicly-served objects must be
 * keyed under `public/` and the prefix is stripped from the URL. Uploading outside it yields a
 * 403 from the CDN even though the upload itself succeeds.
 */
const PUBLIC_PREFIX = 'public/';

export const CATALOG_IMAGE_PREFIX = `${PUBLIC_PREFIX}hardware-catalog/product-images`;

const globalForStorage = globalThis as unknown as { catalogStorage?: StorageProvider };

export const storage: StorageProvider =
  globalForStorage.catalogStorage ??
  createStorageProviderFromEnv(process.env as Record<string, string | undefined>);

if (env.NODE_ENV !== 'production') {
  globalForStorage.catalogStorage = storage;
}

/** Public URL for a stored object, via the CDN host that fronts the bucket. */
export const publicAssetUrl = (storageKey: string): string => {
  const path = storageKey.startsWith(PUBLIC_PREFIX)
    ? storageKey.slice(PUBLIC_PREFIX.length)
    : storageKey;
  return `${env.STORAGE_PUBLIC_ASSET_URL.replace(/\/+$/, '')}/${path}`;
};
