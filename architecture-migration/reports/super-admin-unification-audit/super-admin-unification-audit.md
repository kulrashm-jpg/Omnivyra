# Super-Admin Identity Unification Audit — Final Report

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Trigger symptom**: `/super-admin/dashboard` authenticates successfully; `/settings/security` reports "not signed in" using the same browser session.

---

## Executive summary

The super-admin runtime is split off from the canonical identity spine at the **session-mint layer** and the **per-route auth layer**. There is no `/super-admin/login` path that produces a canonical principal, and 67 admin routes have hand-rolled cookie checks that bypass `IdentityResolver` entirely. This audit maps every authority source (12 distinct), traces the exact divergence chain that produces the symptom, classifies all admin routes (~122) into A/B/C/D/E, identifies migration blockers, and simulates blast radius for immediate bridge removal.

**Bottom line**: super-admin can be unified onto the canonical chain but requires roughly 175 file changes — most mechanical via codemod, plus one new operator-facing Supabase-login UI flow and ~8 new capability definitions.

---

## Files audited (representative; full list in sub-reports)

- Authority sources (12): `pages/api/super-admin/login.ts`, `content-architect-login.ts`, `logout.ts`, `session.ts`, `platform-oauth-configs.ts`, `pages/super-admin/login.tsx`, `pages/super-admin.tsx`, `pages/super-admin/dashboard.tsx`, `lib/security/sessionClient.ts`, `components/community-ai/fetchWithAuth.ts`, `utils/getAuthToken.ts`, `backend/security/IdentityResolver.ts`, `legacyCookieSuperAdminBridge.ts`, `backend/services/authResolver.ts`, `supabaseAuthService.ts`, `requestAccessService.ts`, `rbacService.ts`, `userContextService.ts`, `superAdminSession.ts`, `contentArchitectService.ts`, `contentArchitectSecurityService.ts`, `pages/api/auth/session.ts`, `capabilities.ts`, `pages/settings/security.tsx`.
- 67 files reading `super_admin_session` cookie directly.
- 19 files using `getLegacySuperAdminSession`.
- 13 files using `isContentArchitectSession`.
- ~60 files using `requireSuperAdminUser`.
- 15 files using `requireCapability`.
- 2 files referencing the (dead) `super_admins` table.
- DB schema introspection: `users`, `user_company_roles`, `companies`, `super_admin_audit_logs`, plus all 9 Wave 2A security tables.

---

## Super-admin authority sources identified

12 distinct sources. Full map in [authority-source-map.md](authority-source-map.md). Concise list:

| Class | Sources |
|---|---|
| Cookies (3) | `super_admin_session=1`, `content_architect_session=1`, `content_architect_company_id=<uuid>` |
| Server resolvers/synthesizers (5) | `getLegacySuperAdminSession`, `isContentArchitectSession`, `resolveLegacyCookieSuperAdminPrincipal`, `resolvePrincipal`, inline cookie reads |
| Token-based (4) | `getSupabaseUserFromRequest`, `requireSuperAdminUser`, `isPlatformSuperAdmin`/`isSuperAdmin`, `requireCapability` |
| SSR cookies (1) | `@supabase/ssr` `createServerClient` |
| Synthetic userId (1) | `userId === 'content_architect'` short-circuit |
| Ghost authority (1) | `super_admins` table reads (table absent in DB) |
| Env (3) | `SUPER_ADMIN_USERNAME`/`PASSWORD`, `CONTENT_ARCHITECT_*`, `SUPER_ADMIN_BOOTSTRAP_TOKEN` |

---

## Session divergence findings

Full trace in [session-divergence-trace.md](session-divergence-trace.md).

The exact chain producing the symptom:

