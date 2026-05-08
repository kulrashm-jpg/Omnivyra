# Wave 3A — Trust Authority Map

**Branch**: `identity-spine-enforcement`
**Generated**: 2026-05-07
**Scope**: every authority surface that can grant SUPER_ADMIN-equivalent or COMPANY_ADMIN-equivalent rights, classified by collapse plan.

This report is the master index for Wave 3 collapse. Every row below either:
- already routes through the canonical capability spine (KEEP), or
- is a bridge that must be removed in Wave 3 (BRIDGE), or
- is a role-string compare classified separately in [role-string-classification.md](role-string-classification.md) (SHAPING).

---

## A. Canonical authority (KEEP — these are the spine)

| Surface | Path | Authority shape | Notes |
|---|---|---|---|
| Capability registry | [shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts) | 28 typed capabilities + parent/child hierarchy + `STEP_UP_REQUIRED_CAPABILITIES` set | Single source of truth for what is permitted. |
| Authorization service | [backend/security/AuthorizationService.ts](../../../backend/security/AuthorizationService.ts) | `decide(principal, requirement)` returning allow/deny with reason | Used by `requireCapability` and direct callers. |
| Capability gate | [backend/security/requireCapability.ts](../../../backend/security/requireCapability.ts) | `requireCapability(req, res, { capability, ... })` | Canonical route entry; emits `elevated_route_accessed` / `capability_check_failed`. |
| Step-up policy registry | [backend/security/stepup/StepUpPolicyRegistry.ts](../../../backend/security/stepup/StepUpPolicyRegistry.ts) | `getStepUpPolicy(capability)` returning a `StepUpRequirement` or null | Drives `evaluateStepUp` for elevated routes. |
| Step-up evaluation | [backend/security/StepUpAuthorizationService.ts](../../../backend/security/StepUpAuthorizationService.ts) | `evaluateStepUp(principal, requirement)` returning `{satisfied, reason}` | Bridge principals always rejected (`BRIDGE_PRINCIPAL_INELIGIBLE`). |
| Identity resolver | [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts) | `resolvePrincipal(req)` returning `AuthenticatedPrincipal` | Reads cookies/Bearer + DB → principal with capabilities, mfa, stepUp, device, sessionId. |
| Auth resolver | [backend/services/authResolver.ts](../../../backend/services/authResolver.ts) | `resolveAuthenticatedUser(req)` returning `AuthenticatedUser` | Lower-level Supabase token → public.users row. Hard-fails closed; no JWT-claims fallback. |
| Audit log | [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts) | INSERT-only into `capability_audit_log` (DB triggers block UPDATE/DELETE) | All authority decisions audited. |
| DB role table | `user_company_roles` | `(user_id, company_id, role)` with `revoked_at` soft-delete + status enum | The DB-backed canonical authority. SUPER_ADMIN = `role='SUPER_ADMIN'`. |
| Bootstrap route | [pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts) | Dual-mode: `mode=promote` requires capability gate; `mode=bootstrap` token-gated single-use | NEW in Wave 3A — establishes first SUPER_ADMIN without bridge dependency. |

---

## B. Bridge authority (Wave 3A keeps; Wave 3 removes)

| Surface | Path | Authority shape | Disposition |
|---|---|---|---|
| Legacy cookie super-admin bridge | [backend/security/legacyCookieSuperAdminBridge.ts](../../../backend/security/legacyCookieSuperAdminBridge.ts) | Reads `super_admin_session=1` / `content_architect_session=1` cookies → synthesizes `AuthenticatedPrincipal` with `legacyCookieSuperAdmin: true` | Hard-expires `2026-08-05`. Wave 3A adds `LEGACY_BRIDGE_DRY_RUN` flag for fail-closed simulation. Cannot satisfy step-up. Audited every use. |
| Cookie login route | [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) | env `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD` set the cookie | Issues bridge cookie. Wave 3 deletes after DB-backed SUPER_ADMIN exists. |
| Cookie logout route | [pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts) | Clears the bridge cookie | Coupled to login.ts; remove together. |
| Content architect login | [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) | Sets `content_architect_session=1` cookie | Same shape as super-admin cookie bridge. |
| Bridge capability allowlist | [backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts) → `legacyCookieSuperAdminCapabilities()` | Returns the capability set granted to bridge principals | Removed when bridge deletes. |
| Cookie session helper | [backend/services/superAdminSession.ts](../../../backend/services/superAdminSession.ts) | Cookie-only authority helper used by older routes | Wave 3 collapse target. |
| Legacy middleware | [backend/middleware/requireSuperAdmin.ts](../../../backend/middleware/requireSuperAdmin.ts) | Wraps `requireSuperAdminUser` (which calls `isPlatformSuperAdmin` against `user_company_roles`) | Already DB-backed despite the bridge-era name. KEEP semantics; rename in Wave 3. |
| Legacy super-admin proxy | [proxy.ts](../../../proxy.ts) | Forwards bridge cookie | Re-evaluate during Wave 3. |

