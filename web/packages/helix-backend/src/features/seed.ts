import { type DatabaseClient } from '../db';
import { feature } from '../db/feature-schema';

// Idempotent, upsert-only seed of the feature catalog; never deletes, since that would cascade away enablement/override history.
export const seedFeatures = async (db: DatabaseClient, keys: readonly string[]): Promise<void> => {
  if (keys.length === 0) {
    return;
  }
  await db
    .insert(feature)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing();
};
