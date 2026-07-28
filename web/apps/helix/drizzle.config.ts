import { defineConfig } from 'drizzle-kit';

import { env } from './src/lib/env';

export default defineConfig({
  out: './drizzle',
  schema: [
    '../../packages/core/helix-backend/src/db/schema.ts',
    '../../packages/core/helix-backend/src/db/auth-schema.ts',
    '../../packages/core/helix-backend/src/db/release-schema.ts',
    '../../packages/core/helix-backend/src/db/blog-schema.ts',
    '../../packages/core/helix-backend/src/db/feature-schema.ts',
  ],
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
