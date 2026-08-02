import { randomUUID } from 'node:crypto';

import { user } from '@helix/backend/db/auth-schema';
import { createRouterFactory, TRPCError } from '@helix/backend/trpc';
import { and, arrayOverlaps, asc, desc, eq, ilike, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { post } from './schema';

import type { DatabaseClient } from '@helix/backend/db';

/** Context for the blog control-plane API: public procedures read published posts, admin procedures require `adminRoles`. */
export type BlogSessionUser = Readonly<{
  id: string;
  name: string;
  role: string | null;
}>;

export type BlogContext = Readonly<{
  db: DatabaseClient;
  user: BlogSessionUser | null;
  adminRoles: readonly string[];
}>;

const SLUG_MAX_LENGTH = 80;
const SLUG_SUFFIX_LENGTH = 8;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 500;
const WORDS_PER_MINUTE = 200;
const LIST_LIMIT_MAX = 50;
const LIST_LIMIT_DEFAULT = 10;
const RELATED_LIMIT_MAX = 10;
const RELATED_LIMIT_DEFAULT = 3;

const POST_SUMMARY = {
  id: post.id,
  title: post.title,
  slug: post.slug,
  description: post.description,
  coverImage: post.coverImage,
  tags: post.tags,
  readingTime: post.readingTime,
  published: post.published,
  publishedAt: post.publishedAt,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  authorName: user.name,
  authorImage: user.image,
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);

// Rough reading time in minutes from MDX content (~200 wpm); code blocks and markdown/JSX markers are stripped so a code-heavy post isn't wildly inflated.
const readingTimeFor = (mdx: string): number => {
  const words = mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

const postInput = z.object({
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(SLUG_MAX_LENGTH)
    .optional(),
  content: z.string().default(''),
  description: z.string().max(DESCRIPTION_MAX_LENGTH).default(''),
  coverImage: z.string().default(''),
  tags: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  published: z.boolean().default(false),
});

/** Public, read-only surface — only published posts are read; user/adminRoles unused. */
export const blogPublicRouter = createRouterFactory<BlogContext>()((t) =>
  t.router({
    listPublished: t.procedure
      .input(
        z.object({
          limit: z.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
          offset: z.number().int().min(0).default(0),
          tag: z.string().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where =
          input.tag === undefined
            ? eq(post.published, true)
            : and(eq(post.published, true), arrayOverlaps(post.tags, [input.tag]));
        return ctx.db
          .select(POST_SUMMARY)
          .from(post)
          .leftJoin(user, eq(post.authorId, user.id))
          .where(where)
          .orderBy(desc(post.publishedAt))
          .limit(input.limit)
          .offset(input.offset);
      }),

    countPublished: t.procedure
      .input(z.object({ tag: z.string().optional() }).default({}))
      .query(async ({ ctx, input }) => {
        const where =
          input.tag === undefined
            ? eq(post.published, true)
            : and(eq(post.published, true), arrayOverlaps(post.tags, [input.tag]));
        const [row] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(post)
          .where(where);
        return row?.count ?? 0;
      }),

    publishedSlugs: t.procedure.query(async ({ ctx }) =>
      ctx.db
        .select({ slug: post.slug, publishedAt: post.publishedAt, updatedAt: post.updatedAt })
        .from(post)
        .where(eq(post.published, true)),
    ),

    getBySlug: t.procedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: post.id,
          title: post.title,
          slug: post.slug,
          content: post.content,
          description: post.description,
          coverImage: post.coverImage,
          tags: post.tags,
          readingTime: post.readingTime,
          publishedAt: post.publishedAt,
          updatedAt: post.updatedAt,
          createdAt: post.createdAt,
          authorName: user.name,
          authorImage: user.image,
        })
        .from(post)
        .leftJoin(user, eq(post.authorId, user.id))
        .where(and(eq(post.slug, input.slug), eq(post.published, true)))
        .limit(1);
      return row ?? null;
    }),

    getRelated: t.procedure
      .input(
        z.object({
          slug: z.string(),
          tags: z.array(z.string()).default([]),
          limit: z.number().int().min(1).max(RELATED_LIMIT_MAX).default(RELATED_LIMIT_DEFAULT),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where =
          input.tags.length > 0
            ? and(
                eq(post.published, true),
                ne(post.slug, input.slug),
                arrayOverlaps(post.tags, input.tags),
              )
            : and(eq(post.published, true), ne(post.slug, input.slug));
        return ctx.db
          .select(POST_SUMMARY)
          .from(post)
          .leftJoin(user, eq(post.authorId, user.id))
          .where(where)
          .orderBy(desc(post.publishedAt))
          .limit(input.limit);
      }),
  }),
);

