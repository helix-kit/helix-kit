import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requestBuild } from './build-dispatch';
import { ingestRelease, type IngestArtifact, type IngestReleaseDescriptor } from './ingest';
import { verifyBuildCallback, verifyCiToken } from './tokens';

import type { resolveOtaTarget } from './resolve';
import type { DatabaseClient } from '../db';

import { build } from '../db/release-schema';
import { type StorageProvider } from '../storage/interface';
import { joinCasKey } from '../storage/object-keys';
import { createRouterFactory } from '../trpc';

const presignSchema = z.object({
  storageKey: z.string(),
  exists: z.boolean(),
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
});

// Content-addressed presign: return the CAS key; only hand out a PUT URL if the
// blob is not already stored (dedupe).
const presignBlob = async (
  storage: StorageProvider,
  sha256: string,
  contentType: string | undefined,
): Promise<z.infer<typeof presignSchema>> => {
  const storageKey = joinCasKey(sha256);
  if (await storage.exists(storageKey)) {
    return { storageKey, exists: true, method: 'PUT', url: '', headers: {} };
  }
  const signed = await storage.getSignedUrlForUpload({ key: storageKey, contentType });
  return {
    storageKey,
    exists: false,
    method: signed.method,
    url: signed.url,
    headers: signed.headers,
  };
};

