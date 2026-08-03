// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Delete objects under the catalog's image prefix that no `product_image` row points at.
 *
 * Deleting an image row leaves its object behind, and a change to the key layout strands the
 * old ones; neither is visible from the app. Run with `--apply` to actually delete.
 *
 *   pnpm exec tsx scripts/prune-storage.mts [--apply]
 *
 * Builds its own pool and storage provider rather than importing `src/server/*`, which is
 * marked `server-only` and throws outside the Next runtime.
 */
import { createStorageProviderFromEnv } from '@helix/backend/storage/factory';
import { Pool } from 'pg';

const LIST_LIMIT = 1000;

/** Must match `CATALOG_IMAGE_PREFIX` in src/server/storage.ts, plus any superseded layout. */
const SEARCH_PREFIXES = [
  'public/hardware-catalog/product-images',
  'hardware-catalog/product-images',
];

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const storage = createStorageProviderFromEnv(process.env as Record<string, string | undefined>);
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  const { rows } = await pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM product_image WHERE storage_key IS NOT NULL',
  );
  const referenced = new Set(rows.map((row) => row.storage_key));

  const stored = new Set<string>();
  for (const prefix of SEARCH_PREFIXES) {
    for (const key of await storage.list(prefix, LIST_LIMIT)) {
      stored.add(key);
    }
  }

  const orphans = [...stored].filter((key) => !referenced.has(key));
  console.log(`${referenced.size} referenced, ${stored.size} stored, ${orphans.length} orphaned`);
  for (const key of orphans) {
    console.log(`  ${apply ? 'delete' : 'would delete'} ${key}`);
  }

  if (orphans.length > 0) {
    if (apply) {
      await storage.deleteMultiple(orphans);
      console.log('deleted');
    } else {
      console.log('\nre-run with --apply to delete');
    }
  }

  await pool.end();
};

await main();
process.exit(0);
