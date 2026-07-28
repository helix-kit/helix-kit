import { eq, inArray } from 'drizzle-orm';

import { type DatabaseClient } from '../db';
import { deviceFeatureOverride, feature, profileFeature } from '../db/feature-schema';
import { deviceProfile } from '../db/release-schema';

export type FeatureSource = 'override' | 'profile' | 'default';

export type FeatureResolution = Readonly<{ enabled: boolean; source: FeatureSource }>;

// The single read chokepoint for a device's effective cloud features — the
// features analogue of resolveDeviceArtifacts in releases/resolve.ts. UI, and
// (later) the gateway, resolve here rather than reimplementing precedence.
//
// Universe = the `feature` catalog, all disabled by default → OR-in every
// feature any assigned profile enables → hard-apply per-device overrides, which
// win in both directions. Enablement for keys not in the catalog of this build
// is ignored.
export const resolveDeviceFeatures = async (
  db: DatabaseClient,
  deviceId: string,
): Promise<Map<string, FeatureResolution>> => {
  const catalog = await db.select({ key: feature.key }).from(feature);
  const result = new Map<string, FeatureResolution>(
    catalog.map((row) => [row.key, { enabled: false, source: 'default' as const }]),
  );

  const profiles = await db
    .select({ profileId: deviceProfile.profileId })
    .from(deviceProfile)
    .where(eq(deviceProfile.deviceId, deviceId));

  if (profiles.length > 0) {
    const enabledByProfile = await db
      .select({ featureKey: profileFeature.featureKey })
      .from(profileFeature)
      .where(
        inArray(
          profileFeature.profileId,
          profiles.map((row) => row.profileId),
        ),
      );
    for (const row of enabledByProfile) {
      if (result.has(row.featureKey)) {
        result.set(row.featureKey, { enabled: true, source: 'profile' });
      }
    }
  }

  const overrides = await db
    .select({
      featureKey: deviceFeatureOverride.featureKey,
      enabled: deviceFeatureOverride.enabled,
    })
    .from(deviceFeatureOverride)
    .where(eq(deviceFeatureOverride.deviceId, deviceId));
  for (const row of overrides) {
    if (result.has(row.featureKey)) {
      result.set(row.featureKey, { enabled: row.enabled, source: 'override' });
    }
  }

  return result;
};

// Whether a single feature is effectively enabled for a device — the thin helper
// future gateway/UI gates call.
export const deviceHasFeature = async (
  db: DatabaseClient,
  deviceId: string,
  key: string,
): Promise<boolean> => (await resolveDeviceFeatures(db, deviceId)).get(key)?.enabled ?? false;
