import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { dispatchBuild, fetchCatalog, requestBuild } from './build-dispatch';

import type { DatabaseClient } from '../db';

import {
  artifact,
  artifactType,
  build,
  release,
  releaseChannelHead,
  variant,
  variantArtifact,
} from '../db/release-schema';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin (sysadmin) read surface over the release control plane: product lines,
// releases + variants/artifacts, and custom-build history. Distinct from
// `releasesApiRouter`, which is the machine-facing CI/build API authed by bearer
// tokens; this router is authed by the consuming app's session/role, mirroring
// `blogAdminRouter`.
export type ReleasesAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type ReleasesAdminContext = Readonly<{
  db: DatabaseClient;
  user: ReleasesAdminSessionUser | null;
  adminRoles: readonly string[];
  // The long-running build container's base URL (its GET /catalog + POST /build),
  // and the release-backend base the worker calls back to ({url}/api/build/*) —
  // which must be reachable *from the container*. Null when unconfigured.
  buildWorkerUrl: string | null;
  buildCallbackBaseUrl: string | null;
}>;

const FIRMWARE_TYPE_KEY = 'esp32-firmware';

const buildRequestInput = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  channel: z.string().min(1).default('custom'),
  chip: z.string().min(1),
  flashSize: z.string().min(1),
  apps: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  set: z.record(z.string(), z.string()).default({}),
  fake: z.boolean().optional(),
});

const PAGE_DEFAULT = 1;
const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 50;

const sortInput = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const listInput = z.object({
  page: z.number().int().min(1).default(PAGE_DEFAULT),
  perPage: z.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
});

const orderFor = <T extends Record<string, unknown>>(
  sort: readonly { id: string; desc: boolean }[],
  columns: T,
  fallback: T[keyof T],
): ReturnType<typeof asc>[] => {
  const active = sort.filter((item) => Object.hasOwn(columns, item.id));
  const chosen = active.length > 0 ? active : [{ id: '', desc: true }];
  return chosen.map((item) => {
    const column = (Object.hasOwn(columns, item.id) ? columns[item.id] : fallback) as never;
    return item.desc ? desc(column) : asc(column);
  });
};

// Columns the release list may sort by, keyed by table column id.
const RELEASE_SORTABLE = {
  name: release.name,
  version: release.version,
  channel: release.channel,
  status: release.status,
  createdAt: release.createdAt,
} as const;

const RELEASE_LIST_COLUMNS = {
  id: release.id,
  typeKey: release.typeKey,
  name: release.name,
  version: release.version,
  channel: release.channel,
  status: release.status,
  sourceCommit: release.sourceCommit,
  createdAt: release.createdAt,
  publishedAt: release.publishedAt,
} as const;

