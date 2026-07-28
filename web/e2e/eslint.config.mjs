import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '@workspace/eslint-config/react-internal';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeGlobals = {
  process: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
};

export default [
  ...config,
  {
    languageOptions: {
      globals: nodeGlobals,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: { 'turbo/no-undeclared-env-vars': 'off' },
  },
  {
    ignores: [
      'browser-profile/**',
      'test-results/**',
      'playwright-report/**',
      'dist/**',
      'eslint.config.mjs',
      'vite.config.ts',
    ],
  },
];
