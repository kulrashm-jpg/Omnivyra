# Super-Admin Security Risk Analysis

**Generated**: 2026-05-07
**Method**: source + DB grounded.
**Severity scale**: P0 (active exploitation feasible / data exposure / privilege bypass), P1 (architectural risk that becomes P0 under specific conditions), P2 (cleanup / hygiene).

---

## P0 — active risks

### P0-1 — Bridge cookie + env-var auth is the only way to reach the super-admin dashboard

**Where**: [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts), [pages/super-admin/login.tsx](../../../pages/super-admin/login.tsx).

**Risk**: A leak of `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD` is sufficient to obtain a `super_admin_session=1` cookie. There is no MFA, no passkey, no audit row at the mint site (only `super_admin_audit_logs` writes for content-architect login). The cookie has 24h TTL.

**Compensating controls**:
- `HttpOnly` + `SameSite=Lax`: limits CSRF and JavaScript exfiltration
- Hard-expiry on the bridge resolver (`2026-08-05`)
- `LEGACY_BRIDGE_DRY_RUN=1` can disable the bridge in any env

**Disposition**: Wave 3 deletes this entirely. Until then it is operationally critical (the only operator entry path).

---

### P0-2 — `super_admin_session=1` cookie gives full SUPER_ADMIN to 67 routes with NO capability check

**Where**: 67 files matching `super_admin_session` (see [route-classification.md](route-classification.md) Pattern A).

**Risk**: Any caller carrying a valid bridge cookie is treated as SUPER_ADMIN by these routes regardless of:
- whether their `users.id` exists
- whether they have any role anywhere
- whether they have MFA / step-up
- whether the action requires elevated authority

The cookie short-circuits ALL downstream authorization. Combined with P0-1, the env-var compromise becomes "full platform admin" without any further checks.

**Compensating controls**:
- Bridge principal (canonical path) cannot satisfy step-up — but only routes using `requireCapability` enforce step-up. The 67 hand-rolled routes don't.
- Audit row written ONLY by routes using the canonical bridge resolver. Hand-rolled cookie checks emit NO audit.

**Disposition**: Wave 3B migrates these to `requireCapability`.

---

### P0-3 — `pages/api/super-admin/platform-oauth-configs.ts` has 5 parallel auth surfaces

**Where**: [pages/api/super-admin/platform-oauth-configs.ts:41-79](../../../pages/api/super-admin/platform-oauth-configs.ts).

**Risk**: This single route reads:
1. `super_admin_session` cookie (cookie wins, no DB check)
2. `content_architect_session` cookie (cookie wins, no DB check)
3. Bearer token via `getSupabaseUserFromRequest`
4. SSR Supabase cookies via `createServerClient`
5. `super_admins` table (TABLE DOES NOT EXIST — silently grants nothing)
6. ANY admin role string in `user_company_roles` (any of `COMPANY_ADMIN`, `SUPER_ADMIN`, `ADMIN`, lowercase variants)

**Severity**: A user with ANY org admin role on ANY company can set/modify GLOBAL platform OAuth credentials (encrypted). This is a privilege boundary violation: a tenant admin should not be able to read/modify platform-level OAuth keys.

**Disposition**: Wave 3B URGENT. Replace with `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)`. The capability needs to be SUPER_ADMIN-only (no parent/child relationship to `COMPANY_ADMIN`).

---

### P0-4 — `super_admins` table re-creation hazard

**Where**: [pages/api/super-admin/platform-oauth-configs.ts:60-66](../../../pages/api/super-admin/platform-oauth-configs.ts), [pages/api/social-accounts/status.ts](../../../pages/api/social-accounts/status.ts).

**Risk**: The `super_admins` table does NOT exist in the remote DB. The Supabase client returns `null` data, the route falls through. **If anyone creates a `super_admins` table later (even by accident), every entry in that table grants SUPER_ADMIN to the listed user without going through `user_company_roles`**.

**Severity**: Currently P2 (table absent). Becomes P0 instantly if the table is created.

**Disposition**: Wave 3B — DELETE both source references. No `super_admins` table queries should exist in the codebase.

---

## P1 — architectural risks

### P1-1 — Bridge cookie can persist across logout

**Where**: [pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts), [pages/api/auth/logout.ts](../../../pages/api/auth/logout.ts) (canonical).

**Risk**: The canonical logout (`/api/auth/logout`) revokes the `auth_sessions` row but does NOT clear the bridge cookie. The bridge logout (`/api/super-admin/logout`) clears the bridge cookies but does NOT revoke any auth_session. If a user has BOTH (Supabase sign-in + bridge cookie), logging out via either leaves the other live.

**Severity**: medium — confusing operator UX; less so once Wave 3 collapses.

**Disposition**: Wave 3B can have the canonical logout also clear bridge cookies as a pre-deletion stopgap.

---

### P1-2 — `getCompanyRoleIncludingInvited` grants authority on invited-but-unaccepted roles

**Where**: [contentArchitectService.ts:80-89](../../../backend/services/contentArchitectService.ts), repeated across many routes.

