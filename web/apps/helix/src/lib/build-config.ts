import { env } from '@/lib/env';

// Build-time client config. Currently only gates the tRPC logger link; extend
// as the core app grows (matches a prior production app's cloudAppBuildConfig shape).
export const cloudAppBuildConfig = {
  enableTrpcLogger: env.NODE_ENV === 'development',
} as const;
