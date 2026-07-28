import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../db';

import { session, user } from '../db/auth-schema';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin (sysadmin) read surface: list is a Drizzle query here; user mutations (role/ban/delete/impersonate) go through the better-auth admin API client-side.
export type UsersAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type UsersAdminContext = Readonly<{
  db: DatabaseClient;
  user: UsersAdminSessionUser | null;
  adminRoles: readonly string[];
}>;

const PAGE_DEFAULT = 1;
const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 50;

// Users with no explicit role are treated as this pseudo-role in the facet.
const ROLE_USER = 'user';
const BAN_REASON_MAX = 500;

const sortInput = z.array(z.object({ id: z.string(), desc: z.boolean() }));

export const usersAdminRouter = createRouterFactory<UsersAdminContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  const SORTABLE = {
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  } as const;

  return t.router({
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(PAGE_DEFAULT),
          perPage: z.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
          name: z.string().default(''),
          role: z.array(z.string()).default([]),
          status: z.array(z.string()).default([]),
          sort: sortInput.default([{ id: 'createdAt', desc: true }]),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters: SQL[] = [];
        if (input.name.trim() !== '') {
          const pattern = `%${input.name.trim()}%`;
          const term = or(ilike(user.name, pattern), ilike(user.email, pattern));
          if (term !== undefined) {
            filters.push(term);
          }
        }
        if (input.role.length > 0) {
          // 'user' means an unset OR literal 'user' role; the rest match directly.
          const named = input.role.filter((value) => value !== ROLE_USER);
          const roleConds: SQL[] = [];
          if (input.role.includes(ROLE_USER)) {
            named.push(ROLE_USER);
            roleConds.push(isNull(user.role));
          }
          if (named.length > 0) {
            roleConds.push(inArray(user.role, named));
          }
          const roleTerm = roleConds.length === 1 ? roleConds[0] : or(...roleConds);
          if (roleTerm !== undefined) {
            filters.push(roleTerm);
          }
        }
        const wantsActive = input.status.includes('active');
        const wantsBanned = input.status.includes('banned');
        if (wantsActive !== wantsBanned) {
          filters.push(wantsBanned ? eq(user.banned, true) : sql`${user.banned} is not true`);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const sort = input.sort.length > 0 ? input.sort : [{ id: 'createdAt', desc: true }];
        const orderBy = sort.map((item) => {
          const column = Object.hasOwn(SORTABLE, item.id)
            ? SORTABLE[item.id as keyof typeof SORTABLE]
            : user.createdAt;
          return item.desc ? desc(column) : asc(column);
        });

        const rows = await ctx.db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            role: user.role,
            banned: user.banned,
            banReason: user.banReason,
            banExpires: user.banExpires,
            createdAt: user.createdAt,
          })
          .from(user)
          .where(where)
          .orderBy(...orderBy)
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage);

        const [countRow] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(user)
          .where(where);
        const total = countRow?.count ?? 0;

        return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
      }),

    // Distinct roles present, for the role facet (null → the 'user' pseudo-role).
    filterOptions: adminProcedure.query(async ({ ctx }) => {
      const roleRows = await ctx.db
        .selectDistinct({ role: user.role })
        .from(user)
        .orderBy(asc(user.role));
      const roles = roleRows.map((row) => row.role ?? ROLE_USER);
      return { roles: Array.from(new Set(roles)) };
    }),

    // Done here, not via the better-auth client, since its role type is fixed to admin/user.
    setRole: adminProcedure
      .input(z.object({ userId: z.string(), role: z.enum(['user', 'admin', 'sysadmin']) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(user).set({ role: input.role }).where(eq(user.id, input.userId));
        return { ok: true };
      }),

    // Ban / unban. Banning revokes the account's sessions so it can't keep acting.
    setBan: adminProcedure
      .input(
        z.object({
          userId: z.string(),
          banned: z.boolean(),
          reason: z.string().max(BAN_REASON_MAX).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.banned && input.userId === ctx.user.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot ban yourself' });
        }
        if (input.banned) {
          await ctx.db
            .update(user)
            .set({ banned: true, banReason: input.reason ?? 'Banned by an administrator' })
            .where(eq(user.id, input.userId));
          await ctx.db.delete(session).where(eq(session.userId, input.userId));
        } else {
          await ctx.db
            .update(user)
            .set({ banned: false, banReason: null, banExpires: null })
            .where(eq(user.id, input.userId));
        }
        return { ok: true };
      }),

    // Delete an account. FK cascades remove its sessions, accounts, and passkeys.
    remove: adminProcedure
      .input(z.object({ userId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot delete yourself' });
        }
        await ctx.db.delete(user).where(eq(user.id, input.userId));
        return { ok: true };
      }),
  });
});

export type UsersAdminRouter = typeof usersAdminRouter;
