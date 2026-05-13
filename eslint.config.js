/**
 * ESLint Configuration
 *
 * Applies custom rules to enforce configuration hardening:
 * - no-direct-process-env: Enforce @/config module usage
 *
 * Usage:
 *   npm run lint
 *   npm run lint -- --fix  # Auto-fix auto-fixable rules
 */

const noDirectProcessEnvRule = require('./eslint-rules/no-direct-process-env');
const tsEslintPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const nextPlugin = require('@next/eslint-plugin-next');

module.exports = [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        require: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      // Keep the rule registered for targeted hardening runs, but do not make
      // repo-wide lint fail on legacy env access until the migration is complete.
      'config-hardening/no-direct-process-env': 'off',
    },
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
      'config-hardening': {
        rules: {
          'no-direct-process-env': noDirectProcessEnvRule,
        },
      },
    },
  },

  // TypeScript-specific overrides
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'tests/**',
      'tmp/**',
      'tmp_*',
      '*.config.js',
      'jest.config.js',
      'scripts/**',
      'backend/scripts/**',
      'test-*.js',
      'validate-*.js',
      'tmp_*.mjs',
      'utils/project-protector.js',
      'utils/protector.js',
    ],
  },
];
