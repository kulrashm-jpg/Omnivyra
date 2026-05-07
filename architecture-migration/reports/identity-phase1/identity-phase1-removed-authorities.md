# Identity Phase 1 — Removed Authorities (Wave 1)

**Branch:** `identity-spine-consolidation`
**Wave:** 1 of 3
**Date:** 2026-05-07
**Source-grounded.** Every removal cites file:line.

This document inventories every authority, read path, write path, and dead path removed during Wave 1. Wave 2 (centralized role resolution, invitation hardening, deletion orchestration, invariants) and Wave 3 (super-admin authority normalization, content-architect normalization) are tracked separately.

---

## Removed authorities

### 1. `users.role` — removed as runtime authority

**Status:** Column not yet dropped from DB (Wave 2/3 migration). All runtime reads + writes eliminated.

| Removal | File | Pre-Wave-1 | Post-Wave-1 |
|---|---|---|---|
| Read in routing fast-path | [pages/api/auth/post-login-route.ts:45,72](pages/api/auth/post-login-route.ts) | `select('..., role, ...')` + cached fast-path | Selected columns reduced; role derived from `user_company_roles` |
| Read in pre-signup gate | [pages/api/auth/signup.ts:91,110](pages/api/auth/signup.ts) | `Boolean(...role) && Boolean(...company_id) && companyRole` | Active row in `user_company_roles` is the sole signal |
| Read in resume-status state machine | [pages/api/auth/resume-status.ts:36,46](pages/api/auth/resume-status.ts) | Same combined gate | Same migration |
| Read for super-admin gate | [pages/api/admin/feedback.ts:19](pages/api/admin/feedback.ts) | `.eq('role','SUPER_ADMIN')` against users | `isPlatformSuperAdmin` (canonical RBAC helper) |
| Read for super-admin notification recipients | [pages/api/credits/earn/feedback.ts:78-94](pages/api/credits/earn/feedback.ts) | `.from('users').eq('role','SUPER_ADMIN')` | `.from('user_company_roles').eq('role','SUPER_ADMIN')` |
| Write on bootstrap | [pages/api/auth/sync-supabase-user.ts:752-759](pages/api/auth/sync-supabase-user.ts) | `update({ company_id, active_company_id, role: 'COMPANY_ADMIN', ... })` | `update({ active_company_id, onboarding_state, updated_at })` |
| Write on onboarding completion | [pages/api/onboarding/complete.ts:299-302](pages/api/onboarding/complete.ts) | `update({ company_id, role, onboarding_state })` | `update({ active_company_id, onboarding_state })` |
| Write on setup-company invite-accept path | [pages/api/onboarding/setup-company.ts:163-166](pages/api/onboarding/setup-company.ts) | `update({ company_id })` | `update({ active_company_id })` |
| Write on setup-company access-request path | [pages/api/onboarding/setup-company.ts:195-198](pages/api/onboarding/setup-company.ts) | `update({ company_id, role, onboarding_state })` | `update({ active_company_id, onboarding_state })` |
| Write on setup-company domain-match join | [pages/api/onboarding/setup-company.ts:323-327](pages/api/onboarding/setup-company.ts) | `update({ company_id })` | `update({ active_company_id })` |
| Write on setup-company self-create | [pages/api/onboarding/setup-company.ts:404-407](pages/api/onboarding/setup-company.ts) | `update({ company_id, role, onboarding_state })` | `update({ active_company_id, onboarding_state })` |
| Write on team-invite acceptance | [pages/api/team/accept-invite.ts:147-151](pages/api/team/accept-invite.ts) | `update({ company_id, role: invitation.role })` | `update({ active_company_id })`; role lives in `user_company_roles` |
| Write in PATCH /api/company/users/[userId]/role | [pages/api/company/users/[userId]/role.ts:110-113](pages/api/company/users/[userId]/role.ts) | `update({ role: desiredRole })` | Removed; canonical write at line 123 (`upsertUserCompanyRole`) is sole role write |
| Back-fill UPDATE on every post-login route call | [pages/api/auth/post-login-route.ts:104-112](pages/api/auth/post-login-route.ts) | Cached `users.role` + `users.company_id` from `user_company_roles` | Removed entirely |

