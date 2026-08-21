/**
 * Global Jest teardown — stops all background timers started by module-level
 * side effects (usageProtection, instrumentation, queueInstrumentation, etc.)
 * so Jest doesn't log "Cannot log after tests are done" warnings.
 *
 * Registered as setupFilesAfterEnv in jest.config.js.
 */

/**
 * SAFETY GUARD — database-touching suites must never run against production.
 *
 * jest.config.js loads jest.env.js (which reads `.env.test`) and then
 * backend/tests/setupEnv.ts (which reads `.env.local`). When `.env.test` is
 * absent — as it is by default — the first load is a no-op and the suite
 * inherits `.env.local`, which in this repo holds PRODUCTION Supabase
 * credentials. setupEnv.ts additionally sets ALLOW_EXECUTION_ENGINE_WRITE=1.
 *
 * The result is that `npx jest backend/tests` silently points the integration
 * suites at the live database with writes permitted, and the failures it
 * produces ("Company profile not found") are simply production lacking the
 * fixtures the tests expect — not defects.
 *
 * This guard fails those suites loudly and immediately instead. It is scoped by
 * test path so the mocked unit suites, which never open a connection, are
 * unaffected.
 */
const dbSuitePattern = /[\\/]tests[\\/](integration|manual|realschema)[\\/]/;
const currentTestPath = String(
  (globalThis as { expect?: { getState?: () => { testPath?: string } } }).expect?.getState?.().testPath ?? '',
);
if (dbSuitePattern.test(currentTestPath)) {
  const url = String(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url);
  if (url && !isLocal) {
    throw new Error(
      'REFUSING TO RUN: this suite touches the database, but SUPABASE_URL does not point at a local instance.\n' +
        'Resolved host: ' + (url.split('/')[2] ?? '(unparseable)') + '\n' +
        'Cause: `.env.test` is absent, so backend/tests/setupEnv.ts falls back to `.env.local` (production).\n' +
        'Fix:   create `.env.test` with a local Supabase URL and keys (e.g. http://127.0.0.1:54321),\n' +
        '       then `supabase start`. jest.env.js loads `.env.test` first, and dotenv does not\n' +
        '       override already-set variables, so it takes precedence over `.env.local`.',
    );
  }
}

afterAll(async () => {
  // Stop Redis usage-protection polling timer
  try {
    const { stopUsageProtection } = await import('../../lib/redis/usageProtection');
    stopUsageProtection();
  } catch { /* not imported in this test suite */ }

  // Stop Redis instrumentation flush + persist timers
  try {
    const { stopInstrumentation } = await import('../../lib/redis/instrumentation');
    stopInstrumentation();
  } catch { /* not imported in this test suite */ }
});
