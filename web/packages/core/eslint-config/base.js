import js from '@eslint/js';
import { fixupPluginRules } from '@eslint/compat';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import preferArrowFunctions from 'eslint-plugin-prefer-arrow-functions';
import promise from 'eslint-plugin-promise';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
      'prefer-arrow-functions': fixupPluginRules(preferArrowFunctions),
      sonarjs: fixupPluginRules(sonarjs),
      security: fixupPluginRules(security),
      promise: fixupPluginRules(promise),
      import: fixupPluginRules(importPlugin),
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'warn',

      // TypeScript rules
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-meaningless-void-operator': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: false,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'error',
      '@typescript-eslint/prefer-return-this-type': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'warn',
        {
          allowNullableObject: false,
          allowNumber: false,
          allowString: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Core JavaScript/Style rules
      'array-bracket-spacing': ['error', 'never'],
      'arrow-parens': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      complexity: [
        'off',
        {
          max: 10,
        },
      ],
      curly: ['error', 'all'],
      eqeqeq: [
        'error',
        'always',
        {
          null: 'ignore',
        },
      ],
      'func-style': ['error', 'expression'],
      'key-spacing': [
        'error',
        {
          afterColon: true,
          beforeColon: false,
        },
      ],
      'keyword-spacing': [
        'error',
        {
          after: true,
          before: true,
        },
      ],
      'no-console': 'error',
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-else-return': [
        'error',
        {
          allowElseIf: false,
        },
      ],
      'no-lonely-if': 'error',
      'no-magic-numbers': [
        'warn',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
        },
      ],
      'no-multiple-empty-lines': [
        'error',
        {
          max: 1,
          maxEOF: 1,
        },
      ],
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'no-return-await': 'error',
      'no-trailing-spaces': 'error',
      'no-unneeded-ternary': 'error',
      'no-unused-vars': 'off',
      'no-var': 'error',
      'object-curly-spacing': ['error', 'always'],
      'prefer-arrow-callback': 'error',
      'prefer-arrow-functions/prefer-arrow-functions': [
        'error',
        {
          classPropertiesAllowed: false,
          disallowPrototype: false,
          returnStyle: 'unchanged',
          singleReturnOnly: false,
        },
      ],
      'prefer-const': 'error',
      'prefer-destructuring': [
        'error',
        {
          array: false,
          object: true,
        },
      ],
      'prefer-object-spread': 'error',
      'prefer-template': 'error',
      semi: ['error', 'always'],
      'space-before-blocks': ['error', 'always'],
      'spaced-comment': [
        'error',
        'always',
        {
          markers: ['/'],
        },
      ],
      yoda: 'error',

      // Promise rules
      'promise/always-return': 'error',
      'promise/avoid-new': 'off',
      'promise/catch-or-return': 'error',
      'promise/no-callback-in-promise': 'error',
      'promise/no-nesting': 'error',
      'promise/no-new-statics': 'error',
      'promise/no-promise-in-callback': 'error',
      'promise/no-return-in-finally': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/valid-params': 'error',

      // Security rules
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'error',

      // SonarJS rules
      'sonarjs/cognitive-complexity': ['off', 15],
      'sonarjs/different-types-comparison': 'warn',
      'sonarjs/function-return-type': 'off',
      'sonarjs/max-switch-cases': ['warn', 10],
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/no-commented-code': 'warn',
      'sonarjs/no-duplicate-string': [
        'warn',
        {
          threshold: 3,
        },
      ],
      'sonarjs/no-duplicated-branches': 'warn',
      'sonarjs/no-identical-conditions': 'warn',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-inverted-boolean-check': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/no-redundant-boolean': 'warn',
      'sonarjs/no-small-switch': 'warn',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/prefer-immediate-return': 'warn',
      'sonarjs/prefer-object-literal': 'warn',
      'sonarjs/prefer-read-only-props': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',
      'sonarjs/pseudo-random': 'warn',
      'sonarjs/table-header': 'warn',

      // Import rules
      'import/extensions': [
        'error',
        'never',
        {
          css: 'always',
          json: 'always',
          scss: 'always',
        },
      ],
      'import/first': 'error',
      'import/max-dependencies': [
        'error',
        {
          max: 20,
        },
      ],
      'import/newline-after-import': 'error',
      'import/no-absolute-path': 'error',
      'import/no-anonymous-default-export': 'error',
      'import/no-cycle': 'off',
      'import/no-deprecated': 'warn',
      'import/no-duplicates': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-import-module-exports': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-named-as-default': 'error',
      'import/no-named-default': 'error',
      'import/no-relative-packages': 'error',
      'import/no-self-import': 'error',
      'import/no-unassigned-import': [
        'error',
        {
          allow: ['**/*.css', '**/*.scss'],
        },
      ],
      'import/no-useless-path-segments': [
        'error',
        {
          noUselessIndex: true,
        },
      ],
      'import/no-webpack-loader-syntax': 'error',
      'import/order': [
        'error',
        {
          alphabetize: {
            caseInsensitive: true,
            order: 'asc',
          },
          groups: ['builtin', 'external', 'internal', ['sibling', 'index'], 'type', 'object'],
          'newlines-between': 'always',
          pathGroups: [
            {
              group: 'external',
              pattern: 'react',
              position: 'before',
            },
            {
              group: 'external',
              pattern: 'next/**',
              position: 'before',
            },
            {
              group: 'internal',
              pattern: '@/**',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: ['react', 'next'],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', '.next/**', 'out/**', 'build/**'],
  },
];
