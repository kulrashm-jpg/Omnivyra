/**
 * The single semantic definition of "browser storage that represents
 * authenticated identity or authenticated application state".
 *
 * WHY THIS EXISTS
 * ---------------
 * The logged-out assertions used to require `sessionStorage` to be completely
 * empty. That was an over-broad proxy for "no auth state": the product now
 * mints ANONYMOUS visitor telemetry (`omn_anon_id`, `omn_session`,
 * `omn_journey` — see lib/website/journeyIntelligence.ts) on every page load,
 * which is not auth state and legitimately survives logout.
 *
 * This module inverts the test: instead of allow-listing the telemetry keys
 * that happen to exist today, it DENY-lists exactly what the application itself
 * treats as auth/tenant state. Any future anonymous telemetry is therefore
 * allowed automatically, while any new authenticated-identity key is caught the
 * moment it is added to the product's own definition.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The lists below mirror the private constants in `utils/authStorage.ts`, which
 * is the product code that CLEARS auth state on logout. They are intentionally
 * duplicated rather than imported, because those constants are not exported and
 * the module is browser-oriented. `authStateKeys.spec.ts` contains a drift test
 * that parses `utils/authStorage.ts` and fails if the two ever diverge — so the
 * duplication cannot silently rot.
 */

/** Supabase's own persisted-session key prefixes. */
export const SUPABASE_AUTH_PREFIXES: readonly string[] = ['sb-', 'supabase.auth.'];

/** Exact keys the product clears as auth-scoped application state. */
export const EXACT_AUTH_APP_KEYS: readonly string[] = [
  'selected_company_id',
  'company_id',
  'omnivyra_onboarding',
  'onboarding_profile_draft_v1',
  'onboarding_company_draft_v1',
  'auth_flow_session_established_v1',
  'domain_verification_token_v1',
  'intent_goals',
  'intent_team',
  'intent_challenge',
  'onboarding_phone',
  'onboarding_company_name',
];

/** Key prefixes the product clears as auth-scoped application state. */
export const PREFIXED_AUTH_APP_KEYS: readonly string[] = [
  'company_profile_onboarding:',
  'company_profile_updated:',
  'onboarding_profile_draft_v1:',
  'onboarding_company_draft_v1:',
  'campaign_chat_draft_',
  'campaign_chat_fresh_applied_',
  'campaign_planning_form_',
];

/** Cookie names/prefixes that carry an authenticated session. */
export const AUTH_COOKIE_EXACT: readonly string[] = ['omnivyra_session'];
export const AUTH_COOKIE_PREFIXES: readonly string[] = ['sb-', 'mfa_'];

function isSupabaseAuthKey(key: string): boolean {
  return SUPABASE_AUTH_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isPkceVerifierKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('code-verifier') || lower.includes('pkce');
}

/**
 * True when `key` represents authenticated identity or authenticated
 * application/tenant state, and must therefore be absent when logged out.
 *
 * Also matches user-scoped variants produced by
 * `userScopedStorageKey(baseKey, userId)` => `${baseKey}:${userId}`, so a
 * leaked per-user copy of an auth-scoped key is still caught.
 */
export function isAuthStateKey(key: string): boolean {
  if (!key) return false;
  if (isSupabaseAuthKey(key)) return true;
  if (isPkceVerifierKey(key)) return true;
  if (AUTH_COOKIE_EXACT.includes(key)) return true;
  if (AUTH_COOKIE_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (EXACT_AUTH_APP_KEYS.includes(key)) return true;
  if (PREFIXED_AUTH_APP_KEYS.some((prefix) => key.startsWith(prefix))) return true;
  // User-scoped form of any exact auth key: "<key>:<userId>".
  if (EXACT_AUTH_APP_KEYS.some((base) => key.startsWith(`${base}:`))) return true;
  return false;
}

/** Every auth-state key present in the supplied storage-key list. */
export function findAuthStateKeys(keys: readonly string[]): string[] {
  return keys.filter(isAuthStateKey);
}
