# Security Settings Runtime Audit

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Scope**: audit-only with permission to fix narrow, non-architectural issues. No auth-architecture changes.

---

## Root cause

Two **independent** issues, only one of which has a clear root cause from source-grounded inspection:

### Issue A — `/settings/security` not reachable from UI: **NAV WIRING DEFECT**

Three navigation surfaces reference settings, all hardcoded to `/settings/company-admin-access`:

- [components/Header.tsx:276](../../../components/Header.tsx) — desktop slide-out menu, `<Item icon={Settings} label="Settings" href="/settings/company-admin-access" />`
- [components/Header.tsx:550](../../../components/Header.tsx) — mobile grid, `{ label: 'Settings', href: '/settings/company-admin-access', icon: Settings }`
- [components/layout/GlobalHeader.tsx:500](../../../components/layout/GlobalHeader.tsx) — header dropdown, `<Link href="/settings/company-admin-access">`

The `/settings/security` page exists at [pages/settings/security.tsx](../../../pages/settings/security.tsx) and was added in Wave 2C-B. It was never wired into any nav surface. Result: users cannot click to reach it.

Compounding factor: all three nav surfaces gate "Settings" on `isCompanyAdmin = userRole === 'COMPANY_ADMIN'`. SUPER_ADMIN-roled users do NOT match this check (literal equality, not subset), so even if a SUPER_ADMIN exists, they don't see "Settings" either. (Pre-existing defect; out of audit scope.)

### Issue B — JSON request returns HTML: **INSUFFICIENT DIAGNOSTIC DATA**

The settings page that loads (`/settings/company-admin-access`) makes one fetch:
- [pages/settings/company-admin-access.tsx:120](../../../pages/settings/company-admin-access.tsx) → `GET /api/settings/intelligence-access?mode=company`
- Line 121: `const json = await res.json();` is called BEFORE `res.ok` check — so any non-JSON response throws "Unexpected token '<'..." cryptically.

The API route at [pages/api/settings/intelligence-access.ts](../../../pages/api/settings/intelligence-access.ts) returns JSON on every code path I inspected:
- 405 for non-GET/PUT methods (line 268, JSON)
- 401 for missing/invalid auth (line 273, JSON)
- 403 for non-admin users (line 284, JSON)
- 200 for success (lines downstream, JSON)

**No source-side path returns HTML.** Possible runtime explanations (none verifiable from this position):

1. **Unhandled exception in handler** — Next.js Pages Router renders a stock HTML error page (`<!DOCTYPE html>...Internal Server Error`) on uncaught throws. `getSupabaseUserFromRequest` and `resolveAccess` could throw under network/DB transient errors, though both are wrapped in `try/catch` chains internally.
2. **Build error overlay** — In dev, Next.js serves an HTML error page when the route file fails to compile. Typecheck currently exits 0, so this is unlikely.
3. **Catch-all redirect at the deploy edge** — Vercel / Railway / nginx layer might redirect unauthed requests to `/login`. The audit found NO project-level `next.config.js` rewrites/redirects targeting `/api/settings/*`, NO `middleware.ts` (the `proxy.ts` file is dead per Phase 1 audit), and NO matching pattern in the rewrites array.
4. **Static asset precedence** — would only happen if a static file at `pages/api/settings/intelligence-access.ts` shadowed the route, which the file structure rules out.

**I did not fix Issue B** because the prompt mandates "DO NOT FIX YET unless: issue is isolated, low blast radius, clearly non-architectural". Without a captured response body, status code, and request URL from the failing call, the root cause could be auth-architectural (e.g., a deploy-edge redirect added outside this repo), and a fix here would be speculative.

A safe, non-architectural improvement candidate (deferred): change the frontend's `loadAccess` to check `res.ok` and surface response status + content-type before calling `res.json()`. This would convert the cryptic "Unexpected token '<'" into a meaningful error message but does not fix the underlying redirect/HTML source.

