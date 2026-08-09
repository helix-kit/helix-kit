import { createMDX } from 'fumadocs-mdx/next';

import type { NextConfig } from 'next';

const withMDX = createMDX();

/**
 * Hosts allowed to reach dev-only resources, as origins or bare hostnames.
 *
 * Reaching the dev server through a tunnel — a phone on the LAN, a Cloudflare
 * hostname, a shared preview — is otherwise refused for its HMR and asset
 * requests, which breaks the page without breaking the request that served it.
 */
const devOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')
  .map((entry) => {
    try {
      return new URL(entry).hostname;
    } catch {
      return entry;
    }
  });

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(devOrigins.length === 0 ? {} : { allowedDevOrigins: devOrigins }),
  images: {
    unoptimized: process.env.HELIX_IMAGES_UNOPTIMIZED === 'true',
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: 'assets.helix-kit.com' }],
  },
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
