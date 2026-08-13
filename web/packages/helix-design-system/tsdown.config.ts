import { readFileSync } from 'fs';
import { defineConfig } from 'tsdown';

import { createEntriesFromPackageExports } from '../../scripts/package-exports.ts';

type PackageJsonDependencies = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const packagePattern = (name: string) => `${name}{,/**}`;

const createDependencyConfig = (neverBundle: readonly string[] = []) => {
  const packageJson = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  ) as PackageJsonDependencies;
  const declaredDependencies = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);

  for (const dependency of neverBundle) {
    declaredDependencies.delete(dependency);
  }

  return {
    alwaysBundle: [...declaredDependencies].sort().map(packagePattern),
    neverBundle: neverBundle.map(packagePattern),
    onlyBundle: false as const,
  };
};

const useClientBanner = "'use client';";

export default defineConfig({
  entry: createEntriesFromPackageExports(import.meta.url),
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: createDependencyConfig([
    '@dnd-kit/core',
    '@dnd-kit/modifiers',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
    'react',
    'react-dom',
    'react-hook-form',
    '@tanstack/react-table',
    'class-variance-authority',
    'clsx',
    'cmdk',
    'date-fns',
    'embla-carousel-react',
    'input-otp',
    'lucide-react',
    'maplibre-gl',
    'motion',
    'nuqs',
    'nuqs/server',
    'radix-ui',
    '@radix-ui/react-label',
    '@radix-ui/react-slot',
    'react-day-picker',
    'recharts',
    'sonner',
    'tailwind-merge',
    'vaul',
    'zod',
  ]),
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist',
  // Without this rolldown emits its CommonJS-interop runtime with a
  // `createRequire` from `node:module`, and pulls that chunk into client
  // components (`components/resizable`). A browser consumer of the built package
  // then fails to bundle. Invisible in this repo, where the workspace `exports`
  // resolve to source and nothing is built.
  platform: 'browser',
  treeshake: true,
  clean: true,
  target: false as const,
  outputOptions: {
    banner: useClientBanner,
  },
});
