import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { profile } from './release-schema';

// The catalog of device features this build knows about, auto-seeded from the FeatureRegistry.
export const feature = pgTable('feature', {
  key: text('key').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// A profile enables a feature: row presence = enabled. FK to profile so tearing it down clears the policy.
export const profileFeature = pgTable(
  'profile_feature',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    featureKey: text('feature_key').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.featureKey] }),
  }),
);

// Per-device override of profile resolution. `featureKey` has no hard FK (matching device_profile) so a feature temporarily absent from a build never cascade-deletes overrides.
export const deviceFeatureOverride = pgTable(
  'device_feature_override',
  {
    deviceId: text('device_id').notNull(),
    featureKey: text('feature_key').notNull(),
    enabled: boolean('enabled').notNull(),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.deviceId, table.featureKey] }),
  }),
);
