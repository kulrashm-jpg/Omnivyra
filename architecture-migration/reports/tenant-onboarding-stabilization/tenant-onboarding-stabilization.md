# Tenant Onboarding / Company Resolution Stabilization — Implementation Report

**Generated**: 2026-05-08
**Branch**: `identity-spine-enforcement`
**Symptom**: Authenticated existing tenant user lands on `/onboarding/company` instead of their tenant dashboard.

---

## Root cause identified

**Hydration race condition in `useDashboardState`** — NOT a canonical authority, membership, or DB drift issue.

The redirect-to-onboarding effect in `components/hooks/useDashboardState.tsx:33-56` fires when:
- `!isLoading` AND `authChecked` AND `isAuthenticated` AND `companies.length === 0`

The race triggers on this sequence:
1. User starts on an auth-flow page (e.g., `/onboarding/company` or `/auth/callback`).
2. `CompanyContext` auth subscription fires → `setIsAuthenticated(true)`, `setAuthChecked(true)`.
3. `CompanyContext` companies-fetch effect runs but detects auth-flow pathname and **early-returns with `setIsLoading(false)`** (line 372-375 of `components/CompanyContext.tsx`). NO `refreshCompanies` call. `companies` stays `[]` (initial useState value); `companiesLoadedRef.current` stays `false`.
4. User navigates to `/dashboard`.
5. `CompanyContext` companies effect re-fires (router.pathname dep change). Pathname is no longer auth-flow, so it sets `companiesLoadedRef.current=true` and calls `refreshCompanies()`. `refreshCompanies` synchronously calls `setIsLoading(true)`, but the React state update is QUEUED for the next render.
6. **In the SAME effect-flush phase**, `useDashboardState`'s effect runs (the new `/dashboard` mount or re-render). It reads the CURRENT render's state values: `isLoading=false` (from step 3's stale value), `companies=[]`, `authChecked=true`, `isAuthenticated=true`.
7. All gates pass → effect calls `router.replace('/onboarding/company')`.
8. `refreshCompanies` then completes (too late) — user is already on `/onboarding/company`.

**The DB is fully correct.** The 2 active users both have `user_company_roles` rows with `status='active'` linking to active `companies` rows with valid FKs. Source:
```
admin@drishiq.com  → users.id 6f9163ac-...   → role_user_id MATCH → company_id 4dae7f7a-... → companies.name='Drishiq', status='active'
kuldeep@omnivyra.com → users.id 7fe51fbc-... → role_user_id MATCH → company_id 4bdbec26-... → companies.name='Omnivyra', status='active'
```

Both users have `name`, `has_password=true`, `onboarding_state` NOT in any reject set, and a non-deleted public.users row. `/api/company-profile?mode=list` and `/api/auth/post-login-route` would both return their canonical companies and routes correctly. The race short-circuits the API call entirely.

---

## Files audited

### Redirect sources (4 paths to /onboarding/company)
- [components/hooks/useDashboardState.tsx:33-56](../../../components/hooks/useDashboardState.tsx) — primary redirect (firing prematurely; THIS IS THE BUG)
- [pages/api/auth/post-login-route.ts:103-104](../../../pages/api/auth/post-login-service.ts) — server-side route resolution; correct logic, fires only when `user_company_roles` has no active row
- [pages/api/auth/verify-email.ts:152-153](../../../pages/api/auth/verify-email.ts) — post-email-verification routing; correct logic
- [pages/onboarding/domain-verification.tsx:375](../../../pages/onboarding/domain-verification.tsx) — manual link in domain-verification flow; not auto-redirect

### Canonical resolution chain
- [pages/api/company-profile/index.ts](../../../pages/api/company-profile/index.ts) `mode=list` — query: `user_company_roles WHERE user_id=X AND status='active'` → companies join
- [components/CompanyContext.tsx](../../../components/CompanyContext.tsx) — frontend auth-state + companies orchestrator
- [backend/services/authResolver.ts](../../../backend/services/authResolver.ts) — Bearer/cookie → public.users.id resolution
- [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts) — canonical principal resolution

### DB state (verified live)
- `users` (2 active rows; both with valid `supabase_uid` + `name` + `has_password=true`)
- `user_company_roles` (2 rows; both `status='active'`; both with FK MATCH to `users.id`)
- `companies` (2 rows; both `status='active'`; both linked correctly from role rows)

---

## Files created (1)

1. **[architecture-migration/reports/tenant-onboarding-stabilization/tenant-onboarding-stabilization.md](tenant-onboarding-stabilization.md)** — this report.

## Files modified (2)

1. **[components/CompanyContext.tsx](../../../components/CompanyContext.tsx)** — added `companiesResolved` boolean state:
   - `useState(false)` initial
   - `setCompaniesResolved(true)` in `refreshCompanies`'s `finally` block (success OR explicit empty result both mark as resolved; the distinction is "did we ask the server yet")
   - `setCompaniesResolved(false)` in the auth-subscription signout path (resets for next session)
   - Exposed in `CompanyContextValue` type and `useMemo` value
   - Added to dep array of value useMemo

2. **[components/hooks/useDashboardState.tsx](../../../components/hooks/useDashboardState.tsx)** — gated the onboarding redirect on `companiesResolved`:
   - Destructured `companiesResolved` from `useCompanyContext`
   - Added `if (!companiesResolved) return;` guard between `isAuthenticated` check and `companies.length` check
   - Added `companiesResolved` to effect dep array

---

## Canonical tenant-resolution fixes completed

| Layer | Status |
|---|---|
| `auth_session` → principal | ✅ unchanged; canonical resolver works correctly |
| principal → user | ✅ unchanged; `users.id` lookup via `supabase_uid` mirroring |
| user → membership | ✅ unchanged; `user_company_roles WHERE user_id=X AND status='active'` |
| membership → company | ✅ unchanged; FK to `companies.id` |
| company → onboarding state | ✅ unchanged; `users.onboarding_state` consulted in `post-login-route` |
| Frontend redirect gate | ✅ FIXED — now waits for `companiesResolved` before deciding |

The canonical chain itself was correct end-to-end. The fix is purely in the frontend hydration ordering.

## Onboarding dominance fixes completed

The audit confirms a single canonical onboarding authority:
- `users.onboarding_state` for profile completion checks (post-login-route, verify-email, set-password)
- `user_company_roles WHERE status='active'` for membership checks (post-login-route, verify-email, /api/company-profile?mode=list)
- `users.has_password` for password-setup gating

No duplicate truths, no shadow stores. localStorage is used only for `selected_company_id` UX preference (line 119-122 of CompanyContext.tsx), not for onboarding state. No frontend onboarding store or cache exists outside the context.

## Redirect stabilization results

| Scenario | Before fix | After fix |
|---|---|---|
| Existing tenant user reloads `/dashboard` | ✅ companies populated, no redirect | ✅ unchanged |
| Existing tenant user navigates `/onboarding/company` → `/dashboard` (THE BUG) | ❌ redirected back to `/onboarding/company` due to race | ✅ waits for `companiesResolved`; then sees companies>0; no redirect |
| New user signs up, has no company yet | ✅ correctly redirected to `/onboarding/company` | ✅ unchanged (waits for resolved=true with companies=[], then redirects) |
| Logged-out user hits `/dashboard` | ✅ blocked at `!isAuthenticated` gate | ✅ unchanged |
| Hard refresh on `/dashboard` | ✅ initial isLoading=true blocks redirect; refreshCompanies populates | ✅ unchanged + safer (companiesResolved gate adds defense) |
| Deep link to `/dashboard?campaignId=X` | ✅ same as hard refresh | ✅ unchanged |
| Mobile-browser nav restore (background tab → foreground) | depends on auth subscription firing INITIAL_SESSION | ✅ unchanged + safer |

Critical scenario protected: **existing tenant user navigating off an auth-flow page**. New users still onboard correctly because `companiesResolved=true` with `companies.length===0` correctly triggers the redirect to `/onboarding/company` via post-login-route.

---

## Remaining blockers

1. **The fix doesn't address authentication-state-changes-while-on-non-auth-page** edge cases (e.g., session expires mid-page). Existing behavior preserved; the new gate is additive.

2. **`companiesResolved` is reset on `signout` only**. If `refreshCompanies` is called manually (e.g., via `refreshCompanies()` from a child component) and lands a new fetch, it correctly re-marks resolved=true in the finally. No reset needed for the manual-refresh path.

3. **Dev/test environment edge cases** — e.g., if `/api/company-profile` is mocked to never respond, `companiesResolved` stays false and the user is stuck on `/dashboard` waiting forever. This is preferable to the previous behavior (incorrectly redirected to onboarding) because at least it's deterministic and observable.

4. **No new instrumentation added** for this race. The existing console.warn paths in CompanyContext remain.

5. **Other onboarding redirect sites** (`post-login-route`, `verify-email`, domain-verification page) were NOT modified — their logic is correct and they only fire on first sign-up paths where `companies` truly is empty.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -rn "/onboarding/company" --include="*.ts*" pages/ components/ lib/ utils/ hooks/` | enumerate all redirect callsites | 4 sources identified, classified |
| `git ls-files "pages/onboarding*"` | confirm onboarding pages exist | 5 pages: company, domain-verification, phone, profile, verify-phone |
| `mcp__supabase__execute_sql` (count probe across `users` + `user_company_roles` + status filters) | verify DB state | 2 users, 2 active roles, 0 invited / inactive / deactivated; 0 users without active role |
| `mcp__supabase__execute_sql` (FK linkage join) | verify role_user_id ↔ users.id ↔ companies.id | all rows MATCH; both companies active |
| Manual trace of `useDashboardState.tsx:33-56` + `CompanyContext.tsx:346-384` effect ordering | identify the race | confirmed: stale isLoading=false + initial companies=[] in same render before refreshCompanies's setIsLoading(true) commits |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after fix | exit 0 |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Duplicate onboarding authorities | **0** | **0** | 0 |
| Redirect drift paths (premature redirect to onboarding for existing tenants) | **1** (useDashboardState race) | **0** | -1 |
| Broken membership resolutions (DB-side or API-side) | **0** | **0** | 0 |
| Shadow onboarding authorities | **0** | **0** | 0 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch SUPER_ADMIN canonicalization
- ❌ Did not modify platform authority
- ❌ Did not touch bridge deletion
- ❌ Did not refactor unrelated auth architecture
- ❌ Did not rewrite onboarding UX
- ❌ Did not rewrite tenant architecture
- ❌ Did not modify the company model
- ❌ Did not change the canonical resolution chain (auth_session → principal → user → membership → company → onboarding state)
- ❌ Did not change `post-login-route`, `verify-email`, or `set-password` server-side routing logic (correct as-is)

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Add e2e test for the auth-flow → dashboard transition | Prevent regression of this race | 1 test file |
| Audit other consumers of `useCompanyContext` for similar race risks | Find places that read `companies.length === 0` without checking `companiesResolved` | grep + selective refactor |
| Add structured logging when `companiesResolved` gate prevents a redirect | Operational visibility for users hitting the race | 1-line console.debug |
| Review other onboarding entry pages for similar early-return patterns | Belt-and-suspenders | audit-only |
