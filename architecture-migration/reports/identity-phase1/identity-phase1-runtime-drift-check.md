# Identity Phase 1 — Runtime Drift Check (Wave 1)

**Branch:** `identity-spine-consolidation`
**Wave:** 1 of 3
**Date:** 2026-05-07

This document records the grep-based verification that Wave 1's removed authorities are gone from runtime code. Mandatory checks per the implementation prompt. Each result includes the exact command and an assessment.

BEFORE/AFTER snapshot files are committed at:
- `architecture-migration/reports/identity-phase1/grep-snapshots-before/*.txt`
- `architecture-migration/reports/identity-phase1/grep-snapshots-after/*.txt`

---

## Verification 1 — zero `users.role` runtime reads

**Command (production code only):**
```
git grep -nE "(userRow|byEmail|byUid|existingUser|currentUser)\\.role" \
  -- 'pages/**/*.ts' 'pages/**/*.tsx' 'backend/**/*.ts' 'lib/**/*.ts'
```

**Result:** Zero matches.

**Other suspect patterns checked:**
- `git grep -nE "from\\(['\"]users['\"]\\)" ... | grep "select.*\\brole\\b"` → zero `users` SELECTs include `role`.
- `git grep -nE "\\.eq\\(['\"]role['\"]" ... ` against `from('users')` chains → zero.

**Surviving non-deprecated `.role` references in production code:** `user.role` in `backend/services/userContextService.ts:111` (a derived field already computed from `user_company_roles` upstream — see line 46-49 of the same file), Playwright `candidate.role` in `backend/services/rpaWorker/selectorResolver.ts` (unrelated DOM accessibility role), `user.role` in `pages/admin/users.tsx:213` (display field on an API response that comes from `user_company_roles` via `userManagementService.listUsers`).

---

## Verification 2 — zero `users.company_id` runtime reads

**Command:**
```
git grep -nE "(userRow|byEmail|byUid|existingUser|currentUser|user)\\.company_id" \
  -- 'pages/**/*.ts' 'pages/**/*.tsx' 'backend/**/*.ts' 'lib/**/*.ts'
```

**Result:** Zero matches against user-shaped objects.

**Surviving reference**: a doc-comment in `pages/api/blog/[slug]/campaign-signal.ts:8` was updated during Wave 1 to refer to `active_company_id` instead.

**Other suspect patterns:**
- SELECTs including `company_id` from `users`: 0.
- UPDATEs including `company_id: ...` against `from('users')`: 0.
- `users(company_id)` Supabase nested-relation joins: 0 (the 5 community-ai endpoints + `communityAiForecastInsightsService` were migrated to `users(active_company_id)`).

---

## Verification 3 — zero `firebase_uid` references in production code

**Command:**
```
git grep -n "firebase_uid\|firebaseUid" \
  -- ':(exclude)architecture-migration/' \
     ':(exclude)supabase/migrations/' \
     ':(exclude)*.md' \
     ':(exclude)database/'
```

**Result:** 2 matches — both in a single justification comment in `pages/api/company/users.ts:375-376` documenting why the auto-add-without-invite branch was removed. Allowed under the spec's "explicit deprecated comments" exception.

**Excluded from the check (intentional):**
- `architecture-migration/reports/**` — Phase 1 audit reports document the removal history.
- `supabase/migrations/**` — historical migration files (the column drop migration itself, plus pre-drop migrations).
- `*.md` documentation.
- `database/**` — `database/free-credits-schema.sql`'s `firebase_uid` line was REMOVED as part of Wave 1 Task 5.

**Database state**: column still exists on `auth_audit_logs.firebase_uid` and `free_credit_profiles.firebase_uid`. DROP migrations deferred to Wave 2/3 (column-on-table remains, no INSERT writes from production code).

---

## Verification 4 — zero duplicate auth resolvers

**Command:**
```
git grep -n "auth\\.getUser\\|supabase\\.auth\\.getUser" \
  -- 'pages/**/*.ts' 'backend/**/*.ts' 'lib/**/*.ts'
```

**Sites that call `supabase.auth.getUser` directly (post-Wave-1):**

| File | Line | Reason |
|---|---|---|
| `backend/services/authResolver.ts` | 130-141 (inside `validateTokenWithSupabase`) | The canonical token-validation site. ALL other sites delegate here. |
| `pages/api/auth/verify-email.ts` | 52 | Re-validates the Bearer token specifically when `getSupabaseUserFromRequest` returned null — used to authoritatively confirm the token is valid before INSERTing the missing `users` row. (Required for the row-creation backstop; documented in code.) |
| `pages/api/auth/set-password.ts` | 35 | Re-fetches `auth.users.id` from the Bearer token after `getSupabaseUserFromRequest` returned a public.users.id — needed because `auth.admin.updateUserById(authUserId, ...)` requires `auth.users.id`, not `users.id`. |

