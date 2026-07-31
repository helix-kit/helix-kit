import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '@workspace/eslint-config/base';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  ...config,
  {
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname } },
  },
  { ignores: ['dist/**', 'eslint.config.mjs', 'tsdown.config.ts'] },
];
