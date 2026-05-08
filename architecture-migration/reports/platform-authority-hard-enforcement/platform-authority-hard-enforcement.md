# Platform Authority Hard Enforcement — Implementation Report

**Generated**: 2026-05-08
**Branch**: `identity-spine-enforcement`
**Scope**: convert the platform/tenant capability isolation invariant into HARD runtime enforcement (boot-time invariant assertion + side-effect propagation through canonical resolver). Migrate legacy-facade super-admin routes to canonical platform-tier capability gates. Add bridge-vs-platform telemetry. Soft-warning static detection script.

---

## Files audited

- [backend/security/platformCapabilities.ts](../../../backend/security/platformCapabilities.ts) — invariant module
- [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts) — canonical resolver (where the side-effect import lands)
- [backend/security/AuthorizationService.ts](../../../backend/security/AuthorizationService.ts) — `decideCapability` denial path (where bridge-vs-platform telemetry enriches)
- [backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts) — verified no drift
- All `pages/api/super-admin/*` routes — identified 7 still using legacy `requireSuperAdminUser` Bearer-only facade
- All `requireCapability` callsites — verified no platform routes use shared per-tenant capabilities (Phase 9 migrations completed)
- All `userRole === 'SUPER_ADMIN'` literal-equality patterns in pages/components/hooks — Phase 4 audit confirmed none in primary nav

---

## Files created (2)

1. **[scripts/platform-isolation-check.ts](../../../scripts/platform-isolation-check.ts)** — static detector with 3 categories:
   - `super_admin_user_legacy` — `requireSuperAdminUser` consumers in `pages/api/super-admin/*` (migration candidates)
   - `shared_cap_in_platform_route` — per-tenant capability used in a `pages/api/super-admin/*` route (boundary violation candidate)
   - `role_equality` — `userRole === 'SUPER_ADMIN'` literal checks outside test/script directories
   Soft-warning by default; allowlist-aware. Run via `npx tsx scripts/platform-isolation-check.ts`.

2. **[architecture-migration/reports/platform-authority-hard-enforcement/platform-authority-hard-enforcement.md](platform-authority-hard-enforcement.md)** — this report.

---

## Files modified (8)

### Boot-time invariant wiring (2)
1. **[backend/security/platformCapabilities.ts](../../../backend/security/platformCapabilities.ts)**
   - Added module-load invocation: `try { assertPlatformCapabilityIsolation(); } catch (err) { console.error('[platform-isolation] BOOT ASSERTION FAILED:', err.message); throw err; }`
   - Any module importing this triggers the check at first import. Fails fast (synchronously) on tenant/platform capability drift.

2. **[backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts)**
   - Added `import './platformCapabilities';` side-effect import.
   - IdentityResolver is the canonical principal resolver — every auth-gated request loads it. The side-effect import guarantees the boot invariant fires within the first request lifecycle of every server boot, before any authorization decision is made.

### Bridge-vs-platform telemetry (1)
3. **[backend/security/AuthorizationService.ts](../../../backend/security/AuthorizationService.ts)**
   - `decideCapability` denial path now enriches the `reason` field with `[bridge attempted platform capability]` when the principal is a bridge principal AND the requested capability is not held. Operators can query `capability_audit_log` for `decision='denied' AND via_legacy_bridge=true` to see every bridge → platform escalation attempt.

### Platform-route enforcement (5)
Migrated from legacy `requireSuperAdminUser` Bearer-only check → canonical `requireCapability` + platform-tier capability:

4. **[pages/api/super-admin/audit-logs.ts](../../../pages/api/super-admin/audit-logs.ts)** — `SUPER_ADMIN_DASHBOARD_VIEW` (read-only)
5. **[pages/api/super-admin/community-ai-metrics.ts](../../../pages/api/super-admin/community-ai-metrics.ts)** — `SUPER_ADMIN_DASHBOARD_VIEW` (read-only)
6. **[pages/api/super-admin/usage-alerts.ts](../../../pages/api/super-admin/usage-alerts.ts)** — `SUPER_ADMIN_DASHBOARD_VIEW` (read-only)
7. **[pages/api/super-admin/rbac.ts](../../../pages/api/super-admin/rbac.ts)** — `IDENTITY_ADMIN` (mutation; phishing-resistant + trusted-device step-up enforced via existing policy)
8. **[pages/api/super-admin/credits/grant.ts](../../../pages/api/super-admin/credits/grant.ts)** — `BILLING_GRANT_FREE_CREDITS` (mutation; same step-up policy as `/api/super-admin/free-credits/grant`)

