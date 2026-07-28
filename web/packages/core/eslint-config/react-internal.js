import js from '@eslint/js';
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import reactPreferFunctionComponent from 'eslint-plugin-react-prefer-function-component';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { config as baseConfig } from './base.js';

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * @type {import("eslint").Linter.Config} */
export const config = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  ...fixupConfigRules([
    pluginReact.configs.flat.recommended,
    pluginReact.configs.flat['jsx-runtime'],
  ]),
  {
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      'react-hooks': fixupPluginRules(pluginReactHooks),
      'react-prefer-function-component': fixupPluginRules(reactPreferFunctionComponent),
      'jsx-a11y': fixupPluginRules(jsxA11y),
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,

      // React scope no longer necessary with new JSX transform
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'warn',

      // React Hooks rules
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/refs': 'off',
      'react-hooks/rules-of-hooks': 'error',

      // JSX rules
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-curly-brace-presence': [
        'error',
        {
          children: 'never',
          props: 'never',
        },
      ],
      'react/jsx-fragments': ['error', 'syntax'],
      'react/jsx-no-bind': [
        'error',
        {
          allowArrowFunctions: true,
        },
      ],
      'react/jsx-no-leaked-render': 'error',
      'react/jsx-no-useless-fragment': [
        'error',
        {
          allowExpressions: true,
        },
      ],
      'react/jsx-pascal-case': 'error',
      'react/jsx-props-no-multi-spaces': 'error',
      'react/jsx-sort-props': [
        'error',
        {
          callbacksLast: true,
          reservedFirst: true,
        },
      ],

      // React component rules
      'react/no-array-index-key': 'error',
      'react/no-danger': 'warn',
      'react/no-unsafe': 'error',
      'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
      'react/self-closing-comp': 'error',
      'react/void-dom-elements-no-children': 'error',

      // JSX A11y rules
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/img-redundant-alt': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/tabindex-no-positive': 'error',
    },
  },
];