1. `/super-admin/login` mints `super_admin_session=1` via env-var compare. **No Supabase auth, no `auth_sessions` row, no `omnivyra_session` cookie**.
2. `/super-admin/dashboard` makes API calls via `fetchWithAuth` (Bearer-aware) — but no Bearer exists, so requests carry only cookies.
3. Admin APIs (Pattern A) honor the cookie directly → return 200.
4. `/settings/security` calls `fetch('/api/auth/session')` (no Bearer added).
5. `/api/auth/session` calls `resolvePrincipal` which:
   - Tries Supabase identity → `NO_TOKEN`
   - Falls through to bridge → either rejected by `LEGACY_BRIDGE_DRY_RUN=1` (returns 401) or accepted as `legacyCookieSuperAdmin: true` principal
6. `/settings/security` either renders "You must be signed in" (dry-run path) or "Security settings are not available to legacy cookie super-admin sessions" (bridge accepted).

**Root cause: the super-admin login path does not produce a canonical principal. Bridge fallback in `IdentityResolver` accepts the cookie BUT the canonical settings page deliberately rejects bridge principals.** There is no path through which a `/super-admin/login` user becomes a real principal that `/settings/security` accepts.

---

## Route classifications

Full classification in [route-classification.md](route-classification.md).

| Class | Count | Wave action |
|---|---|---|
| **A — canonical compliant** | 30 | KEEP |
| **B — bridge-only** | 4 | DELETE (Wave 3) |
| **C — dual-authority** | ~80 | MIGRATE (Wave 3B) |
| **D — hard bypass** | 5 | URGENT migrate (Wave 3B) |
| **E — dead/legacy** | 3 | DELETE |

---

## Canonical integration blockers

Full blocker analysis in [canonical-integration-readiness.md](canonical-integration-readiness.md). Summary:

1. **Isolated session store** — bridge cookies independent of canonical session
2. **Custom cookies** — `content_architect_company_id` carries authority outside canonical principal
3. **Middleware assumptions** — 67 hand-rolled cookie checks, no central chokepoint
4. **Hardcoded env auth** — login routes are env-only
5. **Incompatible admin flows** — frontend has no Supabase login UI for super-admin
6. **Missing capability mappings** — ~8 capabilities (`INTEGRATION_PLATFORM_OAUTH_MANAGE`, `BLOG_PUBLISH_MANAGE`, `CONSUMPTION_VIEW_AGGREGATE`, `INTELLIGENCE_OVERRIDE_MANAGE`, `CRON_CONFIG_MANAGE`, `BILLING_AUDIT_VIEW`, `SUPER_ADMIN_DASHBOARD_VIEW`, `CONTENT_ARCHITECT_*`) need to be added to `SecurityCapabilities.ts`

Total migration surface: ~175 files. ~90% mechanical via codemod.

---

## Security risk findings

Full analysis in [security-risk-analysis.md](security-risk-analysis.md). Tally:

| Severity | Count | Examples |
|---|---|---|
| **P0** | 4 | (P0-1) Bridge cookie + env auth = full SUPER_ADMIN; (P0-2) 67 routes have NO capability check; (P0-3) `platform-oauth-configs.ts` has 5 parallel auth surfaces — accessible to ANY org admin; (P0-4) `super_admins` table re-creation hazard |
| **P1** | 5 | logout asymmetry, invited-role authority, untracked bridge sessions, Bearer drop on Supabase expiry, synthetic userId in audits |
| **P2** | 3 | debug `console.log`s in prod, dual audit tables, role-string allowlist case-insensitivity |

P0-3 (platform-oauth-configs) is the only P0 not already addressed by the Wave 3A bridge expiry/dry-run mitigations and warrants targeted Wave 3B priority.

---

## Wave 3B blast-radius findings

Full simulation in [wave3b-blast-radius.md](wave3b-blast-radius.md). If bridge authority is removed TODAY:

| Category | Files | Impact |
|---|---|---|
| Inaccessible admin dashboards | 5 | Operator login redirect loop — no path back in |
| Broken admin APIs (cookie-only operator) | ~99 | All return 403; cookie-only operator locked out |
| Hardened (cookie surface removed) | 1 | platform-oauth-configs (still has SSR + role-string fallback) |
| Routes unchanged (Class A canonical) | 30 | Continue working for Supabase-authed admins |
| Routes already Supabase-only | ~60 | Continue working |

