/**
 * Floating-promise gate config: ONE rule, type-aware, SERVER code only (backend/**, lib/**,
 * pages/api/**). Run by scripts/ci/check-floating-promises.js in its own CI job, NOT by `npm run
 * lint` (a type-aware pass over the server tree takes ~15-20 minutes). e9 ruling, 2026-11-12.
 *
 * The class it exists for: "a write that never executes". `void ownedDbTable(t).update(...)` builds a
 * LAZY PostgREST builder and throws it away; nothing awaits it, so no request is ever sent (four such
 * writes were live on main: campaign_outcomes, fail_fast_log, master_content_cache,
 * credit_efficiency_scores).
 *
 * BOTH options are load-bearing. Measured on the two known `void` sites (outcomeTrackingService:204,
 * failFastService:84):
 *   - ignoreVoid: false   - the default (true) treats `void x` as a deliberate discard and IGNORES
 *                           it, which is exactly this class. Default: 0 of 2 flagged.
 *   - checkThenables: true - a PostgREST builder is a THENABLE, not a Promise; without this the rule
 *                           does not consider it at all. ignoreVoid:false alone: 0 of 2 flagged.
 *   Both: 2 of 2 flagged.
 * Dropping either one makes the gate's self-check fail (the known-defect fixture is no longer flagged).
 *
 * The program is tsconfig.backend.json, which includes backend/**, lib/** and pages/api/**. The root
 * tsconfig does NOT include backend/**: under it, 535 backend files were "not found by the project
 * service" and silently UNANALYSED. The gate treats any parse failure as a failure, and the fixture
 * lives in a backend-only path, so removing tsconfig.backend.json fails the self-check too.
 *
 * UI code (non-api pages, components, hooks) is OFF for this rule for now (post-launch): most of its
 * hits are deliberate fire-and-forget React handlers.
 */
const path = require('path');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [path.join(__dirname, 'tsconfig.backend.json')],
        tsconfigRootDir: __dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false, checkThenables: true }],
    },
  },
];
