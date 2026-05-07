# Identity Write Surface Map — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.** Every write site cites file:line and the trigger condition.

This document inventories every INSERT / UPDATE / DELETE / UPSERT / SOFT-DELETE on identity-critical tables. Production code only — migrations and tests excluded.

---

## 1. `auth.users` (Supabase-managed)

| Operation | File | Line | Trigger Condition |
|---|---|---|---|
| INSERT (via `auth.signUp`) | pages/create-account.tsx | 135-139 | User completes signup form, email+password +emailRedirectTo |
| INSERT (via `auth.signInWithOtp shouldCreateUser:true`) | pages/api/auth/accept-invite.ts | 99-106 | Invitation token validated, single-flight token consume succeeded |
| UPDATE encrypted_password (via `auth.admin.updateUserById`) | pages/api/auth/set-password.ts | 54-60 | User submits password on /auth/set-password (signup OR recovery flow) |
| DELETE (via `auth.admin.deleteUser`) | pages/api/super-admin/users.ts | 743 | Super-admin DELETE on unassigned user |
| DELETE (via `auth.admin.deleteUser`) | pages/api/auth/sync-supabase-user.ts | 336 | Canonical-domain rollback after BRAND-NEW INSERT path |

NO calls to `auth.admin.createUser` in production code.
NO calls to `auth.admin.signOut(userId)` (no "log out all sessions" mechanism).

---

## 2. `public.users` (the app-owned user row)

