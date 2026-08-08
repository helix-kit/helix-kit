import { defineConfig } from 'drizzle-kit';

import { env } from './src/lib/env';

export default defineConfig({
  out: './drizzle',
  schema: [
    '../../packages/helix-backend/src/db/schema.ts',
    '../../packages/helix-backend/src/db/auth-schema.ts',
    '../../packages/helix-backend/src/db/release-schema.ts',
    '../../packages/helix-backend/src/db/feature-schema.ts',
    '../../packages/helix-backend/src/db/agent-schema.ts',
    '../../packages/helix-backend/src/db/ai-usage-schema.ts',
    // Optional feature packages contribute their own tables.
    '../../packages/blog/src/server/schema.ts',
  ],
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