// Shared server-side paginated release list — the flat list and the per-line
// list differ only in their `filters`.
const runReleaseList = async (
  db: DatabaseClient,
  filters: SQL[],
  sort: readonly { id: string; desc: boolean }[],
  page: number,
  perPage: number,
) => {
  const where = filters.length > 0 ? and(...filters) : undefined;
  // Aggregate + LEFT JOIN for the variant count — a correlated subquery in the
  // select renders columns unqualified and mis-correlates.
  const variantAgg = db
    .select({
      releaseId: variant.releaseId,
      variantCount: sql<number>`count(*)::int`.as('variant_count'),
    })
    .from(variant)
    .groupBy(variant.releaseId)
    .as('variant_agg');
  const rows = await db
    .select({
      ...RELEASE_LIST_COLUMNS,
      variantCount: sql<number>`coalesce(${variantAgg.variantCount}, 0)`,
    })
    .from(release)
    .leftJoin(variantAgg, eq(variantAgg.releaseId, release.id))
    .where(where)
    .orderBy(...orderFor(sort, RELEASE_SORTABLE, release.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(release)
    .where(where);
  const total = countRow?.count ?? 0;
  return { rows, pageCount: Math.max(1, Math.ceil(total / perPage)) };
};

export const releasesAdminRouter = createRouterFactory<ReleasesAdminContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  const BUILD_SORTABLE = {
    status: build.status,
    durationMs: build.durationMs,
    createdAt: build.createdAt,
  } as const;

  // Product lines are grouped by (type_key, name) — the identity that ties every
  // version of the same "thing" together.
  const PRODUCT_SORTABLE = {
    name: release.name,
    typeKey: release.typeKey,
    releaseCount: sql`count(*)`,
    latestCreatedAt: sql`max(${release.createdAt})`,
  } as const;

  return t.router({
    // Server-side paginated / filtered / sorted release list backing the admin
    // DataTable. Filter + sort state arrives from the URL (nuqs) via the page.
    list: adminProcedure
      .input(
        listInput.extend({
          name: z.string().default(''),
          typeKey: z.array(z.string()).default([]),
          channel: z.array(z.string()).default([]),
          status: z.array(z.string()).default([]),
          sort: sortInput.default([{ id: 'createdAt', desc: true }]),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters: SQL[] = [];
        if (input.name.trim() !== '') {
          filters.push(ilike(release.name, `%${input.name.trim()}%`));
        }
        if (input.typeKey.length > 0) {
          filters.push(inArray(release.typeKey, input.typeKey));
        }
        if (input.channel.length > 0) {
          filters.push(inArray(release.channel, input.channel));
        }
        if (input.status.length > 0) {
          filters.push(inArray(release.status, input.status));
        }
        return runReleaseList(ctx.db, filters, input.sort, input.page, input.perPage);
      }),

    // Facet option sources for the release list toolbar (artifact types + the
    // set of channels that actually appear on releases).
    filterOptions: adminProcedure.query(async ({ ctx }) => {
      const types = await ctx.db
        .select({ key: artifactType.key, displayName: artifactType.displayName })
        .from(artifactType)
        .orderBy(asc(artifactType.displayName));
      const channelRows = await ctx.db
        .selectDistinct({ channel: release.channel })
        .from(release)
        .orderBy(asc(release.channel));
      return { types, channels: channelRows.map((row) => row.channel) };
    }),

    // Release detail: the release row plus every variant and the artifacts each
    // variant links (roles, storage mode, sha256/size or registry ref).
    getById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [releaseRow] = await ctx.db
        .select()
        .from(release)
        .where(eq(release.id, input.id))
        .limit(1);
      if (releaseRow === undefined) {
        return null;
      }

      const variants = await ctx.db
        .select()
        .from(variant)
        .where(eq(variant.releaseId, input.id))
        .orderBy(desc(variant.createdAt));

      const variantIds = variants.map((row) => row.id);
      const links =
        variantIds.length === 0
          ? []
          : await ctx.db
              .select({
                variantId: variantArtifact.variantId,
                role: variantArtifact.role,
                offset: variantArtifact.offset,
                path: variantArtifact.path,
                sortOrder: variantArtifact.sortOrder,
                artifactId: artifact.id,
                storageMode: artifact.storageMode,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes,
                storageKey: artifact.storageKey,
                contentType: artifact.contentType,
                registry: artifact.registry,
                coordinate: artifact.coordinate,
                refVersion: artifact.refVersion,
                digest: artifact.digest,
              })
              .from(variantArtifact)
              .innerJoin(artifact, eq(variantArtifact.artifactId, artifact.id))
              .where(inArray(variantArtifact.variantId, variantIds))
              .orderBy(asc(variantArtifact.sortOrder));

      return {
        release: releaseRow,
        variants: variants.map((row) => ({
          ...row,
          artifacts: links.filter((link) => link.variantId === row.id),
        })),
      };
    }),

    // Product lines: every (type_key, name) with its release count, the channels
    // it ships to, and its latest version — the top of the Products → line →
    // release → detail drill-down.
    products: t.router({
      list: adminProcedure
        .input(
          listInput.extend({
            name: z.string().default(''),
            typeKey: z.array(z.string()).default([]),
            sort: sortInput.default([{ id: 'latestCreatedAt', desc: true }]),
          }),
        )
        .query(async ({ ctx, input }) => {
          const filters: SQL[] = [];
          if (input.name.trim() !== '') {
            filters.push(ilike(release.name, `%${input.name.trim()}%`));
          }
          if (input.typeKey.length > 0) {
            filters.push(inArray(release.typeKey, input.typeKey));
          }
          const where = filters.length > 0 ? and(...filters) : undefined;

          const grouped = await ctx.db
            .select({
              typeKey: release.typeKey,
              name: release.name,
              releaseCount: sql<number>`count(*)::int`,
              readyCount: sql<number>`count(*) filter (where ${release.status} = 'ready')::int`,
              draftCount: sql<number>`count(*) filter (where ${release.status} = 'draft')::int`,
              channels: sql<
                string[]
              >`array_agg(distinct ${release.channel} order by ${release.channel})`,
              // Raw aggregates skip the column decoder, so map it back through
              // the timestamp column or the driver returns a bare string.
              latestCreatedAt: sql`max(${release.createdAt})`.mapWith(release.createdAt),
            })
            .from(release)
            .where(where)
            .groupBy(release.typeKey, release.name)
            .orderBy(...orderFor(input.sort, PRODUCT_SORTABLE, sql`max(${release.createdAt})`))
            .limit(input.perPage)
            .offset((input.page - 1) * input.perPage);

          // Latest version per line via distinct-on (a correlated subquery inside
          // the grouped select does not render correctly through drizzle).
          const latest = await ctx.db
            .selectDistinctOn([release.typeKey, release.name], {
              typeKey: release.typeKey,
              name: release.name,
              version: release.version,
            })
            .from(release)
            .where(where)
            .orderBy(release.typeKey, release.name, desc(release.createdAt));
          const latestByLine = new Map(
            latest.map((row) => [`${row.typeKey} ${row.name}`, row.version]),
          );
          const rows = grouped.map((row) => ({
            ...row,
            latestVersion: latestByLine.get(`${row.typeKey} ${row.name}`) ?? '',
          }));

          const groups = ctx.db
            .select({ typeKey: release.typeKey })
            .from(release)
            .where(where)
            .groupBy(release.typeKey, release.name)
            .as('g');
          const [countRow] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(groups);
          const total = countRow?.count ?? 0;

          return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
        }),

      // Line summary: identity, status counts, the channels it ships to, and the
      // current head release per channel. Returns null for an unknown line.
      get: adminProcedure
        .input(z.object({ typeKey: z.string(), name: z.string() }))
        .query(async ({ ctx, input }) => {
          const lineWhere = and(eq(release.typeKey, input.typeKey), eq(release.name, input.name));
          const [agg] = await ctx.db
            .select({
              releaseCount: sql<number>`count(*)::int`,
              readyCount: sql<number>`count(*) filter (where ${release.status} = 'ready')::int`,
              draftCount: sql<number>`count(*) filter (where ${release.status} = 'draft')::int`,
            })
            .from(release)
            .where(lineWhere);
          if (agg === undefined || agg.releaseCount === 0) {
            return null;
          }

          const [typeRow] = await ctx.db
            .select({ displayName: artifactType.displayName })
            .from(artifactType)
            .where(eq(artifactType.key, input.typeKey))
            .limit(1);

          const channelRows = await ctx.db
            .selectDistinct({ channel: release.channel })
            .from(release)
            .where(lineWhere)
            .orderBy(asc(release.channel));

          const channelHeads = await ctx.db
            .select({
              channel: releaseChannelHead.channel,
              releaseId: releaseChannelHead.releaseId,
              version: release.version,
              status: release.status,
              updatedAt: releaseChannelHead.updatedAt,
            })
            .from(releaseChannelHead)
            .innerJoin(release, eq(release.id, releaseChannelHead.releaseId))
            .where(
              and(
                eq(releaseChannelHead.typeKey, input.typeKey),
                eq(releaseChannelHead.name, input.name),
              ),
            )
            .orderBy(asc(releaseChannelHead.channel));

          return {
            typeKey: input.typeKey,
            typeName: typeRow?.displayName ?? input.typeKey,
            name: input.name,
            releaseCount: agg.releaseCount,
            readyCount: agg.readyCount,
            draftCount: agg.draftCount,
            channels: channelRows.map((row) => row.channel),
            channelHeads,
          };
        }),

      // The releases within one line — same shape/columns as the flat list, but
      // scoped to an exact (type_key, name).
      releases: adminProcedure
        .input(
          listInput.extend({
            typeKey: z.string(),
            name: z.string(),
            channel: z.array(z.string()).default([]),
            status: z.array(z.string()).default([]),
            sort: sortInput.default([{ id: 'createdAt', desc: true }]),
          }),
        )
        .query(async ({ ctx, input }) => {
          const filters: SQL[] = [eq(release.typeKey, input.typeKey), eq(release.name, input.name)];
          if (input.channel.length > 0) {
            filters.push(inArray(release.channel, input.channel));
          }
          if (input.status.length > 0) {
            filters.push(inArray(release.status, input.status));
          }
          return runReleaseList(ctx.db, filters, input.sort, input.page, input.perPage);
        }),
    }),

    builds: t.router({
      // Custom-build history (queued / success / failed), paginated + filtered.
      list: adminProcedure
        .input(
          listInput.extend({
            typeKey: z.array(z.string()).default([]),
            source: z.array(z.string()).default([]),
            status: z.array(z.string()).default([]),
            sort: sortInput.default([{ id: 'createdAt', desc: true }]),
          }),
        )
        .query(async ({ ctx, input }) => {
          const filters: SQL[] = [];
          if (input.typeKey.length > 0) {
            filters.push(inArray(build.typeKey, input.typeKey));
          }
          if (input.source.length > 0) {
            filters.push(inArray(build.source, input.source));
          }
          if (input.status.length > 0) {
            filters.push(inArray(build.status, input.status));
          }
          const where = filters.length > 0 ? and(...filters) : undefined;

          const rows = await ctx.db
            .select({
              id: build.id,
              typeKey: build.typeKey,
              source: build.source,
              ownerUserId: build.ownerUserId,
              status: build.status,
              configHash: build.configHash,
              releaseId: build.releaseId,
              durationMs: build.durationMs,
              errorSummary: build.errorSummary,
              createdAt: build.createdAt,
              finishedAt: build.finishedAt,
            })
            .from(build)
            .where(where)
            .orderBy(...orderFor(input.sort, BUILD_SORTABLE, build.createdAt))
            .limit(input.perPage)
            .offset((input.page - 1) * input.perPage);

          const [countRow] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(build)
            .where(where);
          const total = countRow?.count ?? 0;

          return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
        }),

      filterOptions: adminProcedure.query(async ({ ctx }) => {
        const types = await ctx.db
          .select({ key: artifactType.key, displayName: artifactType.displayName })
          .from(artifactType)
          .orderBy(asc(artifactType.displayName));
        return { types };
      }),

      // Whether the custom-firmware builder is usable in this deployment (the
      // build container + callback base are both configured).
      serviceStatus: adminProcedure.query(({ ctx }) => ({
        configured: ctx.buildWorkerUrl !== null && ctx.buildCallbackBaseUrl !== null,
      })),

      // The build-options catalog (apps/features/chips/...), proxied from the
      // running build container so the option lists track the firmware sources.
      catalog: adminProcedure.query(async ({ ctx }) => {
        if (ctx.buildWorkerUrl === null) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Build service is not configured (set HELIX_BUILD_WORKER_URL).',
          });
        }
        return fetchCatalog(ctx.buildWorkerUrl);
      }),

      // Request a custom firmware build: Tier-0 dedupe, then dispatch the queued
      // build to the container, which builds and calls back to register a release.
      request: adminProcedure.input(buildRequestInput).mutation(async ({ ctx, input }) => {
        if (ctx.buildWorkerUrl === null || ctx.buildCallbackBaseUrl === null) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Build service is not configured (set HELIX_BUILD_WORKER_URL).',
          });
        }
        const selector = { chip: input.chip, flashSize: input.flashSize };
        const config = {
          apps: input.apps,
          features: input.features,
          set: input.set,
          chip: input.chip,
          flashSize: input.flashSize,
        };
        const result = await requestBuild(ctx.db, {
          typeKey: FIRMWARE_TYPE_KEY,
          ownerUserId: ctx.user.id,
          config,
          selector,
        });
        if (result.status === 'hit') {
          return { status: 'hit' as const, buildId: result.buildId, releaseId: result.releaseId };
        }
        await dispatchBuild(ctx.buildWorkerUrl, {
          buildId: result.buildId,
          callbackToken: result.callbackToken ?? '',
          publicUrl: ctx.buildCallbackBaseUrl,
          release: { name: input.name, version: input.version, channel: input.channel },
          selector,
          config,
          fake: input.fake,
        });
        return { status: 'queued' as const, buildId: result.buildId, releaseId: null };
      }),

      // One build's live state, for the UI to poll while a build is in flight.
      get: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({
            id: build.id,
            typeKey: build.typeKey,
            source: build.source,
            status: build.status,
            configHash: build.configHash,
            releaseId: build.releaseId,
            durationMs: build.durationMs,
            analysis: build.analysis,
            errorSummary: build.errorSummary,
            createdAt: build.createdAt,
            finishedAt: build.finishedAt,
          })
          .from(build)
          .where(eq(build.id, input.id))
          .limit(1);
        return row ?? null;
      }),
    }),
  });
});

export type ReleasesAdminRouter = typeof releasesAdminRouter;
