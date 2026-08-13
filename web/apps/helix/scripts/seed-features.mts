// Seed the feature catalog (the `feature` table) from the FeatureRegistry — the
// set of features this build ships. Run after migrations, both in local dev (via
// `helix appliance up`) and by hand (`pnpm db:seed-features`).
//
// Feature registrations are auto-discovered from src/features/ rather than a
// hand-maintained barrel: every `.mts` registration module found there (at any
// depth) is imported, which force-evaluates its `defineFeature` side-effect. So
// a fork registers exactly the registration modules it ships — drop one and it
// stops being registered, no list to edit.
//
// Registration modules are `.mts` (standalone, importable by this node process)
// and deliberately hold only the `defineFeature(...)` call — never a feature's
// `.tsx` surface, which pulls React/'use client'/design-system and cannot be
// loaded here. A folder-per-feature can drop a `feature.mts` alongside its
// surface. Upsert only — see seedFeatures.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDatabasePool, createDb } from '@helix-hq/backend/db';
import { featureRegistry, seedFeatures } from '@helix-hq/backend/features';

const FEATURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/features');

const collectRegistrationModules = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectRegistrationModules(full);
    }
    return entry.isFile() && entry.name.endsWith('.mts') ? [full] : [];
  });

// Import every registration module so its defineFeature() runs and populates the
// registry. Presence in src/features/ = this app ships that capability.
const loadFeatureModules = async (): Promise<void> => {
  for (const modulePath of collectRegistrationModules(FEATURES_DIR)) {
    await import(pathToFileURL(modulePath).href);
  }
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required to seed features');
  }

  await loadFeatureModules();

  const pool = createDatabasePool({ connectionString: databaseUrl });
  const db = createDb({ pool });
  try {
    const keys = featureRegistry.keys();
    await seedFeatures(db, keys);
    console.log(`seeded ${keys.length} feature(s): ${keys.join(', ') || '(none)'}`);
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
