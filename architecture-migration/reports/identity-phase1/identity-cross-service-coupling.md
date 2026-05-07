# Identity Cross-Service Coupling — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.**

This document maps coupling between the identity-related subsystems: auth, onboarding, domain verification, credits, invitations, RBAC, and company bootstrap. Coupling is broken down by mode (synchronous, transactional, rollback, hidden assumption).

---

## Subsystems in scope

1. **Auth** — Supabase auth + sync to `public.users` ([sync-supabase-user.ts](pages/api/auth/sync-supabase-user.ts), [verify-email.ts](pages/api/auth/verify-email.ts), [supabaseAuthService.ts](backend/services/supabaseAuthService.ts))
2. **Onboarding** — multi-step setup-company flow ([onboarding/setup-company.ts](pages/api/onboarding/setup-company.ts), [onboarding/complete.ts](pages/api/onboarding/complete.ts), [post-login-route.ts](pages/api/auth/post-login-route.ts))
3. **Domain verification** — canonical-domain enforcement + DNS verification ([domainCanonicalService.ts](backend/services/domainCanonicalService.ts), [domainVerificationService.ts](backend/services/domainVerificationService.ts), domain endpoints)
4. **Credits** — wallet + ledger + idempotency anchors ([creditExecutionService.ts](backend/services/creditExecutionService.ts), [initialFreeCreditService.ts](backend/services/initialFreeCreditService.ts))
5. **Invitations** — issuance + acceptance + activation ([invitationService.ts](backend/services/invitationService.ts), [accept-invite.ts](pages/api/auth/accept-invite.ts), [set-password.ts](pages/api/auth/set-password.ts))
6. **RBAC** — role checks + permission enforcement ([rbacService.ts](backend/services/rbacService.ts), [authMiddleware.ts](backend/middleware/authMiddleware.ts))
7. **Company bootstrap** — first-company creation ([sync-supabase-user.ts:382-800](pages/api/auth/sync-supabase-user.ts#L382-L800) `bootstrapCompanyFromSignupIntent`)

---

## 1. Synchronous coupling (one subsystem calls another in-line)

### 1.1 Auth → Company Bootstrap → Domain Verification → Credits

Inside a single `/api/auth/sync-supabase-user` request:

```
auth (verifySupabaseAuthHeader)
  → users INSERT/UPDATE
  → bootstrapCompanyFromSignupIntent
       → resolveDomain (canonical-domain enforcement) [domain verification subsystem]
       → companies INSERT
       → saveDomainRecord (company_domains INSERT) [domain verification]
       → user_company_roles INSERT (role='COMPANY_ADMIN') [RBAC]
       → users UPDATE (active_company_id, role, onboarding_state)
       → grantInitialFreeCredit [credits subsystem]
            → free_credit_claims SELECT (idempotency)
            → free_credit_config SELECT (amount/expiry config)
            → organization_credits UPSERT
            → createCredit → rpc:apply_credit_reservation [credits]
            → free_credit_claims INSERT
            → companies UPDATE (free_credit_granted_at)
       → signup_intents UPDATE (status='completed')
```

**One HTTP request synchronously spans 5 subsystems.** Failure at any step partially-rolls back (see Section 3).

### 1.2 Invitations → Auth → RBAC

Inside `/api/auth/accept-invite`:
```
invitations subsystem (token validation, single-flight consume)
  → auth (signInWithOtp shouldCreateUser:true) — creates auth.users
  ⇢ /auth/callback → /api/auth/sync-supabase-user
       → auth (sync-supabase-user)
            → bootstrapCompanyFromSignupIntent
                 → pending-invite skip [BYPASSES domain verification subsystem]
       → eventually /api/auth/set-password
            → auth (admin.updateUserById)
            → rpc:activate_invitation_membership [RBAC subsystem state flip]
            → users UPDATE (has_password=true)
```

The pending-invitation skip in `bootstrapCompanyFromSignupIntent` ([sync-supabase-user.ts:402-410](pages/api/auth/sync-supabase-user.ts#L402-L410)) is the **load-bearing decoupling** — it tells the domain-verification subsystem "this user was vouched for; skip your enforcement". No audit log records the skip.

### 1.3 RBAC → Auth (every request)

Every authorization check transitively invokes the auth subsystem:
- `enforceRole` → `resolveUserContext` → `getSupabaseUserFromRequest` → Supabase `auth.getUser`.
- `requireSuperAdminUser` → `getSupabaseUserFromRequest` → `isPlatformSuperAdmin` → DB query.
- `requireCompanyAccess` → `getUserRole` → `user_company_roles` SELECT.

**Hidden assumption:** RBAC results are uncached. Each request re-validates the JWT and re-queries roles. With 5s timeout on `auth.getUser` ([supabaseAuthService.ts:91-103](backend/services/supabaseAuthService.ts#L91-L103)) and a JWT-claims fallback in dev, intermittent latency can degrade RBAC silently.

### 1.4 Onboarding → Credits

[onboarding/setup-company.ts:441-449](pages/api/onboarding/setup-company.ts#L441-L449) calls `grantInitialFreeCredit` after creating the company. This is a second entry point to the credits subsystem (the first being bootstrap).

**Coupling assumption:** the credits subsystem's idempotency anchor (`free_credit_claims`) catches duplicate grants regardless of entry point. **VIOLATED** by the category-key mismatch (Finding 9.6 in master audit) — the DB UNIQUE never fires; only app-layer dedup protects.

### 1.5 Super-admin grants → RBAC role mutation → Credits

[super-admin/free-credits/grant.ts:97-118](pages/api/super-admin/free-credits/grant.ts#L97-L118) ensures the recipient is `COMPANY_ADMIN` of the target org BEFORE granting credit. If the recipient was `SUPER_ADMIN` of that org, it **downgrades** them to `COMPANY_ADMIN`:
```
super-admin grant
  → user_company_roles UPDATE role='COMPANY_ADMIN' [RBAC mutation]
  → manual_credit_grants INSERT
  → createCredit → rpc:apply_credit_reservation [credits]
```

**Hidden assumption:** the role downgrade is intentional (prevents super-admin getting personal credits via their own grants). Not documented in code comments.

---

## 2. Transactional coupling (writes intended to be atomic but are not)

Postgres atomicity is per-RPC or per-statement only. Multiple subsystem writes inside one HTTP handler are NOT in a transaction.

### 2.1 `bootstrapCompanyFromSignupIntent` writes 6 tables non-transactionally

Inside [sync-supabase-user.ts:656-776](pages/api/auth/sync-supabase-user.ts#L656-L776), in order:
1. `companies` INSERT (line 656)
2. `company_domains` INSERT via `saveDomainRecord` (line 700)
3. `user_company_roles` INSERT (line 733)
4. `users` UPDATE (line 751-759)
5. `organization_credits` UPSERT, `free_credit_claims` INSERT, `credit_transactions` INSERT (via `grantInitialFreeCredit`, line 765-769)
6. `signup_intents` UPDATE (line 773-776)

If step 3 fails after step 2 succeeded, the `companies` row exists but no admin can access it. If step 5 fails, the user has a company but no credits. Recovery is not automated.

### 2.2 Super-admin DELETE writes 3 stores non-transactionally

[super-admin/users.ts:741-799](pages/api/super-admin/users.ts#L741-L799):
1. `auth.admin.deleteUser` (line 743)
2. `users.update is_deleted=true, deleted_at` (line 762-780)
3. `user_company_roles.update status='inactive'` (line 790-799)

If step 2 fails after step 1 succeeded, the user is "ghosted" (no auth, no soft-delete flag). The comment at [super-admin/users.ts:778](pages/api/super-admin/users.ts#L778) instructs manual SQL to repair.

### 2.3 Invitation accept → user create → role activation is split across HTTP requests

Three requests:
1. `/api/auth/accept-invite` writes `invitations.token_consumed_at`.
2. `signInWithOtp` (Supabase) creates `auth.users` (separate request, after email click).
3. `/api/auth/sync-supabase-user` creates `users` row.
4. `/api/auth/set-password` calls `auth.admin.updateUserById` (writes `auth.users.encrypted_password`) AND `rpc:activate_invitation_membership` (writes `user_company_roles.status='active'`) AND `users.update has_password=true`.

If the user closes the browser between (1) and (4), the invitation is consumed but no auth row was created. Re-clicking the email link returns 400 ALREADY_USED at accept-invite.ts:68-70.

[accept-invite.ts:109-112](pages/api/auth/accept-invite.ts#L109-L112) provides limited rollback: if `signInWithOtp` itself fails synchronously, `token_consumed_at` is reset to NULL. But if the user receives the OTP email and never clicks it, the invitation stays consumed.

### 2.4 Set-password flow couples auth + RBAC + cache

[set-password.ts:54](pages/api/auth/set-password.ts#L54) calls `auth.admin.updateUserById({password})` — writes `auth.users.encrypted_password`.

[set-password.ts:65-100](pages/api/auth/set-password.ts#L65-L100) calls `rpc:activate_invitation_membership` — writes `user_company_roles.status` (and presumably `invitations.accepted_at` per RPC body — not audited).

[set-password.ts:129-132](pages/api/auth/set-password.ts#L129-L132) — `users.update has_password=true`.

If the password update succeeds but the RPC call or the users.update fails, the user has a password set in `auth.users` but `users.has_password` cache is still false → next routing decision sends them back to `/auth/set-password` with `INVALID_RECOVERY_FLOW` (per the gate at [set-password.ts:46-48](pages/api/auth/set-password.ts#L46-L48)).

---

## 3. Rollback coupling

### 3.1 Canonical-domain rejection rollback in sync-supabase-user

[sync-supabase-user.ts:331-342](pages/api/auth/sync-supabase-user.ts#L331-L342) — only triggered on the BRAND-NEW INSERT path:
1. `users.update is_deleted=true, deleted_at`.
2. `auth.admin.deleteUser(supabaseUid)`.

**Does NOT roll back:**
- `signup_intents` row remains.
- If `bootstrapCompanyFromSignupIntent` had already written `companies` (it shouldn't reach that far on rejection — rejection happens before `companies` INSERT — but if it did, the company would persist).
- `auth_audit_logs` rows.

**Coupling gap:** the rollback does not call any subsystem's "undo" hook. Each rollback target is hard-coded in the rollback site.

### 3.2 Invitation token rollback

[accept-invite.ts:109-112](pages/api/auth/accept-invite.ts#L109-L112): `invitations.update token_consumed_at=null` only if `signInWithOtp` errors synchronously.

**Does NOT roll back:**
- A successful `signInWithOtp` followed by user closing the email is unrecoverable.
- The OTP email itself cannot be unsent.

### 3.3 Set-password failure modes

[set-password.ts:57-59](pages/api/auth/set-password.ts#L57-L59): if `auth.admin.updateUserById` fails → 500 returned. No state is mutated, but no rollback either (nothing was mutated yet).

If the call succeeds but downstream RPC or DB write fails: NO rollback. The password is set; the cache is wrong.

### 3.4 Bootstrap rollback does NOT clean up the credit grant

If `grantInitialFreeCredit` succeeds (writes wallet, ledger, claim row) but a later step in the request fails — there is no path to "unwind" the credit. The `apply_credit_reservation` RPC supports RELEASE phase, but no caller invokes it from the bootstrap rollback.

---

## 4. Hidden assumptions (cross-subsystem invariants not enforced by code)

### 4.1 `users.email` is canonical for invitation matching

`invitations.email` is not FK-linked to `users.email`. The acceptance flow ([accept-invite.ts:99-106](pages/api/auth/accept-invite.ts#L99-L106)) calls `signInWithOtp({email})` using the email from the invitation row, then trusts that the eventual `users` row will have a matching email. If the email differs (e.g., user accepts on a different email after some normalization mismatch), the linkage would silently break.

Casing inconsistency across helpers (Section 8 in [identity-duplication-map.md](identity-duplication-map.md)) means the assumption "email is always lower-cased" is best-effort.

### 4.2 `users.id` ↔ `auth.users.id` linkage holds via `users.supabase_uid`

`users.supabase_uid` is the only field linking the two stores. If it's missing or stale:
- `getSupabaseUserFromRequest` falls back to email matching ([supabaseAuthService.ts:148-163](backend/services/supabaseAuthService.ts#L148-L163)).
- `requireAuth` falls back to email matching ([authMiddleware.ts:55-75](backend/middleware/authMiddleware.ts#L55-L75)).

**Hidden assumption:** email matching is acceptable when UID is missing. If a user changes their email in Supabase but the `users.email` is stale, the linkage is broken.

### 4.3 `user_company_roles.user_id` always corresponds to a non-deleted `users.id`

No FK constraint visible in source enforces this. Soft-delete via `users.is_deleted=true` does NOT cascade-update `user_company_roles`. The super-admin DELETE path ([super-admin/users.ts:790-799](pages/api/super-admin/users.ts#L790-L799)) explicitly sets `status='inactive'` to compensate, but the canonical-domain rollback at sync-supabase-user.ts:331-342 does NOT touch `user_company_roles` (because they wouldn't have been created yet on that path). Other deletion paths do not exist.

### 4.4 `companies.admin_email_domain` is the truth for "first-time bootstrap" matching

[sync-supabase-user.ts:437-461](pages/api/auth/sync-supabase-user.ts#L437-L461) checks `companies WHERE admin_email_domain=emailDomain` to detect "domain already claimed" branches. **Assumption:** this column is always set when a company has a domain. **Violated** by super-admin override paths that may bypass `companies.admin_email_domain` write.

### 4.5 Free-email skip in bootstrap == user goes through onboarding/setup-company

[sync-supabase-user.ts:427-428](pages/api/auth/sync-supabase-user.ts#L427-L428) early-returns for free-email domains. The implicit assumption is that the user will reach `/onboarding/setup-company` next. But there's no enforcement — the user could in principle be stuck in a partial state if the front-end fails to route them to setup-company.

### 4.6 Pending-invitation skip == invited user goes through accept-invite

[sync-supabase-user.ts:402-410](pages/api/auth/sync-supabase-user.ts#L402-L410) early-returns for users with pending invitations. **Assumption:** the user came in via accept-invite.ts and the invitation flow will complete via set-password.ts. **Violated** if the invitation row exists but the user reached sync-supabase-user via a different entry (e.g., direct sign-up using the invited email).

### 4.7 `apply_credit_reservation` RPC is atomic

The RPC ([20260322_wallet_reservation.sql:119](supabase/migrations/20260322_wallet_reservation.sql#L119), rewritten in [20260323_remove_balance_credits.sql](supabase/migrations/20260323_remove_balance_credits.sql)) is the only safe path to mutate `organization_credits` AND `credit_transactions` atomically. **Assumption:** all credit mutations go through this RPC. **Held** in production code (no direct UPDATEs on `organization_credits` outside the UPSERT in initialFreeCreditService.ts:79-90).

### 4.8 `super_admin_session=1` is honored equivalently across endpoints

Cookie auth is checked inline at most super-admin endpoints. **Assumption:** the inline check is consistent across endpoints. Not enforced via shared helper. [/api/super-admin/session.ts:18](pages/api/super-admin/session.ts#L18) violates this — it ignores the cookie.

### 4.9 `content_architect_session=1` represents a special "platform privilege" identity

The cookie's special handling at [rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240) maps the literal user_id `'content_architect'` to `Role.COMPANY_ADMIN` of any company. **Hidden assumption:** any code path that calls `getUserRole(content_architect, anyCompanyId)` accepts this identity as a real user. This bypasses normal RBAC scoping.

---

## 5. Coupling diagram

```
                                    ┌─────────────┐
                                    │   AUTH      │
                                    │ (Supabase + │
                                    │   sync)     │
                                    └──┬──┬──┬───┘
                                       │  │  │
                  ┌────────────────────┘  │  └────────────────┐
                  │                       │                   │
                  │                       │                   │
                  ▼                       ▼                   ▼
          ┌─────────────┐         ┌─────────────┐    ┌─────────────┐
          │  COMPANY    │         │ ONBOARDING  │    │   RBAC      │
          │  BOOTSTRAP  │◄───────►│             │◄──►│             │
          └──┬──┬──┬───┘         └──┬──────────┘    └──┬──────────┘
             │  │  │                │                   │
             │  │  │                │                   │
             │  │  └─────────────┐  │                   │
             │  │                │  │                   │
             ▼  ▼                ▼  ▼                   │
       ┌──────────┐        ┌──────────┐                 │
       │ DOMAIN   │        │ CREDITS  │                 │
       │ VERIFY   │        │  (wallet)│                 │
       └──┬───────┘        └──┬───────┘                 │
          │                   │                         │
          │                   │                         │
          └───────────────────┴────────►◄───────────────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │ INVITATIONS  │
                          │  (issuance + │
                          │  acceptance) │
                          └──────┬───────┘
                                 │
                                 │ (uses Auth's
                                 │  signInWithOtp;
                                 │  bypasses Domain
                                 │  Verify in bootstrap)
                                 │
                                 ▼
                              [back to Auth]
```

---

## 6. Coupling summary

| Coupling type | Pair | Severity |
|---|---|---|
| Synchronous in-line | Auth ↔ Bootstrap ↔ Domain ↔ Credits ↔ RBAC | High — one request, 5 subsystems |
| Synchronous (request-cycle) | Invitations ↔ Auth ↔ RBAC | Medium — 3 subsystems, multi-request flow |
| Synchronous (every request) | RBAC ↔ Auth | High — but uncached and tolerated |
| Transactional | None of the above | CRITICAL — no transactions span subsystems |
| Rollback | Auth → Bootstrap (canonical rejection only) | Medium — incomplete rollback, manual repair common |
| Rollback | Invitations → Auth (token reset on signInWithOtp fail only) | Low — narrow case |
| Rollback | Set-password (none) | High — partial state on failure |
| Hidden assumption | `users.email` lower-case canonical | High — 17 normalization sites, 2 bypasses |
| Hidden assumption | `users.supabase_uid` ↔ `auth.users.id` linkage | High — 3 reconciliation sites |
| Hidden assumption | Bootstrap free-email skip → onboarding routes user to setup-company | Medium — frontend dependency |
| Hidden assumption | Pending-invitation skip → user came via accept-invite | High — silent bypass of canonical-domain check |
| Hidden assumption | All credit mutations via apply_credit_reservation RPC | Held in current code; brittle to future direct UPDATEs |
| Hidden assumption | Cookie super-admin sessions are equivalent across endpoints | Violated by /api/super-admin/session.ts |
| Hidden assumption | Content Architect cookie acts as company-admin everywhere | Documented in code, but broader than name implies |