### 2. `users.company_id` — removed as runtime authority

| Removal | File | Pre-Wave-1 | Post-Wave-1 |
|---|---|---|---|
| Read in routing fast-path | [pages/api/auth/post-login-route.ts:45,71](pages/api/auth/post-login-route.ts) | Cached fast-path before falling back to `user_company_roles` | Always queries `user_company_roles`; no fast-path |
| Read in resume-status | [pages/api/auth/resume-status.ts:36,45](pages/api/auth/resume-status.ts) | Combined `company_id && role` gate | Replaced with `user_company_roles` active-row check |
| Read in pre-signup duplicate-account gate | [pages/api/auth/signup.ts:91,109](pages/api/auth/signup.ts) | Same | Same |
| Read for membership check in PATCH role | [pages/api/company/users/[userId]/role.ts:97-108](pages/api/company/users/[userId]/role.ts) | `existing.company_id !== companyId` | `user_company_roles` membership lookup |
| Read for "primary company set" gate | [pages/api/team/accept-invite.ts:91,146](pages/api/team/accept-invite.ts) | `if (!userRow.company_id) write` | `if (!userRow.active_company_id) write active_company_id` |
| Read in scheduled_posts join (5 community-ai endpoints) | [pages/api/community-ai/{forecast,insights,trends,content-kpis}.ts](pages/api/community-ai), [backend/services/communityAiForecastInsightsService.ts:75-77](backend/services/communityAiForecastInsightsService.ts) | `users(company_id)` + `eq('scheduled_posts.users.company_id', org)` | `users(active_company_id)` + `eq('scheduled_posts.users.active_company_id', org)` |
| (All `users.company_id` writers above also removed) | — | — | — |

### 3. `firebase_uid` — removed from runtime production code