The remaining call sites are intentional (each documents why) and do NOT duplicate the resolver's full pipeline. They specifically need to hit `auth.getUser` again with a different argument or for a different purpose.

**Cookie token extraction (`extractCookieToken`)**: 1 implementation, in `backend/services/authResolver.ts`. Pre-Wave-1 had a duplicate in `backend/services/supabaseAuthService.ts` — eliminated.

**UID-backfill logic (`users.update({ supabase_uid })`)**: 1 implementation, in `backend/services/authResolver.ts:resolveUserRow`. Pre-Wave-1 had duplicates in 3 places. The remaining `users.update({ supabase_uid })` in `pages/api/auth/sync-supabase-user.ts` is the bootstrap-time SET (initial population, not back-fill — it runs against rows that don't yet have a UID).

**Dev JWT-claims fallback**: 0 matches for `decodeJwtClaims` in production code. Removed entirely.

---

## Verification 5 — zero duplicate role resolvers

**Command:**
```
git grep -nE "from\\(['\"]user_company_roles['\"]\\).*\\.eq\\(['\"]role['\"]" \
  -- 'pages/**/*.ts' 'backend/**/*.ts' 'lib/**/*.ts'
```

**Note:** Wave 1 explicitly **deferred** consolidating `isSuperAdmin` and `isPlatformSuperAdmin` (the two identical-bodied helpers in `backend/services/rbacService.ts`) to Wave 3, because Task 7 (super-admin authority normalization) is the natural place for that cleanup. They co-exist in this Wave 1 state.

**Per-call-site role lookups**: each authorization site queries `user_company_roles` independently (e.g., `requireCompanyAccess`, `requireSuperAdmin`, `enforceRole`). Wave 2 (Task 3) will introduce a centralized `resolveActiveCompanyRole(userId, activeCompanyId)`.

---

## Additional verifications (mandatory checks per implementation prompt)

### `grep -R "users.role"`

```
git grep -nE "users\\.role|\\busers\\b.*role" -- 'pages/**/*.ts' 'pages/**/*.tsx' 'backend/**/*.ts' 'lib/**/*.ts'
```

Surviving in production code (NON-deprecated):
- Documentation strings and comments (e.g., spec references in JSDoc).
- The `users` table referenced in audit-log payloads.
- The `users` value rendered in admin UI from API response (already canonical-sourced).

No `users.role` SELECTs or `users.update({ role })` writes remain.

### `grep -R "users.company_id"`

Same — no SELECTs/writes. Only doc references, the `pages/api/blog/[slug]/campaign-signal.ts` comment (now corrected to `active_company_id`), and the test-harness mock at `backend/tests/integration/communityAiTestHarness.ts:183-187` (test-only, not production).

### `grep -R "firebase_uid"`

See Verification 3. Two surviving lines, both in a justification comment.

### `grep -R "content_architect_session"`

Per Wave 3 plan — these survive intentionally in Wave 1:
- `backend/services/contentArchitectService.ts` (cookie reader)
- `pages/api/super-admin/content-architect-login.ts` (cookie writer)
- `pages/api/super-admin/login.ts` (clears the cookie)
- `pages/api/super-admin/logout.ts` (clears the cookie)
- `proxy.ts` (middleware dispatch)
- `backend/services/rbacService.ts:238-240` (`userId === 'content_architect'` mapping)
- ~10 super-admin endpoints accepting the cookie for super-admin-equivalent auth

Wave 3 (Task 7) will remove these per the consolidation plan.

### `grep -R "super_admin_session"`

Per Wave 3 plan — these survive intentionally in Wave 1:
- `backend/services/superAdminSession.ts` (cookie reader)
- `pages/api/super-admin/login.ts` (cookie writer, env-credential auth)
- `pages/api/super-admin/logout.ts` (clears)
- `pages/api/super-admin/content-architect-login.ts` (clears)
- ~10 super-admin endpoints accepting the cookie for super-admin-equivalent auth

Wave 3 will remove these AFTER provisioning a canonical `user_company_roles` SUPER_ADMIN row (the user's confirmation #1 prerequisite).

---

## Summary

| Check | Required outcome | Wave 1 outcome | Status |
|---|---|---|---|
| zero `users.role` runtime reads | yes | confirmed | ✅ |
| zero `users.company_id` runtime reads | yes | confirmed | ✅ |
| zero `firebase_uid` references | yes (excl. justification comment per spec) | confirmed | ✅ |
| zero duplicate auth resolvers | yes | confirmed (one canonical, three documented adapters) | ✅ |
| zero duplicate role resolvers | yes — deferred to Wave 3 | not yet | DEFERRED to Wave 3 (Task 7) |

Surviving deprecated-authority surfaces (cookie super-admin, content-architect, `profiles.is_super_admin`, `auth_audit_logs.firebase_uid` column) are explicitly scoped to Wave 2 / Wave 3 per the consolidation plan and are documented in [identity-phase1-final-authority-map.md](identity-phase1-final-authority-map.md).
