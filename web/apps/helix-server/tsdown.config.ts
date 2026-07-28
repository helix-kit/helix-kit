import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsdown';

type PackageJsonDependencies = Readonly<{
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}>;

const packagePattern = (name: string) => `${name}{,/**}`;

const createDependencyConfig = () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  ) as PackageJsonDependencies;
  const declaredDependencies = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);

  return {
    alwaysBundle: [...declaredDependencies].sort().map(packagePattern),
    onlyBundle: false as const,
  };
};

export default defineConfig({
  clean: true,
  deps: createDependencyConfig(),
  dts: false,
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  sourcemap: true,
  target: 'node20',
  treeshake: true,
});
