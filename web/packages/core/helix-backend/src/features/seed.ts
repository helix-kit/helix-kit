import { type DatabaseClient } from '../db';
import { feature } from '../db/feature-schema';

// Idempotent, upsert-only seed of the feature catalog from a set of keys
// (typically featureRegistry.keys()). Deliberately never deletes: a feature
// temporarily absent from a build must not drop the `feature` row, which would
// cascade away its enablement/override history.
export const seedFeatures = async (db: DatabaseClient, keys: readonly string[]): Promise<void> => {
  if (keys.length === 0) {
    return;
  }
  await db
    .insert(feature)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing();
};