---

## Files audited

### Nav surfaces
- [components/Header.tsx](../../../components/Header.tsx)
- [components/layout/GlobalHeader.tsx](../../../components/layout/GlobalHeader.tsx)

### Settings pages
- [pages/settings/company-admin-access.tsx](../../../pages/settings/company-admin-access.tsx)
- [pages/settings/security.tsx](../../../pages/settings/security.tsx)
- [pages/settings/integrations.tsx](../../../pages/settings/integrations.tsx)

### API routes
- [pages/api/settings/intelligence-access.ts](../../../pages/api/settings/intelligence-access.ts)
- [pages/api/auth/session.ts](../../../pages/api/auth/session.ts)
- [pages/api/auth/capabilities.ts](../../../pages/api/auth/capabilities.ts)

### Resolvers / framework
- [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts)
- [backend/services/authResolver.ts](../../../backend/services/authResolver.ts)
- [backend/security/SessionAuthorityService.ts](../../../backend/security/SessionAuthorityService.ts)
- [next.config.js](../../../next.config.js) — no settings/security rewrites or redirects
- `middleware.ts` — does not exist (Next.js convention requires this filename; the present `proxy.ts` is dead code)

### Frontend session client
- [lib/security/sessionClient.ts](../../../lib/security/sessionClient.ts)
- [components/community-ai/fetchWithAuth.ts](../../../components/community-ai/fetchWithAuth.ts)
- [utils/getAuthToken.ts](../../../utils/getAuthToken.ts)

---

## Files modified (2)

1. **[components/Header.tsx](../../../components/Header.tsx)**
   - Added `Shield` icon to lucide-react imports.
   - Added `<Item icon={Shield} label="Security" href="/settings/security" />` to the desktop slide-out menu (after the existing Settings link, NOT gated on `isCompanyAdmin` because security settings are per-user not per-role).
   - Added `{ label: 'Security', href: '/settings/security', icon: Shield }` to the mobile grid (within the existing `isCompanyAdmin` block — pre-existing gate preserved as-is).

2. **[components/layout/GlobalHeader.tsx](../../../components/layout/GlobalHeader.tsx)**
   - Added `Shield` to lucide-react imports.
   - Added `<Link href="/settings/security">` after the existing Settings link in the dropdown. Not gated on `isCompanyAdmin` so every signed-in user sees it.

No other files modified. No auth architecture changes. No route migrations. No bridge changes.

---

## Exact failing endpoint

`/api/settings/intelligence-access` (GET) — called from `pages/settings/company-admin-access.tsx:120`. The endpoint itself returns JSON on every inspected code path; runtime cause of the HTML response cannot be determined from source inspection alone.

## Exact redirect/HTML source

**Indeterminate from source.** No `next.config.js` rewrites/redirects, no `middleware.ts`, no API-route HTML response paths. Possibilities (cannot verify from this position):
- Next.js stock 500 HTML when the handler throws unhandled
- Deploy-edge redirect (Vercel/Railway/nginx) intercepting unauthenticated requests
- Auth proxy outside the repo

To diagnose, capture the actual response from the browser dev tools (Network tab → request → Response tab) showing status code, content-type, and body.

## Canonical auth status

Per the most recent live DB query during this audit chain (Phase 3 readiness check):

| Metric | Value |
|---|---|
| Active SUPER_ADMIN rows | 0 |
| Active passkeys (any user) | 0 |
| Active auth_sessions | 1 |
| Active phishing-resistant step-ups | 0 |
| `bridge_authority_rejected` events | 26 (operator running dry-run) |
| `auth_session_created` events | 1 |
| `super_admin_bootstrap_completed` events | 0 |

The single active `auth_sessions` row likely belongs to a non-SUPER_ADMIN Supabase user. If that user visited `/settings/company-admin-access`, the page would call `/api/settings/intelligence-access?mode=company`. The route's `resolveAccess` would query `user_company_roles` for active rows and:
- find no SUPER_ADMIN row (0 in DB)
- find no COMPANY_ADMIN row either (otherwise the page would have rendered something)
- return `null` → route returns 403 JSON with `{error: 'Only company admins or super admins can access this setting'}`

