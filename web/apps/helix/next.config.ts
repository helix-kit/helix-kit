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
    '@helix/design-system',
    '@helix/device-apps',
    '@helix/esp32-flasher',
    '@helix/protocol-core',
    '@helix/protocol-service',
    '@helix/transport-mqtt',
    '@helix/transport-ble',
    '@helix/transport-serial',
  ],
};

export default withMDX(nextConfig);
