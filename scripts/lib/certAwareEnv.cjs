'use strict';
/**
 * WRITER-CERT-004 Phase 3/4 — the ONE cert-aware env loader used by every
 * runtime entry point. Loading priority: ENV_FILE > .env.cert > .env.local.
 *
 * Backward compatible: .env.cert does not exist in normal dev/prod setups
 * (gitignored, created only by a cert operator), so production/dev behavior is
 * unchanged — .env.local is still loaded. It is only selected when ENV_FILE is
 * set or a .env.cert file is deliberately present.
 *
 * In-process isolation guard (Phase 4): after the env is loaded, when
 * CERT_ENV=1, refuse to continue if any connection var points at production.
 * This runs in the SAME process as the loaded env (unlike the pre-process
 * scripts/cert/assert-cert-isolation.mjs, which is now a secondary safeguard).
 */
const fs = require('fs');
const path = require('path');

/** Production fingerprints (kept in sync with scripts/cert/assert-cert-isolation.mjs). */
const PROD_MARKERS = [
  'klkiseupptzbecbxwrky',                  // prod Supabase project ref
  'aws-1-ap-southeast-1.pooler.supabase',  // prod pooler host
  'noble-dane-77325.upstash.io',           // prod Upstash Redis host
];
const CONNECTION_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_POOLER_DB_URL', 'SUPABASE_POOLER_URL', 'DATABASE_URL', 'DIRECT_URL', 'MIGRATION_DATABASE_URL',
  'REDIS_URL', 'CREATOR_RENDER_REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'SUPABASE_ACCESS_TOKEN',
];

/**
 * Closure-014 (F): certification is an ALLOW-list, not only a deny-list. Under
 * CERT_ENV=1 every one of these connection targets, when set, must resolve to a
 * loopback host — so a new production host (not yet in PROD_MARKERS) or a
 * shared non-production Redis can never be reached from certification.
 * (backend/db/supabaseClient.ts prefers SUPABASE_POOLER_URL over SUPABASE_URL.)
 */
const LOOPBACK_REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_POOLER_URL', 'SUPABASE_POOLER_DB_URL',
  'DATABASE_URL', 'DIRECT_URL', 'MIGRATION_DATABASE_URL',
  'REDIS_URL', 'CREATOR_RENDER_REDIS_URL', 'UPSTASH_REDIS_REST_URL',
];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Hostname of a URL-shaped value, or null when it is not URL-shaped. Never returns credentials. */
function hostOf(value) {
  const m = String(value).match(/[a-z][a-z0-9+.-]*:\/\/\S+/i);
  if (!m) return null;
  try { return new URL(m[0]).hostname.toLowerCase(); } catch (_) { return '(unparseable)'; }
}

/** Pure scan used by the guard and by tests. Violations name the variable, never its value. */
function scanCertEnv(env = process.env) {
  const violations = [];
  for (const key of CONNECTION_VARS) {
    const val = env[key];
    if (typeof val !== 'string') continue;
    for (const marker of PROD_MARKERS) if (val.includes(marker)) violations.push(`${key} → "${marker}"`);
  }
  for (const key of LOOPBACK_REQUIRED_VARS) {
    const val = env[key];
    if (typeof val !== 'string' || !val.trim()) continue;
    const host = hostOf(val);
    if (host === null) violations.push(`${key} → not a URL (a loopback URL is required under CERT_ENV=1)`);
    else if (!LOOPBACK_HOSTS.has(host)) violations.push(`${key} → non-loopback host "${host}"`);
  }
  if (env.OMNIVYRA_ALLOW_SHARED_QUEUES && /^(1|true|yes)$/i.test(String(env.OMNIVYRA_ALLOW_SHARED_QUEUES))) {
    violations.push('OMNIVYRA_ALLOW_SHARED_QUEUES → shared production queue keyspace is forbidden under CERT_ENV=1');
  }
  if (env.NODE_ENV === 'production') violations.push('NODE_ENV → "production" selects the shared production queue keyspace');
  return violations;
}

/** Resolve the env file per the cert-aware priority. */
function resolveEnvFile(cwd = process.cwd()) {
  const envFile = process.env.ENV_FILE && String(process.env.ENV_FILE).trim();
  if (envFile) return path.isAbsolute(envFile) ? envFile : path.join(cwd, envFile);
  const cert = path.join(cwd, '.env.cert');
  if (fs.existsSync(cert)) return cert;
  return path.join(cwd, '.env.local');
}

/** In-process guard: only active under CERT_ENV=1. Exits on any prod marker. */
function assertCertIsolationInProcess(env = process.env) {
  if (env.CERT_ENV !== '1') return { ok: true, violations: [] };
  const violations = scanCertEnv(env);
  if (violations.length) {
    console.error('[cert-isolation:in-process] REFUSING — certification env is not confined to loopback / points at PRODUCTION:\n  ' + violations.join('\n  '));
    process.exit(1);
  }
  return { ok: true, violations: [] };
}

/** Load the resolved env file into process.env, then run the in-process guard. */
function loadCertAwareEnv(cwd = process.cwd()) {
  const file = resolveEnvFile(cwd);
  const dotenv = require('dotenv');
  try { dotenv.config({ path: file }); } catch (_) { /* file missing → fall through */ }
  dotenv.config(); // fill any gaps from a bare .env (prod parity behavior preserved)
  assertCertIsolationInProcess(process.env);
  return file;
}

module.exports = { resolveEnvFile, loadCertAwareEnv, assertCertIsolationInProcess, scanCertEnv, PROD_MARKERS, CONNECTION_VARS, LOOPBACK_REQUIRED_VARS };