const artifactInputSchema = z.object({
  role: z.string().min(1),
  offset: z.string().optional(),
  path: z.string().optional(),
  sha256: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentType: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ref: z
    .object({
      registry: z.string(),
      coordinate: z.string(),
      refVersion: z.string(),
      digest: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const variantInputSchema = z.object({
  selector: z.record(z.string(), z.unknown()),
  name: z.string().optional(),
  analysis: z.unknown().optional(),
  artifacts: z.array(artifactInputSchema).min(1),
});

const releaseDescriptorSchema = z.object({
  typeKey: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  channel: z.string().min(1),
  sourceCommit: z.string().optional(),
  sourceDirty: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  analysis: z.unknown().optional(),
  publish: z.boolean().optional(),
  variants: z.array(variantInputSchema).min(1),
});

const ingestResultSchema = z.object({
  releaseId: z.string(),
  variantIds: z.array(z.string()),
});

type ArtifactInput = z.infer<typeof artifactInputSchema>;

const toIngestArtifact = (input: ArtifactInput): IngestArtifact => {
  if (input.ref !== undefined) {
    return { role: input.role, offset: input.offset, path: input.path, ref: input.ref };
  }
  if (input.sha256 === undefined || input.sizeBytes === undefined) {
    throw new Error(`Blob artifact "${input.role}" requires sha256 and sizeBytes.`);
  }
  return {
    role: input.role,
    offset: input.offset,
    path: input.path,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    metadata: input.metadata,
  };
};

const toDescriptor = (
  input: z.infer<typeof releaseDescriptorSchema>,
  publish: boolean,
): IngestReleaseDescriptor => ({
  ...input,
  publish,
  variants: input.variants.map((variant) => ({
    selector: variant.selector,
    name: variant.name,
    analysis: variant.analysis,
    artifacts: variant.artifacts.map(toIngestArtifact),
  })),
});

// Context for the public release/build control-plane API (CI + build-callback +
// admin triggers). Auth is per-procedure via bearer tokens read from headers.
export type ReleasesApiContext = Readonly<{
  db: DatabaseClient;
  storage: StorageProvider;
  headers: Headers;
  // Injected OTA producer (closes over the gateway's MQTT client).
  publishOta: (deviceId: string) => ReturnType<typeof resolveOtaTarget>;
}>;

const BEARER_PREFIX = 'Bearer ';

const readBearer = (headers: Headers): string | null => {
  const value = headers.get('authorization') ?? '';
  const token = value.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length).trim() : '';
  return token === '' ? null : token;
};

export const releasesApiRouter = createRouterFactory<ReleasesApiContext>()((t) => {
  const { procedure, router } = t;
  return router({
    // --- CI plane (scoped ci_token) ---
    ciArtifactUploadUrl: procedure
      .meta({ openapi: { method: 'POST', path: '/api/ci/artifacts/upload-url' } })
      .input(
        z.object({
          typeKey: z.string(),
          sha256: z.string(),
          size: z.number(),
          contentType: z.string().optional(),
        }),
      )
      .output(presignSchema)
      .mutation(async ({ ctx, input }) => {
        await verifyCiToken(ctx.db, readBearer(ctx.headers), { typeKey: input.typeKey });
        return presignBlob(ctx.storage, input.sha256, input.contentType);
      }),

    ciRegisterRelease: procedure
      .meta({ openapi: { method: 'POST', path: '/api/ci/releases' } })
      .input(releaseDescriptorSchema)
      .output(ingestResultSchema)
      .mutation(async ({ ctx, input }) => {
        await verifyCiToken(ctx.db, readBearer(ctx.headers), {
          typeKey: input.typeKey,
          name: input.name,
          publish: input.publish ?? false,
        });
        return ingestRelease(ctx.db, toDescriptor(input, input.publish ?? false), {
          ownerUserId: null,
          source: 'ci',
        });
      }),

    // --- Custom build request (Tier-0 dedupe by config_hash) ---
    buildsRequest: procedure
      .meta({ openapi: { method: 'POST', path: '/api/builds/request' } })
      .input(
        z.object({
          typeKey: z.string(),
          ownerUserId: z.string(),
          config: z.record(z.string(), z.unknown()),
          selector: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .output(
        z.object({
          status: z.enum(['hit', 'queued']),
          buildId: z.string(),
          releaseId: z.string().nullable(),
          variantId: z.string().nullable(),
          callbackToken: z.string().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await verifyCiToken(ctx.db, readBearer(ctx.headers), { typeKey: input.typeKey });
        // Shared Tier-0 request core. The caller (a CLI, the admin build UI, or a
        // real CI worker) is responsible for dispatching the returned build id +
        // callback token to a build worker.
        return requestBuild(ctx.db, input);
      }),

    // --- Build worker callbacks (per-build token) ---
    buildArtifactUrl: procedure
      .meta({ openapi: { method: 'POST', path: '/api/build/artifact-url' } })
      .input(
        z.object({
          buildId: z.string(),
          sha256: z.string(),
          size: z.number(),
          contentType: z.string().optional(),
        }),
      )
      .output(presignSchema)
      .mutation(async ({ ctx, input }) => {
        await verifyBuildCallback(ctx.db, input.buildId, readBearer(ctx.headers));
        return presignBlob(ctx.storage, input.sha256, input.contentType);
      }),

    buildComplete: procedure
      .meta({ openapi: { method: 'POST', path: '/api/build/complete' } })
      .input(
        z.object({
          buildId: z.string(),
          status: z.enum(['success', 'failed']).default('success'),
          errorSummary: z.string().optional(),
          analysis: z.unknown().optional(),
          durationMs: z.number().int().optional(),
          release: releaseDescriptorSchema.optional(),
        }),
      )
      .output(z.object({ ok: z.boolean(), releaseId: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const { ownerUserId } = await verifyBuildCallback(
          ctx.db,
          input.buildId,
          readBearer(ctx.headers),
        );
        if (input.status === 'failed' || input.release === undefined) {
          await ctx.db
            .update(build)
            .set({
              status: 'failed',
              errorSummary: input.errorSummary ?? 'build failed',
              finishedAt: new Date(),
            })
            .where(eq(build.id, input.buildId));
          return { ok: false, releaseId: null };
        }
        const result = await ingestRelease(ctx.db, toDescriptor(input.release, true), {
          ownerUserId,
          source: 'custom',
          buildId: input.buildId,
        });
        await ctx.db
          .update(build)
          .set({
            status: 'success',
            releaseId: result.releaseId,
            variantId: result.variantIds[0] ?? null,
            analysis: input.analysis ?? null,
            durationMs: input.durationMs ?? null,
            finishedAt: new Date(),
          })
          .where(eq(build.id, input.buildId));
        return { ok: true, releaseId: result.releaseId };
      }),

    // --- OTA trigger (admin/ci) ---
    otaTrigger: procedure
      .meta({ openapi: { method: 'POST', path: '/api/ota/trigger' } })
      .input(z.object({ deviceId: z.string() }))
      .output(
        z.object({
          published: z.boolean(),
          version: z.string().nullable(),
          packagePath: z.string().nullable(),
          sha256: z.string().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await verifyCiToken(ctx.db, readBearer(ctx.headers), {});
        const target = await ctx.publishOta(input.deviceId);
        return {
          published: target !== null,
          version: target?.version ?? null,
          packagePath: target?.storageKey ?? null,
          sha256: target?.sha256 ?? null,
        };
      }),
  });
});

export type ReleasesApiRouter = typeof releasesApiRouter;