**Risk**: An invited user's email could be configured to forward to a different mailbox (intentional or accidental), and they receive elevated rights without ever clicking accept. Once the org admin invites a user as COMPANY_ADMIN, that user gets immediate authority on every route that uses `getCompanyRoleIncludingInvited`.

**Severity**: Limited — invited roles are deliberately granted by an org admin, but the "unaccepted" state should mean LIMITED visibility, not full role authority.

**Disposition**: Wave 3B audit; possibly tighten to require `status='active'` for elevated capabilities.

---

### P1-3 — `super_admin_session=1` cookie is detected at request time but never tied to a sessionId

**Where**: [legacyCookieSuperAdminBridge.ts:129-158](../../../backend/security/legacyCookieSuperAdminBridge.ts) — bridge principal has `sessionId: null`.

**Risk**: Multiple concurrent bridge sessions cannot be distinguished. Revoking a bridge "session" requires unsetting the env var (kill ALL bridge sessions) or rotating it (kill EXISTING sessions but new ones still mint). No granular session management. No "log out all other devices" affordance.

**Severity**: Limited (bridge is by design temporary).

**Disposition**: Inherent property of the bridge; resolves at Wave 3 deletion.

---

### P1-4 — Frontend `fetchWithAuth` silently drops Bearer when Supabase session expires

**Where**: [components/community-ai/fetchWithAuth.ts:6-8](../../../components/community-ai/fetchWithAuth.ts), [utils/getAuthToken.ts:10-17](../../../utils/getAuthToken.ts).

**Risk**: When the Supabase session expires, `getAuthToken()` returns null, no Bearer is sent. If the bridge cookie is also gone, the request lands as anonymous. Routes return 403 with no clear indication that re-authentication is needed. UX issue, but it propagates to "stuck on dashboard" states.

**Severity**: low — UX, not security.

**Disposition**: orthogonal; not Wave 3B's job.

---

### P1-5 — `content_architect_session` synthesizes a non-DB userId

**Where**: [contentArchitectService.ts:43](../../../backend/services/contentArchitectService.ts) returns `{ userId: 'content_architect', role: 'CONTENT_ARCHITECT' }`.

**Risk**: Anywhere this synthetic userId hits a DB query (`user_id = 'content_architect'`), the query returns nothing (it's not a UUID). Some routes rely on this to ALLOW the operation (treating "no rows" as "no restrictions"). For example: an audit insert with `user_id = 'content_architect'` would either fail (if the column is UUID with a FK) or insert a malformed value (if the column is text without FK).

Direct query on `audit_logs` etc. that joins on `user_id` will silently exclude content-architect actions from audit trails.

**Severity**: medium — auditability gap, not direct privilege escalation.

**Disposition**: Wave 3 deletes the synthetic path entirely; Class D and E paths in [route-classification.md](route-classification.md) cover this.

---

## P2 — cleanup / hygiene

### P2-1 — Debug `console.log`s with cookie names in production

**Where**: [pages/api/admin/platform-oauth-configs/index.ts:18-24](../../../pages/api/admin/platform-oauth-configs/index.ts) logs `cookieKeys` and `hasSuperAdminCookie`.

**Risk**: Information disclosure in logs. Cookie *names* are not particularly sensitive, but `console.log` in API handlers shouldn't be shipping to prod.

**Disposition**: scrub during Wave 3B migration.

---

### P2-2 — `super_admin_audit_logs` is a separate audit surface from `capability_audit_log`

**Where**: [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) does NOT write `super_admin_audit_logs` (only content-architect login does); [pages/api/super-admin/content-architect-login.ts:23-50](../../../pages/api/super-admin/content-architect-login.ts) writes it.

**Risk**: Two parallel audit tables that both purport to track admin auth events. `super_admin_audit_logs` is older (table EXISTS in DB); `capability_audit_log` is the canonical Wave 2A introduction. Operator looking for "who did what when" must check both.

**Disposition**: Wave 3 collapses to `capability_audit_log` only. `super_admin_audit_logs` becomes historical (KEEP for retention; STOP writing).

---

### P2-3 — Hardcoded role-string allowlist in `requireAdminAccess`

**Where**: [pages/api/super-admin/platform-oauth-configs.ts:74](../../../pages/api/super-admin/platform-oauth-configs.ts) and similar in admin variant.

```ts
const adminRoles = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'company_admin', 'super_admin', 'admin'];
```

Both lower- AND upper-case variants are accepted, suggesting that role strings are not normalized canonically anywhere. A bug in upstream role-write could insert a lower-case role and would still pass.

**Disposition**: Wave 3B — `requireCapability` doesn't care about case because it queries the typed capability set, not the role string.

---

## Summary

| Severity | Count |
|---|---|
| P0 | 4 |
| P1 | 5 |
| P2 | 3 |
| **Total findings** | **12** |

P0-1 and P0-2 are mitigated by the LEGACY_BRIDGE_DRY_RUN flag (Wave 3A) and by the bridge hard-expiry (`2026-08-05`). P0-3 (platform-oauth-configs multi-surface) requires immediate Wave 3B attention. P0-4 (super_admins ghost) is one-line fix.

No new exploitable vulnerabilities discovered during this audit beyond what was already implicit in the Wave 3A reports — but the structure of the bypass surfaces is now mapped to specific files for targeted remediation.
