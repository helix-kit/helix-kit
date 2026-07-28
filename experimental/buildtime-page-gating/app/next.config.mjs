// Build-time page-gating experiment — Next.js config.
//
// Always a static export (`output: 'export'` → `out/`), matching the device console's
// static export edge-UI bundle. Two gating strategies share this app:
//
//   Approach A (filesystem): the `gate.mjs` script materializes only enabled routes
//     under src/app/(gen)/ before build. next.config needs to do *nothing* — the
//     bundler simply never sees disabled routes. Bundler-agnostic.
//
//   Approach B (module stubbing): all routes stay on disk under src/app/(all)/. The
//     HELIX_GATED_OUT env lists disabled feature ids; webpack's NormalModuleReplacement
//     swaps each disabled feature's ./impl module for an empty stub, so its heavy deps
//     tree-shake out. Bundler-coupled (webpack only).

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
