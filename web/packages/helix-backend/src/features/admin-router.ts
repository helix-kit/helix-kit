import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { resolveDeviceFeatures } from './resolve';

import type { DatabaseClient } from '../db';

import { deviceFeatureOverride, feature, profileFeature } from '../db/feature-schema';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin control plane for device feature flags: catalog, profile grants, and per-device overrides.
export type FeaturesAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type FeaturesAdminContext = Readonly<{
  db: DatabaseClient;
  user: FeaturesAdminSessionUser | null;
  adminRoles: readonly string[];
}>;

export const featuresAdminRouter = createRouterFactory<FeaturesAdminContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    // The registered feature catalog.
    catalog: adminProcedure.query(({ ctx }) =>
      ctx.db.select({ key: feature.key }).from(feature).orderBy(asc(feature.key)),
    ),

    // The catalog paired with which keys a given profile enables.
    profileFeatures: adminProcedure
      .input(z.object({ profileId: z.string() }))
      .query(async ({ ctx, input }) => {
        const catalog = await ctx.db
          .select({ key: feature.key })
          .from(feature)
          .orderBy(asc(feature.key));
        const enabled = await ctx.db
          .select({ featureKey: profileFeature.featureKey })
          .from(profileFeature)
          .where(eq(profileFeature.profileId, input.profileId));
        const enabledKeys = new Set(enabled.map((row) => row.featureKey));
        return catalog.map((row) => ({ key: row.key, enabled: enabledKeys.has(row.key) }));
      }),

    // Enable (insert) or disable (delete) a feature for a profile.
    setProfileFeature: adminProcedure
      .input(z.object({ profileId: z.string(), featureKey: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (input.enabled) {
          await ctx.db
            .insert(profileFeature)
            .values({ profileId: input.profileId, featureKey: input.featureKey })
            .onConflictDoNothing();
        } else {
          await ctx.db
            .delete(profileFeature)
            .where(
              and(
                eq(profileFeature.profileId, input.profileId),
                eq(profileFeature.featureKey, input.featureKey),
              ),
            );
        }
        return { ok: true };
      }),

    // The per-device override rows (the admin exceptions) for a device.
    deviceOverrides: adminProcedure
      .input(z.object({ deviceId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db
          .select({
            featureKey: deviceFeatureOverride.featureKey,
            enabled: deviceFeatureOverride.enabled,
            note: deviceFeatureOverride.note,
          })
          .from(deviceFeatureOverride)
          .where(eq(deviceFeatureOverride.deviceId, input.deviceId))
          .orderBy(asc(deviceFeatureOverride.featureKey)),
      ),

    // Set (enabled = true/false) or clear (enabled = null) a per-device override.
    setDeviceOverride: adminProcedure
      .input(
        z.object({
          deviceId: z.string(),
          featureKey: z.string(),
          enabled: z.boolean().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.enabled === null) {
          await ctx.db
            .delete(deviceFeatureOverride)
            .where(
              and(
                eq(deviceFeatureOverride.deviceId, input.deviceId),
                eq(deviceFeatureOverride.featureKey, input.featureKey),
              ),
            );
          return { ok: true };
        }
        await ctx.db
          .insert(deviceFeatureOverride)
          .values({
            deviceId: input.deviceId,
            featureKey: input.featureKey,
            enabled: input.enabled,
            createdBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: [deviceFeatureOverride.deviceId, deviceFeatureOverride.featureKey],
            set: { enabled: input.enabled, createdBy: ctx.user.id },
          });
        return { ok: true };
      }),

    // The effective feature set for a device (override > profile > default).
    resolveDevice: adminProcedure
      .input(z.object({ deviceId: z.string() }))
      .query(async ({ ctx, input }) => {
        const resolved = await resolveDeviceFeatures(ctx.db, input.deviceId);
        return [...resolved.entries()].map(([key, resolution]) => ({ key, ...resolution }));
      }),
  });
});

export type FeaturesAdminRouter = typeof featuresAdminRouter;
