import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@helix-hq/design-system', '@helix-hq/web-core'],
  /**
   * The dev server is reached through a Cloudflare tunnel rather than on localhost, and Next
   * blocks cross-origin requests to `/_next/*` dev resources by default. Without this the
   * client bundle never loads, so pages render server-side but never hydrate — which presents
   * as "the filter chips do nothing" rather than as a network error.
   */
  allowedDevOrigins: ['board-comparator.helix-kit.com'],
};

export default nextConfig;
