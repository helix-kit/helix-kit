import { defineConfig } from 'tsdown';

import { createEntriesFromPackageExports } from '../../../scripts/package-exports';

export default defineConfig({
  clean: true,
  dts: false,
  entry: createEntriesFromPackageExports(import.meta.url),
  format: ['esm'],
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  sourcemap: true,
  target: false as const,
  treeshake: true,
});
