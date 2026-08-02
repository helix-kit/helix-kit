import { createMDX } from 'fumadocs-mdx/next';

import type { NextConfig } from 'next';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    unoptimized: process.env.HELIX_IMAGES_UNOPTIMIZED === 'true',
    formats: ['image/avif', 'image/webp'],
    // Public assets (blog images) are served from the CloudFront-fronted CDN host.
    remotePatterns: [{ protocol: 'https', hostname: 'assets.helix-kit.com' }],
  },
  transpilePackages: [
    '@helix/blog',
    '@helix/design-system',
    '@helix/device-apps',
    '@helix/protocol',
    '@helix/web-core',
  ],
};

export default withMDX(nextConfig);
