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

      // ── Auth architecture guardrails (Phase 3) ─────────────────────────
      // Prevent regressions of the standardized auth surface. See
      // docs/auth-architecture.md for canonical patterns.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/utils/supabaseClient',
              message:
                'utils/supabaseClient was deleted. Use @/lib/supabaseBrowser (client) or @/backend/db/supabaseClient (server).',
            },
            {
              name: 'utils/supabaseClient',
              message:
                'utils/supabaseClient was deleted. Use lib/supabaseBrowser (client) or backend/db/supabaseClient (server).',
            },
          ],
          patterns: [
            {
              group: ['**/utils/supabaseClient', '**/utils/supabaseClient.js'],
              message:
                'utils/supabaseClient was deleted. Use lib/supabaseBrowser (client) or backend/db/supabaseClient (server).',
            },
            {
              group: ['**/lib/auth/serverValidation'],
              importNames: ['verifySupabaseAuthHeader'],
              message:
                'verifySupabaseAuthHeader was removed. Use resolveAuthenticatedUser (or extractAccessToken + validateAuthToken when the public.users row may not exist) from backend/services/authResolver.',
            },
          ],
        },
      ],

      // Bans constructing the legacy Bearer-only auth header inline. Any
      // authenticated client-side request must go through lib/apiFetch.ts.
      // Cron / webhook secret-bearer comparisons are carved out below
      // (pages/api/cron/**, pages/api/wordpress-plugin/**).
      //
      // Also bans direct `createClient`/`createBrowserClient`/`createServerClient`
      // calls from @supabase/supabase-js / @supabase/ssr — these must live only
      // in the canonical files (lib/supabaseBrowser.ts, backend/db/supabaseClient.ts)
      // plus a small server-only allowlist (audit log, anomaly engine,
      // feature-completion, check-user, tests). Each rogue createClient call
      // instantiates its own GoTrueClient and competes with the canonical
      // singleton for the localStorage auth-token key.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TemplateLiteral:has(TemplateElement[value.raw=/^Bearer /]) > TemplateElement",
          message:
            'Inline `Authorization: Bearer ${token}` construction is forbidden in client code. Use apiFetch() from lib/apiFetch.ts; it attaches the Bearer header via the canonical browser Supabase client.',
        },
        {
          selector:
            "CallExpression[callee.name='createClient'][arguments.length>=2]",
          message:
            'Direct createClient() from @supabase/supabase-js is forbidden outside the canonical files (lib/supabaseBrowser.ts, backend/db/supabaseClient.ts) and the server-only allowlist (lib/auth/auditLog.ts, lib/anomaly/*, backend/services/featureCompletion*, pages/api/auth/check-user.ts, tests/auth/authTestHarness.ts). See docs/auth-architecture.md.',
        },
        {
          selector:
            "CallExpression[callee.name='createBrowserClient']",
          message:
            'createBrowserClient may only be called inside lib/supabaseBrowser.ts. Import the singleton via getSupabaseBrowser() instead.',
        },
        {
          selector:
            "CallExpression[callee.name='createServerClient']",
          message:
            'createServerClient from @supabase/ssr is restricted. Use the canonical server client backend/db/supabaseClient.ts (service role) or, for SSR cookie-bound clients, import from the per-route allowlisted file.',
        },
      ],
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

  // ── Auth architecture carve-outs ─────────────────────────────────────────
  // The two canonical Supabase client files are the only places where a
  // raw createClient/createBrowserClient call may live. The cron / webhook
  // files exchange opaque Bearer secrets that aren't Supabase JWTs, and
  // platform OAuth callbacks pass third-party Bearer tokens to upstream
  // APIs — those must continue to construct Bearer headers inline.
  {
    files: [
      'pages/api/cron/**',
      'pages/api/wordpress-plugin/**',
      'pages/api/auth/*/callback.ts',
      'pages/api/community-ai/connectors/**',
      'backend/services/**',
      'backend/adapters/**',
      'lib/apiFetch.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── createClient / createBrowserClient / createServerClient allowlist ────
  // The files below are the ONLY places where raw Supabase client construction
  // is permitted. The two canonical files are at the top; the rest are
  // pre-existing single-purpose server clients (audit log, anomaly engine,
  // feature-completion sync, pre-auth user probe, SSR-cookie clients) that
  // do not race with the browser singleton. Adding to this list requires a
  // justification in the file header.
  {
    files: [
      'lib/supabaseBrowser.ts',
      'backend/db/supabaseClient.ts',
      'lib/auth/auditLog.ts',
      'lib/anomaly/**',
      'backend/services/featureCompletionService.ts',
      'backend/services/featureCompletionSyncService.ts',
      'pages/api/auth/check-user.ts',
      'pages/api/readiness-score.ts',
      'pages/api/notifications.ts',
      'pages/api/feature-completion.ts',
      'pages/api/community-ai/connectors/utils.ts',
      'tests/auth/authTestHarness.ts',
      'db-utils/supabase-util-client.js',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: [
      'lib/supabaseBrowser.ts',
      'backend/db/supabaseClient.ts',
      'tests/auth/authTestHarness.ts',
      'pages/api/readiness-score.ts',
      'pages/api/notifications.ts',
      'pages/api/feature-completion.ts',
      'pages/api/community-ai/connectors/utils.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
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
