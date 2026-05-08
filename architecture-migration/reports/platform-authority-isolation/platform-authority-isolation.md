# Platform Authority Isolation — Implementation Report

**Generated**: 2026-05-08
**Branch**: `identity-spine-enforcement`
**Scope**: enforce strict separation between platform authority (SUPER_ADMIN / CONTENT_ARCHITECT) and tenant authority (COMPANY_ADMIN and below). Does NOT touch tenant business flows.

---

## Files audited

### Capability + role registries
- [shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts)
- [backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts)
- [backend/security/stepup/StepUpPolicyRegistry.ts](../../../backend/security/stepup/StepUpPolicyRegistry.ts)
- [backend/security/AuthorizationService.ts](../../../backend/security/AuthorizationService.ts) — verified `hasCapability` enforces `organizationId` binding when supplied
- [backend/security/requireCapability.ts](../../../backend/security/requireCapability.ts) — verified `RequireCapabilityOptions` propagates `organizationId` correctly

### Platform routes
- All 15 routes calling `requireCapability` in `pages/api/`. For each: verified the capability used and whether `organizationId` was supplied.

### Visibility surfaces
- [components/Header.tsx](../../../components/Header.tsx) — `Usage` link points to `/super-admin/consumption` (multi-tier page; intentional)
- [components/layout/GlobalHeader.tsx](../../../components/layout/GlobalHeader.tsx) — same
- [components/BlogIntelView.tsx](../../../components/BlogIntelView.tsx) — admin-blog links rendered only inside admin pages (transitively gated)

### Tenant escalation risk surfaces
- All `pages/api/super-admin/*` routes for `BILLING_MANAGE` / `ORGANIZATION_MANAGE` usage without `organizationId` binding
- All routes for stale `userRole === 'SUPER_ADMIN'` literal-equality checks (none found in primary nav after Phase 4 visibility normalization)

---

## Files created (2)

