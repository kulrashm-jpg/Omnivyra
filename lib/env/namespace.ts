/**
 * Phase 4 — Environment namespace helper + cross-environment contamination warnings.
 *
 * Used (today) to mint locally-unique keys for things like report locks and
 * future queue / cache keys, so a developer running against a shared backend
 * does not collide with the production deployment by name alone.
 *
 * Pattern: `${envName}:${resource}` — e.g. `production:report-lock:abc123`.
 *
 * This module is deliberately dependency-light so it can be imported from any
 * runtime (Node, Edge, scripts).
 */

export type RuntimeEnv = 'production' | 'preview' | 'development' | 'test';

export function getRuntimeEnv(): RuntimeEnv {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === 'production' || vercelEnv === 'preview' || vercelEnv === 'development') {
    return vercelEnv;
  }
  if (process.env.NODE_ENV === 'test') return 'test';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

export function namespacedKey(resource: string): string {
  if (!resource) {
    throw new Error('namespacedKey requires a non-empty resource string');
  }
  return `${getRuntimeEnv()}:${resource}`;
}

interface IsolationWarning {
  level: 'warn';
  code: string;
  message: string;
}

/**
 * Inspect the active environment and surface (warn-only) any cross-environment
 * contamination risks we can detect from env vars alone. Never throws, never
 * blocks startup. Returns the list of warnings emitted so callers can also
 * forward them to telemetry.
 *
 * The two checks today:
 *   1. Local dev pointing at a remote (non-localhost) Supabase URL.
 *   2. Production runtime pointing at a localhost Redis / DB URL.
 */
export function checkEnvIsolation(): IsolationWarning[] {
  const env = getRuntimeEnv();
  const warnings: IsolationWarning[] = [];

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
  const redisUrl =
    process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

  const looksRemote = (url: string) =>
    /^https?:\/\//.test(url) && !/localhost|127\.0\.0\.1|::1/.test(url);
  const looksLocal = (url: string) =>
    /localhost|127\.0\.0\.1|::1/.test(url);

  if (env === 'development' && supabaseUrl && looksRemote(supabaseUrl)) {
    const host = (() => {
      try { return new URL(supabaseUrl).host; } catch { return 'unknown'; }
    })();
    warnings.push({
      level: 'warn',
      code: 'ENV_LOCAL_USES_REMOTE_SUPABASE',
      message:
        `Local development is pointing at a remote Supabase host (${host}). ` +
        `Local writes will be visible to other environments and may collide with production.`,
    });
  }

  if ((env === 'production' || env === 'preview') && dbUrl && looksLocal(dbUrl)) {
    warnings.push({
      level: 'warn',
      code: 'ENV_PROD_USES_LOCAL_DB',
      message:
        `Production runtime has a localhost DB URL configured. ` +
        `This indicates a missing/mis-injected env var.`,
    });
  }

  if ((env === 'production' || env === 'preview') && redisUrl && looksLocal(redisUrl)) {
    warnings.push({
      level: 'warn',
      code: 'ENV_PROD_USES_LOCAL_REDIS',
      message:
        `Production runtime has a localhost Redis URL configured. ` +
        `Queue / cache writes will not reach a remote backend.`,
    });
  }

  for (const w of warnings) {
    console.warn(`[env-isolation] ${w.code}: ${w.message}`);
  }

  return warnings;
}

/**
 * Run the isolation check at most once per process. Called from server-side
 * client constructors so it fires once on cold start without imposing import
 * cycles on script callers.
 *
 * Cache-flag invariant: `_ranIsolationCheck` flips to `true` ONLY after
 * `enforceEnvIsolationFatal()` returns successfully. The previous order
 * (flag-flip BEFORE the throw) turned the hard-block into a one-shot —
 * request 1 received 500, request 2+ silently bypassed the guard until
 * the next module reload. Now the throw re-fires on every call until
 * the topology is actually safe.
 */