export type BlogPublicRouter = ReturnType<typeof blogPublicRouter>;

/** Admin (sysadmin) surface: post authoring/management. */
export const blogAdminRouter = createRouterFactory<BlogContext>()((t) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  // Columns the admin table is allowed to sort by (keyed by the table column id).
  const ADMIN_SORTABLE = {
    title: post.title,
    updatedAt: post.updatedAt,
    published: post.published,
  } as const;

  return t.router({
    // Paginated/filtered/sorted list backing the admin DataTable; filter/sort state arrives from the URL (nuqs).
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          perPage: z.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
          title: z.string().default(''),
          status: z.array(z.string()).default([]),
          sort: z
            .array(z.object({ id: z.string(), desc: z.boolean() }))
            .default([{ id: 'updatedAt', desc: true }]),
        }),
      )
      .query(async ({ ctx, input }) => {
        const filters = [];
        if (input.title.trim() !== '') {
          filters.push(ilike(post.title, `%${input.title.trim()}%`));
        }
        // Facet holds 'published' / 'draft'. Selecting both (or neither) is no filter.
        const wantsPublished = input.status.includes('published');
        const wantsDraft = input.status.includes('draft');
        if (wantsPublished !== wantsDraft) {
          filters.push(eq(post.published, wantsPublished));
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const sort = input.sort.length > 0 ? input.sort : [{ id: 'updatedAt', desc: true }];
        const orderBy = sort.map((item) => {
          // Unknown/unsortable ids fall back to updatedAt rather than trusting the URL.
          const column = Object.hasOwn(ADMIN_SORTABLE, item.id)
            ? ADMIN_SORTABLE[item.id as keyof typeof ADMIN_SORTABLE]
            : post.updatedAt;
          return item.desc ? desc(column) : asc(column);
        });

        const rows = await ctx.db
          .select(POST_SUMMARY)
          .from(post)
          .leftJoin(user, eq(post.authorId, user.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(input.perPage)
          .offset((input.page - 1) * input.perPage);

        const [countRow] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(post)
          .where(where);
        const total = countRow?.count ?? 0;

        return { rows, pageCount: Math.max(1, Math.ceil(total / input.perPage)) };
      }),

    getById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(post).where(eq(post.id, input.id)).limit(1);
      return row ?? null;
    }),

    create: adminProcedure
      .input(z.object({ title: z.string().min(1).max(TITLE_MAX_LENGTH).optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const title = input?.title ?? 'Untitled post';
        const id = randomUUID();
        const slugged = slugify(title);
        const base = slugged === '' ? 'post' : slugged;
        const slug = `${base}-${id.slice(0, SLUG_SUFFIX_LENGTH)}`;
        const [row] = await ctx.db
          .insert(post)
          .values({
            id,
            authorId: ctx.user.id,
            title,
            slug,
          })
          .returning();
        return row;
      }),

    update: adminProcedure
      .input(z.object({ id: z.string(), data: postInput.partial() }))
      .mutation(async ({ ctx, input }) => {
        const { data } = input;
        const nextPublished = data.published;
        const [existing] = await ctx.db
          .select({ published: post.published })
          .from(post)
          .where(eq(post.id, input.id))
          .limit(1);
        if (existing === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        const [row] = await ctx.db
          .update(post)
          .set({
            ...data,
            ...(data.slug === undefined ? {} : { slug: slugify(data.slug) }),
            ...(data.content === undefined ? {} : { readingTime: readingTimeFor(data.content) }),
            ...(nextPublished === true && !existing.published ? { publishedAt: new Date() } : {}),
            ...(nextPublished === false ? { publishedAt: null } : {}),
          })
          .where(eq(post.id, input.id))
          .returning();
        return row;
      }),

    delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      await ctx.db.delete(post).where(eq(post.id, input.id));
      return { id: input.id };
    }),
  });
});

export type BlogAdminRouter = ReturnType<typeof blogAdminRouter>;
