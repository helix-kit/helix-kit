// Vite config for the floor-minimization lab: same feature components as the Next lab (via the @features alias),
// built as a static SPA with a swappable React runtime (HELIX_RUNTIME=react|preact).

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
    // dedupe forces parent-source feature files (outside this lab's node_modules) to resolve preact/* from here.
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
