# Identity Phase 1 — Final Authority Map (Wave 1)

**Branch:** `identity-spine-consolidation`
**Wave:** 1 of 3
**Date:** 2026-05-07

This document records the canonical owner per identity dimension after Wave 1. Subsequent waves (2 and 3) will drive further consolidation; this map reflects the post-Wave-1 state of the codebase.

---

## Summary table

| Dimension | Final canonical owner (Wave 1) | Wave-1 changes | Next-wave owner if different |
|---|---|---|---|
| **Auth identity** | `auth.users.id` (Supabase) ↔ mirror in `users.supabase_uid` | None — already canonical | — |
| **Auth resolution (request → user)** | `resolveAuthenticatedUser` in `backend/services/authResolver.ts` | Created in Wave 1 (Task 4) | — |
| **Active organization** | `users.active_company_id` | All deprecated `users.company_id` reads/writes removed (Task 1+2) | — |
| **Role (per (user_id, company_id))** | `user_company_roles.role` | All `users.role` reads/writes removed (Task 1+2) | — |
| **Onboarding state** | `users.onboarding_state` | No change | (Wave 2 invariants will codify the state machine) |
| **Email verification** | `auth.users.email_confirmed_at`; mirror in `users.is_email_verified` | No change | — |
| **Password existence** | `auth.users.encrypted_password IS NOT NULL` (via `auth_user_has_password` RPC); cache in `users.has_password` | No change | — |
| **Invitation state** | `invitations` row tuple | No change yet | Wave 2 (Task 6) — single orchestration path + audit event |
| **Deletion** | `users.is_deleted` (soft) + `auth.users` row absence (auth-side) | No change yet | Wave 2 (Task 9) — orchestrated atomic flow |
| **Super-admin (platform privilege)** | Three competing authorities still co-exist: `user_company_roles.role='SUPER_ADMIN'`, `super_admin_session=1` cookie, `content_architect_session=1` cookie, `profiles.is_super_admin` | No change yet | Wave 3 (Task 7) — `user_company_roles` becomes sole authority |
| **Content Architect cross-company privilege** | `content_architect_session=1` cookie + `userId === 'content_architect'` mapping in rbacService.ts | No change yet | Wave 3 (Task 7) — explicit permissioned capability |
| **Credit ownership** | `organization_credits.{free,paid,incentive}_balance` | No change | — |

---

## Per-dimension detail

### Auth identity

- Canonical: `auth.users.id` (Supabase JWT subject).
- Mirrored in `public.users.supabase_uid` (partial UNIQUE per [20260406_multi_tenant_auth_migration.sql:31-33](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L31-L33)).
- Backfill rule: a row matched by email gets a one-shot `supabase_uid` UPDATE, performed only inside `backend/services/authResolver.ts:resolveUserRow`. No other backfill site exists.

### Auth resolution (the spine)

```
Request → resolveAuthenticatedUser(req)
            ├─ extractAccessToken(req)              [Bearer, then cookie patterns]
            ├─ validateTokenWithSupabase(token)     [supabase.auth.getUser, 5s timeout, NO fallback]
            ├─ resolveUserRow(supabaseUid, email)   [supabase_uid match → email match → backfill]
            └─ enforce users.is_deleted === false
            → ResolveResult { user: { id, supabaseUid, email, emailVerified } }
                    │
                    └─ Adapters:
                         - lib/auth/serverValidation.ts:verifySupabaseAuthHeader (Bearer-only)
                         - backend/services/supabaseAuthService.ts:getSupabaseUserFromRequest
                         - backend/middleware/authMiddleware.ts:requireAuth + resolveActorId
                         - validateAuthToken (re-export of validateTokenWithSupabase)
```

### Active organization

- Canonical: `users.active_company_id`.
- Pre-Wave-1: `users.company_id` was read by 6 sites and written by 7. The migration declared it "frozen" but runtime ignored that.
- Post-Wave-1: zero runtime reads of `users.company_id` (only an audit-comment reference remains in `pages/api/blog/[slug]/campaign-signal.ts:8`). Zero writes. Column DROP migration deferred.
- Where `users.active_company_id` is set:
  - sync-supabase-user.ts bootstrap (work-email path)
  - sync-supabase-user.ts email-match restore (existing user re-syncs)
  - sync-supabase-user.ts brand-new INSERT pre-link from pending invitation
  - onboarding/complete.ts after role creation
  - onboarding/setup-company.ts (4 paths)
  - team/accept-invite.ts after membership insert