### Per-column write inventory

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **id** (default uuid_generate_v4) | sync-supabase-user.ts | 286 | INSERT | Brand-new user during sync (no UID match, no email match) |
| **id** | onboarding/complete.ts | 97 | INSERT | Backstop creation in onboarding |
| **id** | verify-email.ts | 63 | INSERT | Backstop creation in verify-email when getSupabaseUserFromRequest returns null |
| **id** | verify-email.ts | 70 | INSERT | Fallback INSERT without supabase_uid if column-missing error |
| **id** | super-admin/users.ts | findOrCreateUserByEmail (50-145) | INSERT | Super-admin invite creates stub user |
| **id** | company/users.ts | findOrCreateUserByEmail (115-155) | INSERT | Company-admin invite creates stub user |
| **email** | sync-supabase-user.ts | 288 | INSERT | New user creation; lower-cased |
| **email** | verify-email.ts | 65, 71 | INSERT | Backstop |
| **email** | super-admin/users.ts | findOrCreateUserByEmail | INSERT | Stub creation; lower-cased upstream |
| **email** | company/users.ts | 136 | UPDATE | Lower-case correction during upsert |
| **name** | onboarding/complete.ts | 116 | UPDATE | Onboarding profile form submission |
| **supabase_uid** | sync-supabase-user.ts | 172 | UPDATE | Existing user matched by UID; refreshes timestamps |
| **supabase_uid** | sync-supabase-user.ts | 235 | UPDATE | Existing user matched by EMAIL; back-fill UID |
| **supabase_uid** | sync-supabase-user.ts | 287 | INSERT | Brand-new user |
| **supabase_uid** | backend/services/supabaseAuthService.ts | 158 | UPDATE | Auth service back-fills UID for email-matched user |
| **supabase_uid** | backend/middleware/authMiddleware.ts | 73 | UPDATE | requireAuth back-fills UID |
| **supabase_uid** | verify-email.ts | 63 | INSERT | Backstop creation |
| **is_email_verified** | sync-supabase-user.ts | 172 | UPDATE | Forced TRUE on every UID-match sync |
| **is_email_verified** | sync-supabase-user.ts | 235 | UPDATE | Forced TRUE on email-match sync |
| **is_email_verified** | sync-supabase-user.ts | 289 | INSERT | TRUE on brand-new INSERT |
| **is_email_verified** | verify-email.ts | 65, 72 | INSERT | TRUE on backstop INSERT |
| **is_email_verified** | verify-email.ts | 114 | UPDATE | Re-assertion at verify-email gate |
| **is_email_verified** | onboarding/complete.ts | 97 | INSERT | TRUE on fallback creation |
| **last_sign_in_at** | sync-supabase-user.ts | 172 | UPDATE | Stamped on every sync |
| **last_sign_in_at** | sync-supabase-user.ts | 235 | UPDATE | Stamped on email-match sync |
| **last_sign_in_at** | sync-supabase-user.ts | 290 | INSERT | Stamped on new |
| **last_sign_in_at** | verify-email.ts | 114 | UPDATE | Stamped on verify-email |
| **has_password** | sync-supabase-user.ts | 172 | UPDATE | Result of `rpc:auth_user_has_password` |
| **has_password** | sync-supabase-user.ts | 235 | UPDATE | Result of RPC |
| **has_password** | sync-supabase-user.ts | 291 | INSERT | Result of RPC on brand-new |
| **has_password** | set-password.ts | 129-132 | UPDATE | After `auth.admin.updateUserById` succeeds. Idempotent in recovery (already true). |
| **active_company_id** | sync-supabase-user.ts | 235 | UPDATE | Restore from `user_company_roles` if missing during email-match |
| **active_company_id** | sync-supabase-user.ts | 274-292 | INSERT | Pre-link from pending invitation's company_id |
| **active_company_id** | sync-supabase-user.ts | 751-759 | UPDATE | After `bootstrapCompanyFromSignupIntent` succeeds |
| **company_id** *(deprecated)* | sync-supabase-user.ts | 754 | UPDATE | Bootstrap path — also writes deprecated column |
| **company_id** | post-login-route.ts | 108-113 | UPDATE | Migration backfill on every post-login route call |
| **company_id** | onboarding/complete.ts | 302 | UPDATE | Backfill after role creation |
| **company_id** | onboarding/setup-company.ts | 166 | UPDATE | Public-email invite acceptance |
| **company_id** | onboarding/setup-company.ts | 325 | UPDATE | Domain-match join |
| **company_id** | onboarding/setup-company.ts | 404 | UPDATE | After role creation |
| **company_id** | team/accept-invite.ts | 151 | UPDATE | Team invite acceptance (does NOT also write active_company_id) |
| **role** | sync-supabase-user.ts | 754 | UPDATE | Bootstrap COMPANY_ADMIN |
| **role** | post-login-route.ts | 108-113 | UPDATE | Backfill |
| **role** | onboarding/complete.ts | 302 | UPDATE | First registrant set to COMPANY_ADMIN |
| **role** | onboarding/setup-company.ts | 404 | UPDATE | COMPANY_ADMIN after company creation |
| **role** | team/accept-invite.ts | 151 | UPDATE | Set from invitation.role |
| **onboarding_state** | sync-supabase-user.ts | 757 | UPDATE | Set 'company_complete' on bootstrap |
| **onboarding_state** | onboarding/complete.ts | 302 | UPDATE | Set 'company_complete' |
| **onboarding_state** | onboarding/setup-company.ts | 198 | UPDATE | Set 'company_complete' on public-email invite path |
| **onboarding_state** | onboarding/setup-company.ts | 404 | UPDATE | Set 'company_complete' on company creation |
| **onboarding_state** | verify-email.ts | 110-122 | UPDATE | Advance 'pending_verification' → 'verified' |
| **is_deleted** | sync-supabase-user.ts | 333 | UPDATE | Soft-delete on canonical-domain rollback |
| **is_deleted** | super-admin/users.ts | 762-780 | UPDATE | Super-admin DELETE on unassigned user |
| **deleted_at** | sync-supabase-user.ts | 333 | UPDATE | Stamp soft-delete on rollback |
| **deleted_at** | super-admin/users.ts | 762-780 | UPDATE | Stamp soft-delete on super-admin delete |
| **job_title** | onboarding/complete.ts | 116 | UPDATE | Onboarding profile form |
| **updated_at** | sync-supabase-user.ts | 119 | UPDATE | Stamp on profile update |
| **updated_at** | onboarding/complete.ts | 119 | UPDATE | Stamp on update |
| **updated_at** | onboarding/setup-company.ts | 199 | UPDATE | Stamp on update |
| **signup_source** | NONE FOUND | — | — | Column added in 20260406 migration; **no production code writes it** |

