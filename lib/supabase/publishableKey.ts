/**
 * Supabase BROWSER API-key resolution — the single seam for the client-side
 * Supabase credential.
 *
 * Supabase's new API-key model replaces the legacy JWT `anon` key with an
 * opaque `sb_publishable_…` key. The canonical application contract is
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 *
 * NEXT_PUBLIC_SUPABASE_ANON_KEY remains readable here as a MIGRATION-ONLY,
 * TEMPORARY fallback so a deploy that still holds only the legacy variable
 * keeps working. Once Railway and Vercel carry the new variable, delete
 * `LEGACY_PUBLISHABLE_KEY_VAR` and the branch that reads it.
 *
 * CLIENT-SAFE. Both variables are NEXT_PUBLIC_*, i.e. publishable credentials
 * that are meant to reach the browser and are constrained by RLS. This module
 * must NEVER read a server credential — those live behind
 * backend/db/supabaseKeys.ts and are deliberately not even named here, so the
 * client-reachable secret scan stays a clean signal.
 *
 * Both reads below are written as literal `process.env.<NAME>` member
 * expressions on purpose: that is the only form Next.js statically inlines
 * into the client bundle. Dynamic access (`process.env[name]`) would resolve
 * to undefined in the browser.
 */

/** Canonical browser credential (Supabase new API-key model). */
export const PUBLISHABLE_KEY_VAR = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' as const;

/** Legacy browser credential. Temporary; removed after the production cutover. */
export const LEGACY_PUBLISHABLE_KEY_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY' as const;

export type SupabasePublishableKeySource = 'publishable' | 'legacy-anon' | 'missing';

export interface SupabasePublishableKeyResolution {
  key: string | undefined;
  source: SupabasePublishableKeySource;
}

function clean(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the browser Supabase key. Pure — no logging, no throwing.
 *
 * `overrides` exists for tests and for server-side callers that already hold a
 * specific env object; production callers pass nothing so the statically
 * inlined values are used.
 */
export function resolveSupabasePublishableKey(
  overrides?: { publishable?: string; legacyAnon?: string },
): SupabasePublishableKeyResolution {
  const publishable = clean(
    overrides ? overrides.publishable : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  if (publishable) return { key: publishable, source: 'publishable' };

  const legacyAnon = clean(
    overrides ? overrides.legacyAnon : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (legacyAnon) return { key: legacyAnon, source: 'legacy-anon' };

  return { key: undefined, source: 'missing' };
}

/** Resolved browser key, or '' when neither variable is set. */
export function getSupabasePublishableKey(): string {
  return resolveSupabasePublishableKey().key ?? '';
}

/** Resolved browser key, or throw with an actionable message. */
export function requireSupabasePublishableKey(): string {
  const { key } = resolveSupabasePublishableKey();
  if (!key) {
    throw new Error(
      `${PUBLISHABLE_KEY_VAR} is missing. Add it to your deployment environment variables ` +
        `(Vercel/Railway Settings → Environment Variables). During the API-key migration ` +
        `${LEGACY_PUBLISHABLE_KEY_VAR} is still accepted.`,
    );
  }
  return key;
}