---

## Platform invariant enforcement completed

- **Boot-time invariant** — `assertPlatformCapabilityIsolation()` runs at module load of `platformCapabilities.ts` and throws on any tenant role holding a platform-tier capability.
- **Propagation chain** — `IdentityResolver.ts` side-effect imports `platformCapabilities`, so every auth-gated route triggers the check on first request after boot.
- **Failure mode** — first request returns 500 with descriptive log message identifying the violating role(s) and capability(ies). The server doesn't silently leak authority.
- **No false-positive risk** — manual trace of all 5 tenant roles vs. all 14 platform-tier capabilities confirms zero overlap. Invariant passes with the current registry.

## Platform-route enforcement completed

| Route | Before | After |
|---|---|---|
| `/api/super-admin/audit-logs` | `requireSuperAdminUser` (Bearer-only) | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` |
| `/api/super-admin/community-ai-metrics` | `requireSuperAdminUser` | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` |
| `/api/super-admin/usage-alerts` | `requireSuperAdminUser` | `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` |
| `/api/super-admin/rbac` | `requireSuperAdminUser` (no step-up) | `requireCapability(IDENTITY_ADMIN)` (phishing-resistant + trusted-device step-up) |
| `/api/super-admin/credits/grant` | `requireSuperAdminUser` (no step-up) | `requireCapability(BILLING_GRANT_FREE_CREDITS)` (phishing-resistant + trusted-device step-up) |

Two routes were intentionally NOT migrated this phase:
- `pages/api/super-admin/users.ts` — already uses `requireCapability` for IDENTITY_ADMIN_VIEW/MUTATE on the canonical paths; the Bearer-only fallback in some sub-handlers is documented compatibility.
- `pages/api/super-admin/companies.ts` — `requireSuperAdminUser` consumer kept for now; per-org operations + role-aware response shaping make migration require careful handling.

These remain in the `super_admin_user_legacy` category in the static detector but are explicitly grandfathered.

## Platform-visibility locking completed

- Phase 4 visibility normalization confirmed in place — Header.tsx + GlobalHeader.tsx use the canonical settings registry + the COMPANY_ADMIN-or-above gate (no literal-equality regression).
- Static detector (Category 3 `role_equality`) flags any future regression. Allowlists test/script directories.
- No new visibility leaks identified in this phase.

## Bridge-containment hardening completed

- Bridge principal capability allowlist (`LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES`) excludes ALL 14 platform-tier capabilities.
- Step-up requirement on platform-tier capabilities is unsatisfiable by bridge principals (`evaluateStepUp` returns `BRIDGE_PRINCIPAL_INELIGIBLE`).
- New telemetry: `decideCapability` now enriches the audit reason for bridge-principal denials, allowing operator queries of the form:
  ```sql
  SELECT capability, count(*)
  FROM capability_audit_log
  WHERE decision = 'denied'
    AND via_legacy_bridge = true
    AND reason LIKE '%bridge attempted platform capability%'
    AND occurred_at >= now() - interval '7 days'
  GROUP BY capability;
  ```

## Enforcement additions completed

- **Runtime**: boot-time `assertPlatformCapabilityIsolation()` (hard fail on import).
- **Audit**: bridge-attempt telemetry (`[bridge attempted platform capability]` reason enrichment in `decideCapability`).
- **Static**: `scripts/platform-isolation-check.ts` with 3 detection categories + allowlist support.
- **Documentation**: 5-step "adding a new platform-tier capability" checklist in `platformCapabilities.ts` (carried over from Phase 9).

---

## Remaining blockers

1. **Operator prerequisites unchanged** — 0 active SUPER_ADMIN rows in DB. Until the operator bootstraps + sets `SUPER_ADMIN_PRIMARY_USER_ID`, every migrated route returns 401 / 403 to all callers. The CODE is correct; the runtime state is the blocker.

