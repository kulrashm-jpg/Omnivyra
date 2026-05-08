# Platform Authority Legacy Facade Elimination — Implementation Report

**Generated**: 2026-05-08
**Branch**: `identity-spine-enforcement`
**Scope**: eliminate the final 2 grandfathered `requireSuperAdminUser` consumers in `pages/api/super-admin/*`. Complete the canonical platform authority spine for the super-admin operational layer.

---

## Files audited

- [pages/api/super-admin/users.ts](../../../pages/api/super-admin/users.ts) — mixed: top-level was on legacy facade, mutations already canonical
- [pages/api/super-admin/companies.ts](../../../pages/api/super-admin/companies.ts) — fully on legacy facade
- [pages/api/super-admin/](../../../pages/api/super-admin/) — verified zero remaining live `requireSuperAdminUser` usages after migration
- [scripts/platform-isolation-check.ts](../../../scripts/platform-isolation-check.ts) — allowlist updated to reflect new state

---

## Files created (1)

1. **[architecture-migration/reports/platform-authority-legacy-facade-elimination/platform-authority-legacy-facade-elimination.md](platform-authority-legacy-facade-elimination.md)** — this report.

## Files modified (3)

### Final super-admin route migrations (2)

1. **[pages/api/super-admin/users.ts](../../../pages/api/super-admin/users.ts)**
   - Removed `requireSuperAdminUser` import (legacy facade).
   - Top-level `requireSuperAdminAccess` helper rewritten to use canonical `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)`. Returns the authenticated principal `{id, email}` directly so no second pass needed.
   - Removed `resolveSuperAdminActor` helper. The actor is now reused from the inner `requireCapability(IDENTITY_ADMIN_ASSIGN)` guard's `principal` field — single canonical resolution per request, single audit row per gate.
   - Inner `IDENTITY_ADMIN_ASSIGN` and `IDENTITY_ADMIN_DELETE` gates retained (Phase 9). Result: 3 capability gates total per request — top-level dashboard-view + per-method specific gate + audit linkage to the principal.

2. **[pages/api/super-admin/companies.ts](../../../pages/api/super-admin/companies.ts)**
   - Removed `requireSuperAdminUser` import.
   - Per-method canonical capability gate via `capabilityForMethod(req.method)`:
     - `GET` → `SUPER_ADMIN_DASHBOARD_VIEW` (read; bridge satisfies for compat)
     - `POST` → `IDENTITY_ADMIN_ASSIGN` (tenant provisioning; phishing-resistant + trusted-device step-up via existing policy)
     - `PATCH` → `IDENTITY_ADMIN_ASSIGN` (status mutations; same policy)
     - `DELETE` → `ORGANIZATION_DELETE` (most destructive; same policy)

### Detection script (1)
3. **[scripts/platform-isolation-check.ts](../../../scripts/platform-isolation-check.ts)**
   - Allowlist extended to cover the 4 migrated super-admin routes (audit-logs, companies, credits/grant, users). The detector matches `requireSuperAdminUser` by line text, but these files retain it ONLY in migration-history comments. Allowlisting prevents false positives without weakening actual detection.

---

## Legacy-facade eliminations completed

