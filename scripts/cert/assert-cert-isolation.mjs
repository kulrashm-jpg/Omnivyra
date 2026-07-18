#!/usr/bin/env node
/**
 * WRITER-CERT-002 Phase 5 — Production Isolation Guard.
 *
 * Hard-refuses to let the certification environment touch PRODUCTION. Import it
 * (assertCertIsolation) at the top of any cert runner, OR run it as a CLI
 * pre-step (`node scripts/cert/assert-cert-isolation.mjs`). It scans every
 * connection-shaped env var (Supabase URL, DB URLs, Redis, storage, webhooks)
 * for the production project ref / prod hosts and EXITS NON-ZERO if any is
 * found — so a stray `.env.local` (which IS production) can never be used to
 * run certification.
 *
 * Extends the existing beta guard pattern (scripts/beta/beta-client.mjs, which
 * blocks the PROD_REF). One source of truth for "what is production" below.
 */

// The production Supabase project ref (from NEXT_PUBLIC_SUPABASE_URL) and prod
// pooler host. Anything containing these is PRODUCTION and is forbidden in cert.
const PROD_MARKERS = [
  'klkiseupptzbecbxwrky',                 // prod Supabase project ref
  'aws-1-ap-southeast-1.pooler.supabase', // prod pooler host
];

// Env vars that carry a connection target and must be cert-safe.
const CONNECTION_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_POOLER_DB_URL', 'DATABASE_URL', 'DIRECT_URL', 'MIGRATION_DATABASE_URL',
  'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'STORAGE_URL', 'SUPABASE_STORAGE_URL',
  'WEBHOOK_URL', 'PUBLISH_WEBHOOK_URL',
];

/** @returns {{ok:boolean, violations:Array<{var:string,marker:string}>}} */
export function scanForProduction(env = process.env) {
  const violations = [];
  for (const key of CONNECTION_VARS) {
    const val = env[key];
    if (!val || typeof val !== 'string') continue;
    for (const marker of PROD_MARKERS) {
      if (val.includes(marker)) violations.push({ var: key, marker });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Assert the current environment is cert-safe. Throws (or exits) on any prod
 * marker. Set CERT_ALLOW_PROD_SCHEMA_DUMP=1 ONLY for the read-only schema-dump
 * step (pg_dump --schema-only), which reads prod but never writes and never
 * runs the app against it.
 */
export function assertCertIsolation(env = process.env, { exit = false } = {}) {
  if (env.CERT_ALLOW_PROD_SCHEMA_DUMP === '1') {
    // Read-only schema dump is the ONE sanctioned prod touch. It must NEVER be
    // set while the app/workers are running against the connection.
    console.warn('[cert-isolation] CERT_ALLOW_PROD_SCHEMA_DUMP=1 — read-only schema dump ONLY. The app/workers must NOT run under this flag.');
    return { ok: true, violations: [] };
  }
  const result = scanForProduction(env);
  if (!result.ok) {
    const lines = result.violations.map((v) => `  ✗ ${v.var} contains production marker "${v.marker}"`);
    const msg =
      'REFUSING TO RUN CERTIFICATION AGAINST PRODUCTION.\n' +
      lines.join('\n') +
      '\n\nCertification must use an isolated environment (.env.cert → local Postgres/Redis).\n' +
      'A production .env.local must never be used for certification.';
    if (exit) { console.error('[cert-isolation] ' + msg); process.exit(1); }
    throw new Error(msg);
  }
  console.log('[cert-isolation] ✓ no production markers found — environment is cert-safe.');
  return result;
}

// CLI entrypoint — Windows-robust (resolve both paths and compare).
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
const isCli = (() => {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || ''); }
  catch { return false; }
})();
if (isCli) {
  assertCertIsolation(process.env, { exit: true });
}
