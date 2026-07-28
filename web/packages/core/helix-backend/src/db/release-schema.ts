import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const artifactType = pgTable('artifact_type', {
  key: text('key').primaryKey(),
  displayName: text('display_name').notNull(),
  distributionMode: text('distribution_mode').notNull(),
  defaultRegistry: text('default_registry'),
  selectorKeys: jsonb('selector_keys').notNull(),
  roles: jsonb('roles').notNull(),
  adapterKey: text('adapter_key').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const artifact = pgTable(
  'artifact',
  {
    id: text('id').primaryKey(),
    typeKey: text('type_key').notNull(),
    storageMode: text('storage_mode').notNull(),
    metadata: jsonb('metadata').notNull(),
    sha256: text('sha256'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    storageKey: text('storage_key'),
    contentType: text('content_type'),
    registry: text('registry'),
    coordinate: text('coordinate'),
    refVersion: text('ref_version'),
    digest: text('digest'),
    refMetadata: jsonb('ref_metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    sha256Unique: uniqueIndex('artifact_sha256_uq')
      .on(table.sha256)
      .where(sql`storage_mode = 'blob'`),
    refUnique: uniqueIndex('artifact_ref_uq')
      .on(table.registry, table.coordinate, table.digest)
      .where(sql`storage_mode = 'ref'`),
    typeIdx: index('artifact_type_idx').on(table.typeKey),
  }),
);

export const release = pgTable(
  'release',
  {
    id: text('id').primaryKey(),
    typeKey: text('type_key').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    ownerUserId: text('owner_user_id'),
    buildId: text('build_id'),
    sourceCommit: text('source_commit'),
    sourceDirty: boolean('source_dirty').notNull().default(false),
    config: jsonb('config').notNull(),
    analysis: jsonb('analysis'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    publishedAt: timestamp('published_at'),
  },
  (table) => ({
    nameVersionUnique: unique('release_type_name_version_uq').on(
      table.typeKey,
      table.name,
      table.version,
    ),
    lookupIdx: index('release_lookup_idx').on(
      table.typeKey,
      table.name,
      table.channel,
      table.status,
    ),
  }),
);

export const variant = pgTable(
  'variant',
  {
    id: text('id').primaryKey(),
    releaseId: text('release_id')
      .notNull()
      .references(() => release.id, { onDelete: 'cascade' }),
    selector: jsonb('selector').notNull(),
    selectorHash: text('selector_hash').notNull(),
    name: text('name'),
    manifest: jsonb('manifest'),
    analysis: jsonb('analysis'),
    buildId: text('build_id'),
    status: text('status').notNull().default('ready'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    releaseSelectorUnique: unique('variant_release_selector_uq').on(
      table.releaseId,
      table.selectorHash,
    ),
    selectorGin: index('variant_selector_gin_idx').using(
      'gin',
      table.selector.op('jsonb_path_ops'),
    ),
    releaseIdx: index('variant_release_idx').on(table.releaseId),
  }),
);

export const variantArtifact = pgTable(
  'variant_artifact',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => variant.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id').notNull(),
    role: text('role').notNull(),
    offset: text('offset'),
    path: text('path'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    variantRoleUnique: unique('variant_artifact_variant_role_uq').on(table.variantId, table.role),
    artifactIdx: index('variant_artifact_artifact_idx').on(table.artifactId),
  }),
);

export const build = pgTable(
  'build',
  {
    id: text('id').primaryKey(),
    typeKey: text('type_key').notNull(),
    source: text('source').notNull(),
    ownerUserId: text('owner_user_id'),
    status: text('status').notNull(),
    requestConfig: jsonb('request_config').notNull(),
    configHash: text('config_hash').notNull(),
    selector: jsonb('selector'),
    releaseId: text('release_id'),
    variantId: text('variant_id'),
    callbackTokenHash: text('callback_token_hash'),
    callbackExpiresAt: timestamp('callback_expires_at'),
    analysis: jsonb('analysis'),
    errorSummary: text('error_summary'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (table) => ({
    configHashIdx: index('build_config_hash_idx').on(table.configHash, table.status),
  }),
);
export const releaseChannelHead = pgTable(
  'release_channel_head',
  {
    id: text('id').primaryKey(),
    typeKey: text('type_key').notNull(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    releaseId: text('release_id').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    headUnique: unique('release_channel_head_uq').on(table.typeKey, table.name, table.channel),
  }),
);

export const profile = pgTable('profile', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ownerUserId: text('owner_user_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const profileTrack = pgTable(
  'profile_track',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    typeKey: text('type_key').notNull(),
    releaseName: text('release_name').notNull(),
    channel: text('channel'),
    pinnedReleaseId: text('pinned_release_id'),
    selector: jsonb('selector'),
    autoUpdate: boolean('auto_update').notNull().default(true),
  },
  (table) => ({
    trackUnique: unique('profile_track_uq').on(table.profileId, table.typeKey, table.releaseName),
  }),
);

export const deviceProfile = pgTable(
  'device_profile',
  {
    deviceId: text('device_id').notNull(),
    profileId: text('profile_id').notNull(),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.deviceId, table.profileId] }),
  }),
);

export const ciToken = pgTable(
  'ci_token',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique('ci_token_hash_uq'),
    scopes: jsonb('scopes').notNull(),
    ownerUserId: text('owner_user_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    prefixIdx: index('ci_token_prefix_idx').on(table.tokenPrefix),
  }),
);
