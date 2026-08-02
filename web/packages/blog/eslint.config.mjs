import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '@workspace/eslint-config/react-internal';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // `server-only` and CSS side-effect imports are intentional.
      'import/no-unassigned-import': ['error', { allow: ['server-only', '**/*.css'] }],
    },
  },
  {
    // Presentational blog UI is dense with intentional literals; the rule is noise there.
    files: ['src/ui/**'],
    rules: {
      'no-magic-numbers': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  {
    // The MDXEditor wrapper is configuration-shaped, mirroring the upstream plugin list.
    files: ['src/ui/editor/**'],
    rules: {
      'no-duplicate-imports': 'off',
      'sonarjs/no-duplicate-string': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
  { ignores: ['dist/**', 'eslint.config.mjs', 'tsdown.config.ts'] },
];
