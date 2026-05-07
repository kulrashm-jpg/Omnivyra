# Identity Read Surface Map — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.** Every read site cites file:line.

For each identity field, lists every file that reads it, the surrounding function, the purpose, and a security-criticality classification (RBAC / onboarding / routing / billing / display).

---

## Field criticality legend

- **RBAC-critical** — read participates in an authorization decision (allow/deny).
- **Onboarding-critical** — read decides what the user must complete before normal use.
- **Routing-critical** — read picks the destination URL after auth.
- **Billing-critical** — read affects credit availability or grant decisions.
- **Display-only** — read only renders to the UI; no authorization effect.

---

## 1. `users.role` (legacy global role column)

**Status:** Migration declares `users.company_id` deprecated; `users.role` is in the same boat (per the `user_company_roles` model). Still actively read.

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/verify-email.ts | 167 | handler | Fast-path role read for routing (`const userRole = String((userRow as any).role ?? '').trim()`) | **routing-critical** |
| pages/api/auth/post-login-route.ts | 80 | handler | View-mode routing (`const viewMode = getViewMode(session?.role)`) | **routing-critical** |
| pages/admin/users.tsx | 213 | React component | Form value binding | display-only |
| backend/services/userContextService.ts | 111 | session context builder | Adds role to user context | **RBAC-critical** |

---

## 2. `users.company_id` (deprecated — frozen per migration)

**Status:** Per [20260406:58-64](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L58-L64), this column is "frozen and no longer updated". Still actively read AND written (see [identity-write-surface-map.md](identity-write-surface-map.md)).

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/verify-email.ts | 166 | handler | Fast-path active-company check | **routing-critical** |

The lower count of explicit reads is misleading — `users.company_id` is implicitly used by every JOIN against `users.company_id` in business-logic queries scattered across the codebase. Any caller doing `SELECT * FROM users` and reading `.company_id` from the result counts.

---

## 3. `users.active_company_id`

**Status:** Per migration, the canonical "active company" pointer.

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/sync-supabase-user.ts | 225 | bootstrap (handler) | Restore from `user_company_roles` if missing | **onboarding-critical** |
| pages/api/auth/sync-supabase-user.ts | 233 | bootstrap (handler) | Read existing value to decide back-fill | **onboarding-critical** |
| pages/api/domain/verification-status.ts | 95 | handler | Determine company context for domain operations | **onboarding-critical** |
| pages/api/domain/track-event.ts | 81 | handler | Resolve company for event scoping | **routing-critical** |
| pages/api/domain/regenerate-token.ts | 86 | handler | Resolve company for token operations | **routing-critical** |

---

## 4. `users.supabase_uid`

**Status:** Core auth identity link to `auth.users.id`. Partial UNIQUE index per [20260406:31-33](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L31-L33).

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/super-admin/users.ts | 736 | DELETE handler | Resolve UID for `auth.admin.deleteUser` | **RBAC-critical** |
| backend/services/consumptionAnalyticsService.ts | 310 | analytics roll-up | Email-to-UID mapping for reports | display-only |
| scripts/purge-orphan-auth-users.js | 70 | maintenance script | Match `auth.users` against `users` | billing-critical |
| pages/api/auth/sync-supabase-user.ts | 106-110, 235 | bootstrap | UID-match find + email-match back-fill | **RBAC-critical** |
| backend/services/supabaseAuthService.ts | 138-163 | getSupabaseUserFromRequest | UID-match find + email-match back-fill | **RBAC-critical** |
| backend/middleware/authMiddleware.ts | 55-75 | requireAuth | UID-match find + email-match back-fill | **RBAC-critical** |
| pages/api/auth/post-login-route.ts | 47 | handler | UID OR email match | **routing-critical** |

The UID-match logic is **duplicated three times** across these files (see [identity-duplication-map.md](identity-duplication-map.md)).

---

## 5. `users.has_password`

