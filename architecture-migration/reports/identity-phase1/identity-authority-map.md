# Identity Authority Map — Phase 1

**Repo:** `c:\virality` (Next.js Pages Router, Supabase, PostgreSQL)
**Branch:** `identity-spine-enforcement`
**Audit date:** 2026-05-07
**Status:** Source-grounded. NO fixes, NO refactor proposals.

This document inventories every identity concern with **competing sources of truth**, the **runtime winner** (which read path actually decides at request time), and the **drift risk** when those sources disagree.

---

## Top-line table

| Concern | Source of truth (canonical owner) | Competing source (read in code) | Runtime winner | Risk |
|---|---|---|---|---|
| **User identity (auth)** | `auth.users.id` (Supabase) | `public.users.supabase_uid` (back-fill); `public.users.id` (app PK) | Whichever the calling code reads — `getSupabaseUserFromRequest` returns `auth.users.id` ([supabaseAuthService.ts:122-163](backend/services/supabaseAuthService.ts#L122-L163)) but middleware code paths frequently use `users.id` for FK joins | HIGH — dual-keyed identity. `auth.users.id` is the JWT subject; `users.id` is the FK referenced everywhere else. The two are linked only via `users.supabase_uid`. |
| **Email** | `auth.users.email` (Supabase) | `public.users.email` (lower-cased UNIQUE) | `auth.users.email` for token validation; `public.users.email` for app lookups (case normalization varies) | HIGH — see Findings 9.16 in master audit. Casing inconsistency across helpers. |
| **Email verification** | `auth.users.email_confirmed_at` (Supabase) | `public.users.is_email_verified` (boolean) | `public.users.is_email_verified` is forced to `true` in [sync-supabase-user.ts:172](pages/api/auth/sync-supabase-user.ts#L172), [235](pages/api/auth/sync-supabase-user.ts#L235), [289](pages/api/auth/sync-supabase-user.ts#L289). Read by [verify-email.ts](pages/api/auth/verify-email.ts) for routing decisions. | LOW — `auth.users` rejects unconfirmed token bearer at the Supabase boundary; `is_email_verified` is a denormalized cache. |
| **Role (user-level)** | `user_company_roles.role` per `(user_id, company_id)` tuple | `users.role` (legacy global column); `users.company_id`+`users.role` legacy fast path | Mixed. RBAC uses `user_company_roles` ([rbacService.ts:271-300](backend/services/rbacService.ts#L271-L300)), [enforceRole](backend/services/rbacService.ts) and [isSuperAdmin](backend/services/rbacService.ts#L249-L258). But [verify-email.ts:167](pages/api/auth/verify-email.ts#L167), [post-login-route.ts:80](pages/api/auth/post-login-route.ts#L80), [userContextService.ts:111](backend/services/userContextService.ts#L111) still read `users.role`. | CRITICAL — drift between `users.role` and `user_company_roles.role` is unbounded. `users.role` is written in [onboarding/complete.ts:302](pages/api/onboarding/complete.ts#L302), [onboarding/setup-company.ts:404](pages/api/onboarding/setup-company.ts#L404), [team/accept-invite.ts:151](pages/api/team/accept-invite.ts#L151) — all of which set both columns; nothing keeps them in sync after that. |
| **Active organization** | `users.active_company_id` (per `20260406_multi_tenant_auth_migration.sql:30-50`) | `users.company_id` (deprecated/frozen per [20260406:58-64](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L58-L64)); `user_company_roles` rows; `companies.id` | Mixed. `verify-email.ts:166` reads `users.company_id`; domain endpoints read `users.active_company_id` ([domain/verification-status.ts:95](pages/api/domain/verification-status.ts#L95), [domain/track-event.ts:81](pages/api/domain/track-event.ts#L81), [domain/regenerate-token.ts:86](pages/api/domain/regenerate-token.ts#L86)). [sync-supabase-user.ts:751-759](pages/api/auth/sync-supabase-user.ts#L751-L759) writes BOTH. | CRITICAL — migration declares `company_id` frozen but [post-login-route.ts:108-113](pages/api/auth/post-login-route.ts#L108-L113), [verify-email.ts:166](pages/api/auth/verify-email.ts#L166), [sync-supabase-user.ts:754](pages/api/auth/sync-supabase-user.ts#L754), [team/accept-invite.ts:151](pages/api/team/accept-invite.ts#L151), [onboarding/complete.ts:302](pages/api/onboarding/complete.ts#L302), [onboarding/setup-company.ts:166,325,404](pages/api/onboarding/setup-company.ts) all write it. Dual writers + dual readers = state drift. |
| **Company ownership / org root** | `companies.id` | None | `companies.id` | LOW |
| **Company domain claim** | `company_domains` rows (`is_primary=true`) | `companies.admin_email_domain` (UNIQUE per [20260322_domain_credit_hardening.sql:11-18](supabase/migrations/20260322_domain_credit_hardening.sql#L11-L18)); `companies.website_domain` | Mixed. `bootstrapCompanyFromSignupIntent` writes BOTH `companies.admin_email_domain` (line 660) AND `company_domains` via `saveDomainRecord` (line 700). [setup-company.ts:292,349,359](pages/api/onboarding/setup-company.ts) reads `admin_email_domain` directly. [super-admin/companies.ts:20,90,121](pages/api/super-admin/companies.ts) selects all three columns. Per migration [20260406:65-100](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L65-L100), `company_domains` is canonical going forward. | HIGH — two parallel domain-stores. `super-admin/users.ts` POST writes `company_domains` only (override path); bootstrap writes both. Drift: a domain reassignment via `super-admin/users.ts` updates `company_domains` but not `companies.admin_email_domain`. |
| **Domain verification status** | `company_domains.verification_status` (enum: pending / verified / admin_override) | `companies.is_domain_verified` (boolean — read at [super-admin/companies.ts:20,90,121](pages/api/super-admin/companies.ts)) | `companies.is_domain_verified` for display. Real verification logic uses `company_domains.verification_status`. | MEDIUM — denormalized boolean is read but not always updated. |
| **Super-admin (platform-level)** | `user_company_roles WHERE role='SUPER_ADMIN'` | (1) Cookie `super_admin_session=1` (env-credential) ([super-admin/login.ts:7-21](pages/api/super-admin/login.ts#L7-L21)); (2) Cookie `content_architect_session=1` ([content-architect-login.ts:54](pages/api/super-admin/content-architect-login.ts#L54)) | Per-endpoint. Most super-admin endpoints accept cookie OR DB ([free-credits/grant.ts:20-26](pages/api/super-admin/free-credits/grant.ts#L20-L26), [purchases/complete.ts:24-30](pages/api/super-admin/purchases/complete.ts#L24-L30)). `/api/super-admin/session.ts` accepts only DB. | CRITICAL — three competing identities. Cookie sessions have NO bound `users.id` (audit rows show `actor_user_id=null`). See risk register. |
| **Content Architect (platform privilege)** | None — purely cookie-based | `content_architect_session` cookie | Cookie-only. [rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240) maps the literal user_id `'content_architect'` to `Role.COMPANY_ADMIN` for any company. | CRITICAL — privilege escalation: any handler reading the cookie grants effective COMPANY_ADMIN scope on ALL companies. |
| **Onboarding state** | `users.onboarding_state` (enum-like string) | `user_company_roles.status` (active/invited/inactive); `users.has_password`; `users.name` non-null; existence of `user_company_roles` row | [post-login-route.ts:26-140](pages/api/auth/post-login-route.ts#L26-L140) reads ALL of these to compute the routing decision. State machine is stitched across 4 columns. | HIGH — no canonical aggregator. Each endpoint computes its own onboarding-completeness check from disjoint columns. |
| **Password existence** | `auth.users.encrypted_password IS NOT NULL` (via RPC `auth_user_has_password`, defined in [20260422_auth_user_has_password_fn.sql:11](supabase/migrations/20260422_auth_user_has_password_fn.sql#L11)) | `users.has_password` (denormalized boolean) | Mixed. `sync-supabase-user.ts:147-165` calls the RPC, then sets `users.has_password`. Subsequent reads use the denormalized column ([login.ts:69](pages/api/auth/login.ts#L69), [verify-email.ts:157](pages/api/auth/verify-email.ts#L157), [post-login-route.ts:71](pages/api/auth/post-login-route.ts#L71), [resume-status.ts:53](pages/api/auth/resume-status.ts#L53), [set-password.ts:46-52](pages/api/auth/set-password.ts#L46-L52)). | MEDIUM — if `auth.users.encrypted_password` changes via Supabase admin API outside `set-password.ts`, the denorm is stale. |
| **Invitation state** | `invitations` row tuple `(accepted_at, revoked_at, token_consumed_at, expires_at)` | `user_company_roles.status='invited'` (denormalized side-effect) | `invitations` row for token validation; `user_company_roles.status` for member-list rendering. | MEDIUM — flipping `user_company_roles.status` from `invited→active` happens in `activate_invitation_membership` RPC ([20260420_lockdown_idempotency.sql:136](supabase/migrations/20260420_lockdown_idempotency.sql#L136)) and in [setup-company.ts:159-162](pages/api/onboarding/setup-company.ts#L159-L162). The `invitations.accepted_at` is set ONLY at [team/accept-invite.ts:120](pages/api/team/accept-invite.ts#L120) — the pure invitation-acceptance path via `set-password.ts` does NOT stamp `accepted_at` (uses RPC for status flip). |
| **User soft-deletion** | `users.is_deleted=true` + `users.deleted_at` | `auth.users` row absence (after `auth.admin.deleteUser`); `user_company_roles.status='inactive'` (cascade) | `users.is_deleted` for app-level guards (read at 11+ sites — see [identity-read-surface-map.md](identity-read-surface-map.md)). `auth.users` for token validation. | HIGH — soft-delete + auth-delete are NOT atomic. [super-admin/users.ts:741-758,762-780](pages/api/super-admin/users.ts) deletes auth first, then soft-deletes users. If the second step fails, the user has no auth row but no `is_deleted=true` flag — state poisoned. Manual SQL fix is the documented remediation ([super-admin/users.ts:778](pages/api/super-admin/users.ts#L778) comment). |
| **Session state (browser)** | Supabase JWT in cookie `sb-<project>-auth-token` | Three patterns accepted by `extractCookieToken` ([supabaseAuthService.ts:14-57](backend/services/supabaseAuthService.ts#L14-L57)): `sb-*-auth-token`, `auth-token`, `supabase-auth` | First match wins per the function's iteration order. | LOW — multiple patterns supported for compat; no observed runtime impact. |
| **Session state (super-admin/CA cookies)** | None — cookies carry no Supabase user_id | `super_admin_session=1`; `content_architect_session=1`; `content_architect_company_id=<uuid>` | Cookie-only. No `users.id` derivable. | CRITICAL — audit attribution gaps (`actor_user_id=null`). |
| **Credit ownership** | `organization_credits.{free,paid,incentive}_balance` (per-org wallet) | `credit_transactions` (immutable ledger); `usage_meter_monthly`; `free_credit_claims`; `manual_credit_grants` | `organization_credits` for spendable check ([creditPriorityService.ts](backend/services/creditPriorityService.ts) `getTotalAvailable`). Ledger is reconstructed from wallet, never the inverse. | LOW for spending decisions; MEDIUM for reconciliation — multiple grant-tracking tables (`free_credit_claims`, `manual_credit_grants`, `credit_purchases`) feed the same wallet but with different idempotency keys and category mappings (see Finding 9.7 in master audit). |
| **Organization (org_id)** | `companies.id` | `user_company_roles.company_id` (FK); `users.company_id` (deprecated); `users.active_company_id`; `organization_credits.organization_id` | `companies.id` is the FK target. Reads vary — see "Active organization" row above. | HIGH — see "Active organization". |

---

## Identity dimension drilldowns

### Role authority

The `Role` enum at [rbacPrimitives.ts:3-15](backend/services/rbacPrimitives.ts#L3-L15) lists 11 strings, including legacy aliases `ADMIN`, `CONTENT_MANAGER`, `CONTENT_PLANNER`, `CONTENT_ENGAGER`, `VIEWER`. The DB CHECK constraints (Finding 12.1 in master audit) define a different surface:
- `users.role` CHECK: 6 values (no legacy aliases) — [20260331_auth_columns.sql:72-80](supabase/migrations/20260331_auth_columns.sql#L72-L80).
- `invitations.role` CHECK: 5 values, NO `SUPER_ADMIN` — [20260331_invitations.sql:18](supabase/migrations/20260331_invitations.sql#L18).
- `user_company_roles.role`: NO CHECK constraint found in migrations.

`normalizeRole` ([rbacPrimitives.ts:28-40](backend/services/rbacPrimitives.ts#L28-L40)) converts inbound strings to canonical Role enum values. Direct DB writes that bypass `normalizeRole` can introduce un-normalized strings — `user_company_roles.role` has no schema-level guard.

### Active organization authority

Migration [20260406_multi_tenant_auth_migration.sql:58-64](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L58-L64) declares `users.company_id` "frozen and no longer updated". The migration also ran a one-time backfill of `users.active_company_id`. But the application continues to write `users.company_id`:

- [sync-supabase-user.ts:751-759](pages/api/auth/sync-supabase-user.ts#L751-L759) — bootstrap path writes both `company_id` and `active_company_id`.
- [post-login-route.ts:108-113](pages/api/auth/post-login-route.ts#L108-L113) — writes `users.company_id` and `users.role`.
- [team/accept-invite.ts:151](pages/api/team/accept-invite.ts#L151) — writes `users.company_id` (NOT `active_company_id`).
- [onboarding/complete.ts:302](pages/api/onboarding/complete.ts#L302) — writes `users.company_id` and `users.role` and `users.onboarding_state`.
- [onboarding/setup-company.ts:166,325,404](pages/api/onboarding/setup-company.ts) — writes `users.company_id`.

### Super-admin authority — three identities

1. **DB-backed**: `user_company_roles WHERE role='SUPER_ADMIN'`. Read by [isSuperAdmin](backend/services/rbacService.ts#L249-L258) and [isPlatformSuperAdmin](backend/services/rbacService.ts#L260-L269) (identical functions — see [identity-duplication-map.md](identity-duplication-map.md)).
2. **Env-cookie**: `super_admin_session=1`. Set by [super-admin/login.ts:24](pages/api/super-admin/login.ts#L24) after env-credential check. Read by [superAdminSession.ts:6](backend/services/superAdminSession.ts#L6) and inline at most super-admin endpoints.
3. **Content Architect cookie**: `content_architect_session=1`. Set by [content-architect-login.ts:54](pages/api/super-admin/content-architect-login.ts#L54). Read by [contentArchitectService.ts:14,22](backend/services/contentArchitectService.ts).

`/api/super-admin/session.ts:18` returns only the DB-backed result. UI logic that branches on this endpoint will treat cookie-only super-admins as `isSuperAdmin: false`.

### Email verification authority

`auth.users.email_confirmed_at` is the truth — Supabase rejects unconfirmed tokens at the boundary. `users.is_email_verified` is denormalized:
- Forced `true` in [sync-supabase-user.ts:172,235,289](pages/api/auth/sync-supabase-user.ts) — the field is set unconditionally at every sync, even if Supabase's verification state is in flux.
- Re-asserted in [verify-email.ts:114](pages/api/auth/verify-email.ts#L114).
- Read in [verify-email.ts:155-186](pages/api/auth/verify-email.ts#L155-L186) for routing decisions, but app code doesn't gate signin on it (Supabase already did).

### Onboarding state authority

`users.onboarding_state` is the documented owner ([20260406:28-56](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L28-L56)) — values seen at runtime:
- `pending_verification`
- `verified`
- `company_complete`
- `'active'` (default per migration)

Routing decisions in [post-login-route.ts:62-92](pages/api/auth/post-login-route.ts#L62-L92) consult:
- `users.has_password`
- `users.name` (non-null check)
- `users.onboarding_state`
- existence of `user_company_roles` rows

Each gate fires independently — there is no single "is onboarding complete?" predicate. A user with `onboarding_state='company_complete'` but a NULL `name` will be re-routed to `/onboarding/profile`.

### Credit-ownership authority

The wallet (`organization_credits`) is the spend-decision authority. Mutations go exclusively through the `apply_credit_reservation` RPC ([20260322_wallet_reservation.sql:119](supabase/migrations/20260322_wallet_reservation.sql#L119)) called from [creditExecutionService.ts:193,244](backend/services/creditExecutionService.ts).

Idempotency anchors:
- `free_credit_claims` for initial-grant dedup (per `(organization_id, category='initial')` — but the code writes `category='initial_free_credit'`, breaking the DB UNIQUE — see Finding 9.6).
- `manual_credit_grants.id` for super-admin grants.
- `credit_purchases.reference_id` for purchases.
- `credit_transactions.idempotency_key` UNIQUE for all entries.

Source-of-truth for "did this org receive its initial grant?" is `free_credit_claims` (app-layer check at [initialFreeCreditService.ts:46-55](backend/services/initialFreeCreditService.ts#L46-L55)). The DB-level UNIQUE (`category='initial'`) is silently inactive due to the category-key mismatch.

---

## Open authority ambiguities (cannot be resolved from source alone)

1. **`auth_user_confirmed` RPC source.** Referenced in [signup.ts:139](pages/api/auth/signup.ts#L139), [login.ts:53](pages/api/auth/login.ts#L53), [magic-link.ts:52](pages/api/auth/magic-link.ts#L52), [sync-supabase-user.ts:149](pages/api/auth/sync-supabase-user.ts#L149). No CREATE FUNCTION found in `supabase/migrations/`. If absent in production DB, the orphan-detection branches silently degrade.

2. **`users.signup_source`** column — added in [20260406:55-56](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L55-L56). Zero writers found in production code. Authority unclear.

3. **`usage_meter_monthly` and `usage_threshold_alerts`** tables — defined in [database/usage_meter.sql](database/usage_meter.sql) and [database/usage_alerts.sql](database/usage_alerts.sql), NOT in `supabase/migrations/`. Provenance and apply-status unclear.

4. **`20260320_domain_eligibility.sql`** — file content is single byte `r`. The actual `domain_eligibility_cache` table is referenced in [20260320_free_credits_admin.sql:50-61](supabase/migrations/20260320_free_credits_admin.sql#L50-L61) as `ALTER TABLE`, implying creation is elsewhere. Schema drift risk between environments.