### Findings — `users`

- **`is_deleted` written from only 2 sites**, but read from 11+ sites (see [identity-read-surface-map.md](identity-read-surface-map.md)).
- **`company_id` (deprecated/frozen) has 6+ writers** — the deprecation is not enforced.
- **`active_company_id` has 3 writers** — including team/accept-invite.ts:151 which writes `company_id` BUT NOT `active_company_id`. New invite acceptances introduce drift.
- **`signup_source` column has zero writers**. Dead-on-arrival migration column.
- **`is_email_verified` is forced `true` on every sync** regardless of upstream state.

---

## 3. `user_company_roles`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **role** | sync-supabase-user.ts | 736 | INSERT | Bootstrap company → COMPANY_ADMIN |
| **role** | onboarding/complete.ts | 276 | INSERT | First registrant COMPANY_ADMIN |
| **role** | onboarding/setup-company.ts | 394 | INSERT | Company creation → COMPANY_ADMIN |
| **role** | company/users.ts | 204 | UPDATE (upsert) | PUT /api/company/users — change role |
| **role** | company/users.ts | 211 | INSERT (upsert) | POST /api/company/users — invite |
| **role** | company/users.ts | 549 | UPDATE | PUT update path explicit role write |
| **role** | super-admin/users.ts | 176 | UPDATE (upsert) | Super-admin upsert role |
| **role** | super-admin/users.ts | 206 | INSERT (upsert) | Super-admin new invitation |
| **role** | super-admin/users.ts | 586-670 (PATCH) | UPDATE | Super-admin role PATCH |
| **role** | super-admin/free-credits/grant.ts | 115 | UPDATE | Downgrade SUPER_ADMIN → COMPANY_ADMIN to attach to org for grant |
| **role** | (rpc:activate_invitation_membership) | 20260420_lockdown_idempotency.sql:136 | UPDATE | Set from invitation.role on activation |
| **status** | sync-supabase-user.ts | 737 | INSERT | 'active' on bootstrap |
| **status** | onboarding/complete.ts | 277 | INSERT | 'active' |
| **status** | onboarding/setup-company.ts | 161 | UPDATE | invited → active on public-email accept |
| **status** | onboarding/setup-company.ts | 395 | INSERT | 'active' |
| **status** | company/users.ts | 194 | UPDATE (upsert) | invited (re-invite path) |
| **status** | company/users.ts | 216 | INSERT | invited (new invite) |
| **status** | company/users.ts | 267 | UPDATE | active (addExistingUserToCompany — DEAD branch via firebase_uid gate) |
| **status** | company/users.ts | 538 | UPDATE | PUT /api/company/users with status=active|inactive |
| **status** | super-admin/users.ts | 167 | UPDATE (upsert) | invited |
| **status** | super-admin/users.ts | 200 | INSERT | invited |
| **status** | team/accept-invite.ts | 142 | INSERT | active |
| **status** | (rpc:activate_invitation_membership) | RPC | UPDATE | invited → active during set-password |
| **invited_at** | super-admin/users.ts | upsertUserCompanyRole (151-224) | INSERT/UPDATE | Stamp on invite |
| **invited_at** | company/users.ts | upsertUserCompanyRole (190-209) | INSERT/UPDATE | Stamp on invite |
| **accepted_at** | sync-supabase-user.ts | 741 | INSERT | Stamp on bootstrap |
| **accepted_at** | onboarding/complete.ts | 278 | UPDATE | Stamp on activate |
| **accepted_at** | onboarding/setup-company.ts | 161-162 | UPDATE | Stamp on accept |
| **accepted_at** | company/users.ts | 268 | UPDATE | Stamp on activate |
| **accepted_at** | company/users.ts | 543 | UPDATE | Stamp when status=active in PUT |
| **accepted_at** | super-admin/users.ts | 171 | UPDATE | (optional — deactivate stamp) |
| **accepted_at** | team/accept-invite.ts | 142 | INSERT | Stamp on direct accept |
| **deactivated_at** | company/users.ts | 537-545 | UPDATE | PUT with status=inactive/deactivated |
| **deactivated_at** | super-admin/users.ts | 790-799 | UPDATE | Cascade on super-admin DELETE |
| **join_source** | sync-supabase-user.ts | 738 | INSERT | 'self_registered' on bootstrap |
| **join_source** | onboarding/setup-company.ts | 396 | INSERT | 'self_registered' |
| **DELETE row** | company/users.ts | 587-595 | DELETE | DELETE /api/company/users — hard delete of (user_id, company_id) tuple |