**Status:** Denormalized boolean cache of `auth.users.encrypted_password IS NOT NULL`. Read in every routing decision.

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/verify-email.ts | 157 | handler | If !has_password → /auth/set-password | **routing-critical** |
| pages/api/auth/set-password.ts | 46-48 | handler | Recovery flow gate (`if flow=recovery && !has_password → INVALID_RECOVERY_FLOW`) | **RBAC-critical** |
| pages/api/auth/set-password.ts | 50-52 | handler | Signup flow gate (`if flow=signup && has_password → INVALID_SIGNUP_FLOW`) | **RBAC-critical** |
| pages/api/auth/resume-status.ts | 53 | handler | State-machine response field | **routing-critical** |
| pages/api/auth/post-login-route.ts | 71 | handler | Routing decision | **routing-critical** |
| pages/api/auth/login.ts | 69 | handler | Pre-login gate (`if !has_password → 400 NO_PASSWORD`) | **routing-critical** |

Six routing/gate sites consume the denormalized boolean. If `auth.users.encrypted_password` is mutated via Supabase admin API outside `set-password.ts`, the cache goes stale.

---

## 6. `users.onboarding_state`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/verify-email.ts | 110 | handler | Advance state pending_verification → verified | **onboarding-critical** |
| pages/api/auth/post-login-route.ts | 70 | handler | Routing decision when state ∈ {verified, pending_verification} → /onboarding/profile | **routing-critical** |

Routing relies on this state PLUS `users.name` non-null PLUS existence of `user_company_roles` rows — there is no single "onboarding complete" predicate.

---

## 7. `users.is_deleted` (soft-delete flag)

**Status:** Read at 11+ sites — the most-read identity field. Written at 2 sites (sync-supabase-user.ts:333 rollback; super-admin/users.ts:762 manual delete).

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/signup.ts | 96 | handler | Block re-signup of soft-deleted account → 403 ACCOUNT_DELETED | **routing-critical** |
| pages/api/auth/login.ts | 65 | handler | Block login → 400 INVALID_CREDENTIALS | **routing-critical** |
| pages/api/auth/magic-link.ts | 64 | handler | Block magic-link → 400 INVALID_CREDENTIALS | **routing-critical** |
| pages/api/auth/check-user.ts | 43 | handler | Public probe excludes soft-deleted | display-only |
| pages/api/auth/resume-status.ts | 41 | handler | State machine | **routing-critical** |
| pages/api/auth/post-login-route.ts | 60 | handler | Block routing → 403 AUTH_001 | **routing-critical** |
| pages/api/auth/sync-supabase-user.ts | 112 | handler | UID-match soft-delete guard → 403 + ghost_session log | **RBAC-critical** |
| pages/api/auth/sync-supabase-user.ts | 128 | handler | Email-match soft-delete guard → 403 | **RBAC-critical** |
| pages/api/onboarding/complete.ts | 87 | handler | Onboarding gate | **onboarding-critical** |
| pages/api/company/users.ts | 111 | findExistingUserByEmail | Skip soft-deleted | **onboarding-critical** |
| pages/api/company/users.ts | 127 | (companion) | Same | **onboarding-critical** |
| pages/api/company/users.ts | 154 | (companion) | Return ACCOUNT_DELETED on retry | **onboarding-critical** |
| pages/api/super-admin/users.ts | 76 | findOrCreateUserByEmail | Block invitation of soft-deleted | **RBAC-critical** |
| backend/services/supabaseAuthService.ts | 145 | getSupabaseUserFromRequest | UID-match → ACCOUNT_DELETED | **RBAC-critical** |
| backend/services/supabaseAuthService.ts | 157 | getSupabaseUserFromRequest | Email-match → ACCOUNT_DELETED | **RBAC-critical** |

Combined with the email-reuse policy ([20260323_email_reuse_policy.sql](supabase/migrations/20260323_email_reuse_policy.sql)) which makes the email permanently reserved, `is_deleted` becomes a hard ban: cannot retry, cannot be invited, cannot be looked up.

---

## 8. `users.is_email_verified`

**Status:** Read rarely outside the verify-email flow. Default `false`, forced `true` on every sync.

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| (none in production gate logic) | — | — | The flag is set unconditionally; no gate code reads it as a gate | display-only |

Note: Supabase's `auth.users.email_confirmed_at` is the actual gate — Supabase rejects unconfirmed token bearer at the boundary.

---

