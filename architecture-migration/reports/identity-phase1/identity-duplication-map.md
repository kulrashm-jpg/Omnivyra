# Identity Duplication Map — Phase 1

**Repo:** `c:\virality` — `identity-spine-enforcement` branch
**Source-grounded.**

For every duplicated identity-related responsibility, lists all implementations, their behavioral differences, and which one wins at runtime when both are reachable.

---

## 1. Auth checks (token / session validation)

### 1.1 Three competing auth-resolution helpers

| Helper | File:Line | What it accepts | What it returns |
|---|---|---|---|
| `verifySupabaseAuthHeader` | [serverValidation.ts:30](backend/domain/from-lib/auth/serverValidation.ts#L30) | Bearer header only | `{id, email, emailVerified}` |
| `getSupabaseUserFromRequest` | [supabaseAuthService.ts:122](backend/services/supabaseAuthService.ts#L122) | Bearer header OR `sb-*-auth-token` cookie OR `auth-token` cookie OR `supabase-auth` cookie | `{user, error}` where user is augmented with soft-delete check |
| `requireAuth` | [authMiddleware.ts:39](backend/middleware/authMiddleware.ts#L39) | Calls `verifySupabaseAuthHeader` then back-fills `users.supabase_uid` | `{user: AuthUser} \| null` (sends 401 on failure) |

**Behavioral differences:**
- `verifySupabaseAuthHeader` does NOT check `users.is_deleted`. Bearer-only.
- `getSupabaseUserFromRequest` checks `is_deleted` at lines 145, 157 → returns `error: 'ACCOUNT_DELETED'`. Cookie OR Bearer.
- `requireAuth` calls `verifySupabaseAuthHeader` then does its own `users` lookup (with UID-back-fill) at lines 55-75.

**Runtime winner:** depends on the calling endpoint. Most signup/onboarding flow uses `verifySupabaseAuthHeader`; most read-side endpoints use `getSupabaseUserFromRequest`; a few use `requireAuth`. **Inconsistent guarantees** about whether soft-deleted users can reach a route.

### 1.2 Three accepted cookie patterns in `extractCookieToken`

[supabaseAuthService.ts:14-57](backend/services/supabaseAuthService.ts#L14-L57) iterates patterns:
- `sb-<project>-auth-token`
- `auth-token`
- `supabase-auth`

First match wins. No documented preference. The deployment determines which is set.

---

## 2. Super-admin checks

### 2.1 `isSuperAdmin` and `isPlatformSuperAdmin` — IDENTICAL bodies

[rbacService.ts:249-258](backend/services/rbacService.ts#L249-L258):
```typescript
export const isSuperAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', Role.SUPER_ADMIN)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
};
```

[rbacService.ts:260-269](backend/services/rbacService.ts#L260-L269):
```typescript
export const isPlatformSuperAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', Role.SUPER_ADMIN)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
};
```

**Same query, same error handling, same return.**

`enforceRole` ([rbacService.ts:289-293](backend/services/rbacService.ts#L289-L293)) calls BOTH in parallel with `Promise.all` — duplicate roundtrip.

**Callers split unevenly:**
- `isSuperAdmin` — 17 callers (admin, campaigns, social, virality, recommendation paths).
- `isPlatformSuperAdmin` — 16 callers (super-admin, system, admin/credits, requestAccessService).

Many endpoints call BOTH (e.g., [provider-accounts/[id].ts:34](pages/api/provider-accounts/[id].ts#L34): `isPlatformSuperAdmin(user.id) || isSuperAdmin(user.id)` — short-circuit OR with identical truth values).

**Runtime winner:** identical — but the system pays for double DB queries when both are called.

### 2.2 Three competing super-admin authorities (cookie / DB / content-architect)

| Authority | Set by | Read by | Used in |
|---|---|---|---|
| `super_admin_session=1` cookie | [super-admin/login.ts:24](pages/api/super-admin/login.ts#L24) | [superAdminSession.ts:6](backend/services/superAdminSession.ts#L6) and inline at most super-admin endpoints | Most super-admin write endpoints |
| `user_company_roles WHERE role='SUPER_ADMIN'` | DB-backed (no auth UI) | `isSuperAdmin` / `isPlatformSuperAdmin` / `requireSuperAdminUser` | All endpoints accepting Bearer auth |
| `content_architect_session=1` cookie | [content-architect-login.ts:54](pages/api/super-admin/content-architect-login.ts#L54) | [contentArchitectService.ts:14](backend/services/contentArchitectService.ts#L14) | Most super-admin endpoints accept this as super-admin equivalent |

`/api/super-admin/session.ts:18` reads ONLY DB → cookie-only super-admins return `{isSuperAdmin: false}` to UI.

[rbacService.ts:238-240](backend/services/rbacService.ts#L238-L240) maps the literal user_id `'content_architect'` to `Role.COMPANY_ADMIN` of any company — Content Architect cookie effectively grants company-admin scope on all companies.

---

## 3. Role checks

### 3.1 `users.role` vs `user_company_roles.role` — competing role-storage

| Storage | Read in | Written in |
|---|---|---|
| `users.role` (legacy global column) | verify-email.ts:167; post-login-route.ts:80; userContextService.ts:111 | sync-supabase-user.ts:754; post-login-route.ts:108-113; onboarding/complete.ts:302; onboarding/setup-company.ts:404; team/accept-invite.ts:151 |
| `user_company_roles.role` per (user_id, company_id) | rbacService.ts (isSuperAdmin, getUserRole, enforceRole); authMiddleware.ts (requireCompanyAccess); sync-supabase-user.ts; super-admin/users.ts (PATCH) | 11 sites; no DB CHECK constraint |

**Behavioral differences:**
- `users.role` is a single global value per user.
- `user_company_roles.role` is per (user, company) tuple.
- For multi-org users, `users.role` is meaningless (only matches one of the orgs' roles, or none).

**Runtime winner:** depends on the read site. RBAC checks use `user_company_roles`. Routing decisions in `verify-email.ts` and `post-login-route.ts` use `users.role`.

### 3.2 `Role` enum vs DB CHECK constraints — competing enumerations

| Source | Values | File |
|---|---|---|
| TypeScript `Role` enum | 11 strings: SUPER_ADMIN, COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, VIEW_ONLY, ADMIN, CONTENT_MANAGER, CONTENT_PLANNER, CONTENT_ENGAGER, VIEWER | [rbacPrimitives.ts:3-15](backend/services/rbacPrimitives.ts#L3-L15) |
| `users.role` CHECK | 6: SUPER_ADMIN, COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, VIEW_ONLY | [20260331_auth_columns.sql:72-80](supabase/migrations/20260331_auth_columns.sql#L72-L80) |
| `invitations.role` CHECK | 5: COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, VIEW_ONLY (no SUPER_ADMIN) | [20260331_invitations.sql:18](supabase/migrations/20260331_invitations.sql#L18) |
| `user_company_roles.role` CHECK | none | (no migration found) |

**Runtime winner:** `Role` enum — `normalizeRole` ([rbacPrimitives.ts:28-40](backend/services/rbacPrimitives.ts#L28-L40)) folds legacy values into canonical ones before they hit the DB. Direct DB writes bypassing `normalizeRole` could insert un-normalized strings into `user_company_roles.role`.

---

## 4. Company resolution (which org am I in?)

### 4.1 Three competing "active company" sources

| Source | Type | Authority |
|---|---|---|
| `users.active_company_id` | UUID column | Canonical per [20260406:30-50](supabase/migrations/20260406_multi_tenant_auth_migration.sql) |
| `users.company_id` | UUID column | Deprecated/frozen per migration; still actively written |
| `user_company_roles WHERE user_id AND status='active'` | Row-set | Authoritative per "membership" semantic |

**Behavioral differences:**
- `users.active_company_id` is the user's current/preferred org.
- `user_company_roles WHERE active` is the set of orgs the user can access.
- `users.company_id` is unreliable.

**Runtime winner:** depends on call site. Domain endpoints read `active_company_id`. Verify-email reads `company_id`. RBAC reads `user_company_roles`.

### 4.2 Pre-link active_company_id from invitation — TWO paths

- [sync-supabase-user.ts:271-292](pages/api/auth/sync-supabase-user.ts#L271-L292) — brand-new INSERT pre-links `active_company_id` from pending invitation.
- [sync-supabase-user.ts:225,233](pages/api/auth/sync-supabase-user.ts#L225) — email-match path back-fills from `user_company_roles`.

Slight differences in source of truth.

---

## 5. Onboarding routing

### 5.1 Multiple "where does the user go next?" decision points

| Endpoint | Decision logic |
|---|---|
| [verify-email.ts:154-186](pages/api/auth/verify-email.ts#L154-L186) | Based on has_password, name, role | first verified login → /welcome else /onboarding/profile |
| [post-login-route.ts:62-92](pages/api/auth/post-login-route.ts#L62-L92) | Based on has_password, name, onboarding_state, user_company_roles existence |
| [set-password.ts:138-139](pages/api/auth/set-password.ts#L138-L139) | Based on name → `/onboarding/profile` else `getUserPreferenceRoute` |
| [accept-invite.ts](pages/api/auth/accept-invite.ts) | Always to `/auth/set-password` after invitation consume |
| `getUserPreferenceRoute` ([userPreferencesService.ts](backend/services/userPreferencesService.ts)) | The "final" destination resolver |

**Behavioral differences:**
- Each endpoint computes routing from a different subset of state columns.
- A user can take different paths depending on which endpoint is consulted first.

**Runtime winner:** by call order. The browser flow typically calls `verify-email` first, then `post-login-route` to refine the destination.

### 5.2 First-time-vs-returning user routing inconsistency

`verify-email.ts:188-194` sets `requiresLogin: true` for first-time password signups (sends them back to `/login`). `post-login-route.ts` does not have this concept — it routes based on state. The "send to /login after first verify" mechanism is bespoke to `verify-email.ts`.

---

## 6. Invitation activation

### 6.1 Two paths flip `user_company_roles.status` from `invited → active`

| Path | File:Line | Context |
|---|---|---|
| `activate_invitation_membership` RPC | [set-password.ts:65-100](pages/api/auth/set-password.ts#L65-L100) | After password set during signup flow |
| Direct UPDATE | [setup-company.ts:159-162](pages/api/onboarding/setup-company.ts#L159-L162) | When public-email user accepts company invite via setup-company |
| Direct UPDATE | [company/users.ts:267](pages/api/company/users.ts#L267) | `addExistingUserToCompany` (DEAD branch — gated on dropped firebase_uid column) |
| Direct UPDATE | [company/users.ts:543](pages/api/company/users.ts#L543) | PUT /api/company/users with status=active |
| INSERT with status='active' | [team/accept-invite.ts:142](pages/api/team/accept-invite.ts#L142) | Direct team invite acceptance (different endpoint than auth/accept-invite.ts) |

**Behavioral differences:**
- The RPC flips status atomically and (presumably) stamps `accepted_at`.
- Direct UPDATEs each have their own timestamping logic — some stamp `accepted_at`, some don't.

**Runtime winner:** by entry point. Standard flow is via `set-password.ts` → RPC.

### 6.2 Two `accept-invite` endpoints

- [pages/api/auth/accept-invite.ts](pages/api/auth/accept-invite.ts) — token-based, calls `signInWithOtp`.
- [pages/api/team/accept-invite.ts](pages/api/team/accept-invite.ts) — direct accept by authenticated user (e.g., already-logged-in user accepting an invite to a second org).

Both write `invitations` (different columns), both write `user_company_roles`. Cannot be merged trivially.

---

## 7. User reconciliation (auth.users ↔ public.users)

### 7.1 UID-match + email-match-back-fill — THREE implementations

| Implementation | File:Line | Purpose |
|---|---|---|
| `bootstrapCompanyFromSignupIntent` flow | [sync-supabase-user.ts:106-235](pages/api/auth/sync-supabase-user.ts#L106-L235) | First-time sync after auth callback |
| `getSupabaseUserFromRequest` | [supabaseAuthService.ts:138-163](backend/services/supabaseAuthService.ts#L138-L163) | Per-request lookup with back-fill |
| `requireAuth` middleware | [authMiddleware.ts:55-75](backend/middleware/authMiddleware.ts#L55-L75) | Per-request lookup with back-fill |

**Behavioral differences:**
- All three look up by `supabase_uid` first, then by `email`.
- All three back-fill `supabase_uid` if missing.
- `sync-supabase-user.ts` is the heaviest — also runs `bootstrapCompanyFromSignupIntent`.
- The other two are lighter — just back-fill and return.

**Runtime winner:** by entry point.

### 7.2 `findOrCreateUserByEmail` — TWO copies

| Implementation | File:Line | Differences |
|---|---|---|
| Super-admin | [super-admin/users.ts:50-145](pages/api/super-admin/users.ts#L50-L145) | Soft-delete check at line 76; PGRST204 fallback when columns missing |
| Company-admin | [company/users.ts:115-155](pages/api/company/users.ts#L115-L155) | Same general shape; differs in audit-log behavior |

Both retry on PG 23505 (unique violation). Both insert with default columns and lower-cased email.

**Runtime winner:** by entry point — only one is callable per code path.

---

## 8. Email normalization

### 8.1 Inconsistent normalization across helpers

| Site | Pattern | Notes |
|---|---|---|
| signup.ts:60 | `email.trim().toLowerCase()` | Pre-lookup normalize |
| login.ts:42 | `email.trim().toLowerCase()` | |
| magic-link.ts:42 | `email.trim().toLowerCase()` | |
| sync-supabase-user.ts:105 | `email.toLowerCase().trim()` | Different order (cosmetic) |
| check-user.ts:36 | `.ilike('email', normalised)` | Case-insensitive match |
| post-login-route.ts:47 | `.or(email.toLowerCase()...)` | OR clause |
| authMiddleware.ts:67-69 | `.eq('email', email)` | NO normalization — relies on upstream |
| set-password.ts:68 | `.eq('email', user.email.toLowerCase())` | Late normalize |
| onboarding/complete.ts:105,157 | `.eq('email', authEmail.toLowerCase())` | Late normalize |
| onboarding/setup-company.ts:122 | `.eq('email', user.email.toLowerCase())` | Late normalize |
| onboarding/request-company-access.ts:69 | `email.trim().toLowerCase()` | Pre-insert |
| onboarding/company-domain-check.ts:63 | `.or(email.toLowerCase()...)` | |
| team/accept-invite.ts:84 | `callerEmail.toLowerCase() !== invitation.email.toLowerCase()` | Comparison-side normalize |
| admin/access-requests/approve.ts:81 | `.eq('email', request.email)` | NO normalization |
| supabaseAuthService.ts:153 | `.eq('email', email.toLowerCase())` | |
| userManagementService.ts:34,40,66 | `email.toLowerCase().trim()` | |
| invitationService.ts:21,32,63,134 | `email.toLowerCase()` | NO trim |
| serverValidation.ts:17 | `email.trim().toLowerCase().split('@')` | Domain extract |
| identityGateway.ts:4 | `email.trim().toLowerCase()` | Reusable normalize |

**Behavioral differences:**
- Some sites normalize before lookup; others rely on upstream callers.
- Some sites use `.eq` (case-sensitive); others use `.ilike` (case-insensitive); others use `.or` clauses.
- DB has `users_email_key ON users (LOWER(email))` per [20260406:284](supabase/migrations/20260406_multi_tenant_auth_migration.sql#L284) — case-sensitive UNIQUE on the LOWER expression. Mixed-case writes that bypass normalization could in principle collide.

**Runtime winner:** the call-chain's first normalizer wins. If a chain has none, the DB UNIQUE provides a partial backstop.

### 8.2 No shared `normalizeEmail` utility

[identityGateway.ts:4](backend/domain/from-lib/identity/identityGateway.ts#L4) appears to define a normalize function but is not consistently imported across the codebase.

---

## 9. Soft-delete guards

### 9.1 11+ sites read `users.is_deleted`

(See [identity-read-surface-map.md](identity-read-surface-map.md) Section 7 for the full list.)

### 9.2 Inconsistent return shapes for ACCOUNT_DELETED

| File | Status | Error code |
|---|---|---|
| signup.ts:96-98 | 403 | ACCOUNT_DELETED |
| login.ts:65 | 400 | INVALID_CREDENTIALS (deliberately misleading for security) |
| magic-link.ts:64 | 400 | INVALID_CREDENTIALS |
| post-login-route.ts:60 | 403 | AUTH_001 / ACCOUNT_DELETED |
| sync-supabase-user.ts:112,128 | 403 | ACCOUNT_DELETED + ghost-session audit |
| getSupabaseUserFromRequest:145,157 | (returns error: 'ACCOUNT_DELETED') | up to caller |
| onboarding/complete.ts:87 | (handler-specific) | ACCOUNT_DELETED |
| company/users.ts:111,127,154 | depends on call | mixed |
| super-admin/users.ts:76 | 403 | ACCOUNT_DELETED |

Different error codes and HTTP statuses for the same condition.

---

## 10. Free-email domain blocklists

### 10.1 Two independent lists

| Source | List size | Function |
|---|---|---|
| [serverValidation.ts:9-14](backend/domain/from-lib/auth/serverValidation.ts#L9-L14) | 19 domains | `validateWorkEmail` — used in signup gate |
| [companyMatchService.ts:23-33](backend/services/companyMatchService.ts#L23-L33) | 21 domains | `isFreeEmailDomain` — used in bootstrap skip |

**Overlap:** ~17 domains shared.

**Differences:**
- `serverValidation.ts` includes `1and1.com`, `btinternet.com`, `mail.ru`, `protonmail.ch`, `mailbox.org`, `163.com`, `qq.com`, `foxmail.com`, `tutanota.com` — but NOT `yahoo.co.uk`, `yahoo.co.in`, `yahoo.ca`, `googlemail.com`, `live.com`, `msn.com`, `me.com`, `mac.com`, `proton.me`, `zoho.com`, `gmx.net`.
- `companyMatchService.ts` includes the second list — country-code TLDs and common alternates.

**Runtime winner:** depends on entry point. Self-signup uses `validateWorkEmail`. Bootstrap skip uses `isFreeEmailDomain`. A user with `yahoo.co.in` passes `validateWorkEmail` (allowed) but is then `isFreeEmailDomain`-skipped during bootstrap (no company created) — partially-onboarded state.

---

## 11. Audit-log writers

### 11.1 Three distinct audit tables

| Table | Writer | Defined in |
|---|---|---|
| `auth_audit_logs` | [auditLog.ts:41-70](backend/domain/from-lib/auth/auditLog.ts#L41-L70) `logAuthEvent` | [20260323_auth_audit_logs.sql](supabase/migrations/20260323_auth_audit_logs.sql) |
| `audit_logs` (generic) | `insertAuditLog` ([super-admin/users.ts:226-250](pages/api/super-admin/users.ts#L226-L250), `insertAuditLogStrict`) | (older base schema) |
| `super_admin_audit_logs` | [content-architect-login.ts:23-50](pages/api/super-admin/content-architect-login.ts#L23-L50) | [20260420_hardening_auth_email_invites.sql:51-62](supabase/migrations/20260420_hardening_auth_email_invites.sql#L51-L62) |

**Behavioral differences:**
- `auth_audit_logs` covers a fixed set of `AuthAuditEvent` types (no password-change event).
- `audit_logs` is generic, called from super-admin/users.ts and company/users.ts.
- `super_admin_audit_logs` is only written by content-architect-login.ts.

**Coverage gaps:**
- Password reset / change → no audit row (anywhere).
- Super-admin env-credential login → no audit row (anywhere).
- Pending-invitation skip in bootstrap → no audit row.

---

## 12. Domain-record writers

### 12.1 `saveDomainRecord` is the canonical helper, called from two paths

- [sync-supabase-user.ts:700-721](pages/api/auth/sync-supabase-user.ts#L700-L721) — bootstrap path; writes `verification_status='pending'`, `created_via='user'`.
- [super-admin/users.ts:467](pages/api/super-admin/users.ts#L467) — admin override path; writes `verification_status='admin_override'`, `created_via='admin'`.

Plus `reassignDomain` ([super-admin/users.ts:513](pages/api/super-admin/users.ts#L513)) for moving a domain between companies.

### 12.2 `companies.admin_email_domain` and `company_domains` are written in parallel

`bootstrapCompanyFromSignupIntent` writes both:
- `companies.admin_email_domain` (line 660)
- `company_domains` row (line 700 via `saveDomainRecord`)

Super-admin `override_domain` writes ONLY `company_domains` ([super-admin/users.ts:467](pages/api/super-admin/users.ts#L467)) — `companies.admin_email_domain` stays at its original value (or NULL if just-created).

`reassignDomain` updates `company_domains.company_id` but does NOT update either company's `admin_email_domain`.

Drift accumulates with each admin-override or reassignment.

---

## 13. Aggregate duplication summary

| Concern | Implementations | Worst-case drift | Runtime winner |
|---|---:|---|---|
| Auth resolution (Bearer/cookie) | 3 | Inconsistent soft-delete coverage | per-endpoint |
| Cookie patterns | 3 | First-match-wins iteration | first match |
| Super-admin authority | 3 | Cookie-only sessions return false from session.ts but pass write endpoints | per-endpoint |
| `isSuperAdmin` / `isPlatformSuperAdmin` | 2 (identical bodies) | DB query duplicated | always identical |
| Role storage (`users.role` vs `user_company_roles.role`) | 2 | Unbounded after bootstrap | per read site |
| Role enum vs DB CHECK | 4 sources | un-normalized strings via direct DB access | normalizer wins for application writes |
| Active-company sources | 3 | `team/accept-invite` writes one but not the other | per read site |
| Onboarding routing | 4+ | Endpoint-dependent destination | call order |
| Invitation status flip | 4-5 paths | accepted_at not always stamped | RPC dominant |
| User reconciliation (UID-back-fill) | 3 | Identical logic, triplicated | per entry point |
| `findOrCreateUserByEmail` | 2 | Soft-delete guard differs | per entry point |
| Email normalization | 17+ sites | Inconsistent ordering, some skip | first normalizer wins |
| Soft-delete error codes | 8 endpoints | Mixed status codes | per endpoint |
| Free-email blocklist | 2 lists | Country-code TLD coverage gap | per call site |
| Audit logs | 3 tables | Coverage gaps (password change, env-cred login) | per writer |
| Domain records (`companies.admin_email_domain` vs `company_domains`) | 2 columns + 1 helper | Drift after override/reassign | last writer wins per source |