---

## C. Profile-flag authority (DEAD or obsolete, must verify)

| Surface | Path | Reason | Disposition |
|---|---|---|---|
| `profiles.is_super_admin` column | DB column on `profiles` | Pre-spine boolean flag | Wave 3 will drop; verify zero runtime reads against the column first via runtime reachability scan. |
| `is_super_admin` JSON keys in service responses | scattered `pages/api/admin/*.ts`, `users.ts`, etc. | UI/response shaping uses snake_case `is_super_admin` derived from DB role check — NOT from any auth path | KEEP shape; Wave 3 backfills from `user_company_roles.role`. |
| `isPlatformSuperAdmin` / `isSuperAdmin` helpers | [backend/services/rbacService.ts](../../../backend/services/rbacService.ts) lines 246–264 | Both query `user_company_roles.role='SUPER_ADMIN'` directly | KEEP — these are DB-backed canonical, not bridge. |

---

## D. Role-string authority (response shaping vs. mixed authority)

15 runtime call sites use `role === 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'ADMIN' | 'CAMPAIGN_CONTENT_MANAGER'` directly. Full classification (Class A/B/C/D/E) lives in [role-string-classification.md](role-string-classification.md). Summary:

- **Class A (safe response shaping, KEEP)**: company-profile read paths that return a limited profile to non-admins. The role string here drives serialization, not authority — a non-admin who somehow reaches the response path still doesn't gain rights.
- **Class B (legacy serializer, KEEP with TODO)**: consumption tier mapping in `pages/api/admin/consumption/llm.ts` and `apis.ts`.
- **Class C (mixed authority risk, FLAG)**: `pages/api/external-apis/index.ts:141` and `presets.ts:162` use `access.role === 'SUPER_ADMIN'` to skip permission checks. Must be migrated to capability check in Wave 3 — NOT in 3A scope.
- **Class D (dead path, REMOVE in Wave 3)**: Content Architect special-case at `userContextService.ts:94`, `rbacService.ts:235/279`, `pages/api/campaigns/list.ts:31`. Once the bridge cookie is removed the synthetic `userId === 'content_architect'` path can never trigger.
- **Class E (Wave-3-required rewrite)**: `pages/api/super-admin/free-credits/grant.ts:113` and `requests.ts:116` — these are role mutations that demote a SUPER_ADMIN to COMPANY_ADMIN as a side-effect of granting credits. These must be split into an explicit promotion-revocation path.

---

## E. Trust-authority conflict surface (NEW audit event)

`trust_authority_conflict_detected` is a new `AuditDecision` value reserved for runtime detection of conflict between authority sources. It is not yet emitted; the implementation hook lands when the bridge collapse audit landing page is wired up. Documented here so collapse PRs know the event ID.

Conflict cases the event must catch:
1. Bridge principal AND a real `users` row resolved on the same request (bridge accidentally activated).
2. `user_company_roles.role='SUPER_ADMIN'` with `revoked_at IS NOT NULL` somehow returning truthy on a check.
3. `profiles.is_super_admin = true` for a userId whose `user_company_roles` has no SUPER_ADMIN row (DB drift).

---

## Collapse plan summary

| Phase | Goal | Status |
|---|---|---|
| Wave 3A (this) | Establish DB-backed SUPER_ADMIN authority + dry-run simulation. NO removals. | ✅ Done |
| Wave 3B | Migrate Class C role-string sites + Class E credit-grant role mutation. Remove dead Class D content_architect short-circuits. | Pending |
| Wave 3 | Delete `legacyCookieSuperAdminBridge.ts`, `super-admin/login.ts`, `super-admin/content-architect-login.ts`, `superAdminSession.ts`, drop `profiles.is_super_admin`, remove env-var bridge gating. | Blocked on Wave 3A bootstrap + dry-run telemetry showing zero bridge dependencies. |
