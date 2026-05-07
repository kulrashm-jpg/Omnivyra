# Identity State Authority Matrix — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.**

For each identity state, identifies the canonical owner, the secondary owner(s) read at runtime, the drift risk, and the current observable violations in source.

---

## State 1 — `authenticated`

| Aspect | Value |
|---|---|
| **Canonical owner** | `auth.users` (Supabase JWT signing key validates the token) |
| **Secondary owner** | `public.users.supabase_uid` (linkage); cookie patterns (`sb-*-auth-token`, `auth-token`, `supabase-auth` per [supabaseAuthService.ts:14-57](backend/services/supabaseAuthService.ts#L14-L57)) |
| **Drift risk** | LOW — Supabase rejects invalid tokens at the boundary. |
| **Current violations** | (1) [supabaseAuthService.ts:91-103](backend/services/supabaseAuthService.ts#L91-L103) has a **dev-only JWT-claims fallback** when `auth.getUser` times out (5s) — bypasses Supabase verification. (2) Three cookie patterns supported with no documented preference; whichever the deployment sets is the de-facto authority. |

---

## State 2 — `verified` (email confirmed)

| Aspect | Value |
|---|---|
| **Canonical owner** | `auth.users.email_confirmed_at` (Supabase) |
| **Secondary owner** | `public.users.is_email_verified` (denormalized boolean) |
| **Drift risk** | LOW for security (Supabase enforces); MEDIUM for app logic (the cache is forced `true` unconditionally on every sync). |
| **Current violations** | [sync-supabase-user.ts:172,235,289](pages/api/auth/sync-supabase-user.ts) sets `is_email_verified=true` on every sync regardless of upstream state. If Supabase changes its verification model (e.g., re-verification flow), the cache will be wrong. [verify-email.ts:65-82](pages/api/auth/verify-email.ts#L65-L82) backstop INSERTs `is_email_verified=true` for unsynced users — second writer with same forcing pattern. |

---

## State 3 — `invited` (invitation pending)

| Aspect | Value |
|---|---|
| **Canonical owner** | `invitations` row tuple `(accepted_at, revoked_at, token_consumed_at, expires_at)` |
| **Secondary owner** | `user_company_roles.status='invited'` (denormalized side-effect) |
| **Drift risk** | HIGH — two state machines, three flip points. |
| **Current violations** | (1) `invitations.accepted_at` is set ONLY at [team/accept-invite.ts:120](pages/api/team/accept-invite.ts#L120). The standard set-password flow uses `activate_invitation_membership` RPC ([20260420_lockdown_idempotency.sql:136](supabase/migrations/20260420_lockdown_idempotency.sql#L136)) which flips `user_company_roles.status` but the RPC body would need to be inspected to confirm whether it also stamps `invitations.accepted_at`. (2) `user_company_roles.status` flips `invited→active` from 4 paths: setup-company.ts:159-162, company/users.ts:267, company/users.ts:543, RPC. (3) No DELETE of expired invitations — they accumulate. (4) No "revoke pending invitation" endpoint — only implicit revoke via `normalizeInvitationState` ([invitationService.ts:25-40](backend/services/invitationService.ts#L25-L40)) when re-issuing. |

---

## State 4 — `active` (member of an organization)

| Aspect | Value |
|---|---|
| **Canonical owner** | `user_company_roles.status='active'` per `(user_id, company_id)` |
| **Secondary owner** | `users.company_id` (deprecated, still written); `users.active_company_id` (canonical per migration) |
| **Drift risk** | CRITICAL — 3 storage locations, multiple writers, no canonical aggregator. |
| **Current violations** | (1) [team/accept-invite.ts:151](pages/api/team/accept-invite.ts#L151) writes `users.company_id` but NOT `users.active_company_id` — drift on each team-invite acceptance. (2) [post-login-route.ts:108-113](pages/api/auth/post-login-route.ts#L108-L113) writes `users.company_id` and `users.role` on every post-login route call — backfilling the deprecated column. (3) [sync-supabase-user.ts:751-759](pages/api/auth/sync-supabase-user.ts#L751-L759) writes BOTH `company_id` and `active_company_id`. (4) No code path keeps `users.company_id` in sync with `user_company_roles` after the initial write. (5) Reads inconsistent: [verify-email.ts:166](pages/api/auth/verify-email.ts#L166) reads `company_id`; domain endpoints ([domain/verification-status.ts:95](pages/api/domain/verification-status.ts#L95) etc) read `active_company_id`. |

---

## State 5 — `deleted` (soft-deleted user)

| Aspect | Value |
|---|---|
| **Canonical owner** | `users.is_deleted=true` + `users.deleted_at` |
| **Secondary owner** | `auth.users` row absence (after `auth.admin.deleteUser`); `user_company_roles.status='inactive'` (cascade); `users.email` UNIQUE remains — email permanently reserved |
| **Drift risk** | HIGH — soft-delete + auth-delete + role-deactivation are NOT atomic. |
| **Current violations** | (1) [super-admin/users.ts:741-758](pages/api/super-admin/users.ts#L741-L758) deletes auth FIRST; if subsequent `users.update is_deleted=true` (line 762) fails, user is ghosted (no auth row, no soft-delete flag). Manual SQL fix is the documented remediation per comment at line 778. (2) [sync-supabase-user.ts:331-342](pages/api/auth/sync-supabase-user.ts#L331-L342) rollback: `users.update is_deleted=true` THEN `auth.admin.deleteUser`. If auth delete fails after soft-delete succeeds, app sees deleted user but auth still has row. (3) `users.email` UNIQUE constraint blocks re-signup forever per [20260323_email_reuse_policy.sql](supabase/migrations/20260323_email_reuse_policy.sql) — combined with rollback paths, a transient failure can permanently lock out a user. (4) 14 read sites depend on `users.is_deleted`; any new deletion path that forgets to set the flag creates a silent leak. |

---

## State 6 — `company-admin` (org-level privilege)

| Aspect | Value |
|---|---|
| **Canonical owner** | `user_company_roles WHERE role='COMPANY_ADMIN' AND status='active'` |
| **Secondary owner** | `users.role='COMPANY_ADMIN'` (legacy); inferred from `companies` ownership (no FK exists) |
| **Drift risk** | HIGH |
| **Current violations** | (1) Writers: 11 sites write `user_company_roles.role` (no CHECK constraint), 6 sites write `users.role`. After initial bootstrap, no path keeps them aligned. (2) The "one active admin" guard at [super-admin/users.ts:382-396](pages/api/super-admin/users.ts#L382-L396) and [company/users.ts:519-536](pages/api/company/users.ts#L519-L536) reads ONLY `user_company_roles`. (3) No atomic "transfer admin" path — must demote then promote, leaving company admin-less mid-flight. (4) `user_company_roles.role` has no DB CHECK; bypasses can insert junk roles. |

---

## State 7 — `super-admin` (platform-level privilege)

| Aspect | Value |
|---|---|
| **Canonical owner** | `user_company_roles WHERE role='SUPER_ADMIN'` (DB-backed) |
| **Secondary owner** | (1) Cookie `super_admin_session=1` — env-credential auth, not bound to `users.id`. (2) Cookie `content_architect_session=1` — separate platform privilege, also not bound. |
| **Drift risk** | CRITICAL — three competing identities accepted by different endpoints. |
| **Current violations** | (1) [/api/super-admin/session.ts:18](pages/api/super-admin/session.ts#L18) reads ONLY DB-backed authority. UI branching on this returns `{isSuperAdmin:false}` for cookie-only sessions. (2) Every write endpoint accepts cookie OR DB ([free-credits/grant.ts:20-26](pages/api/super-admin/free-credits/grant.ts#L20-L26), [purchases/complete.ts:24-30](pages/api/super-admin/purchases/complete.ts#L24-L30), [plans/create.ts:7-16](pages/api/super-admin/plans/create.ts#L7-L16)). (3) `super_admin_session` cookie has no `actor_user_id` — audit rows attributable only to "the cookie session" (`actor_user_id=null` for grants — see [free-credits/grant.ts:55](pages/api/super-admin/free-credits/grant.ts#L55) and [identity-write-surface-map.md](identity-write-surface-map.md)). (4) `isSuperAdmin` and `isPlatformSuperAdmin` ([rbacService.ts:249-269](backend/services/rbacService.ts#L249-L269)) have IDENTICAL bodies — duplicate. (5) `enforceRole` calls both in parallel ([rbacService.ts:289-293](backend/services/rbacService.ts#L289-L293)) — duplicate DB roundtrip. (6) Content Architect cookie aliases to COMPANY_ADMIN of any company per [rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240) — broader privilege than the cookie's name implies. |

---

## State 8 — `onboarding-complete`

| Aspect | Value |
|---|---|
| **Canonical owner** | NONE — no single field. The composite predicate is: `users.has_password=true` AND `users.name IS NOT NULL` AND existence of `user_company_roles WHERE status='active'` AND `users.onboarding_state='company_complete'` |
| **Secondary owner** | `users.onboarding_state` (string enum-ish); each gate computes its own check |
| **Drift risk** | HIGH — no canonical aggregator; each endpoint computes independently. |
| **Current violations** | (1) [post-login-route.ts:62-92](pages/api/auth/post-login-route.ts#L62-L92) is the closest thing to an aggregator but it cascades through 4 independent gates and doesn't write any composite state. (2) `users.onboarding_state` values seen at runtime: `pending_verification`, `verified`, `company_complete`, default `'active'`. No enum constraint visible. (3) [verify-email.ts:110-122](pages/api/auth/verify-email.ts#L110-L122) only advances `pending_verification → verified`. The hop to `company_complete` happens at sync-supabase-user.ts:757 / setup-company.ts:198/404 / onboarding/complete.ts:302. Multiple writers, different conditions. (4) A user with `onboarding_state='company_complete'` but a NULL `name` is re-routed to `/onboarding/profile` by [post-login-route.ts](pages/api/auth/post-login-route.ts) — meaning the state name is misleading. |

---

## State 9 — `password-enabled` (user has a password)

| Aspect | Value |
|---|---|
| **Canonical owner** | `auth.users.encrypted_password IS NOT NULL` (queried via `rpc:auth_user_has_password` from [20260422_auth_user_has_password_fn.sql:11](supabase/migrations/20260422_auth_user_has_password_fn.sql#L11)) |
| **Secondary owner** | `public.users.has_password` (denormalized boolean) |
| **Drift risk** | MEDIUM — denorm cached at sync, then read directly in 6 routing decisions. Not refreshed except on subsequent sync. |
| **Current violations** | (1) The RPC is called only at [sync-supabase-user.ts:147-165](pages/api/auth/sync-supabase-user.ts#L147-L165). All other reads use the denorm. (2) [set-password.ts:54](pages/api/auth/set-password.ts#L54) calls `auth.admin.updateUserById({password})` and then sets `users.has_password=true` ([set-password.ts:129-132](pages/api/auth/set-password.ts#L129-L132)). If the auth call succeeds but the DB UPDATE fails, the truth has flipped but the cache hasn't — user sees `INVALID_RECOVERY_FLOW` errors on next attempt. (3) RPC fail-open returns `false` ([sync-supabase-user.ts:147-165](pages/api/auth/sync-supabase-user.ts#L147-L165)) — a transient RPC failure will downgrade the cache to `false`, forcing a user back through `/auth/set-password`. |

---

## State 10 — `credit-ownership` (org wallet)

| Aspect | Value |
|---|---|
| **Canonical owner** | `organization_credits.{free,paid,incentive}_balance` minus `reserved_*` |
| **Secondary owner** | `credit_transactions` (immutable ledger — reconstructable but not authoritative); `free_credit_claims` (idempotency anchor for free grants); `manual_credit_grants` (idempotency anchor for admin grants); `credit_purchases` (idempotency anchor for purchases); `usage_meter_monthly` (independent token/cost meter — NOT credits) |
| **Drift risk** | LOW for spending decisions (single source: wallet); MEDIUM for reconciliation. |
| **Current violations** | (1) **Category-key mismatch**: `free_credit_claims.category='initial_free_credit'` ([initialFreeCreditService.ts:28](backend/services/initialFreeCreditService.ts#L28)) but DB UNIQUE is `WHERE category='initial'` ([20260322_domain_credit_hardening.sql:22-24](supabase/migrations/20260322_domain_credit_hardening.sql#L22-L24)). DB-level UNIQUE silently inactive. Only app-layer dedup ([initialFreeCreditService.ts:46-55](backend/services/initialFreeCreditService.ts#L46-L55)) protects against double-grant. (2) **Initial-credit amount drift**: code fallback 50/14d ([initialFreeCreditService.ts:29-30](backend/services/initialFreeCreditService.ts#L29-L30)); DB seed `('initial', 300, 14, true)` ([20260322_domain_credit_hardening.sql:38](supabase/migrations/20260322_domain_credit_hardening.sql#L38)); UI advertises "300 free credits" ([create-account.tsx:273](pages/create-account.tsx#L273)). Runtime grants 50 because the seed key never matches. (3) **Admin grants conflate categories**: [free-credits/grant.ts:81](pages/api/super-admin/free-credits/grant.ts#L81) writes ALL admin grants (including `referral`, `feedback`, `setup`) to category `paid` — they should be `incentive` or `free` based on intent. (4) `manual_credit_grants.granted_by` is NULL for cookie-only super-admin actors — audit gap. (5) `usage_meter_monthly` and `usage_threshold_alerts` live in [database/](database/) NOT [supabase/migrations/](supabase/migrations/) — provenance unclear. |

---

## State 11 — `session` (logged-in browser)

| Aspect | Value |
|---|---|
| **Canonical owner** | Supabase JWT in cookie (3 patterns: `sb-*-auth-token`, `auth-token`, `supabase-auth`) |
| **Secondary owner** | Bearer header `Authorization: Bearer <token>`; `super_admin_session=1` cookie; `content_architect_session=1` cookie |
| **Drift risk** | MEDIUM |
| **Current violations** | (1) `extractCookieToken` ([supabaseAuthService.ts:14-57](backend/services/supabaseAuthService.ts#L14-L57)) supports 3 cookie patterns; first match wins by iteration order. No documented preference. (2) Password change does NOT invalidate other sessions: [set-password.ts:54](pages/api/auth/set-password.ts#L54) calls `auth.admin.updateUserById({password})` only; no `auth.admin.signOut(userId)` call exists in the entire codebase. A compromised account whose password is reset by the user remains compromised in any pre-existing browser sessions until JWT expiry (~1h access + ~1week refresh). (3) `super_admin_session=1` cookie session has Max-Age=86400 (24h) — no rotation, no MFA, no per-session audit identity. |

---

## State 12 — `domain claim` (which company owns a domain)

| Aspect | Value |
|---|---|
| **Canonical owner** | `company_domains` rows where `is_primary=true` AND `verification_status='verified'` |
| **Secondary owner** | `companies.admin_email_domain` (UNIQUE, denormalized); `companies.is_domain_verified` (boolean cache) |
| **Drift risk** | HIGH |
| **Current violations** | (1) `bootstrapCompanyFromSignupIntent` writes BOTH `companies.admin_email_domain` (line 660) AND `company_domains` via `saveDomainRecord` (line 700). Super-admin `override_domain` path writes ONLY `company_domains` ([super-admin/users.ts:467](pages/api/super-admin/users.ts#L467)) — `companies.admin_email_domain` becomes stale. (2) Domain reassignment via `reassignDomain` ([super-admin/users.ts:513](pages/api/super-admin/users.ts#L513)) updates `company_domains.company_id` but does NOT update `companies.admin_email_domain` on either company. (3) `companies.is_domain_verified` is set independently from `company_domains.verification_status`. |

---

## State 13 — `domain verification status`

| Aspect | Value |
|---|---|
| **Canonical owner** | `company_domains.verification_status` (enum-ish: `pending`, `verified`, `admin_override`) |
| **Secondary owner** | `companies.is_domain_verified` (boolean) |
| **Drift risk** | MEDIUM |
| **Current violations** | (1) Display reads `companies.is_domain_verified` ([super-admin/companies.ts:20,90,121](pages/api/super-admin/companies.ts)). Verification logic reads `company_domains.verification_status`. (2) When the verification flow flips status to `verified`, no code path in the audit confirms the boolean is also set. |

---

## State 14 — Composite "user can spend credits" predicate

| Aspect | Value |
|---|---|
| **Canonical owner** | composite: `assertOrgMembership` ([requestAccessService.ts:78-90](backend/services/requestAccessService.ts#L78-L90)) returns true if `user_company_roles.status='active'` OR `isPlatformSuperAdmin` |
| **Secondary owner** | None |
| **Drift risk** | LOW |
| **Current violations** | (1) `assertOrgMembership` is called at only TWO sites: [activity-workspace/content.ts:471](pages/api/activity-workspace/content.ts#L471) and [creditExecutionService.ts:322](backend/services/creditExecutionService.ts#L322). Other credit-spending paths rely on different gates (e.g., `enforceRole` for content generation endpoints). (2) The Content Architect cookie maps to COMPANY_ADMIN of any company at the role level ([rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240)) — but `assertOrgMembership`'s direct DB check would NOT recognize the Content Architect identity (which has no `users.id`). |

---

## Aggregate state-authority drift summary

| State | # canonical-owner writers | # secondary writers | Drift severity |
|---|---:|---:|---|
| authenticated | 0 (Supabase) | 5 cookie/Bearer entry points | LOW |
| verified | 0 (Supabase) | 4 (sync, verify-email, onboarding/complete) | LOW |
| invited | 1 (invitationService) | 4 status-flip writers | HIGH |
| active | 11+ (`user_company_roles`) | 6+ (`users.company_id`/`active_company_id`) | CRITICAL |
| deleted | 2 | 1 (auth-row delete) + cascade | HIGH |
| company-admin | 11 (`user_company_roles.role`) | 6 (`users.role`) | HIGH |
| super-admin | 1 DB role + 2 cookies | — | CRITICAL (3 competing) |
| onboarding-complete | NONE (composite) | 4 partial writers | HIGH |
| password-enabled | 1 (auth admin) | 1 cache writer | MEDIUM |
| credit-ownership | 1 RPC | 5 idempotency tables | MEDIUM |
| session | 1 (Supabase) | 3 cookie types | MEDIUM |
| domain claim | 1 (`company_domains`) | 2 (`companies.admin_email_domain`/`is_domain_verified`) | HIGH |
