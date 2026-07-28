import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { config } from '@workspace/eslint-config/react-internal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
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
    ignores: ['dist/', 'postcss.config.mjs', 'eslint.config.mjs', 'tsdown.config.ts'],
  },
];

export default eslintConfig;