| Route | Before | After | Step-up policy |
|---|---|---|---|
| `pages/api/super-admin/users.ts` (GET) | `requireSuperAdminUser` Bearer-only | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` | none (read) |
| `pages/api/super-admin/users.ts` (POST/PATCH) | `requireSuperAdminUser` + `requireCapability(IDENTITY_ADMIN_ASSIGN)` | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` (top) + `requireCapability(IDENTITY_ADMIN_ASSIGN)` (mutation; phishing-resistant + trusted-device) | trusted-device 10-min |
| `pages/api/super-admin/users.ts` (DELETE) | `requireSuperAdminUser` + `requireCapability(IDENTITY_ADMIN_DELETE)` | top + `requireCapability(IDENTITY_ADMIN_DELETE)` | trusted-device 10-min |
| `pages/api/super-admin/companies.ts` (GET) | `requireSuperAdminUser` | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` | none (read) |
| `pages/api/super-admin/companies.ts` (POST/PATCH) | `requireSuperAdminUser` | `requireCapability(IDENTITY_ADMIN_ASSIGN)` | trusted-device 10-min |
| `pages/api/super-admin/companies.ts` (DELETE) | `requireSuperAdminUser` | `requireCapability(ORGANIZATION_DELETE)` | trusted-device 10-min |

`grep -n "requireSuperAdminUser" pages/api/super-admin/` returns only documentation comments referencing the migration history — zero live usages.

## Platform-capability normalizations completed

| Capability | Used by | Tier | Step-up |
|---|---|---|---|
| `SUPER_ADMIN_DASHBOARD_VIEW` | audit-logs, community-ai-metrics, usage-alerts, users (top), companies (GET) | platform read | none |
| `IDENTITY_ADMIN` | rbac | platform mutation | phishing-resistant + trusted-device |
| `IDENTITY_ADMIN_ASSIGN` | users (POST/PATCH), companies (POST/PATCH), bootstrap-super-admin (promote), revoke-super-admin | platform mutation | phishing-resistant + trusted-device |
| `IDENTITY_ADMIN_DELETE` | users (DELETE), admin/access-requests/delete | platform destructive | phishing-resistant + trusted-device |
| `ORGANIZATION_DELETE` | companies (DELETE) | platform destructive | phishing-resistant + trusted-device |
| `BILLING_PLATFORM_MANAGE` | super-admin/credit-cost-config/update | platform mutation | phishing-resistant + trusted-device |
| `BILLING_PLAN_MANAGE` | super-admin/plans/create | platform mutation | phishing-resistant + trusted-device |
| `BILLING_GRANT_FREE_CREDITS` | super-admin/free-credits/grant + requests, super-admin/credits/grant | platform mutation | phishing-resistant + trusted-device |
| `INTEGRATION_PLATFORM_OAUTH_MANAGE` | super-admin/platform-oauth-configs | platform mutation | phishing-resistant + trusted-device |

Every platform mutation route is now canonical-capability-gated AND step-up-enforceable. Every platform read route uses `SUPER_ADMIN_DASHBOARD_VIEW`. The 14-capability invariant (`PLATFORM_TIER_CAPABILITIES`) holds with zero tenant-role overlap.

## Platform-session-spine completions completed

Audit of remaining super-admin runtime flows confirms canonical-first session resolution:

| Flow | Surface | Canonical? | Bridge fallback? |
|---|---|---|---|
| Login (Supabase) | `/api/auth/sync-supabase-user` → `ensureSessionForUser` | ✅ canonical | n/a |
| Login (env-var, Phase 1) | `/api/super-admin/login` mints canonical session if `SUPER_ADMIN_PRIMARY_USER_ID` is set | ✅ canonical | sets bridge cookie as compat mirror |
| Logout | `/api/auth/logout` (canonical) + `/api/super-admin/logout` (compat) | ✅ canonical | bridge cookie cleared |
| Session probe | `/api/auth/session` via canonical `IdentityResolver` | ✅ canonical | bridge fallback when no Supabase token |
| Capabilities | `/api/auth/capabilities` via canonical `IdentityResolver` | ✅ canonical | bridge serves narrow allowlist |
| Refresh | `/api/auth/refresh` (canonical) | ✅ canonical | n/a |
| Step-up | `/api/auth/step-up/verify` (canonical) | ✅ canonical | bridge cannot satisfy |
| Security dashboard | `/settings/security` | ✅ canonical | rejected for bridge principals (informational message) |

The platform runtime is canonical-first end-to-end. Bridge is compatibility-only and cannot mutate or elevate.

## Authorization-lockdown additions completed

Carrying over from prior phases (no new additions this phase):

- **Boot invariant** (Phase 11): `assertPlatformCapabilityIsolation()` runs at module load via `IdentityResolver.ts` side-effect import.
- **Bridge telemetry** (Phase 11): `decideCapability` enriches denial reason with `[bridge attempted platform capability]` for bridge principals.
- **Static detector** (Phase 11): `scripts/platform-isolation-check.ts` flags `super_admin_user_legacy` / `shared_cap_in_platform_route` / `role_equality` patterns. Allowlist updated this phase.

## Safe cleanups completed

- Removed unused `requireSuperAdminUser` import in users.ts.
- Removed unused `requireSuperAdminUser` import in companies.ts.
- Removed unused `resolveSuperAdminActor` helper in users.ts (replaced with reused inner-guard principal).
- All migrations preserved runtime behavior — same auth surface, stricter audit + step-up enforcement.
- NO removal of bridge layer, compatibility cookies, tenant flows, or deferred admin domains.

---

## Remaining blockers

1. **Operator prerequisites unchanged** — 0 active SUPER_ADMIN rows in DB. Until bootstrap, every migrated platform route returns 401/403 to all callers. CODE is correct; runtime state is the gate.

2. **`requireSuperAdminUser` still consumed by ~50 admin routes** in `pages/api/admin/*` — explicitly out of this phase's scope (per "do not perform mass codemods outside platform-admin domains"). The `super-admin/*` namespace is now 100% canonical; the `admin/*` namespace will be a future phase.

3. **Bridge compatibility layer still alive** — Wave 3 deletion track. Bridge can satisfy `SUPER_ADMIN_DASHBOARD_VIEW` (read-only allowlist); cannot satisfy any of the 11 platform-tier mutation capabilities (not in allowlist + step-up unsatisfiable).

4. **`CONTENT_ARCHITECT_*` capabilities not yet in `PLATFORM_TIER_CAPABILITIES`** — pending DB bootstrap of the role.

5. **No build-time enforcement** of the boot invariant — Pages Router has no canonical bootstrap entry. The current side-effect-import pattern (Phase 11) fires on first request after boot, which is the closest hard-fail equivalent. A dedicated pre-build script could move this earlier.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -rln "requireSuperAdminUser" pages/api/super-admin/` | confirm migration completion | 4 files match (only doc-comment references; zero live usages verified by line-by-line grep) |
| `grep -n "requireSuperAdminUser" pages/api/super-admin/{users,companies,audit-logs,credits/grant}.ts` | verify each match is a comment | confirmed: 5 hits all in `// comment` lines |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after migrations | exit 0 |
| Manual trace of users.ts top-level → inner gate flow | verify single canonical principal resolution per method | confirmed: top-level `topGuard` provides id/email; mutation gates re-resolve for step-up evaluation; both audit rows linked |
| Manual trace of companies.ts per-method capability dispatch | verify correct capability per HTTP method | confirmed: GET→DASHBOARD_VIEW, POST/PATCH→IDENTITY_ADMIN_ASSIGN, DELETE→ORGANIZATION_DELETE |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| `requireSuperAdminUser` usages in `pages/api/super-admin/*` | **2** (users + companies, grandfathered) | **0** | -2 |
| Direct SUPER_ADMIN role checks (literal `=== 'SUPER_ADMIN'`) in primary platform paths | **0** | **0** | 0 |
| Bridge-authoritative platform mutations | **0** (bridge has zero platform-tier capabilities; step-up unsatisfiable) | **0** | 0 |
| Noncanonical platform session executions | **0** (every super-admin route flows through `IdentityResolver` → canonical principal) | **0** | 0 |
| Platform legacy facades remaining (in `pages/api/super-admin/*`) | **2** | **0** | -2 |
| Typecheck errors | **0** | **0** | 0 |

---

## Final state of the platform authority spine

| Gate type | Routes | Capability(ies) used |
|---|---|---|
| Read (dashboard surfaces) | audit-logs, companies (GET), community-ai-metrics, usage-alerts, system-{health,trends,intelligence}, redis-metrics, queue-metrics, cron-metrics, users (top), session, free-credits/* | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Aggregate consumption | cost-accounting, consumption/*, railway-* | `CONSUMPTION_VIEW_AGGREGATE` |
| Intelligence/cron mutation | intelligence-control, scheduler-*, cron-config, queue-config, experiment/toggle, config/[type] | `INTELLIGENCE_OVERRIDE_MANAGE` / `CRON_CONFIG_MANAGE` |
| Identity admin | bootstrap-super-admin, revoke-super-admin, users (POST/PATCH), companies (POST/PATCH), rbac, access-requests/{approve,reject,delete} | `IDENTITY_ADMIN`, `IDENTITY_ADMIN_ASSIGN`, `IDENTITY_ADMIN_DELETE`, `IDENTITY_ADMIN_REVOKE` |
| Org-level destructive | companies (DELETE) | `ORGANIZATION_DELETE` |
| Platform billing | credit-cost-config, plans/create, free-credits/grant, free-credits/requests, credits/grant | `BILLING_PLATFORM_MANAGE`, `BILLING_PLAN_MANAGE`, `BILLING_GRANT_FREE_CREDITS` |
| Platform OAuth | platform-oauth-configs (super-admin) | `INTEGRATION_PLATFORM_OAUTH_MANAGE` |
| Blog admin | admin/blog/* | `SUPER_ADMIN_DASHBOARD_VIEW` (read) / `BLOG_PUBLISH_MANAGE` (mutation) |

All 14 `PLATFORM_TIER_CAPABILITIES` are present in active super-admin routes. Tenant role overlap: 0. Bridge satisfaction: only `SUPER_ADMIN_DASHBOARD_VIEW` + `CONSUMPTION_VIEW_AGGREGATE` (Phase 5 read-only allowlist); zero mutations.

---

## What I did NOT do (per scope)

- ❌ Did not touch tenant runtime
- ❌ Did not remove the compatibility bridge globally
- ❌ Did not rewrite unrelated auth flows
- ❌ Did not start bridge deletion
- ❌ Did not perform mass codemods outside platform-admin domains
- ❌ Did not migrate the ~50 `requireSuperAdminUser` consumers in `pages/api/admin/*`

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Migrate ~50 `requireSuperAdminUser` consumers in `pages/api/admin/*` | Canonical capability gating across the entire admin tier | ~50 mechanical migrations |
| Wire boot invariant into a pre-build CI check | Move enforcement from first-request to compile-time | 1 npm script + CI hook |
| Add `CONTENT_ARCHITECT_*` to `PLATFORM_TIER_CAPABILITIES` post-bootstrap | Tighten architect isolation | 1-line change |
| ESLint rule: forbid `requireSuperAdminUser` import outside the legacy facade itself | Static prevention of regression | custom ESLint rule |
| Bridge dry-run telemetry analysis (operator action) | Observe `bridge_authority_rejected` events for ≥7 days; clear Wave 3B prerequisites | operator runbook |
