# Wave 3A — Runtime Reachability Map

**Branch**: `identity-spine-enforcement`
**Generated**: 2026-05-07
**Question answered**: "Of all the authority surfaces in the codebase, which are actually reachable at runtime, and via which entry point?"

This map ties every authority decision to a runtime entry surface (HTTP route or scheduled job). A surface is "reachable" iff a request path can land in it; everything else is dead and is candidate for removal in Wave 3.

---

## 1. Canonical capability-gated routes (15)

These routes call `requireCapability(req, res, { capability, ... })` and are therefore the canonical, fully audited authority surfaces. Each one binds a capability + (sometimes) step-up + audit row.

| Route | Capability | Step-up | Notes |
|---|---|---|---|
| [pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts) | `IDENTITY_ADMIN_ASSIGN` | phishing-resistant + trusted-device (mode=promote); evaluated inline (mode=bootstrap) | NEW — wave 3A |
| [pages/api/admin/revoke-super-admin.ts](../../../pages/api/admin/revoke-super-admin.ts) | `IDENTITY_ADMIN_ASSIGN` | phishing-resistant | Wave 2C-A |
| [pages/api/auth/passkeys/revoke.ts](../../../pages/api/auth/passkeys/revoke.ts) | self-targeted | webauthn step-up | Wave 2C-B |
| [pages/api/auth/totp/recovery/regenerate.ts](../../../pages/api/auth/totp/recovery/regenerate.ts) | self-targeted | webauthn step-up | Wave 2C-C |
| [pages/api/auth/totp/revoke.ts](../../../pages/api/auth/totp/revoke.ts) | self-targeted | webauthn step-up | Wave 2C-B |
| [pages/api/external-apis/index.ts](../../../pages/api/external-apis/index.ts) | mixed: platform-scope GET requires `INTEGRATION_PLATFORM_MANAGE`, tenant-scope POST uses `resolvePrincipal` directly + role-string fallback | none for GET; tenant guard for POST | **Class C role-string risk site** — see role-string-classification.md |
| [pages/api/super-admin/credit-cost-config/update.ts](../../../pages/api/super-admin/credit-cost-config/update.ts) | `BILLING_MANAGE` | phishing-resistant | Wave 2C-A |
| [pages/api/super-admin/free-credits/grant.ts](../../../pages/api/super-admin/free-credits/grant.ts) | `BILLING_GRANT_FREE_CREDITS` | none | **Class E role-mutation risk** — line 113 demotes SUPER_ADMIN→COMPANY_ADMIN as side-effect |
| [pages/api/super-admin/free-credits/requests.ts](../../../pages/api/super-admin/free-credits/requests.ts) | `BILLING_GRANT_FREE_CREDITS` | none | **Class E role-mutation risk** — line 116 same as above |
| [pages/api/super-admin/plans/create.ts](../../../pages/api/super-admin/plans/create.ts) | `BILLING_PLAN_MANAGE` | phishing-resistant | Wave 2C-A |
| [pages/api/super-admin/purchases/complete.ts](../../../pages/api/super-admin/purchases/complete.ts) | `BILLING_MANAGE` | phishing-resistant | Wave 2C-A |
| [pages/api/super-admin/users.ts](../../../pages/api/super-admin/users.ts) | `IDENTITY_ADMIN_VIEW` (GET), `IDENTITY_ADMIN_MUTATE` (PATCH/DELETE) | phishing-resistant on mutate | Wave 2C-A |
| [pages/api/team/self-joined.ts](../../../pages/api/team/self-joined.ts) | `TEAM_VIEW_SELF` | none | Wave 2C-B |
| [pages/api/virality/playbooks/index.ts](../../../pages/api/virality/playbooks/index.ts) | `PLAYBOOK_MANAGE` | none | Wave 2C-B |
| [pages/api/virality/playbooks/[id].ts](../../../pages/api/virality/playbooks/[id].ts) | `PLAYBOOK_MANAGE` | none | Wave 2C-B |

