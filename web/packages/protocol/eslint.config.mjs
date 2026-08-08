import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '@workspace/eslint-config/base';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  ...config,
  {
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname } },
  },
  // `**/dist/**`, not `dist/**`: this package builds into per-transport subdirectories
  // (transport-websocket/dist, transport-serial/dist), which a top-level-only glob misses.
  // They are gitignored, so a fresh checkout is clean and only a post-build lint sees them.
  { ignores: ['**/dist/**', 'eslint.config.mjs', 'tsdown.config.ts'] },
];