Column was dropped in [supabase/migrations/20260407_drop_firebase_uid.sql:10-16](supabase/migrations/20260407_drop_firebase_uid.sql#L10-L16) on 2026-04-07. Wave 1 removed the remaining production source references that survived the migration:

| File | Line | Pre-Wave-1 | Post-Wave-1 |
|---|---|---|---|
| pages/api/super-admin/users.ts | 724 | `.select('id, supabase_uid, firebase_uid')` in DELETE handler | `.select('id, supabase_uid')` |
| pages/api/super-admin/users.ts | 82,717,721,733 | Stale comments | Refreshed to point at `supabase_uid` |
| pages/api/company/users.ts | 99-111 | `findExistingUserByEmail` SELECTed `firebase_uid` | Function deleted (no other callers) |
| pages/api/company/users.ts | 246-282 | `addExistingUserToCompany` (gated on `firebase_uid` truthy) | Function deleted (gate permanently false; the dead branch at line 430 was the only caller) |
| pages/api/company/users.ts | 419,428-441 | Dead branch + comment | Removed; replaced with documentation comment explaining removal |
| backend/middleware/authMiddleware.ts | 27-28, 85 | `AuthUser.firebaseUid` field with stale "interface compat" comment | Renamed to `AuthUser.supabaseUid`; no consumers of the old name existed |
| lib/auth/auditLog.ts | 38, 53, 65 | `firebaseUid` param + `firebase_uid` INSERT field on `auth_audit_logs` | Removed from `logAuthEvent` signature and INSERT payload |
| backend/services/userManagementService.ts | 51 | Stale "firebase_uid will be populated" comment | Refreshed to `supabase_uid` via `sync-supabase-user` |
| lib/auth/rateLimit.ts | 258 | "Applied AFTER Firebase token verification, keyed by firebaseUid" | "Applied AFTER Supabase token verification, keyed by supabaseUid" |
| database/free-credits-schema.sql | 18 | `firebase_uid text` column in schema source | Removed (DB column drop is a Wave 2/3 migration) |

**Surviving production reference**: only the justification comment at `pages/api/company/users.ts:375-378` documenting why the auto-add-without-invite branch was removed. This is allowed under the spec's "explicit deprecated comments" exception.

**Deferred to a follow-up migration:**
- `auth_audit_logs.firebase_uid` column (and its index) per [supabase/migrations/20260323_auth_audit_logs.sql:18](supabase/migrations/20260323_auth_audit_logs.sql#L18) — column still exists; the production INSERT no longer references it.
- `free_credit_profiles.firebase_uid` column — still exists (verified via DB query); the schema-source file no longer declares it.

---

## Removed read paths

| Read path | Site of read | Replacement (canonical authority) |
|---|---|---|
| `users.role` SELECT in 6 sites above | listed above | `user_company_roles.role` per (user_id, company_id) |
| `users.company_id` SELECT in 6 sites above | listed above | `users.active_company_id` for "primary org" or `user_company_roles` for "membership" |
| `users.firebase_uid` SELECT in 2 sites | super-admin/users.ts:724, company/users.ts (deleted function) | `users.supabase_uid` |
| `auth.users` token validation duplicated across 3 helpers | `verifySupabaseAuthHeader`, `getSupabaseUserFromRequest`, `requireAuth` | Single call site in `backend/services/authResolver.ts` `validateTokenWithSupabase` |
| Cookie token extraction logic (3 cookie patterns) duplicated in supabaseAuthService | extractCookieToken in supabaseAuthService.ts | Centralized in `backend/services/authResolver.ts` |
| Dev JWT-claims fallback bypass | `decodeJwtClaims` + the `process.env.NODE_ENV === 'development'` branch in supabaseAuthService.ts | Removed entirely (per spec: "NO dev fallback auth bypass") |
| UID-backfill logic duplicated in 3 places | sync-supabase-user.ts (still has it for first-create), supabaseAuthService.ts, authMiddleware.ts | Centralized in `backend/services/authResolver.ts` `resolveUserRow`. Legacy facades delegate. |

---

## Removed write paths

| Write path | Site of write | Replacement |
|---|---|---|
| `users.role` UPDATE × 6 sites | listed above | Removed; canonical write is `user_company_roles.role` |
| `users.company_id` UPDATE × 7 sites | listed above | `users.active_company_id` UPDATE |
| `users.role` + `users.company_id` back-fill UPDATE on every post-login | post-login-route.ts:104-112 | Removed entirely |
| `users.firebase_uid` writes (none in production code) | — | — (column was already write-frozen by [20260331_firebase_uid_immutable.sql](supabase/migrations/20260331_firebase_uid_immutable.sql) and dropped in 20260407) |
| `auth_audit_logs.firebase_uid` INSERT | lib/auth/auditLog.ts:65 | Removed from INSERT payload (column still exists in DB) |

---

## Deleted dead paths

### 1. `addExistingUserToCompany` branch in `pages/api/company/users.ts`

**State pre-Wave-1**: gated on `existingUser.firebase_uid` truthy. Column was dropped 2026-04-07. Gate permanently false.

**Action**: deleted the entire dead branch (lines 428-441), the unreachable function `addExistingUserToCompany` (lines 246-282), and its only data-source helper `findExistingUserByEmail` (lines 96-111, which selected `firebase_uid` and would have errored at runtime).

**Replacement**: invite flow always issues an invitation now. Behavior unchanged for callers because the dead branch was never reachable.

### 2. `verifyAuthHeader` legacy alias in `lib/auth/serverValidation.ts`

**State pre-Wave-1**: exported alias for `verifySupabaseAuthHeader`. Zero consumers.

**Action**: deleted the export entirely.

### 3. `decodeJwtClaims` + dev-only fallback in `backend/services/supabaseAuthService.ts`

**State pre-Wave-1**: when `supabase.auth.getUser` timed out in dev, the helper would extract `sub`/`email` from the JWT claims directly (no signature verification). This was a development-only soft-bypass.

**Action**: deleted entirely. The new resolver hard-fails closed on token-validation failure.

### 4. `verify-email.ts` schema-version fallbacks

**State pre-Wave-1**:
- INSERT path retried without `supabase_uid` if the column was missing.
- SELECT path retried with only `name` if the new columns didn't exist.

**Reason for removal**: both were guards for a schema state pre-2026-04-06 (before [20260406_multi_tenant_auth_migration.sql](supabase/migrations/20260406_multi_tenant_auth_migration.sql) added the columns). Unreachable on current schema.

**Action**: deleted both fallback branches.

### 5. `AuthUser.firebaseUid` interface field in `backend/middleware/authMiddleware.ts`

**State pre-Wave-1**: field carried the supabase_uid value with a "kept for interface compatibility" comment. Zero consumers read the field.

**Action**: renamed to `supabaseUid` (matches the actual semantic).

### 6. `verifyAuthHeader` (separate from `verifySupabaseAuthHeader`)

Already covered in #2.

---

## Surviving compatibility shims (explicitly documented)

Per the spec's "NO compatibility writebacks except explicitly documented temporary bridge" — the following three shims are explicitly documented and isolated to a single line of delegation each:

| Shim | File | What it adapts | Rationale |
|---|---|---|---|
| `verifySupabaseAuthHeader(authHeader)` | lib/auth/serverValidation.ts | Bearer-only token validation, throws on failure (legacy contract) | 12 callers; some operate before a `public.users` row exists (e.g., sync-supabase-user) and cannot use the full resolver |
| `getSupabaseUserFromRequest(req)` | backend/services/supabaseAuthService.ts | Returns `{user: {id, email}, error}` shape | 10 callers; preserved to avoid 30+ call-site mass-renames in this commit |
| `requireAuth(req, res)` | backend/middleware/authMiddleware.ts | Sends 401 + returns null on failure; returns `{user: AuthUser}` on success | 4 callers; convenience wrapper |

All three delegate to `resolveAuthenticatedUser` in `backend/services/authResolver.ts` — the canonical resolver. ZERO duplicated logic across them: no duplicate token validation, no duplicate cookie extraction, no duplicate UID backfill, no duplicate soft-delete check.

A future Wave 1 follow-up commit (or Wave 2) will migrate the call sites to import `resolveAuthenticatedUser` directly and delete the three shims.

---

## Wave 1 commit log

```
6f9fb6d9  identity Wave 1 / Tasks 4+8 — auth resolver consolidation + dead-path sweep
2bccbcca  identity Wave 1 / Tasks 1+2 — remove deprecated users.role / users.company_id reads & writes
7a69a3c1  identity Wave 1 / Task 5 — remove firebase_uid remnants
df0a1...  Phase 1 identity-spine audit reports
```

---

## What Wave 1 did NOT remove (intentionally deferred)

- **Cookie super-admin authority** (`super_admin_session=1`, `content_architect_session=1`) → Wave 3 (Task 7).
- **`profiles.is_super_admin` parallel super-admin column** → Wave 3.
- **`isSuperAdmin` / `isPlatformSuperAdmin` duplicate-body cleanup** in `backend/services/rbacService.ts` → Wave 3.
- **DB column drops** (`users.company_id`, `users.role`, `auth_audit_logs.firebase_uid`, `free_credit_profiles.firebase_uid`) → migration in Wave 2 or post-Wave-3.
- **Migration of 30+ legacy-facade callers** to import `resolveAuthenticatedUser` directly → bookkeeping cleanup post-Wave-3.
- **`users.signup_source`** zero-writer column → bookkeeping; harmless.