That's a JSON 403, not HTML. So the HTML source must be elsewhere in the runtime stack.

## Security route status

| Aspect | Status |
|---|---|
| Page exists | ✅ [pages/settings/security.tsx](../../../pages/settings/security.tsx) |
| Page guards | ✅ correctly hydrates session via `/api/auth/session`; rejects bridge principals at line 132 with informational text; redirects to `/login?reason=session_revoked` if session disappears |
| Reachable in nav (BEFORE this fix) | ❌ no nav link exists |
| Reachable in nav (AFTER this fix) | ✅ added to Header.tsx + GlobalHeader.tsx |
| Operates correctly for canonical principal | yes — but requires (1) operator bootstrap, (2) `SUPER_ADMIN_PRIMARY_USER_ID` env, (3) Supabase login. None of these are met yet |
| Operates correctly for bridge principal | NO — explicit reject branch at line 132 (intended; bridge users cannot use security settings by design) |

## Remaining blockers

1. **HTML-instead-of-JSON root cause** — needs runtime diagnostic data: actual response status code + body + Network-tab capture of the failing `/api/settings/intelligence-access` request. Source-only audit cannot determine this.
2. **Settings nav `isCompanyAdmin` gate** — Settings link is hidden from SUPER_ADMINs because `userRole.toUpperCase() === 'COMPANY_ADMIN'` is a literal equality check. Pre-existing defect, out of this audit's scope.
3. **Operator prerequisites** unchanged from Phase 3 readiness check (0 SUPER_ADMIN rows, 0 passkeys, 0 stepups, 0 bootstrap events).

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `git ls-files "pages/settings/**" "components/settings/**"` | enumerate settings pages | 3 pages, 0 components |
| `grep -rln "settings/security\|settings/integrations\|settings/company-admin-access"` | find nav references | 2 files (Header.tsx + GlobalHeader.tsx) point only to company-admin-access |
| `grep -n "settings/" components/Header.tsx components/layout/GlobalHeader.tsx` | locate hardcoded nav hrefs | confirmed 3 hardcodes |
| `grep -n "default async function handler\|getSupabaseUserFromRequest\|res.redirect" pages/api/settings/intelligence-access.ts` | inspect handler entry + redirect calls | no `res.redirect`; only JSON returns |
| `cat next.config.js` | scan rewrites/redirects | no settings/* or auth/* redirects |
| `ls middleware.ts` | check for Next.js middleware | does not exist |
| `mcp__supabase__execute_sql` | live runtime auth state | 0 SUPER_ADMIN, 0 passkeys, 1 auth_session |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after nav fix | exit 0 |

## Typecheck status

✅ exit 0 after the nav fix.

---

## What I did NOT do (per scope)

- ❌ Did not modify auth architecture
- ❌ Did not migrate routes
- ❌ Did not touch bridge collapse
- ❌ Did not fix the HTML-instead-of-JSON issue (insufficient diagnostic data; risk of architectural change)
- ❌ Did not change the `isCompanyAdmin` gate behavior on Settings link
- ❌ Did not add a `res.ok` check in the frontend's `loadAccess` (deferred — would be a UX-only improvement but not a fix for the underlying HTML source)

## Recommended next step (operator)

To diagnose Issue B, reproduce the failure in dev tools:
1. Sign in as the user who saw the error
2. Open Network tab and visit `/settings/company-admin-access`
3. Click the failing `/api/settings/intelligence-access` request
4. Capture: status code, response headers (especially `content-type` and `location`), response body (first 1KB), redirect chain

That data points directly at the source — JSON-returning route + HTML response means an interceptor between the browser and the handler. Once captured, share back and the fix will be narrow.
