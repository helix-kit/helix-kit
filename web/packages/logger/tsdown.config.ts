import { defineConfig } from 'tsdown';

import { createEntriesFromPackageExports } from '../../scripts/package-exports.ts';

export default defineConfig({
  clean: true,
  // Bundled declarations, not `tsc` output: tsc emits extensionless
  // relative imports in .d.ts, which fail to resolve under node16 /
  // nodenext and silently break types for Node ESM consumers.
  dts: true,
  entry: createEntriesFromPackageExports(import.meta.url),
  format: ['esm'],
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  sourcemap: true,
  target: 'node20',
  treeshake: true,
});
