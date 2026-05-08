# Super-Admin Session Divergence Trace

**Generated**: 2026-05-07
**Symptom**: `/super-admin/dashboard` authenticates successfully; `/settings/security` reports "not signed in" using the same browser session.

This is the exact divergence chain that produces that mismatch. Every step is source-grounded with line references.

---

## Step-by-step trace

### 1. Operator logs in via `/super-admin/login`

[pages/super-admin/login.tsx:14-42](../../../pages/super-admin/login.tsx) submits `{ username, password }` to `POST /api/super-admin/login`.

[pages/api/super-admin/login.ts:9-37](../../../pages/api/super-admin/login.ts) validates the credentials against env `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD` and on success sets:

```
super_admin_session=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400
```

There is **NO** call to `supabase.auth.signInWithPassword`, **NO** `auth_sessions` row inserted, **NO** `webauthn_credentials` row, **NO** `omnivyra_session` cookie minted, and **NO** `users` row created or modified. The operator now has a `super_admin_session=1` cookie in their browser AND nothing else.

### 2. Operator lands on `/super-admin/dashboard`

The dashboard ([pages/super-admin.tsx:78-80](../../../pages/super-admin.tsx)) calls:

```ts
fetchWithAuth('/api/super-admin/platform-oauth-configs')
  .then((r) => { if (r.status === 403) window.location.href = '/super-admin/login'; })
```

`fetchWithAuth` ([components/community-ai/fetchWithAuth.ts](../../../components/community-ai/fetchWithAuth.ts)) calls `getAuthToken()` which calls `supabase.auth.getSession()` — there is no Supabase session, so token is null. The request goes out with **no `Authorization` header** but **with cookies** (`credentials: 'include'`).

### 3. `/api/super-admin/platform-oauth-configs` honors the cookie

[pages/api/super-admin/platform-oauth-configs.ts:42-44](../../../pages/api/super-admin/platform-oauth-configs.ts):

```ts
async function requireAdminAccess(req, res) {
  if (req.cookies?.super_admin_session === '1') return true;       // C1 wins
  if (req.cookies?.content_architect_session === '1') return true; // C2 wins
  // ... never reached
}
```

The cookie short-circuits the entire downstream auth. Returns 200. Dashboard renders. **Operator is "authenticated" to the super-admin panel.**

### 4. Operator clicks `/settings/security`

[pages/settings/security.tsx:99-106](../../../pages/settings/security.tsx) `useEffect` calls `reloadAuthState()` which calls `fetchSessionSnapshot()` from [lib/security/sessionClient.ts:57-62](../../../lib/security/sessionClient.ts):

```ts
const r = await fetch('/api/auth/session', { method: 'GET', credentials: 'same-origin' });
if (r.status === 401) return null;
```

Critical: this is `fetch`, **not** `fetchWithAuth`. **No `Authorization` header is added.** Cookies are sent (same-origin includes them).

### 5. `/api/auth/session` calls `resolvePrincipal`

[pages/api/auth/session.ts:23-25](../../../pages/api/auth/session.ts) → [backend/security/IdentityResolver.ts:240-263](../../../backend/security/IdentityResolver.ts):

```ts
// 1. Try Supabase-backed identity first.
const auth = await resolveAuthenticatedUser(req);
if (auth.error === null) { … return canonical principal … }

// 2. Fall back to legacy cookie super-admin
const bridge = await resolveLegacyCookieSuperAdminPrincipal(req);
if (bridge) return { ok: true, principal: bridge };

// 3. NO_AUTH / INVALID_AUTH
return { ok: false, reason: 'INVALID_AUTH' };
```

[backend/services/authResolver.ts:55-103](../../../backend/services/authResolver.ts) `extractAccessToken` reads:
- `Authorization: Bearer <token>` header (NONE present)
- `sb-*-auth-token` / `auth-token` / `supabase-auth` cookies (NONE present — these are Supabase SSR cookies, not the bridge cookie)

→ token is `null` → `resolveAuthenticatedUser` returns `{ user: null, error: 'NO_TOKEN' }` → step 2.

### 6. The bridge fallback — two possible outcomes

[backend/security/legacyCookieSuperAdminBridge.ts:76-161](../../../backend/security/legacyCookieSuperAdminBridge.ts):