## 9. `user_company_roles.role`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| backend/services/rbacService.ts | 249-258 | isSuperAdmin | `WHERE user_id AND role='SUPER_ADMIN'` | **RBAC-critical** |
| backend/services/rbacService.ts | 260-269 | isPlatformSuperAdmin | Identical to above | **RBAC-critical** |
| backend/services/rbacService.ts | 232 | getUserRole | Returns role for (user_id, company_id) | **RBAC-critical** |
| backend/services/rbacService.ts | 271-300 | enforceRole | Authorization decision | **RBAC-critical** |
| backend/middleware/authMiddleware.ts | 105-130 | requireCompanyAccess | Read role for membership check | **RBAC-critical** |
| pages/api/auth/sync-supabase-user.ts | 221-230 | bootstrap | Read role to restore active_company_id | **onboarding-critical** |
| pages/api/company/users.ts | 307-340 | GET handler | List members | display-only |
| pages/api/super-admin/users.ts | 586-670 | PATCH handler | Read current role before update | **RBAC-critical** |

Combined with `users.role`, there are TWO sources of "what role does this user hold". Drift is unbounded.

---

## 10. `user_company_roles.status`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| backend/services/rbacService.ts | 232 | getUserRole | `WHERE user_id AND company_id AND status='active'` | **RBAC-critical** |
| backend/middleware/authMiddleware.ts | 105-130 | requireCompanyAccess | Membership check | **RBAC-critical** |
| pages/api/auth/sync-supabase-user.ts | 221-230 | bootstrap | Find any active role (`.eq('status','active')`) | **onboarding-critical** |
| pages/api/auth/sync-supabase-user.ts | 390-397 | bootstrap | Skip-if-already-active | **onboarding-critical** |
| pages/api/auth/post-login-route.ts | 80-88 | handler | "no active role → /onboarding/company" | **routing-critical** |
| pages/api/auth/verify-email.ts | 175 | handler | Active membership check | **onboarding-critical** |
| pages/api/onboarding/setup-company.ts | 107-202 | handler | Free-email branch — find pending invite | **onboarding-critical** |
| pages/api/company/users.ts | 307-340 | GET handler | Filter active members | display-only |
| pages/api/super-admin/users.ts | 415-439 | POST handler | One-active-admin guard (ADMIN_TRANSFER_REQUIRED) | **RBAC-critical** |
| pages/api/super-admin/users.ts | 519-536 | PATCH handler | Promotion guard | **RBAC-critical** |
| pages/api/super-admin/free-credits/grant.ts | 97-118 | handler | Verify or set COMPANY_ADMIN before grant | **billing-critical** |
| backend/services/requestAccessService.ts | 78-90 | assertOrgMembership | `WHERE status='active' OR isPlatformSuperAdmin` | **RBAC-critical** |

---

## 11. `companies.admin_email_domain`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/sync-supabase-user.ts | 437-461 | bootstrap | Domain-already-claimed branch | **onboarding-critical** |
| pages/api/onboarding/setup-company.ts | 292 | handler | Domain-first lookup | **onboarding-critical** |
| pages/api/onboarding/setup-company.ts | 349 | handler | INSERT path uses for write | **onboarding-critical** |
| pages/api/onboarding/setup-company.ts | 359 | handler | Confirmation read | **onboarding-critical** |
| pages/api/super-admin/companies.ts | 20, 90, 121 | handlers | Display in API response | display-only |
| pages/api/company/users.ts | 400-419 | POST handler | INVALID_WORK_EMAIL_DOMAIN guard for COMPANY_ADMIN role | **RBAC-critical** |
| pages/api/auth/check-domain.ts | (handler) | handler | Public domain-claimed probe | display-only |

