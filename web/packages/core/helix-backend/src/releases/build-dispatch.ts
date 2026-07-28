import { eq } from 'drizzle-orm';

import { getAdapter } from './adapters';
import { prefixedId } from './ids';
import { generateBuildCallbackToken } from './tokens';

import type { DatabaseClient } from '../db';

import { artifactType, build } from '../db/release-schema';

const CALLBACK_TTL_MS = 3_600_000;

// --- Build-options catalog (served by the build container's GET /catalog) ------
// Mirrors tooling/release/catalog.py; the container is the source of truth so the
// option lists never drift from what `helix embedded esp32 link` understands.
export type CatalogOption = Readonly<{ value: string; label: string }>;
export type CatalogApp = Readonly<{
  name: string;
  label: string;
  description: string;
  features: string[];
}>;
export type CatalogFeature = Readonly<{ key: string; label: string; description: string }>;
export type CatalogSdkconfigKnob = Readonly<{
  key: string;
  label: string;
  description: string;
  type: 'select' | 'text';
  default: string;
  options?: CatalogOption[];
}>;
export type BuildCatalog = Readonly<{
  typeKey: string;
  chips: CatalogOption[];
  flashSizes: CatalogOption[];
  apps: CatalogApp[];
  features: CatalogFeature[];
  sdkconfig: CatalogSdkconfigKnob[];
  defaults: Readonly<{ chip: string; flashSize: string; channel: string }>;
}>;

// The user-chosen firmware configuration. Its canonical hash (computed by the
// artifact-type adapter) is the Tier-0 dedupe key.
export type BuildConfig = Readonly<{
  apps: string[];
  features: string[];
  set: Record<string, string>;
  chip: string;
  flashSize: string;
}>;

export type BuildRequestInput = Readonly<{
  typeKey: string;
  ownerUserId: string;
  config: Record<string, unknown>;
  selector?: Record<string, unknown>;
}>;

export type BuildRequestResult = Readonly<{
  status: 'hit' | 'queued';
  buildId: string;
  releaseId: string | null;
  variantId: string | null;
  callbackToken: string | null;
}>;

// The job dispatched to the build container's POST /build. `publicUrl` is the
// release backend base the worker calls back to ({publicUrl}/api/build/*) — it
// must be reachable *from the container*.
export type BuildDispatchJob = Readonly<{
  buildId: string;
  callbackToken: string;
  publicUrl: string;
  release: Readonly<{ name: string; version: string; channel: string }>;
  selector: Record<string, unknown>;
  config: Record<string, unknown>;
  fake?: boolean;
}>;

// Shared Tier-0 request core: dedupe by config hash, else create a queued build
// with a per-build callback token. Used by both the CI/public api-router and the
// admin build UI so there is one definition of "request a build".
export const requestBuild = async (
  db: DatabaseClient,
  input: BuildRequestInput,
): Promise<BuildRequestResult> => {
  const [type] = await db
    .select({ adapterKey: artifactType.adapterKey })
    .from(artifactType)
    .where(eq(artifactType.key, input.typeKey))
    .limit(1);
  if (type === undefined) {
    throw new Error(`Unknown artifact type "${input.typeKey}".`);
  }
  const configHash = getAdapter(type.adapterKey).computeConfigHash(input.config);

  const [hit] = await db
    .select({ id: build.id, releaseId: build.releaseId, variantId: build.variantId })
    .from(build)
    .where(eq(build.configHash, configHash))
    .limit(1);
  if (hit?.releaseId != null) {
    return {
      status: 'hit',
      buildId: hit.id,
      releaseId: hit.releaseId,
      variantId: hit.variantId,
      callbackToken: null,
    };
  }

  const buildId = prefixedId('bld');
  const callback = generateBuildCallbackToken();
  await db.insert(build).values({
    id: buildId,
    typeKey: input.typeKey,
    source: 'custom',
    ownerUserId: input.ownerUserId,
    status: 'queued',
    requestConfig: input.config,
    configHash,
    selector: input.selector ?? null,
    callbackTokenHash: callback.hash,
    callbackExpiresAt: new Date(Date.now() + CALLBACK_TTL_MS),
  });
  return {
    status: 'queued',
    buildId,
    releaseId: null,
    variantId: null,
    callbackToken: callback.secret,
  };
};

const trimBase = (url: string): string => url.replace(/\/+$/, '');

// Fetch the build-options catalog from the running build container.
export const fetchCatalog = async (workerUrl: string): Promise<BuildCatalog> => {
  const response = await fetch(`${trimBase(workerUrl)}/catalog`);
  if (!response.ok) {
    throw new Error(`Build service catalog request failed (${response.status}).`);
  }
  return (await response.json()) as BuildCatalog;
};

// Dispatch a queued build to the container. Fire-and-return: the worker builds
// asynchronously and drives the /api/build/* callbacks on completion.
export const dispatchBuild = async (workerUrl: string, job: BuildDispatchJob): Promise<void> => {
  const response = await fetch(`${trimBase(workerUrl)}/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  if (!response.ok) {
    throw new Error(`Build service dispatch failed (${response.status}).`);
  }
};
