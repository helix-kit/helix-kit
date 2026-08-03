import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { nextJsConfig } from '@workspace/eslint-config/next-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  ...nextJsConfig,
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
    // The schema is a long declarative table/enum listing; string repetition and numeric
    // literals (bus widths, pin counts) are the content, not a smell.
    files: ['src/server/schema/**'],
    rules: {
      'no-magic-numbers': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'public/**',
      // Maintenance scripts run outside the Next build and are not in its tsconfig.
      'scripts/**',
      'next-env.d.ts',
      'postcss.config.mjs',
    ],
  },
];

export default eslintConfig;