2. **`requireSuperAdminUser` consumers still on legacy facade** in 2 routes (`super-admin/users.ts`, `super-admin/companies.ts`) — these are explicitly grandfathered and listed in the static detector's allowlist with notes. Future Phase migrates them with careful per-handler capability mapping.

3. **`assertPlatformCapabilityIsolation` runs on first request, not at compile time** — Next.js Pages Router has no canonical bootstrap entry. The current side-effect-import pattern is the closest hard-fail equivalent. A future Phase could add a build-time check via a pre-build script.

4. **`CONTENT_ARCHITECT_*` capabilities not yet in `PLATFORM_TIER_CAPABILITIES`** — pending DB bootstrap of the `CONTENT_ARCHITECT` role. Once the role has an active row, adding the two capabilities is a 1-line change with the invariant catching any drift.

5. **Bridge-cookie compatibility layer still in place** — bridge can satisfy `SUPER_ADMIN_DASHBOARD_VIEW` (compat allowlist). Cannot satisfy any of the 3 platform-tier billing caps (not in allowlist + step-up required). Wave 3 deletes the bridge.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -l "requireSuperAdminUser" pages/api/super-admin/*.ts pages/api/super-admin/**/*.ts` | enumerate legacy facade consumers | 7 files; 5 migrated this phase, 2 explicitly grandfathered |
| `grep -B1 -A4 "capability: ORGANIZATION_MANAGE" pages/api/virality/playbooks/*` | re-verify tenant routes pass `organizationId` | confirmed |
| `grep -rn "BILLING_MANAGE\b" pages/api/super-admin/` | confirm no remaining shared-capability platform usage | only doc comments left |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after enforcement wiring | exit 0 |
| Manual trace of `assertPlatformCapabilityIsolation()` against 5 tenant roles × 14 platform-tier capabilities | confirm zero overlap | 0 violations; invariant passes |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Mixed-authority routes (platform-tier route using shared per-tenant capability) | **0** (closed in Phase 9) | **0** | 0 |
| Tenant-escalation risks (COMPANY_ADMIN of any org could satisfy a platform gate) | **0** | **0** | 0 |
| Stale platform role checks (literal `userRole === 'SUPER_ADMIN'` in primary nav/auth positions) | **0** (closed in Phase 4) | **0** | 0 |
| Platform visibility leaks | **0** | **0** | 0 |
| Bridge-authoritative platform mutations | **0** (bridge has zero platform-tier capabilities; step-up unsatisfiable) | **0** + telemetry now records every attempt | infra |
| Organization-fallback platform guards (platform routes that fall through to org membership) | **0** | **0** | 0 |
| Routes using legacy `requireSuperAdminUser` facade in `pages/api/super-admin/*` | **7** | **2** (explicitly grandfathered) | -5 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch tenant business logic
- ❌ Did not rewrite unrelated auth flows
- ❌ Did not remove the compatibility bridge
- ❌ Did not start Wave 3B collapse
- ❌ Did not migrate `super-admin/users.ts` or `super-admin/companies.ts` (explicitly grandfathered)
- ❌ Did not remove `requireSuperAdminUser` from `requestAccessService.ts` (still imported by ~50 admin routes outside this sprint)
- ❌ Did not wire `assertPlatformCapabilityIsolation` into Next.js build-time check (deferred — Pages Router has no clean bootstrap hook)

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Migrate the 2 grandfathered super-admin routes (users, companies) | Eliminate the last `requireSuperAdminUser` consumers in super-admin/* | 2 files |
| Migrate ~50 `requireSuperAdminUser` consumers in `pages/api/admin/*` | Canonical capability gating across the admin tier | ~50 files |
| Wire `assertPlatformCapabilityIsolation` into a pre-build script | Compile-time enforcement | 1 npm script + CI hook |
| Add `CONTENT_ARCHITECT_*` to `PLATFORM_TIER_CAPABILITIES` post-bootstrap | Tighten architect isolation | 1 line |
| ESLint rule: forbid `requireSuperAdminUser` usage in `pages/api/super-admin/*` | Static enforcement of the canonical pattern | custom ESLint rule |
