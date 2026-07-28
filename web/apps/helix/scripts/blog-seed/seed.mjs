// Seed / upsert the blog posts described by manifest.mjs into the `post` table.
// Content is GitHub-flavored MDX, compiled at request time by src/lib/blog-mdx.ts.
//
// Reusable + idempotent: keyed on `slug` via ON CONFLICT, so re-running refreshes
// content in place rather than duplicating. Reading time is derived from the HTML
// (tags stripped, ~200 wpm) to match the app's blog router.
//
// Usage (from web/apps/helix, with a provisioned .env pointing DATABASE_URL at the
// appliance):
//   node scripts/blog-seed/seed.mjs
//
// The pg driver is resolved from the workspace root node_modules.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..');
const workspaceRoot = join(appRoot, '..', '..');

// Resolve `pg` from @helix/backend, which depends on it (pnpm does not hoist it
// to the workspace root).
const require = createRequire(
  join(workspaceRoot, 'packages', 'core', 'helix-backend', 'noop.js'),
);
const { Pool } = require('pg');

const loadEnv = () => {
  const raw = readFileSync(join(appRoot, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
};

// Mirrors readingTimeFor in @helix/backend/src/blog/router.ts — keep in sync so a
// seeded post reports the same estimate as one saved from the admin editor.
const WORDS_PER_MINUTE = 200;
const readingTimeFor = (mdx) => {
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

const main = async () => {
  const env = loadEnv();
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL missing from web/apps/helix/.env');

  const { posts } = await import(pathToFileURL(join(here, 'manifest.mjs')).href);

  const pool = new Pool({ connectionString });

  // Author every seeded post as an admin. Prefer a sysadmin (the role that gates
  // the blog admin surface), but a freshly provisioned appliance seeds its first
  // user as plain 'admin', so fall back to that rather than refusing to seed.
  const authorRes = await pool.query(
    `SELECT id, name, role FROM "user"
      WHERE role IN ('sysadmin', 'admin')
      ORDER BY (role = 'sysadmin') DESC, created_at ASC
      LIMIT 1`,
  );
  if (authorRes.rowCount === 0) throw new Error('No sysadmin/admin user found to author posts');
  const authorId = authorRes.rows[0].id;
  console.log(`Authoring ${posts.length} posts as ${authorRes.rows[0].name} [${authorRes.rows[0].role}] (${authorId})`);

  // Space publish dates 5 days apart, newest first, ending a day before "now".
  const BASE_DATE = new Date('2026-07-14T09:00:00Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  let i = 0;
  for (const post of posts) {
    const content = readFileSync(join(here, 'posts', post.file), 'utf8').trim();
    const publishedAt = new Date(BASE_DATE.getTime() - i * 5 * DAY_MS);
    const readingTime = readingTimeFor(content);

    await pool.query(
      `INSERT INTO post
         (id, author_id, title, slug, content, description, cover_image,
          tags, keywords, reading_time, published, published_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$11,now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         description = EXCLUDED.description,
         cover_image = EXCLUDED.cover_image,
         tags = EXCLUDED.tags,
         keywords = EXCLUDED.keywords,
         reading_time = EXCLUDED.reading_time,
         published = true,
         published_at = COALESCE(post.published_at, EXCLUDED.published_at),
         updated_at = now()`,
      [
        randomUUID(),
        authorId,
        post.title,
        post.slug,
        content,
        post.description,
        '',
        post.tags,
        post.keywords,
        readingTime,
        publishedAt,
      ],
    );
    console.log(`  ✓ ${post.slug}  (${readingTime} min read)`);
    i += 1;
  }

  await pool.end();
  console.log('Done.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
