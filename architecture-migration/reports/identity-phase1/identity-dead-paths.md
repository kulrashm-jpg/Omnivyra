# Identity Dead Paths — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.**

This document enumerates code paths that are **definitely unreachable on the current schema/runtime**, the cause, the runtime impact, and a removal-safety assessment. NO removal proposals — assessment only.

---

## Top-line table

| Path | Why Dead | Runtime Impact | Safe To Remove? |
|---|---|---|---|
| `addExistingUserToCompany` branch in [company/users.ts:432-442](pages/api/company/users.ts#L432-L442) | Gated on `firebase_uid` being truthy; column dropped 2026-04-07 in [20260407_drop_firebase_uid.sql:16](supabase/migrations/20260407_drop_firebase_uid.sql#L16) | Branch never executed. Every existing-user invite goes through the email path. | **CONDITIONAL** — `findExistingUserByEmail` SELECT on line 106 will error on PG schema; if that error is silently caught, the branch behaves as documented. Verify the SELECT actually errors at runtime before removing. |
| `addExistingUserToCompany` function definition in [company/users.ts:248-284](pages/api/company/users.ts#L248-L284) | Only caller is the dead branch above | Unreachable function body | YES — once the gate is removed |
| `findExistingUserByEmail` SELECT including `firebase_uid` ([company/users.ts:106](pages/api/company/users.ts#L106)) | Column dropped | **Will fail at runtime** with PG `column "firebase_uid" does not exist`. Either the function returns null on every call (breaking the auto-add-without-invite path forever) or the error is caught upstream and silently swallowed. | NO — needs schema-aware refactor to remove only `firebase_uid` from the SELECT, not delete the function (which is used). |
| Super-admin DELETE handler SELECT including `firebase_uid` ([super-admin/users.ts:725](pages/api/super-admin/users.ts#L725)) | Column dropped | **Will fail at runtime**. The DELETE handler may error before `auth.admin.deleteUser` runs at line 743 — meaning super-admin user-delete may be permanently broken unless the SELECT is wrapped in error tolerance. Could not verify with grep alone. | NO — needs to be replaced with `select('id, supabase_uid')` |
| `firebase_uid` payload field in `logAuthEvent` ([auditLog.ts:18,28,53](backend/domain/from-lib/auth/auditLog.ts)) | Type field never set by callers; `auth_audit_logs.firebase_uid` column still exists per [20260323_auth_audit_logs.sql:18](supabase/migrations/20260323_auth_audit_logs.sql#L18) | Inserts succeed writing `null`. No errors. Column exists on `auth_audit_logs` — schema artifact. | YES — remove field from type+insert, keep column DROP for a separate migration |
| `verify-email.ts` `supabase_uid` column-missing fallback ([verify-email.ts:70-75](pages/api/auth/verify-email.ts#L70-L75)) | Column was added in [20260406:31-33](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L31-L33); fallback assumes it doesn't exist | Branch is unreachable on current schema. | YES — if no rollback contingency is needed |
| `verify-email.ts` BACKSTOP user-row INSERT ([verify-email.ts:50-83](pages/api/auth/verify-email.ts#L50-L83)) | `sync-supabase-user.ts` runs first in normal flow and creates the row | Reachable only if a Bearer token exists for an `auth.users` row that has no matching `users` row — i.e., a sync was skipped or failed. Edge case, not strictly dead, but a duplication of `sync-supabase-user.ts`'s responsibility. | NO — emergency backstop; removing requires confirming sync-supabase-user is always called |
| `recovery` flow for `has_password=false` user at [set-password.ts:46-48](pages/api/auth/set-password.ts#L46-L48) | Returns 400 INVALID_RECOVERY_FLOW immediately | Branch IS executed for users without passwords who click reset links. NOT dead — but no in-band guidance to the user. | NO — load-bearing error path |
| Magic-link signup path | `magic-link.ts` is login-only ([magic-link.ts:11](pages/api/auth/magic-link.ts#L11) comment, `shouldCreateUser:false` per design) | Magic-link does NOT create users. **EXCEPT**: [accept-invite.ts:99-106](pages/api/auth/accept-invite.ts#L99-L106) bypasses with `shouldCreateUser:true`. | NO — accept-invite is the legitimate user-creation entry; not dead |
| `auth_user_confirmed` RPC fallback in `signup.ts` and others | Migration creating the RPC is **not found** in `supabase/migrations/` | If RPC exists in DB but not in source: paths work as designed. If it's missing in DB: `RESUME_SIGNUP` orphan-detection silently degrades to `INVALID_CREDENTIALS`. | NO — provenance unverified |
| `users.signup_source` column writers | Column added [20260406:55-56](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L55-L56); zero writers found | Column exists; never populated. Reads (if any) get NULL. | NO — column is harmless; removing requires migration |
| `pages/api/super-admin/login.ts` — env credential session | `super_admin_session=1` cookie only — no MFA, no rotation | Path is reachable and works. NOT dead. | NO |
| Old partial UNIQUE on `invitations(email, company_id) WHERE expires_at > NOW()` | Replaced by `invitations_active_unique` in [20260420_hardening_auth_email_invites.sql:20-49](supabase/migrations/20260420_hardening_auth_email_invites.sql#L20-L49) | Old index is dropped; new index does NOT require `expires_at > NOW()`. Old behavior is dead. | YES — was already removed by the hardening migration |
| `apply_credit_transaction_v2` RPC | Created in [20260321_credit_ledger_hardening.sql](supabase/migrations/20260321_credit_ledger_hardening.sql); dropped in [20260323_remove_balance_credits.sql](supabase/migrations/20260323_remove_balance_credits.sql) | RPC no longer exists. No production caller. | YES — dropped by migration |
| `users.balance_credits` column | Dropped in [20260323_remove_balance_credits.sql:272](supabase/migrations/20260323_remove_balance_credits.sql#L272) | Column gone. No production reader found. | YES — already done |
| Initial-credit DB seed `('initial', 300, 14)` in `free_credit_config` ([20260322_domain_credit_hardening.sql:38](supabase/migrations/20260322_domain_credit_hardening.sql#L38)) | Service queries `category='initial_free_credit'` — seed never matches | Seed row is unread; hardcoded fallback (50/14d) is used at runtime. | NO — removing the seed is harmless but doesn't fix the bug |
| Partial UNIQUE on `free_credit_claims WHERE category='initial'` ([20260322_domain_credit_hardening.sql:22-24](supabase/migrations/20260322_domain_credit_hardening.sql#L22-L24); [20260322_domain_level_credit_enforcement.sql:53-60](supabase/migrations/20260322_domain_level_credit_enforcement.sql#L53-L60)) | Service writes `category='initial_free_credit'` | DB UNIQUE never fires; only app-layer dedup protects against double-grant. | NO — removing the index removes a (silent) safety net |
| Stale comment "user can re-attempt with a corrected domain on a clean slate" ([sync-supabase-user.ts:329](pages/api/auth/sync-supabase-user.ts#L329)) | Email-reuse policy keeps email reserved | Comment misleads readers. | YES — comment-only |
| Stale comment "Never calls supabase.auth — identity is established by Firebase" ([super-admin/users.ts:48](pages/api/super-admin/users.ts#L48)) | Identity is now Supabase | Misleading. | YES — comment-only |
| `archive/unreachable-api-routes/pages/api/company/users/reinvite.ts` | Lives under `archive/unreachable-api-routes/` | Archived; not in live route table. | YES — archive |
| `archive/unreachable-api-routes/pages/api/admin/credits/grant.ts` | Same | Archived | YES — archive |
| `archive/unreachable-api-routes/pages/api/analytics/properties.ts` | Same | Archived | YES — archive |
| `archive/unreachable-api-routes/pages/api/admin/domain-analytics.ts` | Same | Archived | YES — archive |
| `archive/unreachable-api-routes/pages/api/campaigns/[id]/outcomes.ts` | Same | Archived | YES — archive |
| `archive/unreachable-api-routes/pages/api/campaigns/pending/[id]/approve.ts` | Same | Archived | YES — archive |
| `archive/unreachable-api-routes/pages/api/admin/org/[id]/economics.ts` | Same | Archived | YES — archive |
| Backstop comment "set requiresLogin: true" path in verify-email.ts:188-194 | Implementation exists but its activation depends on `mode !== 'passwordless'` | Branch IS reachable for first-time password signups. NOT dead. | NO |
| Magic-link path with `shouldCreateUser: true` other than via accept-invite | Only accept-invite uses it; no other call site found | Only entry point is invitation acceptance | NO — load-bearing for invite flow |
| `resolveActorId` ([authMiddleware.ts:176](backend/middleware/authMiddleware.ts#L176)) | No callers found in active codebase | Function is exported but unused outside the same file (where it's used internally). | CONDITIONAL — if internally used by `requireAuth` etc., not dead |

---

## Detail — `firebase_uid` removal map

The column was dropped on 2026-04-07. Production code that still references it:

| Site | Read or Write? | Effect |
|---|---|---|
| [super-admin/users.ts:725](pages/api/super-admin/users.ts#L725) `select('id, supabase_uid, firebase_uid')` | READ | SELECT fails on current schema |
| [company/users.ts:106](pages/api/company/users.ts#L106) `select('id, email, firebase_uid, is_deleted, created_at')` | READ | SELECT fails |
| [company/users.ts:432](pages/api/company/users.ts#L432) `if ((existingUser as any).firebase_uid)` | READ | Always falsey on undefined access (not a column-error per se, since the upstream SELECT already failed) |
| [auditLog.ts:53](backend/domain/from-lib/auth/auditLog.ts#L53) INSERT into `auth_audit_logs.firebase_uid` | WRITE | Succeeds writing NULL — `auth_audit_logs.firebase_uid` column still exists |
| [auditLog.ts:18](backend/domain/from-lib/auth/auditLog.ts#L18) Type definition | (declaration only) | Does not run |

To safely remove: clean up the SELECT queries first, then the type field, then the audit-log insert. Dropping the `auth_audit_logs.firebase_uid` column itself requires its own migration.

---

## Detail — Unreachable invitation branches

### Magic-link signup that is NOT accept-invite

The only `signInWithOtp({ shouldCreateUser: true })` caller is [accept-invite.ts:99-106](pages/api/auth/accept-invite.ts#L99-L106). Other signin entry points use `shouldCreateUser: false`:
- `magic-link.ts` (login-only)
- `pages/login.tsx` (browser direct)

A flow that creates a user via OTP without going through accept-invite cannot be reached.

### Pending invitation skip in bootstrap (NOT DEAD — load-bearing)

[sync-supabase-user.ts:402-410](pages/api/auth/sync-supabase-user.ts#L402-L410) — early-return if a pending invitation exists for the email. This branch is **active and load-bearing**. Master audit Section 13 documents it as the path that lets super-admin invite a `gmail.com` user as `COMPANY_ADMIN` without triggering the canonical-domain check.

---

## Detail — Onboarding routing branches

### `verified` → `/onboarding/profile` for users who passed bootstrap

[post-login-route.ts:62-92](pages/api/auth/post-login-route.ts#L62-L92):
```typescript
if (!name || onboardingState in {'verified', 'pending_verification'}) {
  return /onboarding/profile;
}
```

For self-signup work-email users, `bootstrapCompanyFromSignupIntent` advances `onboarding_state` to `'company_complete'` (line 757). For these users, this branch is unreachable.

For free-email / domain-claimed / invited users, the bootstrap returns early without advancing state. They reach this branch with state still `'verified'`. **Branch IS reachable** for that subset.

### `no active role` → `/onboarding/company`

[post-login-route.ts:80-88](pages/api/auth/post-login-route.ts#L80-L88) routes users with no `user_company_roles WHERE status='active'` to `/onboarding/company`.

After bootstrap (work-email path), every user has an active role. Branch unreachable for the work-email path.

For free-email users, the role is created during `/onboarding/setup-company`. Branch IS reachable for them at the moment after `verify-email` but before `setup-company`.

For invited users, the role is created during `accept-invite.ts` → `set-password.ts` → `activate_invitation_membership` RPC. Branch IS reachable transiently between `accept-invite` and `set-password`.

---

## Detail — Recovery vs signup flow gates

[set-password.ts:46-52](pages/api/auth/set-password.ts#L46-L52):
```typescript
if (flow === 'recovery' && !(currentUser as any)?.has_password) {
  return res.status(400).json({ error: 'INVALID_RECOVERY_FLOW' });
}
if (flow === 'signup' && (currentUser as any)?.has_password) {
  return res.status(400).json({ error: 'INVALID_SIGNUP_FLOW' });
}
```

These mutually-exclusive gates produce two distinct error paths.

`flow='recovery'` for `has_password=false` is reachable when:
- A user without a password (magic-link-only or unaccepted invitee) clicks a reset email.

`flow='signup'` for `has_password=true` is reachable when:
- An invitee re-clicks an old set-password URL after already setting a password.

Both branches are alive but produce no in-band guidance to the user.

---

## Detail — Duplicate function dead-code

| Function | File:Line | Has callers? |
|---|---|---|
| `isSuperAdmin` ([rbacService.ts:249-258](backend/services/rbacService.ts#L249-L258)) | yes — 17 callers |
| `isPlatformSuperAdmin` ([rbacService.ts:260-269](backend/services/rbacService.ts#L260-L269)) | yes — 16 callers |
| Both have **identical bodies**. Neither is dead, but one is redundant. | | |

---

## Removal-safety bucketing

**SAFE to remove now (zero runtime risk):**
- `users.balance_credits` column (already dropped per migration)
- `apply_credit_transaction_v2` RPC (already dropped per migration)
- Old `invitations_pending_unique` index (already dropped)
- Stale comments in source files
- `auditLog.ts` `firebase_uid` payload field
- All 7 `archive/unreachable-api-routes/*` files (already segregated)

**SAFE to remove with simple cleanup:**
- `firebase_uid` from SELECT queries in `super-admin/users.ts:725` and `company/users.ts:106`
- `addExistingUserToCompany` function definition (after the dead branch is removed)
- `verify-email.ts` `supabase_uid` column-missing fallback

**NOT SAFE to remove without further investigation:**
- `verify-email.ts` BACKSTOP user creation (could be relied on as failsafe)
- `auth_user_confirmed` RPC references (provenance unverified)
- `users.signup_source` column (no current writers but column may be filled in future)
- `auth_audit_logs.firebase_uid` column (requires its own migration)
- DB seeds and partial UNIQUE indices on `free_credit_claims`/`free_credit_config` with category mismatch — they're unfired safety nets, not dead per se

**LOAD-BEARING (NOT dead):**
- Pending-invitation skip in `bootstrapCompanyFromSignupIntent`
- Recovery/signup flow gates in `set-password.ts`
- `super_admin_session=1` and `content_architect_session=1` cookies (active code paths used in production)
- `magic-link` `shouldCreateUser:false` policy (paired with accept-invite override)
