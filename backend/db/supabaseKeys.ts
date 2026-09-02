/**
 * Supabase SERVER API-key resolution — the single seam for the server-side
 * Supabase credential.
 *
 * Supabase's new API-key model replaces the legacy JWT `service_role` key with
 * an opaque `sb_secret_…` secret key. The canonical application contract is
 * therefore SUPABASE_SECRET_KEY.
 *
 * SUPABASE_SERVICE_ROLE_KEY remains readable here as a MIGRATION-ONLY,
 * TEMPORARY fallback, for exactly one reason: this code ships before Railway
 * and Vercel carry the new variable, so a deploy that still holds only the
 * legacy variable must keep serving. It is not a permanent alias. Once both
 * platforms carry SUPABASE_SECRET_KEY, delete `LEGACY_SECRET_KEY_VAR` and the
 * two branches that reference it — that is the whole removal.
 *
 * SERVER ONLY. This module names a secret-bearing variable and must never be
 * imported from client/browser code. The browser credential lives in
 * lib/supabase/publishableKey.ts, which reads only NEXT_PUBLIC_* variables.
 * config/integrity/runtimeIntegrity.ts enforces that boundary.
 */

/** Canonical server credential (Supabase new API-key model). */
export const SECRET_KEY_VAR = 'SUPABASE_SECRET_KEY' as const;

/** Legacy server credential. Temporary; removed after the production cutover. */
export const LEGACY_SECRET_KEY_VAR = 'SUPABASE_SERVICE_ROLE_KEY' as const;

export type SupabaseSecretKeySource = 'secret' | 'legacy-service-role' | 'missing';

export interface SupabaseSecretKeyResolution {
  /** The resolved key, or undefined when neither variable carries a value. */
  key: string | undefined;
  /** Which variable supplied it. Reported by diagnostics; never the value. */
  source: SupabaseSecretKeySource;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the server Supabase key. Pure — no logging, no throwing — so callers
 * and tests can inspect the outcome (including which variable supplied it)
 * without side effects.
 */
export function resolveSupabaseSecretKey(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseSecretKeyResolution {
  const preferred = read(env, SECRET_KEY_VAR);
  if (preferred) return { key: preferred, source: 'secret' };

  const legacy = read(env, LEGACY_SECRET_KEY_VAR);
  if (legacy) return { key: legacy, source: 'legacy-service-role' };

  return { key: undefined, source: 'missing' };
}

/** Presence probe for diagnostics/preflight. Never returns the value. */
export function hasSupabaseSecretKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSupabaseSecretKey(env).source !== 'missing';
}

let _warnedAboutLegacy = false;

/**
 * Resolve the server key or throw with an actionable message.
 *
 * Emits one deprecation warning per process when the legacy variable supplied
 * the value, so a deploy still running on the old contract is visible in logs
 * instead of silently permanent. The warning names variables only.
 */
export function requireSupabaseSecretKey(env: NodeJS.ProcessEnv = process.env): string {
  const { key, source } = resolveSupabaseSecretKey(env);

  if (!key) {
    throw new Error(
      `${SECRET_KEY_VAR} is missing. Add it to your deployment environment variables ` +
        '(Vercel/Railway Settings → Environment Variables). ' +
        `During the API-key migration ${LEGACY_SECRET_KEY_VAR} is still accepted.`,
    );
  }

  if (source === 'legacy-service-role' && !_warnedAboutLegacy) {
    _warnedAboutLegacy = true;
    try {
      console.warn(
        `[supabaseKeys] DEPRECATED: falling back to ${LEGACY_SECRET_KEY_VAR}. ` +
          `Set ${SECRET_KEY_VAR} in this environment; the fallback is removed after the cutover.`,
      );
    } catch {
      /* logging must never break credential resolution */
    }
  }

  return key;
}
