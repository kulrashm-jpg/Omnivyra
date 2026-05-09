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
 */
let _ranIsolationCheck = false;
export function checkEnvIsolationOnce(): void {
  if (_ranIsolationCheck) return;
  _ranIsolationCheck = true;
  try {
    checkEnvIsolation();
  } catch (err) {
    // Strictly warn-only; never block startup.
    console.warn('[env-isolation] check failed:', err);
  }
}
