import { env } from '@/lib/env';

// Build-time client config; currently only gates the tRPC logger link.
export const cloudAppBuildConfig = {
  enableTrpcLogger: env.NODE_ENV === 'development',
} as const;
