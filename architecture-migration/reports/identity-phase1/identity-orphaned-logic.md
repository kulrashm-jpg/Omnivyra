# Identity Orphaned Logic — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.** Every orphan claim cites file:line.

This document inventories orphaned, stale, or unreachable identity logic. Includes Firebase remnants after the column drop, dead branches gated on impossible conditions, deprecated-but-active paths, and duplicate reconciliation logic.

---

## 1. Firebase remnants after `firebase_uid` column drop

The column was dropped in [20260407_drop_firebase_uid.sql:10-16](supabase/migrations/20260407_drop_firebase_uid.sql#L10-L16):
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_firebase_uid_unique;
DROP INDEX IF EXISTS users_firebase_uid_key;
ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid;
```

Trail of column changes:
1. Added in [20260331_auth_columns.sql:46](supabase/migrations/20260331_auth_columns.sql#L46) with partial UNIQUE index `users_firebase_uid_key WHERE firebase_uid IS NOT NULL`.
2. Immutability trigger in [20260331_firebase_uid_immutable.sql:18-42](supabase/migrations/20260331_firebase_uid_immutable.sql#L18-L42).
3. Promoted to full UNIQUE in [20260401_firebase_uid_full_unique.sql:24-25](supabase/migrations/20260401_firebase_uid_full_unique.sql#L24-L25).
4. Constraint, index, and column dropped together in 20260407.

### Remaining production references (column does NOT exist in current schema)

| File | Line | Reference | Effect at runtime |
|---|---|---|---|
| [pages/api/super-admin/users.ts](pages/api/super-admin/users.ts) | 725 | `.select('id, supabase_uid, firebase_uid')` in DELETE handler | **Will fail at runtime** with PG error `column "firebase_uid" does not exist`. Mitigation: line 734-736 only consumes `supabase_uid` from the result, but the SELECT itself will error. |
| [pages/api/company/users.ts](pages/api/company/users.ts) | 106 | `.select('id, email, firebase_uid, is_deleted, created_at')` in `findExistingUserByEmail` | **Will fail at runtime**. `findExistingUserByEmail` returns null on every existing-user lookup → every invite goes through the email path even if a user exists. |
| [pages/api/company/users.ts](pages/api/company/users.ts) | 432 | `if (existingUser && (existingUser as any).firebase_uid) { addExistingUserToCompany... }` | **Always false** (column absent). Lines 434-442 — the auto-add-without-invite branch — are unreachable code. |
| [backend/domain/from-lib/auth/auditLog.ts](backend/domain/from-lib/auth/auditLog.ts) | 16-19 | Type definition includes `firebase_uid?: string \| null` in `AuthAuditEvent` payload | Stale type — no caller passes the field. |
| [backend/domain/from-lib/auth/auditLog.ts](backend/domain/from-lib/auth/auditLog.ts) | 28 | Body includes `firebase_uid: opts.firebaseUid ?? null` | Insert payload includes the column. |
| [backend/domain/from-lib/auth/auditLog.ts](backend/domain/from-lib/auth/auditLog.ts) | 53 | Insert call writes `firebase_uid` to `auth_audit_logs` | **`auth_audit_logs.firebase_uid` column DOES still exist** per [20260323_auth_audit_logs.sql:18](supabase/migrations/20260323_auth_audit_logs.sql#L18) — was NOT dropped in 20260407. Insert succeeds writing `null`. Schema is inconsistent with the rest of the system. |
| [supabase/migrations/20260323_auth_audit_logs.sql](supabase/migrations/20260323_auth_audit_logs.sql) | 18 | `auth_audit_logs.firebase_uid` column with own index | Schema artifact never cleaned up. |
| [supabase/migrations/20260323_email_reuse_policy.sql](supabase/migrations/20260323_email_reuse_policy.sql) | 6-8 | Comment references `/api/auth/sync-firebase-user` (file does not exist — see Section 6) | Stale comment. |
| [pages/api/super-admin/users.ts](pages/api/super-admin/users.ts) | 48 | Comment: "Never calls supabase.auth — identity is established by Firebase on first sign-in" | Stale comment — identity is now Supabase. |

---

## 2. Stale migration assumptions

### 2.1 `users.company_id` is "frozen" — but actively written

[20260406_multi_tenant_auth_migration.sql:58-64](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L58-L64) declares:
```sql
COMMENT ON COLUMN users.company_id IS 'Deprecated. Frozen, no longer updated. Use users.active_company_id.';
```

But the column is written by **6+ production paths** (see [identity-write-surface-map.md](identity-write-surface-map.md)):
- [sync-supabase-user.ts:754](pages/api/auth/sync-supabase-user.ts#L754)
- [post-login-route.ts:108-113](pages/api/auth/post-login-route.ts#L108-L113)
- [team/accept-invite.ts:151](pages/api/team/accept-invite.ts#L151)
- [onboarding/complete.ts:302](pages/api/onboarding/complete.ts#L302)
- [onboarding/setup-company.ts:166,325,404](pages/api/onboarding/setup-company.ts)

The "frozen" assumption from the migration comment is **false at runtime**.

### 2.2 `signup_intents` is the canonical pre-signup state — but never DELETEd

[20260406:](supabase/migrations/20260406_multi_tenant_auth_migration.sql) creates `signup_intents` with `expires_at` column. No production code deletes expired rows. No background job cleans them up.

### 2.3 `usage_meter_monthly` and `usage_threshold_alerts` provenance unclear

These tables live at [database/usage_meter.sql:4](database/usage_meter.sql#L4) and [database/usage_alerts.sql:4](database/usage_alerts.sql#L4) — NOT in `supabase/migrations/`. They are referenced by RLS coverage in [supabase/migrations/20260403_enable_rls_all_tables.sql](supabase/migrations/20260403_enable_rls_all_tables.sql) — implying they ARE applied somewhere, but the apply mechanism is not migration-driven.

### 2.4 `20260320_domain_eligibility.sql` is a single byte

The file content is a single character `r`. The actual table creation for `domain_eligibility_cache` is referenced as `ALTER TABLE` in [20260320_free_credits_admin.sql:50-61](supabase/migrations/20260320_free_credits_admin.sql#L50-L61), implying creation is elsewhere (possibly the `20260320_domain_eligibility_patch.sql` or the original of the broken file). Schema drift risk between environments.

### 2.5 `users.signup_source` column never written

Added in [20260406:55-56](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L55-L56). Grep across `pages/` and `backend/` returns zero writers. The column exists but is unused.

---

## 3. Unreachable guards

### 3.1 Backstop user-row creation in `verify-email.ts`

[verify-email.ts:50-83](pages/api/auth/verify-email.ts#L50-L83) — when `getSupabaseUserFromRequest` returns no user, the handler INSERTs a `users` row directly. This duplicates `sync-supabase-user.ts`'s responsibility. In normal flow, `sync-supabase-user.ts` runs BEFORE `verify-email.ts` (per the callback orchestration), so the !user branch is rarely hit.

The fallback at [verify-email.ts:70-75](pages/api/auth/verify-email.ts#L70-L75) handles the case when the `supabase_uid` column doesn't exist — but the column was added in [20260406_multi_tenant_auth_migration.sql:31-33](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L31-L33) and is NOT NULL implicit (or partial UNIQUE-indexed). On current schema, the fallback is unreachable.

### 3.2 `addExistingUserToCompany` branch in company/users.ts

[company/users.ts:432-442](pages/api/company/users.ts#L432-L442) — gated on `(existingUser as any).firebase_uid` being truthy. Column was dropped (Section 1) and was never repopulated. Branch is unreachable.

Lines 248-284 (`addExistingUserToCompany` definition) become dead code — the function is defined but never called.

### 3.3 `auth_user_confirmed` RPC — provenance unverified

Referenced at:
- [signup.ts:139](pages/api/auth/signup.ts#L139)
- [login.ts:53](pages/api/auth/login.ts#L53)
- [magic-link.ts:52](pages/api/auth/magic-link.ts#L52)
- [sync-supabase-user.ts:149](pages/api/auth/sync-supabase-user.ts#L149) (Note: this RPC reference may also be `auth_user_has_password` — both are present in this file)

`grep -r 'CREATE OR REPLACE FUNCTION auth_user_confirmed' supabase/migrations/` returned no hits. Either the RPC is defined in a migration that wasn't reviewed, or it doesn't exist in the migrations directory. If absent in production DB:
- All `RESUME_SIGNUP` orphan-detection branches silently degrade to `INVALID_CREDENTIALS` paths.
- The `signup.ts` at [signup.ts:138-152](pages/api/auth/signup.ts#L138-L152) wraps the call in error tolerance — silent failure.

### 3.4 Soft-delete check on UID-match before email-match in sync

[sync-supabase-user.ts:106-136](pages/api/auth/sync-supabase-user.ts#L106-L136) checks `is_deleted` first by UID, then by email. The two checks are independent: a user soft-deleted under UID `A` could in principle have a different `users` row matched by email after UID is back-filled. In practice this can't happen because of the UNIQUE constraints, but the code path defensively double-checks.

### 3.5 `supabase_uid` column-missing fallback in verify-email.ts

[verify-email.ts:65-75](pages/api/auth/verify-email.ts#L65-L75):
```typescript
let insertResult = await supabase.from('users').insert({ supabase_uid, ... });
if (insertResult.error?.message?.includes('supabase_uid')) {
  insertResult = await supabase.from('users').insert({ email, ... });
}
```

The `supabase_uid` column was added in [20260406:31-33](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L31-L33). The fallback path assumes a schema version where the column doesn't exist — pre-2026-04-06. Unreachable on current schema.

---

## 4. Impossible conditions

### 4.1 Magic-link blocked from creating users — except via accept-invite

[magic-link.ts:11](pages/api/auth/magic-link.ts#L11) (comment): "Magic link is login-only; signup requires a password."

But [accept-invite.ts:99-106](pages/api/auth/accept-invite.ts#L99-L106) calls `signInWithOtp({ shouldCreateUser: true })`. The two policies are reconciled by accept-invite being the only entry point that bypasses login-only. A user who clicks an OTP from elsewhere (e.g., a test fixture or attacker-controlled link) with `shouldCreateUser: true` cannot reach `accept-invite.ts` without a valid invitation token.

### 4.2 Recovery flow gate against passwordless users

[set-password.ts:46-48](pages/api/auth/set-password.ts#L46-L48):
```typescript
if (flow === 'recovery' && !(currentUser as any)?.has_password) {
  return res.status(400).json({ error: 'INVALID_RECOVERY_FLOW' });
}
```

A user with `has_password=false` cannot complete password recovery. They must use magic-link. UI surfaces the error string raw at [set-password.tsx:113-114](pages/auth/set-password.tsx#L113-L114) — no in-band guidance to switch flows.

### 4.3 Post-login route routing on `verified` state

[post-login-route.ts:62-92](pages/api/auth/post-login-route.ts#L62-L92) routes users with `onboarding_state ∈ {'verified', 'pending_verification'}` to `/onboarding/profile`. But the standard sync flow advances state to `'company_complete'` BEFORE post-login is called. So this branch is hit only on:
- Free-email users who never reach `bootstrapCompanyFromSignupIntent` (skips at line 427-428).
- Domain-claimed users (skips at line 437-461).
- Invited users (skips at line 402-410).

For these users, `onboarding_state` remains `'verified'` and `/onboarding/profile` is the destination.

---

## 5. Deprecated-but-active paths

### 5.1 `users.company_id` (Section 2.1)

### 5.2 Partial UNIQUE on `free_credit_claims WHERE category='initial'`

[20260322_domain_credit_hardening.sql:22-24](supabase/migrations/20260322_domain_credit_hardening.sql#L22-L24) creates a UNIQUE index `WHERE category='initial'`.

[20260322_domain_level_credit_enforcement.sql:53-60](supabase/migrations/20260322_domain_level_credit_enforcement.sql#L53-L60) creates another UNIQUE index `WHERE category='initial' AND domain IS NOT NULL`.

But [initialFreeCreditService.ts:28](backend/services/initialFreeCreditService.ts#L28) writes `category='initial_free_credit'` — neither UNIQUE index ever fires. The migration's intent (DB-enforced single initial grant per org) is silently inactive.

### 5.3 DB seed `('initial', 300, 14, true)` in `free_credit_config`

[20260322_domain_credit_hardening.sql:38](supabase/migrations/20260322_domain_credit_hardening.sql#L38) seeds the row with category `'initial'` and amount 300/14d.

[initialFreeCreditService.ts:58-62](backend/services/initialFreeCreditService.ts#L58-L62) queries `WHERE category=INITIAL_FREE_CREDIT_CATEGORY` (= `'initial_free_credit'`). Lookup misses; hardcoded fallback 50/14 ([initialFreeCreditService.ts:29-30](backend/services/initialFreeCreditService.ts#L29-L30)) kicks in.

UI advertises "300 free credits" at [create-account.tsx:273](pages/create-account.tsx#L273). System grants 50.

### 5.4 `super_admin_session=1` cookie

Set by [super-admin/login.ts:24](pages/api/super-admin/login.ts#L24). Accepted by every super-admin write endpoint as super-admin equivalent. Not accepted by [/api/super-admin/session.ts:18](pages/api/super-admin/session.ts#L18). Env-credential, no MFA, no rotation, no audit identity binding ([free-credits/grant.ts:55](pages/api/super-admin/free-credits/grant.ts#L55) sets `granted_by=null` for cookie sessions).

### 5.5 `content_architect_session=1` cookie

Per [contentArchitectService.ts:5-9](backend/services/contentArchitectService.ts#L5-L9) the original intent was platform-level access to all companies' content. But the cookie is also accepted as super-admin-equivalent for credit grants ([free-credits/grant.ts:21](pages/api/super-admin/free-credits/grant.ts#L21)) and purchase completion ([purchases/complete.ts:25](pages/api/super-admin/purchases/complete.ts#L25)). And [rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240) maps the literal user_id `'content_architect'` to `Role.COMPANY_ADMIN` of any company. Scope creep beyond the original purpose.

---

## 6. Stale references to non-existent files

### 6.1 `/api/auth/sync-firebase-user`

Referenced in:
- [supabase/migrations/20260323_email_reuse_policy.sql:6-8](supabase/migrations/20260323_email_reuse_policy.sql#L6-L8) — comment

`Glob 'pages/api/auth/sync-firebase-user*'` returns no files. The actual sync handler is `sync-supabase-user.ts`.

### 6.2 `pages/settings/security` and `pages/settings/account`

Implied by general convention but `Glob 'pages/settings/security*'` and `Glob 'pages/settings/account*'` return no files. The only settings pages are:
- [pages/settings/company-admin-access.tsx](pages/settings/company-admin-access.tsx)
- [pages/settings/integrations.tsx](pages/settings/integrations.tsx)

There is no in-app password-change or session-management UI.

### 6.3 `pages/api/account/*` namespace

`Glob 'pages/api/account/**'` returns no files. There is no account-self-service API namespace.

---

## 7. Duplicate reconciliation logic

These are documented in detail in [identity-duplication-map.md](identity-duplication-map.md). Highlights:

### 7.1 `findOrCreateUserByEmail` — TWO independent implementations

- [pages/api/super-admin/users.ts:50-145](pages/api/super-admin/users.ts#L50-L145) — `findOrCreateUserByEmail` for super-admin invites.
- [pages/api/company/users.ts:115-155](pages/api/company/users.ts#L115-L155) — same name, similar body, for company-admin invites.

Both retry on PG 23505 (unique violation). Different soft-delete handling.

### 7.2 UID-match + email-match-back-fill — THREE implementations

- [pages/api/auth/sync-supabase-user.ts:106-235](pages/api/auth/sync-supabase-user.ts#L106-L235)
- [backend/services/supabaseAuthService.ts:138-163](backend/services/supabaseAuthService.ts#L138-L163)
- [backend/middleware/authMiddleware.ts:55-75](backend/middleware/authMiddleware.ts#L55-L75)

Each backfills `users.supabase_uid` from `auth.users.id` if not already set.

### 7.3 `isSuperAdmin` and `isPlatformSuperAdmin` — IDENTICAL bodies

[rbacService.ts:249-269](backend/services/rbacService.ts#L249-L269). Both functions issue the same query against `user_company_roles WHERE role='SUPER_ADMIN'`.

### 7.4 Free-email domain blocklist — TWO independent lists

- [serverValidation.ts:9-14](backend/domain/from-lib/auth/serverValidation.ts#L9-L14) — 19 domains via `validateWorkEmail`.
- [companyMatchService.ts:23-33](backend/services/companyMatchService.ts#L23-L33) — 21 domains via `isFreeEmailDomain`.

Overlapping but not identical coverage. No shared source.

### 7.5 Session-cookie patterns — THREE accepted

`extractCookieToken` ([supabaseAuthService.ts:14-57](backend/services/supabaseAuthService.ts#L14-L57)) accepts `sb-*-auth-token`, `auth-token`, `supabase-auth`. First match wins by iteration order.

---

## 8. Pre-firebase-drop schema artifacts in `auth_audit_logs`

`auth_audit_logs.firebase_uid` column exists per [20260323_auth_audit_logs.sql:18](supabase/migrations/20260323_auth_audit_logs.sql#L18) and is INDEXed. This column was never dropped when `users.firebase_uid` was dropped on 2026-04-07. Every `logAuthEvent` call ([auditLog.ts:53](backend/domain/from-lib/auth/auditLog.ts#L53)) writes `null` to this column.

---

## 9. Conditional comment drift

Comments in production code that contradict the runtime:

| File | Line | Stale comment | Truth |
|---|---|---|---|
| [pages/api/super-admin/users.ts](pages/api/super-admin/users.ts) | 48 | "identity is established by Firebase on first sign-in" | Identity is established by Supabase. |
| [supabase/migrations/20260323_email_reuse_policy.sql](supabase/migrations/20260323_email_reuse_policy.sql) | 6-8 | References `/api/auth/sync-firebase-user` | File is `sync-supabase-user.ts`. |
| [supabase/migrations/20260406_multi_tenant_auth_migration.sql](supabase/migrations/20260406_multi_tenant_auth_migration.sql) | 58-64 | "users.company_id is frozen" | Actively written by 6+ paths. |
| [pages/api/auth/sync-supabase-user.ts](pages/api/auth/sync-supabase-user.ts) | 329 | "user can re-attempt with a corrected domain on a clean slate" (after canonical-domain rejection rollback) | Email is permanently reserved per [20260323_email_reuse_policy.sql](supabase/migrations/20260323_email_reuse_policy.sql); user CANNOT retry. |

---

## 10. Orphan logic summary

| Class | Count | Top instances |
|---|---:|---|
| `firebase_uid` references after column drop | 7+ files | super-admin/users.ts:725, company/users.ts:106,432, auditLog.ts:18,53 |
| Stale migration comments / declarations | 5 | `users.company_id` frozen, `signup_intents` no cleanup |
| Unreachable guards | 4 | verify-email backstop, addExistingUserToCompany branch, supabase_uid column-missing fallback, post-login `verified` routing for non-bootstrap users |
| Deprecated-but-active paths | 5 | `users.company_id`, `free_credit_claims.category` mismatch, DB seed mismatch, two cookie sessions |
| Stale file references | 3 | sync-firebase-user, settings/security, api/account/* |
| Duplicate reconciliation logic | 5 | findOrCreateUserByEmail ×2, UID-back-fill ×3, isSuperAdmin/isPlatformSuperAdmin, free-email lists, cookie patterns |
| Comment drift | 4 | Firebase identity, sync-firebase-user reference, frozen company_id, "user can re-attempt" |