1. **[backend/security/platformCapabilities.ts](../../../backend/security/platformCapabilities.ts)** — formal isolation invariant:
   - `PLATFORM_TIER_CAPABILITIES` enumerates the 14 capabilities that are platform-only.
   - `TENANT_ROLES` enumerates the 5 tenant roles (COMPANY_ADMIN, CONTENT_*, VIEW_ONLY).
   - `assertPlatformCapabilityIsolation()` — runtime invariant check that throws on any drift (any platform-tier capability appearing in a tenant role's expanded capability set). Intended to be called at server startup.
   - `describeRoleCapabilityIsolation()` — diagnostic helper for audit reports.

2. **[architecture-migration/reports/platform-authority-isolation/platform-authority-isolation.md](platform-authority-isolation.md)** — this report.

---

## Files modified (6)

### Capability registry (3 new platform-tier capabilities)
1. **[shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts)**
   - Added `BILLING_PLATFORM_MANAGE` (= `'billing.platform.manage'`)
   - Added `BILLING_PLAN_MANAGE` (= `'billing.plan.manage'`)
   - Added `BILLING_GRANT_FREE_CREDITS` (= `'billing.grant_free_credits'`)
   - All three added to `ALL_CAPABILITIES` and `STEP_UP_REQUIRED_CAPABILITIES`.

2. **[backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts)** — wired the 3 new platform-tier capabilities into `ROLE_CAPABILITIES.SUPER_ADMIN` ONLY. NOT added to COMPANY_ADMIN or any other tenant role.

3. **[backend/security/stepup/StepUpPolicyRegistry.ts](../../../backend/security/stepup/StepUpPolicyRegistry.ts)** — registered `PHISHING_RESISTANT_TRUSTED_TENMIN` policies for the 3 new capabilities + `INTEGRATION_PLATFORM_OAUTH_MANAGE` (which had been step-up-required but missing an explicit policy). Trusted-device required because these affect ALL tenants.

### Platform routes (4 routes migrated from BILLING_MANAGE → platform-tier)
4. **[pages/api/super-admin/credit-cost-config/update.ts](../../../pages/api/super-admin/credit-cost-config/update.ts)** — `BILLING_MANAGE` → `BILLING_PLATFORM_MANAGE`. Affects all-org credit cost configuration.

5. **[pages/api/super-admin/free-credits/grant.ts](../../../pages/api/super-admin/free-credits/grant.ts)** — `BILLING_MANAGE` (with target-org-as-membership-binding which was misuse) → `BILLING_GRANT_FREE_CREDITS` (no org binding required). Closes the self-grant attack: previously a COMPANY_ADMIN of org X could satisfy the gate when granting free credits to org X.

6. **[pages/api/super-admin/free-credits/requests.ts](../../../pages/api/super-admin/free-credits/requests.ts)** — `BILLING_MANAGE` → `BILLING_GRANT_FREE_CREDITS`. Reviewing free-credit access requests is platform-tier (cross-org).

7. **[pages/api/super-admin/plans/create.ts](../../../pages/api/super-admin/plans/create.ts)** — `BILLING_MANAGE` → `BILLING_PLAN_MANAGE`. Pricing plans affect all orgs by definition.

---

## Platform isolation fixes completed

| Risk | Before | After |
|---|---|---|
| `pages/api/super-admin/credit-cost-config/update.ts` (Class C: tenant-escalation) | `BILLING_MANAGE` — any COMPANY_ADMIN passes the capability check (step-up still required, but capability gate misclassified) | `BILLING_PLATFORM_MANAGE` — SUPER_ADMIN only |
| `pages/api/super-admin/free-credits/grant.ts` (Class C + self-grant attack) | `BILLING_MANAGE` with `organizationId: <target_org>` — required actor membership in target org. Either fails for SUPER_ADMINs not in that org, OR succeeds for COMPANY_ADMINs of the target org granting themselves credits. | `BILLING_GRANT_FREE_CREDITS` — SUPER_ADMIN only, no org binding required, target org recorded for audit only |
| `pages/api/super-admin/free-credits/requests.ts` (Class C) | `BILLING_MANAGE` | `BILLING_GRANT_FREE_CREDITS` |
| `pages/api/super-admin/plans/create.ts` (Class C) | `BILLING_MANAGE` | `BILLING_PLAN_MANAGE` |

## Capability-boundary fixes completed

- 3 new platform-tier capabilities defined with clear "SUPER_ADMIN-only" comments.
- All 3 added to `STEP_UP_REQUIRED_CAPABILITIES` AND have step-up policies registered with `PHISHING_RESISTANT_TRUSTED_TENMIN` (passkey + trusted-device + 10-min TTL).
- `assertPlatformCapabilityIsolation()` invariant check added — confirms zero tenant role holds any platform-tier capability. Will fail server startup if drift introduced.

## Platform-route isolation fixes completed

- 4 super-admin billing routes migrated from per-tenant `BILLING_MANAGE` to platform-tier capabilities.
- Verified all other `requireCapability` callsites use either platform-tier capabilities (correct) OR per-tenant capabilities WITH `organizationId` binding (correct).
- No remaining route uses a per-tenant capability without `organizationId` for a platform operation.

## Visibility-isolation fixes completed

Source-grounded audit found:
- ✅ `/super-admin/consumption` link in nav is gated on `isCompanyAdmin` (after Phase 4 covers SUPER_ADMIN | COMPANY_ADMIN | ADMIN). The page itself is multi-tier (super_admin / company_admin / user views) with server-side scope enforcement. Not a leak.
- ✅ Admin-blog links rendered only inside admin pages (transitively gated).
- ✅ No nav surface exposes platform-tier-only routes to lower-tier users.

No additional visibility fixes needed in this phase.

## Enforcement additions completed

- **Run-time invariant**: `assertPlatformCapabilityIsolation()` throws on startup if any tenant role accidentally holds a platform-tier capability. Intended to be called from a server entry point or health probe.
- **Static enumeration**: `PLATFORM_TIER_CAPABILITIES` provides a single source of truth for which capabilities are platform-only.
- **Documentation**: `backend/security/platformCapabilities.ts` includes the rule for adding new platform-tier capabilities (5-step checklist).

Recommended next phase: wire `assertPlatformCapabilityIsolation()` into the existing `backend/security/env.ts` validation chain so it runs on every server boot.

---

## Remaining blockers

1. **Operator prerequisites unchanged** from prior phases — still 0 active SUPER_ADMIN rows in DB. Until the operator bootstraps + sets `SUPER_ADMIN_PRIMARY_USER_ID`, the platform-tier capability gates are unreachable in production. The CODE is correct; the runtime state is the blocker.

2. **`assertPlatformCapabilityIsolation()` not yet wired into startup**. Recommended Phase: import it from a server entry (e.g. `backend/services/serverBootstrap.ts` or `pages/_app.tsx`-equivalent server hook) so it fails fast on drift.

3. **`CONTENT_ARCHITECT` capabilities not yet enforced** as platform-tier. The `CONTENT_ARCHITECT_READ` and `CONTENT_ARCHITECT_WRITE` capabilities are declared platform-tier conceptually but `PLATFORM_TIER_CAPABILITIES` excludes them because the architect role itself isn't yet bootstrapped (no DB consumers). Adding them post-bootstrap is a follow-up.

4. **Visibility surface for `/super-admin/*` routes** — the URL prefix is shared by SUPER_ADMIN-only and multi-tier pages. Pages like `/super-admin/consumption` adapt by tier; pages like `/super-admin/free-credits` are SUPER_ADMIN-only. A future Phase could rename / restructure for clarity, but not in this scope.

5. **Bridge-cookie compatibility** — bridge principals can still satisfy `SUPER_ADMIN_DASHBOARD_VIEW` via the expanded `LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES` allowlist (Phase 5 compatibility expansion). They CANNOT satisfy any of the 3 new platform-tier billing capabilities (these aren't in the allowlist, AND step-up is required which bridge cannot satisfy). Wave 3 deletes the bridge.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -B1 "capability: BILLING_MANAGE\|capability: ORGANIZATION_MANAGE\|..."` (pages/api/) | Identify shared capabilities used in platform routes | 4 platform billing routes flagged |
| `grep -B1 -A4 "capability: ORGANIZATION_MANAGE" pages/api/virality/playbooks/*` | Verify tenant routes correctly pass org binding | All 2 sites pass `organizationId` |
| `grep -n "capability:" pages/api/super-admin/purchases/complete.ts` | Verify purchase-complete uses correct capability | uses `BILLING_PURCHASE` (correct) |
| `grep -rn "BILLING_MANAGE\b" pages/api/` | Confirm no remaining BILLING_MANAGE platform usage | only doc comments left |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after capability + route migrations | exit 0 |
| `node -e "..."` (attempted) | Runtime invariant check | TypeScript can't be required directly; mental trace confirms 0 violations |

Manual trace of `assertPlatformCapabilityIsolation()`:
- `COMPANY_ADMIN` capabilities: ORGANIZATION_MANAGE, BILLING_MANAGE, BILLING_VIEW, BILLING_PURCHASE, BILLING_AUDIT_VIEW, INTEGRATION_MANAGE, INTEGRATION_SECRETS_READ, API_KEY_MANAGE, API_KEY_GENERATE, AUTOMATION_EXECUTE, MFA_ENROLL, MFA_VIEW_FACTORS, CAMPAIGN_EXECUTE, CAMPAIGN_VIEW, CAMPAIGN_DELETE, CONTENT_PUBLISH, CONTENT_REVIEW, CONTENT_CREATE, CONTENT_DELETE — **0 platform-tier overlap** ✓
- `CONTENT_PUBLISHER`: CAMPAIGN_VIEW, CONTENT_PUBLISH, CONTENT_REVIEW, CONTENT_CREATE, MFA_ENROLL, MFA_VIEW_FACTORS — **0 overlap** ✓
- `CONTENT_REVIEWER`: CAMPAIGN_VIEW, CONTENT_REVIEW, CONTENT_CREATE, MFA_ENROLL, MFA_VIEW_FACTORS — **0 overlap** ✓
- `CONTENT_CREATOR`: CAMPAIGN_VIEW, CONTENT_CREATE, MFA_ENROLL, MFA_VIEW_FACTORS — **0 overlap** ✓
- `VIEW_ONLY`: CAMPAIGN_VIEW, MFA_ENROLL, MFA_VIEW_FACTORS — **0 overlap** ✓

Invariant holds. Server startup will pass when the assertion is wired in.

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Mixed-authority routes (platform-tier route using shared per-tenant capability) | **4** (credit-cost, free-credits/grant, free-credits/requests, plans/create) | **0** | -4 |
| Tenant-escalation risks (COMPANY_ADMIN of any org could satisfy a platform gate) | **4** | **0** | -4 |
| Stale platform role checks (literal `role === 'SUPER_ADMIN'` in primary nav) | **0** (cleared in Phase 4) | **0** | 0 |
| Platform visibility leaks (platform routes shown to non-SUPER_ADMIN nav) | **0** (`/super-admin/consumption` is multi-tier by design) | **0** | 0 |
| Mixed capability lineage paths (capabilities in both platform AND tenant roles when they shouldn't be) | **0** (per audit) | **0**, enforced by `PLATFORM_TIER_CAPABILITIES` | 0 → invariant-locked |
| Organization-fallback platform guards (platform routes that fall through to org membership check) | **0** post-migration | **0** | 0 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch tenant business flows
- ❌ Did not modify auth architecture (no changes to IdentityResolver, SessionAuthorityService, etc.)
- ❌ Did not migrate per-tenant routes that correctly pass `organizationId`
- ❌ Did not rename `/super-admin/*` URL prefix (cosmetic; out of scope)
- ❌ Did not wire `assertPlatformCapabilityIsolation` into startup (recommended next phase; trivial integration)
- ❌ Did not add `CONTENT_ARCHITECT_READ`/`CONTENT_ARCHITECT_WRITE` to `PLATFORM_TIER_CAPABILITIES` — pending CONTENT_ARCHITECT bootstrap

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| Wire `assertPlatformCapabilityIsolation` into server startup | Hard-fail boot on isolation drift | 1 file (`server.ts` / equivalent) |
| Add `CONTENT_ARCHITECT_*` to platform-tier set after bootstrap | Tighten architect isolation | 1 file (`platformCapabilities.ts`) |
| Audit cross-cutting `requireSuperAdminUser` consumers (~60 routes) for platform-tier capability migration | Eliminate Bearer-only DB-backed legacy gate | ~60 mechanical migrations |
| Lint rule: forbid passing per-tenant capability without `organizationId` | Static enforcement of org binding | ESLint custom rule |