The work-email domain check at [company/users.ts:400-419](pages/api/company/users.ts#L400-L419) is the **only** runtime gate that ties COMPANY_ADMIN role to email domain. Super-admin invites bypass it (Section 13 of master audit).

---

## 12. `companies.is_domain_verified`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/super-admin/companies.ts | 20, 90, 121 | handlers | API response display | display-only |

The boolean is denormalized from `company_domains.verification_status='verified'`. Most consumers read `company_domains` directly.

---

## 13. `companies.free_credit_granted_at`

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| backend/services/initialFreeCreditService.ts | 136-141 | grantInitialFreeCredit | Idempotency gate (`UPDATE ... WHERE NULL`) | **billing-critical** |

Read implicitly via the `WHERE free_credit_granted_at IS NULL` predicate. Not read elsewhere.

---

## 14. `auth.users.id` (Supabase)

Read indirectly through:
- `verifySupabaseAuthHeader` returns `{id, email, emailVerified}` — `id` IS `auth.users.id`.
- `getSupabaseUserFromRequest` returns same shape.
- `supabase.auth.getUser(token)` returns `data.user.id`.

Every authenticated handler reads this transitively. **RBAC-critical** at every site.

---

## 15. `invitations` row state (token_consumed_at, accepted_at, revoked_at, expires_at)

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| pages/api/auth/accept-invite.ts | 60-76 | handler | All four fields gate the consume operation | **RBAC-critical** |
| pages/api/auth/set-password.ts | 64-100 | handler | Find pending invitation for `activate_invitation_membership` | **RBAC-critical** |
| pages/api/auth/sync-supabase-user.ts | 271-292 | bootstrap | Pre-link active_company_id from pending invitation | **onboarding-critical** |
| pages/api/auth/sync-supabase-user.ts | 402-410 | bootstrap | Pending-invitation skip — bypasses canonical-domain check | **RBAC-critical** |
| pages/api/team/accept-invite.ts | (handler) | direct accept | Read all four fields | **RBAC-critical** |
| backend/services/invitationService.ts | 25-40 | normalizeInvitationState | Find prior pending invites to revoke | **RBAC-critical** |

---

## 16. Cookie reads

| File | Line | Cookie | Purpose | Criticality |
|---|---|---|---|---|
| backend/services/superAdminSession.ts | 6 | super_admin_session | Cookie-based super-admin gate | **RBAC-critical** |
| backend/services/contentArchitectService.ts | 14 | content_architect_session | Cookie-based platform privilege gate | **RBAC-critical** |
| backend/services/contentArchitectService.ts | 22 | content_architect_company_id | Optional impersonation target | **RBAC-critical** |
| pages/api/super-admin/free-credits/grant.ts | 20-26 | super_admin_session, content_architect_session | Inline check | **RBAC-critical** |
| pages/api/super-admin/free-credits/activity.ts | 17-23 | (same) | Inline check | **RBAC-critical** |
| pages/api/super-admin/purchases/complete.ts | 24-30 | (same) | Inline check | **billing-critical** |
| pages/api/super-admin/plans/create.ts | 7-16 | (same) | Inline check | **RBAC-critical** |
| backend/services/supabaseAuthService.ts | 14-57 | sb-*-auth-token, auth-token, supabase-auth | extractCookieToken — three patterns | **RBAC-critical** |
| proxy.ts | 45 | content_architect_session | Middleware dispatch | **RBAC-critical** |

---

## 17. Wallet reads (`organization_credits`)

| File | Line | Function | Purpose | Criticality |
|---|---|---|---|---|
| backend/services/creditPriorityService.ts | (getTotalAvailable) | getTotalAvailable | "How many spendable credits?" | **billing-critical** |
| backend/services/creditExecutionService.ts | (multiple) | HOLD/CONFIRM logic | Pre-flight balance check | **billing-critical** |
| backend/services/initialFreeCreditService.ts | 79-90 | UPSERT path | Read-then-upsert | billing-critical |
| pages/api/admin/credits/index.ts | (admin GET) | display | Admin view | display-only |

---

## 18. Read-vs-write asymmetry (top concentration zones)

| Field | # readers | # writers | Asymmetry signal |
|---|---:|---:|---|
| `users.is_deleted` | 14 | 2 | High — 14 gates depend on a flag set by only 2 paths. Any new deletion path that forgets to set the flag creates a silent leak. |
| `users.has_password` | 6 | 4 | Moderate — 6 routing decisions; the `auth.users.encrypted_password` truth is decoupled. |
| `users.role` | 4 (RBAC + routing) | 6 | Inverted — more writers than readers, with `user_company_roles.role` as the parallel authority. |
| `users.company_id` | 1 explicit + many implicit | 6+ | Inverted — deprecated column has more writers than readers. |
| `users.active_company_id` | 5 | 4 | Symmetric. |
| `users.supabase_uid` | 7 (RBAC) | 5 | Symmetric — auth-link integrity. |
| `user_company_roles.role` | 8 | 11+ | High write pressure with no DB CHECK. |
| `user_company_roles.status` | 12 | 12 | Symmetric — but two separate state-flip pathways (`activate_invitation_membership` RPC vs direct UPDATEs). |
| `companies.admin_email_domain` | 7 | 3 | Symmetric. |
| `auth.users.encrypted_password` | 6 (via `users.has_password`) | 1 | High asymmetry — the truth has 1 writer, 6 readers consume the cache. |
