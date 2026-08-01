import type { KnipConfig } from 'knip';

const nextAppRouterEntries = [
  'app/**/{page,layout,template,loading,error,global-error,not-found,forbidden,unauthorized,default,route}.{ts,tsx}',
];

const nextSrcAppRouterEntries = nextAppRouterEntries.map((entry) => `src/${entry}`);

const config: KnipConfig = {
  ignoreDependencies: ['eslint-*'],
  drizzle: false,
  workspaces: {
    '.': {
      project: ['*.{js,mjs,cjs,ts,mts,cts}', 'scripts/**/*.ts'],
    },
    'apps/helix': {
      entry: [...nextSrcAppRouterEntries, 'drizzle.config.ts'],
      project: ['src/**/*.{ts,tsx}'],
      // src/generated/ is produced by the contract codegen.
      ignore: ['src/generated/**'],
      // Reached only from CSS (`@plugin` in globals.css, the postcss config) or by
      // the toolchain — knip parses TS, so it cannot see any of these.
      ignoreDependencies: [
        '@tailwindcss/postcss',
        '@tailwindcss/typography',
        'postcss',
        'tailwindcss',
        '@typescript/native-preview',
      ],
    },
    'apps/helix-server': {
      project: ['src/**/*.ts'],
    },
    e2e: {
      entry: ['tests/**/*.ts'],
      project: ['harness/**/*.{ts,tsx}', 'serial/**/*.{ts,tsx}', 'tests/**/*.ts', '*.ts'],
    },
    'packages/device-apps': {
      project: ['src/**/*.{ts,tsx}'],
      // Reusable device-app contracts + SDK: exports are the package's public API
      // (consumed by the web app and external SDK consumers), and src/**/generated/**
      // is contract-codegen output — neither is dead code even when unused in-repo.
      ignore: ['src/**/*.{ts,tsx}'],
    },
    'packages/helix-backend': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/helix-design-system': {
      project: ['src/**/*.{ts,tsx}'],
      ignore: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: [
        'postcss-load-config',
        'react-hook-form',
        '@base-ui/react',
        'embla-carousel-react',
        'input-otp',
        'motion',
        'react-resizable-panels',
        'recharts',
      ],
    },
    'packages/eslint-config': {
      entry: ['*.js'],
      project: ['**/*.js'],
    },
    'packages/typescript-config': {
      entry: ['*.json'],
      ignoreDependencies: ['next'],
    },
    'packages/protocol': {
      project: ['src/**/*.{ts,tsx}'],
    },
  },
};

export default config;
