// Static-export Next.js config for the page-gating experiment.
// Approach B (module stubbing): HELIX_GATED_OUT lists disabled feature ids; webpack's
// NormalModuleReplacement swaps each disabled feature's ./impl for an empty stub so its heavy deps tree-shake out.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatedOut = (process.env.HELIX_GATED_OUT ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Deterministic build id so two identical gate configs produce byte-identical output.
  generateBuildId: () => 'helix-gating-experiment',
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { webpack }) => {
    if (gatedOut.length > 0) {
      const stub = path.resolve(__dirname, 'src/features/_stub.tsx');
      const pattern = new RegExp(`/features/(${gatedOut.join('|')})/impl(\\.tsx)?$`);
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(pattern, stub));
    }
    return config;
  },
};

export default nextConfig;