let _ranIsolationCheck = false;
export function checkEnvIsolationOnce(): void {
  if (_ranIsolationCheck) return;
  try {
    checkEnvIsolation();
  } catch (err) {
    // Strictly warn-only; never block startup.
    console.warn('[env-isolation] check failed:', err);
  }
  // Fatal-check is intended to throw on the dangerous combination.
  // We do NOT set `_ranIsolationCheck = true` until it returns clean.
  enforceEnvIsolationFatal();
  _ranIsolationCheck = true;
}

/**
 * Hard-block startup when prod-Supabase + local-Redis is detected.
 *
 * Rationale: this combination is the most production-dangerous env
 * misconfiguration — queue work enqueued from the local runtime lands
 * in local Redis, while remote workers (Railway) read from prod Redis.
 * Jobs are invisible to consumers, but writes against prod Supabase
 * still happen. Net effect: production state gets partially mutated
 * by a dev process whose queue side believes everything is local.
 *
 * Detection:
 *   - SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL points at a remote host
 *   - AND REDIS_URL / UPSTASH_REDIS_REST_URL points at localhost
 *
 * Override:
 *   Set ALLOW_PROD_DB_WITH_LOCAL_REDIS=1 to bypass. The bypass exists
 *   ONLY for explicit emergency / debug usage — set it, do the thing,
 *   immediately unset. Never put this in a long-lived shell profile.
 *
 * Intentionally unaffected:
 *   - Local Supabase + local Redis (full local stack)
 *   - Remote Supabase + remote Redis (full deployed stack, including
 *     dev-against-prod-everything which is a documented pattern)
 */
let _loggedOverrideOnce = false;
export function enforceEnvIsolationFatal(): void {
  if (process.env.ALLOW_PROD_DB_WITH_LOCAL_REDIS === '1') {
    // Log once per process, not per request, so production logs aren't
    // spammed if the flag ever leaks into a non-local environment.
    // Restricted to runtimes that aren't Vercel/preview/production-build.
    const env = getRuntimeEnv();
    if (!_loggedOverrideOnce && (env === 'development' || env === 'test')) {
      _loggedOverrideOnce = true;
      console.warn(
        '[env-isolation] ALLOW_PROD_DB_WITH_LOCAL_REDIS=1 active — prod-DB/local-Redis hard block bypassed. ' +
        'Local dev only. Unset before deploying.',
      );
    }
    return;
  }
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const redisUrl =
    process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

  const looksRemote = (url: string) =>
    /^https?:\/\//.test(url) && !/localhost|127\.0\.0\.1|::1/.test(url);
  const looksLocalRedis = (url: string) =>
    /^(redis|rediss):\/\/[^@]*@?(localhost|127\.0\.0\.1|::1)|^redis:\/\/(localhost|127\.0\.0\.1|::1)/.test(url);

  if (supabaseUrl && redisUrl && looksRemote(supabaseUrl) && looksLocalRedis(redisUrl)) {
    let host = 'unknown';
    try { host = new URL(supabaseUrl).host; } catch { /* leave unknown */ }
    const msg =
      `[env-isolation] FATAL: prod-Supabase + local-Redis detected.\n` +
      `  SUPABASE_URL host: ${host}\n` +
      `  REDIS_URL:         ${redisUrl}\n\n` +
      `  This combination is production-dangerous: writes against prod Supabase\n` +
      `  happen normally, but queue jobs land in local Redis and remote workers\n` +
      `  never see them. Production state can be partially mutated by a local\n` +
      `  process whose queue side believes everything is local.\n\n` +
      `  If you genuinely need this for an emergency debug session, set\n` +
      `  ALLOW_PROD_DB_WITH_LOCAL_REDIS=1 and unset it immediately after.`;
    console.error(msg);
    throw new Error('[env-isolation] prod-Supabase + local-Redis topology blocked');
  }
}
