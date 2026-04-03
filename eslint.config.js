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

module.exports = [
  {
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
      'config-hardening/no-direct-process-env': 'error',
    },
    plugins: {
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
      '*.config.js',
      'jest.config.js',
      'script/**',
    ],
  },
];