**Reachability**: all 15 routes are reachable from the front-end. Bridge principals can reach them (because `resolvePrincipal` falls through to the bridge) BUT will be rejected at step-up where applicable, and at any future capability granularity that the bridge allowlist (`legacyCookieSuperAdminCapabilities()`) does not include.

---

## 2. Auth/MFA self-service routes (15)

These call `resolvePrincipal` directly. They form the WebAuthn / TOTP / device / session / step-up surface owned by the user themselves.

| Route | Purpose | Bridge-eligible? |
|---|---|---|
| `pages/api/auth/capabilities.ts` | Read principal.capabilities | yes (read-only) |
| `pages/api/auth/devices/list.ts` | List trusted devices | yes (read-only) |
| `pages/api/auth/devices/revoke.ts` | Revoke trusted device | **NO** — bridge has no device |
| `pages/api/auth/devices/trust.ts` | Trust current device | **NO** — bridge has no session |
| `pages/api/auth/passkeys/begin-authentication.ts` | Start WebAuthn auth ceremony | **NO** — bridge user_id is sentinel |
| `pages/api/auth/passkeys/begin-registration.ts` | Start WebAuthn registration | **NO** — bridge cannot enroll |
| `pages/api/auth/passkeys/list.ts` | List user's passkeys | yes (returns empty) |
| `pages/api/auth/passkeys/verify-authentication.ts` | Finish WebAuthn auth ceremony | **NO** |
| `pages/api/auth/passkeys/verify-registration.ts` | Finish WebAuthn registration | **NO** |
| `pages/api/auth/refresh.ts` | Rotate session | **NO** — bridge has no session |
| `pages/api/auth/session.ts` | Check session state | yes (read-only) |
| `pages/api/auth/sessions/list.ts` | List active sessions | yes (returns empty) |
| `pages/api/auth/sessions/revoke.ts` | Revoke a session | **NO** |
| `pages/api/auth/step-up/status.ts` | Check active step-up | yes (always inactive for bridge) |
| `pages/api/auth/step-up/verify.ts` | Verify a step-up factor | **NO** |
| `pages/api/auth/totp/*` | TOTP enrollment / verify / recovery | **NO** |

---

## 3. Legacy cookie routes (4 — bridge-only)

These are unreachable for canonical principals; only bridge cookie traffic lands here.

| Route | Purpose | Wave 3 disposition |
|---|---|---|
| [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts) | Sets bridge cookie via env-var compare | DELETE |
| [pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts) | Clears bridge cookie | DELETE |
| [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) | Sets `content_architect_session=1` cookie | DELETE |
| [pages/api/super-admin/session.ts](../../../pages/api/super-admin/session.ts) | Bridge session probe used by old UI | Wave 3 — replace with canonical `/api/auth/session` |

---

## 4. Routes still using `requireSuperAdminUser` (legacy DB-backed path)

Files using `requireSuperAdminUser` from [backend/services/requestAccessService.ts](../../../backend/services/requestAccessService.ts) — note this DOES query `user_company_roles.role='SUPER_ADMIN'`, so it is DB-backed despite the legacy-style API. Bridge cookie cannot satisfy this because `requireAuthenticatedInternalUser` calls `getSupabaseUserFromRequest`, which only resolves Supabase identities.

This means: bridge cookie is INSUFFICIENT for the ~60 routes that still use `requireSuperAdminUser`. Those routes were never bridge-reachable in the first place. Wave 3 will migrate them to `requireCapability` for consistency, but they are not blockers for bridge removal.

