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
  // Matches the upstream react-pdf example's wiring: both are server-only and
  // must not be bundled with the RSC export conditions.
  serverExternalPackages: ['@react-pdf/renderer', '@json-render/react-pdf'],
  transpilePackages: [
    '@helix/blog',
    '@helix/design-system',
    '@helix/device-apps',
    '@helix/pdf-report',
    '@helix/protocol',
    '@helix/web-core',
  ],
};

export default withMDX(nextConfig);
