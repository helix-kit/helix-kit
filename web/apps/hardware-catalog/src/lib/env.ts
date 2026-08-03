import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Object storage, shared with the rest of Helix (see src/server/storage.ts).
    STORAGE_PROVIDER: z.enum(['S3', 'MINIO', 'AZURE', 'FS']).default('FS'),
    STORAGE_PUBLIC_ASSET_URL: z.string().default(''),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.url().default('http://localhost:3100'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_PUBLIC_ASSET_URL: process.env.STORAGE_PUBLIC_ASSET_URL,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
  emptyStringAsUndefined: true,
});