### Findings — `user_company_roles`

- **`role` has 11 writers, no DB CHECK constraint.** Any string passes. Application's `normalizeRole` is the only guard.
- **`status` flips `invited→active` from 4+ paths**: onboarding/setup-company, company/users PUT, team/accept-invite, and the `activate_invitation_membership` RPC. Each path uses different timestamping (some set `accepted_at`, some don't).
- **DELETE path is hard-delete** (company/users.ts:587-595) — destroys audit linkage. Other paths use `status='inactive'` (preserves history). Mix is inconsistent.
- **`invitations.accepted_at` is set ONLY by team/accept-invite.ts:120**. The standard signup-link → set-password.ts → `activate_invitation_membership` path flips role status but never stamps `invitations.accepted_at`.

---

## 4. `companies`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | sync-supabase-user.ts | 656-664 | INSERT | bootstrapCompanyFromSignupIntent happy path |
| **(full INSERT)** | onboarding/complete.ts | 191 | INSERT | Onboarding-driven company creation |
| **(full INSERT)** | onboarding/setup-company.ts | 341-351 | INSERT | Setup-company happy path |
| **id** | (above) | — | INSERT | uuid_generate_v4() per migration |
| **name** | sync-supabase-user.ts | 656 | INSERT | from signup_intents.intent_data.company_name |
| **name** | onboarding/setup-company.ts | 341 | INSERT | From form |
| **website** | sync-supabase-user.ts | 659 | INSERT | **PLACEHOLDER `companyId` (UUID) because column is NOT NULL** |
| **website** | onboarding/setup-company.ts | 341 | INSERT | From form |
| **admin_email_domain** | sync-supabase-user.ts | 660 | INSERT | from extractDomain(email) |
| **admin_email_domain** | onboarding/complete.ts | 196 | INSERT | from email domain |
| **admin_email_domain** | onboarding/setup-company.ts | 349 | INSERT | from user email domain |
| **domain_claimed_at** | sync-supabase-user.ts | 661 | INSERT | now |
| **domain_claimed_at** | onboarding/setup-company.ts | 350 | INSERT | now (if admin_email_domain present) |
| **status** | sync-supabase-user.ts | 662 | INSERT | 'active' |
| **status** | onboarding/setup-company.ts | 341 | INSERT | 'active' |
| **free_credit_granted_at** | backend/services/initialFreeCreditService.ts | 136-141 | UPDATE | After successful initial-grant; only if NULL |

### Findings — `companies`

- **`website` is a UUID placeholder** when `bootstrapCompanyFromSignupIntent` creates the row (`website=companyId`). Until the user reaches `/onboarding/company` and refines it, any feature reading this column gets a non-URL string.
- **`admin_email_domain` UNIQUE** ([20260322:11-18](supabase/migrations/20260322_domain_credit_hardening.sql#L11-L18)) — a second row inserting the same domain will fail.
- **`free_credit_granted_at` is set once by initialFreeCreditService.ts:136-141**, gated on `IS NULL` to be idempotent.
- **No DELETE path on `companies`**. Companies are never destroyed at runtime.

---

## 5. `company_domains`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(via saveDomainRecord)** | sync-supabase-user.ts | 700-721 | INSERT | bootstrapCompanyFromSignupIntent — happy path |
| **(via saveDomainRecord)** | super-admin/users.ts | 467 | INSERT/UPDATE | Super-admin override_domain=true branch |
| **(via reassignDomain)** | super-admin/users.ts | 513 | UPDATE | Super-admin domain reassignment with confirm_reassignment=true |

Per migration [20260406:65-100](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L65-L100), columns include: `id`, `company_id`, `input_domain`, `final_domain`, `redirect_chain`, `is_forwarding`, `verification_status`, `created_via`, `is_primary`, `verified_at`.

### Findings — `company_domains`

- **No DELETE path** in production code. Reassignment via `reassignDomain` mutates `company_id` rather than delete+insert.
- **`verification_status` values seen:** `'pending'` (user flow), `'admin_override'` (super-admin), `'verified'` (after DNS verification).

---

## 6. `invitations`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | backend/services/invitationService.ts | 124-153 | INSERT | createInvitation called from super-admin or company-admin invite |
| **email** | invitationService.ts | 134 | INSERT | lower-cased |
| **company_id** | invitationService.ts | 124-153 | INSERT | from caller |
| **role** | invitationService.ts | 124-153 | INSERT | from caller; role CHECK at migration 20260331_invitations.sql:18 (no SUPER_ADMIN) |
| **token_hash** | invitationService.ts | 124-153 | INSERT | SHA-256 of raw token |
| **expires_at** | invitationService.ts | 6 | INSERT | now+7d (ish — depends on InvitationService TTL constant) |
| **idempotency_key** | invitationService.ts | 67-79 | INSERT (optional) | From withIdempotency wrapper at company/users.ts:610 |
| **token_consumed_at** | accept-invite.ts | 81 | UPDATE | Single-flight consume on first use; WHERE token_consumed_at IS NULL |
| **token_consumed_at** | accept-invite.ts | 109-112 | UPDATE | Reset to NULL if signInWithOtp fails (rollback) |
| **accepted_at** | team/accept-invite.ts | 120 | UPDATE | Direct team invite acceptance (NOT the standard signup-set-password path) |
| **revoked_at** | accept-invite.ts | 74 | UPDATE | Auto-revoke on expiry detected at acceptance time |
| **revoked_at** | invitationService.ts | normalizeInvitationState (25-40) | UPDATE | Revoke prior pending invites before issuing a new one for same (email, company) |

### Findings — `invitations`

- **No "revoke pending invitation" endpoint exists** — only implicit revoke via `normalizeInvitationState` when a new invite is issued for the same (email, company).
- **`accepted_at` is rarely written.** Only team/accept-invite.ts:120 writes it. The standard flow (super-admin or company-admin invite → set-password.ts → `activate_invitation_membership` RPC) does NOT write `accepted_at`. The RPC body would need to be inspected to confirm.
- **No DELETE path** — invitations are append-only.

---

## 7. `signup_intents`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | pages/api/auth/signup.ts | 174 | INSERT | Pre-signup gate — POST /api/auth/signup |
| **email** | signup.ts | 174 | INSERT | lower-cased |
| **source** | signup.ts | 174 | INSERT | 'signup_form' |
| **status** | signup.ts | 174 | INSERT | 'pending' |
| **expires_at** | signup.ts | 174 | INSERT | now+24h |
| **intent_data** | signup.ts | 174, 191 | INSERT/UPDATE | jsonb { company_name } |
| **status='completed'** | sync-supabase-user.ts | 773-776 | UPDATE | After successful bootstrap |
| **completed_at** | sync-supabase-user.ts | 775 | UPDATE | now |
| **status='completed'** | verify-email.ts | 128-148 | UPDATE | Idempotent re-assertion |

### Findings — `signup_intents`

- **No DELETE path** — rows accumulate, expired ones unused.
- **Not rolled back** on canonical-domain rejection (sync-supabase-user.ts:331-342 only undoes users + auth.users).

---

## 8. `organization_credits` (the wallet)

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full UPSERT)** | backend/services/initialFreeCreditService.ts | 79-90 | UPSERT (ignoreDuplicates) | First credit grant for org |
| **free_balance / paid_balance / incentive_balance** | (rpc:apply_credit_reservation) | RPC | UPDATE | All wallet mutations go through this RPC; called from creditExecutionService.ts:193 |
| **reserved_free / reserved_paid / reserved_incentive** | (rpc:apply_credit_reservation) | RPC | UPDATE | HOLD increases reserved_*; CONFIRM decreases reserved_* and increments lifetime_consumed; RELEASE moves back to balance |
| **lifetime_purchased / lifetime_consumed** | (rpc:apply_credit_reservation) | RPC | UPDATE | Per migration [20260322_wallet_reservation.sql](supabase/migrations/20260322_wallet_reservation.sql) |
| **credit_rate_usd** | initialFreeCreditService.ts | 79-90 | INSERT (default 0.001) | First-time creation only |

### Findings — `organization_credits`

- **No direct UPDATE site** in production code outside the RPC. The wallet is exclusively mutated through `apply_credit_reservation` ([20260322_wallet_reservation.sql:119](supabase/migrations/20260322_wallet_reservation.sql#L119), rewritten in [20260323_remove_balance_credits.sql](supabase/migrations/20260323_remove_balance_credits.sql)).
- **No DELETE path** — wallets are never destroyed.

---

## 9. `free_credit_claims`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | backend/services/initialFreeCreditService.ts | 118 | INSERT | After successful credit grant |
| **user_id** | initialFreeCreditService.ts | 118 | INSERT | from caller |
| **organization_id** | initialFreeCreditService.ts | 118 | INSERT | from caller |
| **category** | initialFreeCreditService.ts | 118 | INSERT | **'initial_free_credit'** — but DB UNIQUE is `WHERE category='initial'` (mismatch — see orphaned-logic) |
| **credits_granted** | initialFreeCreditService.ts | 118 | INSERT | from caller |
| **domain** | initialFreeCreditService.ts | 118 | INSERT | denormalized email/admin domain |

### Findings — `free_credit_claims`

- **Category-key mismatch** — DB UNIQUE expects `'initial'` ([20260322_domain_credit_hardening.sql:22-24](supabase/migrations/20260322_domain_credit_hardening.sql#L22-L24)) and ([20260322_domain_level_credit_enforcement.sql:53-60](supabase/migrations/20260322_domain_level_credit_enforcement.sql#L53-L60)), but code writes `'initial_free_credit'`. DB-level UNIQUE guard silently inactive.
- **App-layer dedup** is the only protection ([initialFreeCreditService.ts:46-55](backend/services/initialFreeCreditService.ts#L46-L55)).

---

## 10. `manual_credit_grants`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | pages/api/super-admin/free-credits/grant.ts | 60-69 | INSERT | Super-admin manual grant |
| **granted_by** | super-admin/free-credits/grant.ts | 55 | INSERT | adminId === 'cookie' ? null : adminId — **NULL when cookie-only super-admin** |

### Findings — `manual_credit_grants`

- **`granted_by` can be NULL** when the cookie-credential super-admin session is the actor — audit gap.

---

## 11. `credit_transactions` (immutable ledger)

| Operation | File | Line | Trigger Condition |
|---|---|---|---|
| INSERT (via RPC) | (rpc:apply_credit_reservation) | RPC at 20260322_wallet_reservation.sql:119 | Every grant/hold/confirm/release writes one row; UNIQUE idempotency_key |
| INSERT (via RPC) | creditExecutionService.ts | 193 | HOLD/CONFIRM/RELEASE phase |
| INSERT (via RPC) | creditExecutionService.ts | 244 | apply_credit_partial_confirm — partial CONFIRM with measured cost |

NO direct INSERTs to `credit_transactions` — all writes flow through RPC. NO UPDATEs (immutable). NO DELETEs.

---

## 12. Other identity-coupled tables

### `signup_referrals` (claimed-domain notification)

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | sync-supabase-user.ts | 850 | INSERT | notifyAdminAndProspectOfClaimedDomain |
| **attempt_count** | sync-supabase-user.ts | 873 | UPDATE | Increment on retry |
| **emails_sent_at** | sync-supabase-user.ts | 897 | UPDATE | Stamp after successful email send |

### `auth_audit_logs`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | backend/domain/from-lib/auth/auditLog.ts | 41-70 | INSERT | logAuthEvent — events: user_deleted, role_changed, ghost_session_detected, unauthorized_access_attempt, domain_validation_failed |
| **firebase_uid** | auditLog.ts | 53 | INSERT | **DEAD payload field** — column was DROPPED on `users` (20260407) but `auth_audit_logs.firebase_uid` was NOT dropped per [20260323_auth_audit_logs.sql:18](supabase/migrations/20260323_auth_audit_logs.sql#L18) |

### `audit_logs` (generic)

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | super-admin/users.ts | 226-250 | INSERT (insertAuditLog) | Super-admin user actions: SUPER_ADMIN_INVITE, ADD_EXISTING_USER, etc. |
| **(full INSERT)** | company/users.ts | 464-470 | INSERT | INVITE_USER from company-admin |
| **(full INSERT)** | company/users.ts | 557-563 | INSERT | UPDATE_USER_ROLE / DEACTIVATE_USER |
| **(full INSERT)** | company/users.ts | 597-602 | INSERT | REMOVE_USER (DELETE) |
| **(full INSERT)** | various | (insertAuditLogStrict via auditActorService) | INSERT | Audit-actor wrapper |

NO `audit_logs` writes for password changes ([set-password.ts:11-142](pages/api/auth/set-password.ts#L11-L142) writes none).

### `super_admin_audit_logs`

| Column | File | Line | Operation | Trigger Condition |
|---|---|---|---|---|
| **(full INSERT)** | content-architect-login.ts | 23-50 | INSERT | CONTENT_ARCHITECT_LOGIN |

NO write on `/api/super-admin/login.ts` — env-credential super-admin login is **not auditable**.

---

## 13. Aggregate write-pressure summary

Tables ranked by number of distinct production writers:

| Table | Distinct write sites | Distinct writer columns |
|---|---|---|
| `users` | 12+ (across sync, verify-email, post-login-route, onboarding/complete, onboarding/setup-company, team/accept-invite, super-admin/users, company/users, set-password, supabaseAuthService, authMiddleware) | 14 columns |
| `user_company_roles` | 12+ | 7 columns |
| `companies` | 3 | (full row) |
| `company_domains` | 3 (via 2 service helpers) | (full row + reassign) |
| `invitations` | 3 (insert + 4 updates from 2 files) | 4 columns |
| `signup_intents` | 3 | 4 columns |
| `organization_credits` | 1 direct (UPSERT) + RPC mutations | (RPC-driven) |
| `free_credit_claims` | 1 | (full row) |
| `manual_credit_grants` | 1 | (full row) |
| `credit_transactions` | 0 direct (RPC only) | — |
| `auth.users` | 5 (signUp, signInWithOtp create, updateUserById password, deleteUser ×2) | encrypted_password only via 1 site |
| `auth_audit_logs` | 1 | (full row) |
| `audit_logs` | 4+ | (full row) |
| `super_admin_audit_logs` | 1 | (full row) |
| `signup_referrals` | 1 (3 ops: insert, update, update) | (full row + 2 cols) |

`users` and `user_company_roles` are the highest-write tables in the identity domain — and have the most writers per column. This is the largest concentration of write-side authority drift in the system.
