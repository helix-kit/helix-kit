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
  },
  {
    // Literal inputs and expected values are the substance of an assertion, and
    // the limits under test are only meaningful as concrete numbers.
    files: ['**/*.test.ts'],
    rules: { 'no-magic-numbers': 'off' },
  },
  { ignores: ['dist/**', 'eslint.config.mjs', 'tsdown.config.ts'] },
];