**For a fully-bootstrapped Supabase admin**: 5 dashboard pages break (UI not yet adapted); rest of the surface continues working.
**For a cookie-only operator (CURRENT STATE)**: catastrophic — entire admin surface goes dark.

Required pre-removal migrations (in order of unblock leverage):
1. Bootstrap first SUPER_ADMIN (Wave 3A — pending operator action)
2. Add Supabase login UX to `/super-admin/login.tsx`
3. Migrate Pattern A (67 routes)
4. Migrate Pattern C (13 routes) + add `CONTENT_ARCHITECT_*` capabilities
5. Migrate Pattern D (~60 routes) for canonical audit
6. 7-day dry-run window
7. Reviewer sign-off
8. THEN delete bridge

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `git ls-files "pages/super-admin*"` | enumerate super-admin pages | 7 page files |
| `grep -rln "super_admin_session"` (scoped to backend/, pages/, lib/) | direct cookie reads | 67 files |
| `grep -rln "getLegacySuperAdminSession"` | legacy session synthesizer callers | 19 files |
| `grep -rln "isContentArchitectSession"` | content-architect cookie callers | 13 files |
| `grep -rln "requireSuperAdminUser"` | Supabase-only admin gate callers | ~60 files |
| `grep -rln "requireCapability"` (pages/) | canonical gate callers | 15 files |
| `grep -rln "@supabase/ssr\|createServerClient"` | SSR cookie path | 6 files (1 admin auth) |
| `mcp__supabase__execute_sql` (super_admins/super_admin_audit_logs existence) | DB-grounded verification | super_admins ABSENT, super_admin_audit_logs EXISTS |
| `mcp__supabase__execute_sql` (count probes from Wave 3B readiness) | super-admin / passkey / step-up counts | all zero (no canonical principals) |
| `npx tsc --noEmit -p tsconfig.json` | typecheck (no edits made) | exit 0 |

---

## Final audit counts

| Metric | Value |
|---|---|
| Bridge-only admin routes | **4** |
| Dual-authority routes | **~80** (Pattern A 67 + Pattern B 19 + Pattern C 13, with overlap) |
| Hard auth bypasses | **5** (Class D) |
| Canonical-auth-compliant routes | **30** (Class A) |
| Admin routes missing IdentityResolver | **~99** (67 + 19 + 13 hand-rolled cookie + synthesizer paths) |
| Duplicate trust authorities | **12** (sources C1, C2, C3, R1, R2, R3, R4, R5, T1, T2, T3, T4, S1, U1, G1 grouped — see authority map; effective 12 distinct decision-grant points) |
| Typecheck errors | **0** |

---

## What I did NOT do (per prompt)

- ❌ Did not start Wave 3B
- ❌ Did not remove bridge authorities
- ❌ Did not patch auth ad hoc
- ❌ Did not migrate runtime behavior
- ❌ Did not rewrite admin routing
- ❌ Did not modify any source files

This audit is read-only. The five sub-reports + this final summary are the deliverable.

---

## Deliverables

All under `architecture-migration/reports/super-admin-unification-audit/`:

1. [authority-source-map.md](authority-source-map.md) — 12 authority sources with precedence + reachability
2. [session-divergence-trace.md](session-divergence-trace.md) — exact chain producing the symptom
3. [route-classification.md](route-classification.md) — every admin route classified A/B/C/D/E
4. [canonical-integration-readiness.md](canonical-integration-readiness.md) — migration surface + 5 blocker categories
5. [security-risk-analysis.md](security-risk-analysis.md) — 12 findings P0/P1/P2
6. [wave3b-blast-radius.md](wave3b-blast-radius.md) — what breaks if bridge removed today
7. [super-admin-unification-audit.md](super-admin-unification-audit.md) — this file (final summary)
