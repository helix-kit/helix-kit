import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import { device, deviceEvent } from '../db/schema';
import { prefixedId } from '../releases/ids';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin (sysadmin) management surface for the device registry: list enrolled
// devices (with event count + last-seen derived from device_event), register
// new devices with a generated access token, toggle active, rotate the token,
// and delete. Mirrors the releases/blog admin routers (session/role auth).
export type DevicesAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type DevicesAdminContext = Readonly<{
  db: DatabaseClient;
  user: DevicesAdminSessionUser | null;
  adminRoles: readonly string[];
}>;

const PAGE_DEFAULT = 1;
const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 50;
const TOKEN_BYTES = 24;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;
const EVENTS_LIMIT_MAX = 100;
const EVENTS_LIMIT_DEFAULT = 20;

const sortInput = z.array(z.object({ id: z.string(), desc: z.boolean() }));

const newToken = (): string => randomBytes(TOKEN_BYTES).toString('hex');

// A device with no events yields NULL, so decode null explicitly rather than
// through the timestamp column (which would type it non-null).
const decodeLastSeen = (value: unknown): Date | null =>
  value === null ? null : new Date(value as string);

export const devicesAdminRouter = createRouterFactory<DevicesAdminContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  const SORTABLE = {
    name: device.name,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  } as const;

  return t.router({
    // Server-side paginated / filtered / sorted device list backing the admin
    // DataTable. The access token is never returned here — only on create/rotate.
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(PAGE_DEFAULT),
          perPage: z.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
          name: z.string().default(''),
          status: z.array(z.string()).default([]),
          sort: sortInput.default([{ id: 'createdAt', desc: true }]),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters: SQL[] = [];
        if (input.name.trim() !== '') {
          filters.push(ilike(device.name, `%${input.name.trim()}%`));
        }
        // Facet holds 'active' / 'inactive'. Selecting both (or neither) is no filter.
        const wantsActive = input.status.includes('active');
        const wantsInactive = input.status.includes('inactive');
        if (wantsActive !== wantsInactive) {
          filters.push(eq(device.isActive, wantsActive));
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const sort = input.sort.length > 0 ? input.sort : [{ id: 'createdAt', desc: true }];
        const orderBy = sort.map((item) => {
          const column = Object.hasOwn(SORTABLE, item.id)
            ? SORTABLE[item.id as keyof typeof SORTABLE]
            : device.createdAt;
          return item.desc ? desc(column) : asc(column);
        });

        // Aggregate events per device, then LEFT JOIN — a correlated subquery in
        // the select renders columns unqualified and mis-correlates.
        const eventAgg = ctx.db
          .select({
            deviceId: deviceEvent.deviceId,
            eventCount: sql<number>`count(*)::int`.as('event_count'),
            lastSeenAt:
              sql`max(coalesce(${deviceEvent.eventTimestamp}, ${deviceEvent.receivedAt}))`.as(
                'last_seen_at',
              ),
          })
          .from(deviceEvent)
          .groupBy(deviceEvent.deviceId)
          .as('event_agg');

        const rows = await ctx.db
          .select({
            id: device.id,
            name: device.name,
            description: device.description,
            isActive: device.isActive,
            eventCount: sql<number>`coalesce(${eventAgg.eventCount}, 0)`,
            lastSeenAt: sql`${eventAgg.lastSeenAt}`.mapWith(decodeLastSeen),
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
          })
          .from(device)
          .leftJoin(eventAgg, eq(eventAgg.deviceId, device.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage);

        const [countRow] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(device)
          .where(where);
        const total = countRow?.count ?? 0;

        return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
      }),

    // Public single-device overview backing /device/[id] — readable by anyone
    // (no admin gate), and never exposes the access token. Mutations stay admin.
    get: t.procedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: device.id,
          name: device.name,
          description: device.description,
          isActive: device.isActive,
          // Filter on the literal id (a bound param) — not a correlation to the
          // outer column, which renders unqualified in select context.
          eventCount: sql<number>`(
            select count(*)::int from ${deviceEvent} where ${deviceEvent.deviceId} = ${input.id}
          )`,
          lastSeenAt: sql`(
            select max(coalesce(${deviceEvent.eventTimestamp}, ${deviceEvent.receivedAt}))
            from ${deviceEvent} where ${deviceEvent.deviceId} = ${input.id}
          )`.mapWith(decodeLastSeen),
          createdAt: device.createdAt,
          updatedAt: device.updatedAt,
        })
        .from(device)
        .where(eq(device.id, input.id))
        .limit(1);
      return row ?? null;
    }),

    // Register a device. The access token is returned exactly once (the device
    // authenticates ingestion/cert issuance with it); it is not stored in plain
    // view anywhere the list can read.
    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(NAME_MAX),
          description: z.string().max(DESCRIPTION_MAX).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = prefixedId('dev');
        const accessToken = newToken();
        await ctx.db.insert(device).values({
          id,
          name: input.name,
          description: input.description ?? null,
          accessToken,
          isActive: true,
        });
        return { id, name: input.name, accessToken };
      }),

    setActive: adminProcedure
      .input(z.object({ id: z.string(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(device)
          .set({ isActive: input.isActive })
          .where(eq(device.id, input.id));
        return { ok: true };
      }),

    // Rotate the access token (revokes the old one). Returned once.
    rotateToken: adminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const accessToken = newToken();
        const [row] = await ctx.db
          .update(device)
          .set({ accessToken })
          .where(eq(device.id, input.id))
          .returning({ id: device.id });
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });
        }
        return { accessToken };
      }),

    delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      // device_event.device_id is free text (no FK), so clear history explicitly.
      await ctx.db.delete(deviceEvent).where(eq(deviceEvent.deviceId, input.id));
      await ctx.db.delete(device).where(eq(device.id, input.id));
      return { ok: true };
    }),

    // Recent events for a device (the detail drawer / last-seen breakdown).
    events: adminProcedure
      .input(
        z.object({
          id: z.string(),
          limit: z.number().int().min(1).max(EVENTS_LIMIT_MAX).default(EVENTS_LIMIT_DEFAULT),
        }),
      )
      .query(async ({ ctx, input }) =>
        ctx.db
          .select({
            id: deviceEvent.id,
            eventType: deviceEvent.eventType,
            messageId: deviceEvent.messageId,
            eventTimestamp: deviceEvent.eventTimestamp,
            receivedAt: deviceEvent.receivedAt,
          })
          .from(deviceEvent)
          .where(eq(deviceEvent.deviceId, input.id))
          .orderBy(desc(deviceEvent.receivedAt))
          .limit(input.limit),
      ),
  });
});

export type DevicesAdminRouter = typeof devicesAdminRouter;