**Outcome A** — `LEGACY_BRIDGE_DRY_RUN` is **NOT** set:
- Reads `super_admin_session=1` from `req.cookies` ✅
- Audit row written: `decision='bridge_used'`
- Returns synthetic principal with `legacyCookieSuperAdmin: true`
- `resolvePrincipal` returns `{ ok: true, principal }` → `/api/auth/session` returns 200

[pages/settings/security.tsx:132-138](../../../pages/settings/security.tsx):
```ts
if (session.legacyCookieSuperAdmin) {
  return <div>Security settings are not available to legacy cookie super-admin sessions. Please sign in with a Supabase user account.</div>;
}
```

→ Page renders **"Security settings are not available to legacy cookie super-admin sessions"**.

**Outcome B** — `LEGACY_BRIDGE_DRY_RUN=1` (or `=true`/`=yes`/`=on`):
- [legacyCookieSuperAdminBridge.ts:88-104](../../../backend/security/legacyCookieSuperAdminBridge.ts) — dry-run gate fires BEFORE the bridge would normally synthesize
- Audit row written: `decision='bridge_authority_rejected'`
- Returns `null` (bridge inactive)
- `resolvePrincipal` falls through to step 3 → returns `{ ok: false, reason: 'INVALID_AUTH' }`
- `/api/auth/session` returns **401**

[pages/settings/security.tsx:129-131](../../../pages/settings/security.tsx):
```ts
if (!session) {
  return <div>You must be signed in to view security settings.</div>;
}
```

→ Page renders **"You must be signed in to view security settings"**.

---

## Conclusion — root cause

**The super-admin login path produces ONLY a bridge cookie. The canonical security spine accepts bridge principals through `IdentityResolver`'s fallback but the `/settings/security` page deliberately rejects them at the `legacyCookieSuperAdmin` guard. There is NO code path through which a `/super-admin/login` user becomes a canonical principal able to use `/settings/security`.**

The exact text the operator sees ("not signed in" vs "not available to legacy cookie super-admin sessions") depends on whether `LEGACY_BRIDGE_DRY_RUN` is set in the operator's environment. The user's `.env.local` was opened in the IDE, suggesting they may have just toggled it.

Either way, the underlying issue is identical: the super-admin runtime never enters the canonical session lifecycle. Every "fix" that papers over the symptom without that lifecycle is a hack.

---

## What canonical integration would require

For `/settings/security` to work for a super-admin operator, ALL of the following must be true:

1. The operator has a real `users` row + `auth.users` row (Supabase identity) — current state: **maybe** (unverified; bridge users have no DB identity).
2. The operator has authenticated via a Supabase password / magic link / passkey flow — current state: **no Supabase login flow exists in `/super-admin/login.tsx`**.
3. After Supabase login, the canonical `/api/auth/sync-supabase-user` runs and mints an `auth_sessions` row + `omnivyra_session` cookie — current state: **never invoked from the super-admin login flow**.
4. The operator's `users.id` has a `user_company_roles` row with `role='SUPER_ADMIN'` and `status='active'` — current state: **0 such rows in the DB**.
5. The operator has enrolled at least one passkey for phishing-resistant step-up — current state: **0 passkeys total**.

Wave 3B's job is to make all five conditions a precondition of being a SUPER_ADMIN; the current divergence is what makes that work non-trivial.

---

## Code paths involved (full list)

- `pages/super-admin/login.tsx` — login UI (env-only, NO Supabase)
- `pages/api/super-admin/login.ts` — sets bridge cookie
- `pages/api/super-admin/content-architect-login.ts` — sets `content_architect_session` + `content_architect_company_id`
- `pages/api/super-admin/logout.ts` — clears bridge cookies (does NOT call canonical `/api/auth/logout`)
- `pages/super-admin.tsx` / `pages/super-admin/dashboard.tsx` — dashboard
- `components/community-ai/fetchWithAuth.ts` — adds Bearer token IF Supabase session exists; otherwise sends cookies only
- `pages/settings/security.tsx` — canonical-only consumer
- `lib/security/sessionClient.ts` — uses `fetch` directly, no Bearer
- `pages/api/auth/session.ts` / `pages/api/auth/capabilities.ts` — canonical principal endpoints
- `backend/security/IdentityResolver.ts` — canonical resolver with bridge fallback
- `backend/services/authResolver.ts` — Bearer + Supabase auth cookie extractor
- `backend/security/legacyCookieSuperAdminBridge.ts` — bridge synthesizer with hard-expiry + dry-run flag
