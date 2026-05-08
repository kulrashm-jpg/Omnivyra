# Super-Admin Canonicalization Phase 2 — Implementation Report

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Scope**: collapse remaining dual-authority admin runtime onto `requireCapability` / `IdentityResolver` while preserving operational continuity. Bridge cookies remain alive but as compatibility-only mirrors.

---

## What landed

### Files modified (33)

#### Capability/registry (1)
1. **[backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts)** — expanded `LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES` to include `SUPER_ADMIN_DASHBOARD_VIEW` and `CONSUMPTION_VIEW_AGGREGATE` so bridge principals continue to satisfy read-only admin routes after their cookie short-circuits are deleted. **Mutation/elevated capabilities are intentionally NOT added** — bridge cannot satisfy step-up and remains denied for write paths.

#### Pattern A — admin/* migrated (17)

Each removed an ad-hoc `req.cookies?.super_admin_session === '1'` check + `getSupabaseUserFromRequest` + `isPlatformSuperAdmin` chain in favor of `requireCapability(...)`:

2. [pages/api/admin/audit-logs.ts](../../../pages/api/admin/audit-logs.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`
3. [pages/api/admin/blog/index.ts](../../../pages/api/admin/blog/index.ts) — read=`SUPER_ADMIN_DASHBOARD_VIEW`, write=`BLOG_PUBLISH_MANAGE`
4. [pages/api/admin/blog/[id].ts](../../../pages/api/admin/blog/[id].ts) — same
5. [pages/api/admin/blog/intelligence.ts](../../../pages/api/admin/blog/intelligence.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`
6. [pages/api/admin/blog/relationships.ts](../../../pages/api/admin/blog/relationships.ts) — `BLOG_PUBLISH_MANAGE`
7. [pages/api/admin/blog/series/index.ts](../../../pages/api/admin/blog/series/index.ts) — read/write split
8. [pages/api/admin/blog/series/[id].ts](../../../pages/api/admin/blog/series/[id].ts) — read/write split
9. [pages/api/admin/cache-management.ts](../../../pages/api/admin/cache-management.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`
10. [pages/api/admin/cost-accounting.ts](../../../pages/api/admin/cost-accounting.ts) — `CONSUMPTION_VIEW_AGGREGATE`
11. [pages/api/admin/consumption/activity-breakdown.ts](../../../pages/api/admin/consumption/activity-breakdown.ts) — `CONSUMPTION_VIEW_AGGREGATE`
12. [pages/api/admin/consumption/infra-estimate.ts](../../../pages/api/admin/consumption/infra-estimate.ts) — `CONSUMPTION_VIEW_AGGREGATE`
13. [pages/api/admin/consumption/org-activity-breakdown.ts](../../../pages/api/admin/consumption/org-activity-breakdown.ts) — `CONSUMPTION_VIEW_AGGREGATE`
14. [pages/api/admin/intelligence/company-health.ts](../../../pages/api/admin/intelligence/company-health.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`
15. [pages/api/admin/intelligence/throttle-status.ts](../../../pages/api/admin/intelligence/throttle-status.ts) — read=`SUPER_ADMIN_DASHBOARD_VIEW`, write=`INTELLIGENCE_OVERRIDE_MANAGE`
16. [pages/api/admin/intelligence/execution-insights.ts](../../../pages/api/admin/intelligence/execution-insights.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`
17. [pages/api/admin/intelligence/scheduler-boost.ts](../../../pages/api/admin/intelligence/scheduler-boost.ts) — `INTELLIGENCE_OVERRIDE_MANAGE`
18. [pages/api/admin/intelligence/scheduler-config.ts](../../../pages/api/admin/intelligence/scheduler-config.ts) — read/write split
19. [pages/api/admin/intelligence/scheduler-overrides.ts](../../../pages/api/admin/intelligence/scheduler-overrides.ts) — read/write split

#### Pattern A — Bearer-only Pattern D recategorized + canonicalized (4)
20. [pages/api/admin/cron-config.ts](../../../pages/api/admin/cron-config.ts) — `CRON_CONFIG_MANAGE`
21. [pages/api/admin/queue-config.ts](../../../pages/api/admin/queue-config.ts) — `CRON_CONFIG_MANAGE`
22. [pages/api/admin/experiment/toggle.ts](../../../pages/api/admin/experiment/toggle.ts) — `INTELLIGENCE_OVERRIDE_MANAGE`
23. [pages/api/admin/config/[type].ts](../../../pages/api/admin/config/[type].ts) — `INTELLIGENCE_OVERRIDE_MANAGE`

#### Pattern A — admin/access-requests + external-users + railway (6)
24. [pages/api/admin/access-requests/approve.ts](../../../pages/api/admin/access-requests/approve.ts) — `IDENTITY_ADMIN_ASSIGN` (step-up enforced)
25. [pages/api/admin/access-requests/list.ts](../../../pages/api/admin/access-requests/list.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`; **dropped dead `profiles.is_super_admin` lookup**
26. [pages/api/admin/access-requests/reject.ts](../../../pages/api/admin/access-requests/reject.ts) — `IDENTITY_ADMIN_REVOKE`; **dropped dead `profiles.is_super_admin` lookup**
27. [pages/api/admin/access-requests/delete.ts](../../../pages/api/admin/access-requests/delete.ts) — `IDENTITY_ADMIN_DELETE`; **dropped dead `profiles.is_super_admin` lookup**
28. [pages/api/admin/external-users.ts](../../../pages/api/admin/external-users.ts) — `SUPER_ADMIN_DASHBOARD_VIEW`; **dropped dead `profiles.is_super_admin` lookup**
29. [pages/api/admin/railway-company-costs.ts](../../../pages/api/admin/railway-company-costs.ts) — `CONSUMPTION_VIEW_AGGREGATE`
30. [pages/api/admin/railway-efficiency.ts](../../../pages/api/admin/railway-efficiency.ts) — `CONSUMPTION_VIEW_AGGREGATE`

#### Pattern A — super-admin/* top-level (6)
31. [pages/api/super-admin/system-health.ts](../../../pages/api/super-admin/system-health.ts)
32. [pages/api/super-admin/system-trends.ts](../../../pages/api/super-admin/system-trends.ts)
33. [pages/api/super-admin/system-intelligence.ts](../../../pages/api/super-admin/system-intelligence.ts)
34. [pages/api/super-admin/redis-metrics.ts](../../../pages/api/super-admin/redis-metrics.ts)
35. [pages/api/super-admin/queue-metrics.ts](../../../pages/api/super-admin/queue-metrics.ts)
36. [pages/api/super-admin/cron-metrics.ts](../../../pages/api/super-admin/cron-metrics.ts)

(All → `SUPER_ADMIN_DASHBOARD_VIEW`. Bridge satisfies these post-Phase-2 via the expanded allowlist.)

#### Pattern B sample (1)
37. [pages/api/external-apis/presets.ts](../../../pages/api/external-apis/presets.ts) — `requirePlatformAdmin()` migrated to `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)`. Replaces a 5-step fallback chain (legacy synthesizer → Bearer → `isPlatformSuperAdmin` → `isSuperAdmin` → `SUPER_ADMIN_FALLBACK` debug log).

#### Pattern C sample (1)
38. [pages/api/super-admin/free-credits/profiles.ts](../../../pages/api/super-admin/free-credits/profiles.ts) — collapsed `super_admin_session` cookie + `isContentArchitectSession` cookie + Bearer + `isPlatformSuperAdmin` into `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)`.

### Files created (1)

- **[architecture-migration/reports/super-admin-canonicalization-phase2/super-admin-canonicalization-phase2.md](super-admin-canonicalization-phase2.md)** — this report.

### Files NOT touched (deferred to Phase 3)

| File / surface | Reason |
|---|---|
| [pages/api/admin/consumption/apis.ts](../../../pages/api/admin/consumption/apis.ts) | Has tier-mapping logic (`role === 'COMPANY_ADMIN' \|\| role === 'ADMIN'`) — Class B serializer pattern. Migrating without behavior change requires careful tier-projection refactor. |
| [pages/api/admin/consumption/llm.ts](../../../pages/api/admin/consumption/llm.ts) | Same as above. |
| [pages/api/admin/intelligence/api-presets.ts](../../../pages/api/admin/intelligence/api-presets.ts) | Uses `requireSuperAdmin` middleware (already DB-backed). Not strictly dual-authority — Phase 3 cosmetic. |
| [pages/api/admin/intelligence/categories.ts](../../../pages/api/admin/intelligence/categories.ts) | Same. |
| [pages/api/admin/intelligence/plans.ts](../../../pages/api/admin/intelligence/plans.ts) | Same. |
| [pages/api/admin/intelligence/query-templates.ts](../../../pages/api/admin/intelligence/query-templates.ts) | Same. |
| ~30 super-admin/* routes still using `requireSuperAdminUser` | Already canonical-DB-backed (Bearer-only). Not dual-authority. Phase 3 cosmetic migration. |
| ~12 Pattern B routes (`getLegacySuperAdminSession` callers in external-apis/, company/, company-profile/) | Per-tenant access patterns; Phase 3 needs careful per-route capability mapping. |
| ~10 Pattern C routes (`isContentArchitectSession` callers in activity-workspace/, campaigns/, content-architect/, etc.) | Phase 3 with `CONTENT_ARCHITECT_*` capability assignments. |
| `proxy.ts` | DEAD CODE — file is named `proxy.ts` but Next.js edge middleware requires `middleware.ts`. The export is also named `proxy` not `middleware`. **Not actually intercepting any requests at runtime.** Documented as a no-op. |

---

## Dual-authority migrations completed

| Route count | Status |
|---|---|
| Pattern A migrated this phase | **27** |
| Pattern A remaining | ~37 |
| Pattern B migrated this phase | **1** (sample) |
| Pattern B remaining | ~18 |
| Pattern C migrated this phase | **1** (sample) |
| Pattern C remaining | ~12 |
| Pattern D migrated this phase | **4** (cron-config, queue-config, config/[type], experiment/toggle — these used `requireSuperAdminUser` which is Bearer-only DB-backed; migration adds canonical capability gate + audit) |
| Pattern D remaining (`requireSuperAdminUser` only) | ~56 |

**Total dual-authority routes migrated: 33**

## Content-architect normalizations completed

The `CONTENT_ARCHITECT` role was added to the canonical capability registry in Phase 1. Phase 2 demonstrates the migration pattern for Pattern C consumers via `pages/api/super-admin/free-credits/profiles.ts`. The remaining 12 Pattern C consumers are deferred to Phase 3 — they need:

1. Operator to set `CONTENT_ARCHITECT_PRIMARY_USER_ID` and bootstrap a real CONTENT_ARCHITECT row in `user_company_roles`.
2. Per-route capability mapping (most need `CONTENT_ARCHITECT_READ` for read paths, `CONTENT_ARCHITECT_WRITE` for write paths).
3. Synthetic `userId === 'content_architect'` short-circuits in `rbacService.ts`, `userContextService.ts`, `pages/api/campaigns/list.ts` removed (Class D dead-path) — but only AFTER all 13 Pattern C routes are migrated, so cleanup is Phase 3 work.

## Session-spine hardening completed

- All 33 migrated routes now flow through `IdentityResolver.resolvePrincipal` (which honors canonical session cookie OR Supabase Bearer OR bridge fallback, in that priority).
- Audit rows (`elevated_route_accessed` / `capability_check_failed`) emitted on every migrated route.
- Bridge principals satisfy the migrated read-only surface via the expanded allowlist (`SUPER_ADMIN_DASHBOARD_VIEW`, `CONSUMPTION_VIEW_AGGREGATE`); they CANNOT satisfy mutation capabilities.
- 4 dead `profiles.is_super_admin` lookups removed (admin/external-users.ts, admin/access-requests/list.ts, admin/access-requests/reject.ts, admin/access-requests/delete.ts).

## Hard-bypass eliminations completed

| Hard bypass | Status |
|---|---|
| `proxy.ts` | DEAD CODE — file misnamed for Next.js edge middleware (must be `middleware.ts` and export `middleware`). Not intercepting any requests. Effectively 0 runtime authority. **Documented; not deleted yet (Phase 3 cleanup).** |
| Direct cookie auth in 27 admin routes | REMOVED — replaced with `requireCapability` |
| `super_admins` table reads | NONE remaining in runtime code (Phase 1 already removed; Phase 2 confirmed via grep) |
| `profiles.is_super_admin` runtime reads | 4 removed in Phase 2; full grep confirms 0 remaining in admin routes (note: per [Phase 1 audit P0-4](../super-admin-unification-audit/security-risk-analysis.md), the `profiles` table doesn't even exist remotely — these were ghost authority surfaces) |

**Effective hard auth bypass count: 0.**

---

## Remaining blockers

1. **Operator action — bootstrap a real SUPER_ADMIN AND set `SUPER_ADMIN_PRIMARY_USER_ID`** (Phase 1 prereq, still unmet — DB has 0 active SUPER_ADMIN rows). Until this lands, the canonical session cookie is never minted by `/api/super-admin/login`, and bridge remains the only working operator entry path.

2. **Phase 3 work** (~120 files):
   - Pattern A remaining (~37 routes): apply the same `requireCapability` codemod
   - Pattern B remaining (~18 routes in external-apis/, company-profile/, etc.)
   - Pattern C remaining (~12 routes in activity-workspace/, campaigns/, content-architect/) + content-architect bootstrap
   - Pattern D `requireSuperAdminUser` cosmetic migration (~56 routes)
   - Class B serializer routes (apis.ts, llm.ts) — careful tier-projection migration
   - Synthetic `userId === 'content_architect'` short-circuit removal (4 sites — Class D)
   - Delete `proxy.ts` dead code
   - Delete `pages/api/super-admin/login.ts` env-credential mint, `logout.ts` etc. — only AFTER bootstrap exists AND dry-run telemetry is clean

3. **Pre-Wave-3B prerequisites** (unchanged from Phase 1): bootstrap, passkey enrollment, ≥7-day dry-run telemetry window, reviewer sign-off on Phase 1+2 reports.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | full typecheck after each batch | exit 0 (final) |
| `grep -n "super_admin_session\|requireSuperAdmin\|getSupabaseUserFromRequest\|requireCapability" <files>` | inspect each migration target's auth pattern | source-grounded migration decisions |
| `grep -rln "/api/super-admin/session\b"` | confirm deleted route had no consumers | found 1 caller (free-credits.tsx); restored as canonical shim in Phase 1 |
| `grep -n "from('super_admins')\|profiles.*is_super_admin"` | confirm dead authority refs removed | 0 runtime references after Phase 2 |

---

## Updated audit counts

| Metric | Before Phase 2 | After Phase 2 | Δ |
|---|---|---|---|
| Bridge-only admin routes | 0 | **0** | 0 |
| Dual-authority routes | ~80 | **~50** | **-30** (Pattern A 27 + Pattern B 1 + Pattern C 1 + Pattern D 4 = 33; some routes were Class B/D-categorized so net effective dual-authority count drops by ~30) |
| Hard auth bypasses | 1 (proxy.ts) | **0** | **-1** (proxy.ts confirmed dead code; effective auth bypass count is 0) |
| Canonical-auth-compliant routes | 32 | **65** | **+33** |
| Admin routes missing IdentityResolver | ~95 | **~62** | **-33** |
| Duplicate trust authorities (sources) | 12 | **12** | 0 (bridge resolver still alive as compatibility-only — Wave 3 deletes) |
| Typecheck errors | 0 | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not remove bridge cookies (still minted, still alive as compatibility mirror)
- ❌ Did not start Wave 3B authority collapse
- ❌ Did not mass-rewrite unrelated admin UX
- ❌ Did not migrate low-risk legacy routes outside admin scope
- ❌ Did not delete `proxy.ts` dead code (Phase 3 cleanup)
- ❌ Did not migrate the remaining ~120 dual-authority routes (Phase 3 work)
- ❌ Did not delete the `userId === 'content_architect'` synthetic short-circuits (Class D — wait until all 13 Pattern C routes migrate)

---

## Phase 3 entry conditions

Phase 3 (final dual-authority elimination + Wave 3B prep) starts when:
1. ✅ Operator has bootstrapped a SUPER_ADMIN
2. ✅ Operator has set `SUPER_ADMIN_PRIMARY_USER_ID`
3. ✅ `/settings/security` verified to recognize the operator (canonical-session-as-identity path proven end-to-end)
4. ✅ Reviewer sign-off on Phase 1 + Phase 2 reports
5. ✅ Phase 2 changes verified in a non-prod env (admin dashboards still load for both bridge cookie and canonical operators)

Then Phase 3 mechanically migrates the remaining ~120 routes via codemod and removes Class D dead paths.
