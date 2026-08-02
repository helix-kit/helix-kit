import { user } from '@helix/backend/db/auth-schema';
import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const post = pgTable(
  'post',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique('post_slug_unique'),
    content: text('content').notNull().default(''),
    description: text('description').notNull().default(''),
    coverImage: text('cover_image').notNull().default(''),
    tags: text('tags').array().notNull().default([]),
    keywords: text('keywords').array().notNull().default([]),
    readingTime: integer('reading_time'),
    published: boolean('published').notNull().default(false),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('post_author_idx').on(table.authorId),
    index('post_published_idx').on(table.published),
  ],
);

export type Post = typeof post.$inferSelect;
export type NewPost = typeof post.$inferInsert;
