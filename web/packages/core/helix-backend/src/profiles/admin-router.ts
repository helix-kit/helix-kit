import { and, asc, desc, eq, ilike, notInArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import { artifactType, deviceProfile, profile, profileTrack, release } from '../db/release-schema';
import { device } from '../db/schema';
import { prefixedId } from '../releases/ids';
import { resolveDeviceTracks, resolveProfileTracks } from '../releases/resolve';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin (sysadmin) control plane for device profiles: the reusable release-policy
// bundles (`profile` + `profile_track`) and the device↔profile assignment
// (`device_profile`) that the resolver turns into a device's allowed/OTA artifacts.
export type ProfilesAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type ProfilesAdminContext = Readonly<{
  db: DatabaseClient;
  user: ProfilesAdminSessionUser | null;
  adminRoles: readonly string[];
}>;

const PAGE_DEFAULT = 1;
const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 50;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;
const SEARCH_LIMIT = 20;

const sortInput = z.array(z.object({ id: z.string(), desc: z.boolean() }));
// Selector values are stringy facet choices (chip=esp32, flashSize=4MB).
const selectorInput = z.record(z.string(), z.string()).default({});

// A track must follow a channel OR pin a release (channel is ignored when pinned).
const trackConfigInput = z.object({
  channel: z.string().nullable().default(null),
  pinnedReleaseId: z.string().nullable().default(null),
  selector: selectorInput,
  autoUpdate: z.boolean().default(true),
});

export const profilesAdminRouter = createRouterFactory<ProfilesAdminContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  const SORTABLE = {
    name: profile.name,
    createdAt: profile.createdAt,
  } as const;

  return t.router({
    // ---- Profiles ----
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(PAGE_DEFAULT),
          perPage: z.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
          name: z.string().default(''),
          sort: sortInput.default([{ id: 'createdAt', desc: true }]),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where =
          input.name.trim() === '' ? undefined : ilike(profile.name, `%${input.name.trim()}%`);

        // LEFT JOIN aggregates (a correlated subquery in select mis-correlates).
        const trackAgg = ctx.db
          .select({
            profileId: profileTrack.profileId,
            count: sql<number>`count(*)::int`.as('track_count'),
          })
          .from(profileTrack)
          .groupBy(profileTrack.profileId)
          .as('track_agg');
        const deviceAgg = ctx.db
          .select({
            profileId: deviceProfile.profileId,
            count: sql<number>`count(*)::int`.as('device_count'),
          })
          .from(deviceProfile)
          .groupBy(deviceProfile.profileId)
          .as('device_agg');

        const sort = input.sort.length > 0 ? input.sort : [{ id: 'createdAt', desc: true }];
        const orderBy = sort.map((item) => {
          const column = Object.hasOwn(SORTABLE, item.id)
            ? SORTABLE[item.id as keyof typeof SORTABLE]
            : profile.createdAt;
          return item.desc ? desc(column) : asc(column);
        });

        const rows = await ctx.db
          .select({
            id: profile.id,
            name: profile.name,
            description: profile.description,
            ownerUserId: profile.ownerUserId,
            trackCount: sql<number>`coalesce(${trackAgg.count}, 0)`,
            deviceCount: sql<number>`coalesce(${deviceAgg.count}, 0)`,
            createdAt: profile.createdAt,
          })
          .from(profile)
          .leftJoin(trackAgg, eq(trackAgg.profileId, profile.id))
          .leftJoin(deviceAgg, eq(deviceAgg.profileId, profile.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage);

        const [countRow] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(profile)
          .where(where);
        const total = countRow?.count ?? 0;
        return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
      }),

    // Profile detail: the profile, its tracks resolved to concrete releases, and
    // the devices it's assigned to.
    get: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(profile).where(eq(profile.id, input.id)).limit(1);
      if (row === undefined) {
        return null;
      }
      const tracks = await resolveProfileTracks(ctx.db, input.id);
      const devices = await ctx.db
        .select({
          deviceId: device.id,
          name: device.name,
          isActive: device.isActive,
          assignedAt: deviceProfile.assignedAt,
        })
        .from(deviceProfile)
        .innerJoin(device, eq(device.id, deviceProfile.deviceId))
        .where(eq(deviceProfile.profileId, input.id))
        .orderBy(asc(device.name));
      return { profile: row, tracks, devices };
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(NAME_MAX),
          description: z.string().max(DESCRIPTION_MAX).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = prefixedId('prof');
        await ctx.db.insert(profile).values({
          id,
          name: input.name,
          description: input.description ?? null,
          ownerUserId: ctx.user.id,
        });
        return { id };
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(NAME_MAX).optional(),
          description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(profile)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          })
          .where(eq(profile.id, input.id));
        return { ok: true };
      }),

    delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      // Tracks cascade via FK; device assignments have no FK, so clear them.
      await ctx.db.delete(deviceProfile).where(eq(deviceProfile.profileId, input.id));
      await ctx.db.delete(profile).where(eq(profile.id, input.id));
      return { ok: true };
    }),

    // ---- Tracks ----
    addTrack: adminProcedure
      .input(
        trackConfigInput.extend({
          profileId: z.string(),
          typeKey: z.string().min(1),
          releaseName: z.string().min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.channel === null && input.pinnedReleaseId === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A track must follow a channel or pin a release',
          });
        }
        await ctx.db.insert(profileTrack).values({
          id: prefixedId('ptrk'),
          profileId: input.profileId,
          typeKey: input.typeKey,
          releaseName: input.releaseName,
          channel: input.pinnedReleaseId === null ? input.channel : null,
          pinnedReleaseId: input.pinnedReleaseId,
          selector: input.selector,
          autoUpdate: input.autoUpdate,
        });
        return { ok: true };
      }),

    updateTrack: adminProcedure
      .input(trackConfigInput.extend({ trackId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (input.channel === null && input.pinnedReleaseId === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A track must follow a channel or pin a release',
          });
        }
        await ctx.db
          .update(profileTrack)
          .set({
            channel: input.pinnedReleaseId === null ? input.channel : null,
            pinnedReleaseId: input.pinnedReleaseId,
            selector: input.selector,
            autoUpdate: input.autoUpdate,
          })
          .where(eq(profileTrack.id, input.trackId));
        return { ok: true };
      }),

    removeTrack: adminProcedure
      .input(z.object({ trackId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(profileTrack).where(eq(profileTrack.id, input.trackId));
        return { ok: true };
      }),

    // Options for the (guided) add/edit-track form: types + their selector keys,
    // the release lines, channels, and releases available to pin.
    trackOptions: adminProcedure.query(async ({ ctx }) => {
      const types = await ctx.db
        .select({
          key: artifactType.key,
          displayName: artifactType.displayName,
          selectorKeys: artifactType.selectorKeys,
        })
        .from(artifactType)
        .orderBy(asc(artifactType.displayName));
      const releaseLines = await ctx.db
        .selectDistinct({ typeKey: release.typeKey, name: release.name })
        .from(release)
        .orderBy(asc(release.typeKey), asc(release.name));
      const channelRows = await ctx.db
        .selectDistinct({ channel: release.channel })
        .from(release)
        .orderBy(asc(release.channel));
      const releases = await ctx.db
        .select({
          id: release.id,
          typeKey: release.typeKey,
          name: release.name,
          version: release.version,
          channel: release.channel,
          status: release.status,
        })
        .from(release)
        .orderBy(desc(release.createdAt));
      return {
        types,
        releaseLines,
        channels: channelRows.map((row) => row.channel),
        releases,
      };
    }),

    // ---- Device assignment (both directions) ----
    assignDevice: adminProcedure
      .input(z.object({ profileId: z.string(), deviceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .insert(deviceProfile)
          .values({ profileId: input.profileId, deviceId: input.deviceId })
          .onConflictDoNothing();
        return { ok: true };
      }),

    unassignDevice: adminProcedure
      .input(z.object({ profileId: z.string(), deviceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(deviceProfile)
          .where(
            and(
              eq(deviceProfile.profileId, input.profileId),
              eq(deviceProfile.deviceId, input.deviceId),
            ),
          );
        return { ok: true };
      }),

    // Devices matching a query, optionally excluding those already on a profile —
    // for the profile page's "add device" picker.
    deviceSearch: adminProcedure
      .input(z.object({ query: z.string().default(''), excludeProfileId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const filters: SQL[] = [];
        if (input.query.trim() !== '') {
          filters.push(ilike(device.name, `%${input.query.trim()}%`));
        }
        if (input.excludeProfileId !== undefined) {
          const assigned = ctx.db
            .select({ deviceId: deviceProfile.deviceId })
            .from(deviceProfile)
            .where(eq(deviceProfile.profileId, input.excludeProfileId));
          filters.push(notInArray(device.id, assigned));
        }
        return ctx.db
          .select({ id: device.id, name: device.name, isActive: device.isActive })
          .from(device)
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(asc(device.name))
          .limit(SEARCH_LIMIT);
      }),

    // Profiles a device has (device-page side), + a picker for adding more.
    deviceProfiles: adminProcedure
      .input(z.object({ deviceId: z.string() }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .select({
            id: profile.id,
            name: profile.name,
            description: profile.description,
            assignedAt: deviceProfile.assignedAt,
          })
          .from(deviceProfile)
          .innerJoin(profile, eq(profile.id, deviceProfile.profileId))
          .where(eq(deviceProfile.deviceId, input.deviceId))
          .orderBy(asc(profile.name)),
      ),

    profileSearch: adminProcedure
      .input(z.object({ query: z.string().default(''), excludeDeviceId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const filters: SQL[] = [];
        if (input.query.trim() !== '') {
          filters.push(ilike(profile.name, `%${input.query.trim()}%`));
        }
        if (input.excludeDeviceId !== undefined) {
          const assigned = ctx.db
            .select({ profileId: deviceProfile.profileId })
            .from(deviceProfile)
            .where(eq(deviceProfile.deviceId, input.excludeDeviceId));
          filters.push(notInArray(profile.id, assigned));
        }
        return ctx.db
          .select({ id: profile.id, name: profile.name, description: profile.description })
          .from(profile)
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(asc(profile.name))
          .limit(SEARCH_LIMIT);
      }),

    // ---- Resolve preview ----
    // What a device currently resolves to across all its assigned profiles.
    resolveDevice: adminProcedure
      .input(z.object({ deviceId: z.string() }))
      .query(async ({ ctx, input }) => resolveDeviceTracks(ctx.db, input.deviceId)),
  });
});

export type ProfilesAdminRouter = typeof profilesAdminRouter;