Concrete files (sample, not exhaustive — full list available via `grep "requireSuperAdminUser" pages/`):
- `pages/api/super-admin/users.ts` (now uses `requireCapability`, but other handlers in the same dir still use the legacy path)
- `pages/api/super-admin/usage-alerts.ts`
- `pages/api/super-admin/system-health.ts` / `system-trends.ts` / `system-intelligence.ts`
- `pages/api/super-admin/savings-report.ts`
- `pages/api/super-admin/cron-metrics.ts` / `redis-metrics.ts` / `queue-metrics.ts`
- `pages/api/super-admin/llm/providers.ts` / `models.ts`
- `pages/api/super-admin/free-credits/summary.ts` / `profiles.ts` / `activity.ts`
- `pages/api/super-admin/credit-packages/index.ts`
- `pages/api/super-admin/community-ai-policy.ts` / `community-ai-metrics.ts`
- `pages/api/super-admin/audit-logs.ts`
- `pages/api/super-admin/companies.ts`
- `pages/api/super-admin/connection-health.ts`
- `pages/api/super-admin/campaign-health.ts`
- `pages/api/super-admin/analytics-summary.ts` / `analytics-provider-config.ts`
- `pages/api/super-admin/activity-cost-breakdown-v2.ts` / `activity-control.ts`
- `pages/api/super-admin/ga-*.ts`
- `pages/api/super-admin/platform-oauth-configs.ts`
- `pages/api/super-admin/credits/grant.ts`
- `pages/api/super-admin/usage/grant-access.ts` / `usage/revoke-access.ts`
- `pages/api/super-admin/rbac.ts`
- `pages/api/super-admin/plans/{toggle, override, list, get-organization-plan, assign}.ts`
- `pages/api/admin/{audit-logs, blog/*, cache-management, config/*, consumption/*, cron-config, etc.}` ~30 files

---

## 5. Routes that read `super_admin_session` cookie directly (bridge consumers OUTSIDE the canonical resolver)

These are routes that bypass `resolvePrincipal` and hand-roll a cookie check. Wave 3 must inventory and migrate each one; Wave 3A requires only that they be cataloged.

Confirmed direct cookie readers (cookie name appears in source):
- `backend/services/contentArchitectSecurityService.ts` — uses `content_architect_session` for content-architect-mode authority
- `backend/services/contentArchitectService.ts` — same
- `backend/services/superAdminSession.ts` — central helper
- `proxy.ts` — passes cookies through
- `backend/middleware/authMiddleware.ts` — reads cookie names
- `pages/super-admin/consumption.tsx` — UI render branch
- `hooks/useSysHealth.tsx` — UI hook
- and ~70 other route files (see grep output) where the cookie is referenced for client-side or server-side branching

These do NOT all grant authority; many simply check the cookie to render a different UI. The dry-run (`LEGACY_BRIDGE_DRY_RUN`) lets the operator distinguish:
- Authority-grant uses → emit `bridge_authority_used` audit (canonical bridge resolver path)
- UI-branch uses → no audit (cookie is just a presence check)

The Wave 3 collapse PR must use the audit telemetry to confirm zero `bridge_authority_used` events in production before deletion.

---

## 6. Scheduled jobs / cron / queue workers

`backend/scheduler/cron.ts` and queue processors do NOT call `resolvePrincipal` — they bypass auth. They reach DB authority via service-layer helpers (`isPlatformSuperAdmin`, etc.) which all read `user_company_roles`. No bridge dependency.

---

## Summary

| Class | Count | Bridge-reachable? | Wave 3 disposition |
|---|---|---|---|
| Capability-gated routes | 15 | yes (capability-allowlist limited) | Audit emits `elevated_route_accessed` per request |
| MFA self-service routes | 16 | mostly NO (most fail because bridge has no session/user) | KEEP |
| Legacy cookie endpoints | 4 | yes (only bridge) | DELETE in Wave 3 |
| `requireSuperAdminUser` routes (~60) | ~60 | NO (Supabase identity only) | Migrate to `requireCapability` in Wave 3B |
| Direct cookie readers (~75) | ~75 | yes for ~5 (authority); rest are UI branching | Audit-driven removal in Wave 3 |
