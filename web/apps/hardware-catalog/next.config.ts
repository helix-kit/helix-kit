import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@helix/design-system', '@helix/web-core'],
};

export default nextConfig;
