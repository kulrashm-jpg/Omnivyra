const SUPABASE_AUTH_PREFIXES = ['sb-', 'supabase.auth.'];

const EXACT_AUTH_APP_KEYS = [
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

const PREFIXED_AUTH_APP_KEYS = [
  'company_profile_onboarding:',
  'company_profile_updated:',
  'onboarding_profile_draft_v1:',
  'onboarding_company_draft_v1:',
  // Campaign-chat sessionStorage drafts. sessionStorage survives a same-tab
  // sign-out → sign-in, so without explicit cleanup the next user's tab can
  // restore the previous user's chat draft for the same campaign.
  'campaign_chat_draft_',
  'campaign_chat_fresh_applied_',
  'campaign_planning_form_',
];

function isSupabaseAuthKey(key: string): boolean {
  return SUPABASE_AUTH_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isPkceVerifierKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('code-verifier') || lower.includes('pkce');
}

function removeMatchingKeys(storage: Storage, shouldRemove: (key: string) => boolean): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key));
  for (const key of keys) {
    if (shouldRemove(key)) storage.removeItem(key);
  }
}

function expireCookie(name: string): void {
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const base = `${name}=; Expires=${expires}; Max-Age=0; Path=/; SameSite=Lax`;
  document.cookie = base;

  const hostname = window.location.hostname;
  if (hostname && hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    document.cookie = `${base}; Domain=${hostname}`;
    document.cookie = `${base}; Domain=.${hostname}`;
  }
}

function clearAuthCookies(options: { preservePkce?: boolean } = {}): void {
  const preservePkce = options.preservePkce === true;
  const cookieNames = document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name));

  for (const name of cookieNames) {
    // @supabase/ssr's browser client persists the PKCE code verifier in a
    // cookie (sb-<ref>-auth-token-code-verifier), NOT localStorage. When a
    // magic-link / reset exchange is in flight (preservePkce), wiping it here
    // makes the subsequent exchangeCodeForSession() fail with a missing-
    // verifier error and bounces the user to /login. Keep it until the
    // exchange completes.
    if (preservePkce && isPkceVerifierKey(name)) continue;
    if (name.startsWith('sb-') || name === 'omnivyra_session' || name.startsWith('mfa_')) {
      expireCookie(name);
    }
  }

  // Legacy non-chunked session cookie names — never the PKCE verifier, safe
  // to always expire.
  expireCookie('sb-access-token');
  expireCookie('sb-refresh-token');
  expireCookie('omnivyra_session');
}

export function clearSupabasePersistedSession(options: { preservePkce?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const preservePkce = options.preservePkce === true;
  const shouldRemove = (key: string) =>
    isSupabaseAuthKey(key) && !(preservePkce && isPkceVerifierKey(key));

  try { removeMatchingKeys(window.localStorage, shouldRemove); } catch { /* ignore */ }
  try { removeMatchingKeys(window.sessionStorage, shouldRemove); } catch { /* ignore */ }

  try {
    clearAuthCookies({ preservePkce });
  } catch { /* ignore */ }
}

export function clearAuthScopedAppState(): void {
  if (typeof window === 'undefined') return;
  const shouldRemove = (key: string) =>
    EXACT_AUTH_APP_KEYS.includes(key) ||
    PREFIXED_AUTH_APP_KEYS.some((prefix) => key.startsWith(prefix));

  try { removeMatchingKeys(window.localStorage, shouldRemove); } catch { /* ignore */ }
  try { removeMatchingKeys(window.sessionStorage, shouldRemove); } catch { /* ignore */ }
}

export function clearBrowserAuthState(options: { preservePkce?: boolean } = {}): void {
  clearSupabasePersistedSession(options);
  clearAuthScopedAppState();
}

export function userScopedStorageKey(baseKey: string, userId: string | null | undefined): string | null {
  const normalized = String(userId ?? '').trim();
  return normalized ? `${baseKey}:${normalized}` : null;
}

export function getUserScopedLocalStorage(
  baseKey: string,
  userId: string | null | undefined,
): string | null {
  if (typeof window === 'undefined') return null;
  const scopedKey = userScopedStorageKey(baseKey, userId);
  if (!scopedKey) return null;
  try {
    return window.localStorage.getItem(scopedKey);
  } catch {
    return null;
  }
}

export function setUserScopedLocalStorage(
  baseKey: string,
  userId: string | null | undefined,
  value: string,
): void {
  if (typeof window === 'undefined') return;
  const scopedKey = userScopedStorageKey(baseKey, userId);
  if (!scopedKey) return;
  try {
    window.localStorage.setItem(scopedKey, value);
    window.localStorage.removeItem(baseKey);
  } catch { /* ignore */ }
}
