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
      'import/no-unassigned-import': [
        'error',
        { allow: ['server-only', '**/*.css', 'highlight.js/**'] },
      ],
    },
  },
  {
    // Marketing / docs / blog UI is dense with intentional literals; the rule is noise there.
    files: [
      'src/app/(marketing)/**',
      'src/app/docs/**',
      'src/components/marketing/**',
      'src/components/blog/**',
      'src/components/site-header.tsx',
      'src/components/site-footer.tsx',
      'src/components/icons.tsx',
      'src/lib/landing.ts',
      'src/lib/blog-content.ts',
      'src/app/sitemap.ts',
    ],
    rules: {
      'no-magic-numbers': 'off',
    },
  },
  {
    files: [
      'src/components/editor/**',
      'src/components/geistdocs/**',
      'src/hooks/**',
      'src/lib/source.ts',
    ],
    rules: {
      'no-duplicate-imports': 'off',
      'no-empty': 'off',
      'no-magic-numbers': 'off',
      'no-return-await': 'off',
      'no-useless-escape': 'off',
      'react/no-array-index-key': 'off',
      'react/no-danger': 'off',
      'security/detect-unsafe-regex': 'off',
      'sonarjs/different-types-comparison': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-nested-conditional': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      '.source/**',
      'out/**',
      'build/**',
      'public/**',
      'scripts/**',
      'next-env.d.ts',
      'postcss.config.mjs',
      'source.config.ts',
    ],
  },
];

export default eslintConfig;
