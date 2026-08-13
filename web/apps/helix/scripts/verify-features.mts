// Reusable end-to-end check of the feature-flag framework against a live DB
// (the appliance). Exercises the resolveDeviceFeatures precedence — default →
// profile-enabled → device-override (both directions) → cleared — plus that the
// catalog was seeded. Setup/teardown use raw SQL so the script depends only on
// @helix-hq/backend. Exits non-zero on any assertion failure. Run with:
//   DATABASE_URL=... node --import tsx/esm scripts/verify-features.mts
import { createDatabasePool, createDb } from '@helix-hq/backend/db';
import { feature, resolveDeviceFeatures, seedFeatures } from '@helix-hq/backend/features';

const TEST_PROFILE = 'prof_verify_features';
const TEST_DEVICE = 'dev_verify_features';
const KEY = 'esp-flasher';
const OTHER_KEY = 'linux-shell';

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
  console.log(`  ok: ${message}`);
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required');
  }
  const pool = createDatabasePool({ connectionString: databaseUrl });
  const db = createDb({ pool });

  const cleanup = async (): Promise<void> => {
    await pool.query('DELETE FROM device_feature_override WHERE device_id = $1', [TEST_DEVICE]);
    await pool.query('DELETE FROM device_profile WHERE device_id = $1', [TEST_DEVICE]);
    await pool.query('DELETE FROM profile_feature WHERE profile_id = $1', [TEST_PROFILE]);
    await pool.query('DELETE FROM profile WHERE id = $1', [TEST_PROFILE]);
  };

  try {
    // Catalog must be seeded (the two keys we exercise exist).
    await seedFeatures(db, [KEY, OTHER_KEY]);
    const catalog = await db.select({ key: feature.key }).from(feature);
    const catalogKeys = new Set(catalog.map((row) => row.key));
    assert(catalogKeys.has(KEY) && catalogKeys.has(OTHER_KEY), 'catalog contains seeded features');

    await cleanup();
    await pool.query('INSERT INTO profile (id, name) VALUES ($1, $2)', [
      TEST_PROFILE,
      'verify-features',
    ]);

    // 1. No assignment → everything default-disabled.
    let resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(KEY)?.enabled === false, 'default disabled with no profile');
    assert(resolved.get(KEY)?.source === 'default', 'source is default with no profile');

    // 2. Assigned to a profile that does not enable the feature → still disabled.
    await pool.query('INSERT INTO device_profile (device_id, profile_id) VALUES ($1, $2)', [
      TEST_DEVICE,
      TEST_PROFILE,
    ]);
    resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(KEY)?.enabled === false, 'disabled when profile does not enable');

    // 3. Profile enables the feature → enabled via profile.
    await pool.query('INSERT INTO profile_feature (profile_id, feature_key) VALUES ($1, $2)', [
      TEST_PROFILE,
      KEY,
    ]);
    resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(KEY)?.enabled === true, 'enabled when profile enables');
    assert(resolved.get(KEY)?.source === 'profile', 'source is profile when profile enables');

    // 4. Device override force-disables a profile-enabled feature → override wins.
    await pool.query(
      'INSERT INTO device_feature_override (device_id, feature_key, enabled) VALUES ($1, $2, $3)',
      [TEST_DEVICE, KEY, false],
    );
    resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(KEY)?.enabled === false, 'override force-off beats profile-on');
    assert(resolved.get(KEY)?.source === 'override', 'source is override when overridden');

    // 5. Device override force-enables a feature no profile enables → override wins.
    await pool.query(
      'INSERT INTO device_feature_override (device_id, feature_key, enabled) VALUES ($1, $2, $3)',
      [TEST_DEVICE, OTHER_KEY, true],
    );
    resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(OTHER_KEY)?.enabled === true, 'override force-on with no profile enable');
    assert(resolved.get(OTHER_KEY)?.source === 'override', 'source is override (force-on)');

    // 6. Clearing the overrides reverts to profile/default.
    await pool.query('DELETE FROM device_feature_override WHERE device_id = $1', [TEST_DEVICE]);
    resolved = await resolveDeviceFeatures(db, TEST_DEVICE);
    assert(resolved.get(KEY)?.enabled === true, 'reverts to profile-on after clearing override');
    assert(resolved.get(OTHER_KEY)?.enabled === false, 'reverts to default after clearing override');

    console.log('\nfeature framework verification passed');
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
