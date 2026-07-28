// Vite config for the floor-minimization lab.
//
// Same feature components as the Next lab (reused verbatim via the @features
// alias → ../app/src/features — no duplication), but built as a static SPA and
// with a swappable React runtime:
//
//   HELIX_RUNTIME=react   (default)  → @vitejs/plugin-react, real react/react-dom
//   HELIX_RUNTIME=preact             → @preact/preset-vite, react→preact/compat
//
// The device serving model is unchanged: cloud-comm serves index.html as an SPA
// fallback, which is exactly what a client-routed static build needs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));
const runtime = process.env.HELIX_RUNTIME ?? 'react';

export default defineConfig(async () => {
  const alias = {
    '@features': path.resolve(dir, '../app/src/features'),
    '@': path.resolve(dir, 'src'),
  };

  let plugins;
  let dedupe = [];
  if (runtime === 'preact') {
    const preact = (await import('@preact/preset-vite')).default;
    // The preset installs react→preact/compat aliases itself. dedupe forces the
    // parent-source feature files (which live outside this lab's node_modules) to
    // resolve preact/* from here rather than failing to find it upward.
    plugins = [preact()];
    dedupe = ['preact', 'react', 'react-dom'];
  } else {
    const react = (await import('@vitejs/plugin-react')).default;
    plugins = [react()];
    // Force a single React instance even for the aliased parent-source features.
    dedupe = ['react', 'react-dom', 'react/jsx-runtime'];
  }

  return {
    root: dir,
    plugins,
    resolve: {
      alias,
      dedupe: [...dedupe, '@xyflow/react', 'recharts', 'react-grid-layout'],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // No hashed-filename noise across builds; easier diffing/measuring.
      chunkSizeWarningLimit: 2000,
    },
  };
});