### Role authority

- Canonical: `user_company_roles.role` per (user_id, company_id).
- Pre-Wave-1: a parallel global `users.role` was read by routing/RBAC and written by 6 sites.
- Post-Wave-1: zero runtime reads of `users.role`. Zero writes. RBAC reads come exclusively from `user_company_roles`.
- Routing decision: `pages/api/auth/post-login-route.ts` derives the role purely from `user_company_roles`; no fast-path/cache.

### Onboarding state

- Canonical: `users.onboarding_state` enum-ish value.
- Wave-1 didn't touch the state machine; Wave 2 will codify invariants.
- States seen at runtime: `pending_verification`, `verified`, `company_complete`, default `'active'`.
- Routing decisions consult: `users.onboarding_state` + `users.has_password` + `users.name` + `user_company_roles` rows.

### Invitation state

- Canonical: `invitations` row tuple `(accepted_at, revoked_at, token_consumed_at, expires_at)`.
- Activation flips `user_company_roles.status` invited→active via `activate_invitation_membership` RPC ([20260420_lockdown_idempotency.sql:136](supabase/migrations/20260420_lockdown_idempotency.sql#L136)).
- Wave 2 (Task 6) will:
  - Add a mandatory audit event `invitation_canonical_domain_bypass` for the bypass path in `bootstrapCompanyFromSignupIntent`.
  - Centralize the activation orchestration into a single deterministic entry point.

### Deletion

- Canonical (post-Wave-1): unchanged from pre-Wave-1.
- Wave 2 (Task 9) will create a single deletion orchestration with transactional sequencing across `auth.users`, `users.is_deleted`, `user_company_roles.status`.

### Super-admin

- **Pre-Wave-1 + post-Wave-1 (unchanged):** three competing authorities accepted by different endpoints.
  - DB: `user_company_roles.role='SUPER_ADMIN'`. Currently zero rows in production (verified via DB query).
  - Cookie: `super_admin_session=1` (env credential).
  - Cookie: `content_architect_session=1`.
  - Column: `profiles.is_super_admin` (read by `pages/api/super-admin/plans/analytics.ts:59`, `pages/api/admin/external-users.ts:65,69`, `pages/api/admin/access-requests/{reject,list,delete}.ts`).
- **Wave 3 (Task 7)** will:
  - Provision a canonical SUPER_ADMIN row in `user_company_roles` (the user's confirmation #1 prerequisite).
  - Remove the cookie authority paths.
  - Remove `profiles.is_super_admin` reads.
  - Remove the `userId === 'content_architect'` → `Role.COMPANY_ADMIN` mapping in rbacService.ts.

### Content Architect

- Pre-Wave-1 + post-Wave-1: `content_architect_session=1` cookie maps to `Role.COMPANY_ADMIN` of any company per [backend/services/rbacService.ts:238-240](backend/services/rbacService.ts).
- Wave 3 will replace this with an explicit permissioned capability.

### Credit ownership

- Canonical: `organization_credits.{free,paid,incentive}_balance` (per-org wallet).
- All wallet mutations go through the `apply_credit_reservation` RPC. This was already canonical pre-Wave-1; Wave 1 didn't touch it.

---

## Authority drift remediation log

| Concern | Pre-Wave-1 drift score | Post-Wave-1 | Wave that closes it |
|---|---|---|---|
| Auth identity | LOW | LOW | — |
| Auth resolution | HIGH (3 helpers, duplicate logic) | LOW (1 canonical, 3 thin facades) | Wave 1 (now) |
| Active org | CRITICAL (deprecated column written by 7 sites) | LOW (single canonical column written by all sites) | Wave 1 (now) |
| Role | CRITICAL (2 parallel storage locations) | LOW (`users.role` no longer read/written) | Wave 1 (now) |
| Email verification | LOW | LOW | — |
| Password existence | MEDIUM (cache drift risk) | MEDIUM | (not in this consolidation) |
| Invitation state | HIGH | HIGH (unchanged) | Wave 2 |
| Deletion | HIGH (non-atomic) | HIGH (unchanged) | Wave 2 |
| Super-admin | CRITICAL (3 competing) | CRITICAL (unchanged) | Wave 3 |
| Content Architect | CRITICAL (global escalation) | CRITICAL (unchanged) | Wave 3 |
| Credit ownership | LOW | LOW | — |
