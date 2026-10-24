# Closure-015B — high-risk authorization containment assessment and test plan

**Assessment and test design only.**
- No source or test file was changed, and nothing was staged or committed.
- No database rows were read or written: only `supabase/_schema/baseline.sql` (a file) and catalog metadata were consulted.
- No migration, production access, credential inspection or remote operation took place.
- No application or worker was started.

**Markers:**
- **CONFIRMED** — verified in code by me in this phase or in Closure-015A [V].
- **INCONCLUSIVE** — code cannot settle it.
- **BLOCKED** — needs runtime or production evidence that this phase may not gather.

**No claim of runtime exploitation or production exposure is made.**

## 1. Baseline

| | |
|---|---|
| Worktree / branch | `C:\tmp\closure-014a` / `integration/closure-014a` |
| HEAD | `03724e86969cd9d022fd191e142e914e04963b8a` |
| Staged / unstaged | 0 / 0 |
| Untracked (preserved) | `CLOSURE_015_SUPER_ADMIN_STATUS_AUDIT.md` (sha256 `b8eb1988…`, byte-identical at start and end) and `CLOSURE_015A_AUTHORIZATION_IMPACT_ASSESSMENT.md` (`7c996444…`) |

## 2. Prioritized confirmed findings

| # | Finding | Code | Status |
|---|---|---|---|
| P1 | An **invited** company-scoped `SUPER_ADMIN` membership passes `withRBAC([SUPER_ADMIN])`, and five handlers behind it act **platform-wide or cross-tenant** | §4 | CONFIRMED |
| P2 | `company/users/reinvite.ts` lets an **active company admin** recreate a privileged membership as `invited`, preserving `SUPER_ADMIN` | §5 | CONFIRMED |
| P3 | `/api/users/invite` → `inviteUser` changes an **existing active** membership's role in place to **any** role, including `SUPER_ADMIN`, so an active super admin can mint another **active** super admin without the Closure-014 identity controls | §5.4 | CONFIRMED (new in 015B) |
| P4 | Recommendation-audit reads are ID-only (cross-tenant), and the only writer cannot produce matching rows and writes undefined columns | §6 | CONFIRMED (code); exposure INCONCLUSIVE / BLOCKED |
| P5 | `admin/delete-content` / `delete-activity`: unguarded destructive platform deletes with client-supplied audit data and false success | §7 | CONFIRMED |
| P6 | `campaigns?type=content-plan` DELETE: tenant-bound, no role check | §7 | CONFIRMED |
| P7 | Re-invite **demotes** on acceptance: the membership keeps its role, but the new invitation carries the default `CONTENT_CREATOR`, and acceptance applies `invitation.role` | §5.3 | CONFIRMED (functional defect, new in 015B) |

## 3. Attack preconditions and impact

| # | Preconditions (all needed) | Static impact | Runtime / production |
|---|---|---|---|
| P1 | (a) An account with `users.status='active'` (an *invited account* is refused at authentication: `supabaseAuthService.ts:41-42`). (b) A `user_company_roles` row `role='SUPER_ADMIN', status='invited'` in some company X. (c) The request carries `companyId=X`. | releases the **global** governance lock; restores **any tenant's** governance snapshot by id; rebuilds **any** campaign's projection; runs the slot scheduler for **every** company; reads the platform Omnivyra health report | BLOCKED: no runtime test (needs synthetic rows); prevalence of (b) unknown |
| P2 | An active COMPANY_ADMIN/ADMIN of X (or an active platform SA), plus a target with a prior SUPER_ADMIN row in X (e.g. one deactivated, which keeps the role: `rbacService.ts` SEC-91A comment ~:254-257) | creates precondition P1(b) for that target. Applied to an **active** SA whose row is in X, it deletes the active row, removing platform authority (denial of admin). | BLOCKED (prevalence) |
| P2 → acceptance | the target accepts the new invitation | **no escalation**: the invitation has no role field set, so the default `CONTENT_CREATOR` applies, the `invitations_role_check` constraint excludes `SUPER_ADMIN` (`baseline.sql:16811`), and acceptance overwrites the membership role with it (P7). The invited-SA window lasts **until acceptance, indefinitely if never accepted** (no expiry at authorization time). | CONFIRMED (code) |
| P3 | An active platform SA (no step-up, no capability) | another **active** SUPER_ADMIN; bypasses `identity.admin.assign`, passkey step-up and `validateCapabilityGrant` from Closure-014 | CONFIRMED (code) |
| P4 | P1 precondition or an active platform SA, plus audit rows that have non-null ids | read other tenants' `company_profile_used` / trend / score data | INCONCLUSIVE: repository code never writes the ids (§6). BLOCKED: production rows. |
| P5 | An active platform SA (no step-up) | irreversible deletes, no tenant scope; forged audit IP/UA; scheduled post still publishes after its activity is deleted | CONFIRMED (code) |
| P6 | Any member of the campaign's company (active, or invited admin) | deletes that campaign's plan rows (incl. non-panel rows: the marker is GET-only [015A]) | CONFIRMED (code) |

## 4. Route-by-route authorization (Workstream A)

All five routes use **only** `withRBAC(handler, [Role.SUPER_ADMIN])` and none reads `req.rbac.companyId`.

The shared path [V] is:
1. `withRBAC.ts:48-50`: `companyId` comes from the request.
2. `enforceRole` (`rbacService.ts:282-341`):
   - 401 if unauthenticated;
   - 400 without a companyId;
   - a platform bypass, which needs **active** exact SUPER_ADMIN (`hasActiveSuperAdminRow` :266-276; bypass :322-324);
   - otherwise `getUserRole(X)`, which returns an active role, or an **invited** COMPANY_ADMIN/SUPER_ADMIN role (:197-211).

There is **no step-up** and no capability check on any of the five routes.

| Route | Handler / effect | Company or platform scope of the effect | Request can select another company's records? | Tests |
|---|---|---|---|---|
| `POST /api/governance/unlock` | `pages/api/governance/unlock.ts:23` → `releaseGovernanceLock` (`GovernanceLockdownService.ts:90-113`): updates the **single** `governance_lockdown` row (`.limit(1)`, no company filter) | **platform-global** | n/a (global) | `governance_lockdown.test.ts:196-217`: functional only, pre-attaches `req.rbac` |
| `POST /api/governance/restore-snapshot` | `restore-snapshot.ts:22-28` → `restoreGovernanceSnapshot(snapshotId)`; the company is taken from the snapshot row (`company_id`), not from X | **cross-tenant write** | **yes**, by `snapshotId` | `governance_snapshot.test.ts:133-202`: functional only |
| `POST /api/governance/rebuild-projection` | `rebuild-projection.ts:18-23` → `rebuildGovernanceProjection(campaignId)` (`GovernanceProjectionService.ts:153+`): looks up the campaign by id; the company comes from `campaign_versions.company_id` | **cross-tenant write** of derived projection data | **yes**, by `campaignId` | none |
| `POST /api/opportunities/refresh-slots` | `refresh-slots.ts:26-36`: a cron-secret branch (`constantTimeEqual`), otherwise `withRBAC` → `runOpportunitySlotsScheduler()` (`opportunitySlotsScheduler.ts:30+`): loops `getActiveCompanyIds()` × types → `fillOpportunitySlots` | **platform-wide write** | n/a (all companies) | `sec91CConstantTimeSecrets.test.ts` (cron-secret comparison only) |
| `GET /api/omnivyra/health` | `health.ts:12` → `getOmnivyraHealthReport()` (in-process report) | platform read, low sensitivity | n/a | none |

**Minimum invariant per route.** The owner chooses the mechanism; the invariant is a security requirement.

| Route | Minimum invariant |
|---|---|
| unlock | **active platform super admin** plus **passkey step-up** (a platform-global write) |
| restore-snapshot | active platform SA plus step-up, **or** (if company-scoped restore is wanted) an authorized active company admin **and** `snapshot.company_id === authorized company`, checked before any write |
| rebuild-projection | active platform SA, **or** the campaign's company equals the authorized company |
| refresh-slots | cron secret **or** active platform SA (plus step-up if treated as a platform write) |
| omnivyra/health | active platform SA or the existing read capability `super_admin.dashboard.view` |

**Global `withRBAC` change: not recommended now.**
- Altering `getUserRole`'s invited fallback affects 81 `withRBAC` routes, 103 direct `enforceRole` routes and 103 `getUserRole` callers [015A §4.5].
- Many of those *intentionally* admit invited COMPANY_ADMINs (pinned by tests, §5.5).

A per-route guard on these five routes closes P1 without touching the shared helper.

## 5. Reinvitation and invitation policy (Workstream B)

### 5.1 Role selection

| Path | Who may call | Role written | Status written |
|---|---|---|---|
| `company/users/reinvite.ts` | an active platform SA, or an active COMPANY_ADMIN/ADMIN of X (`isActorAuthorized`, ~:18-41) | the target's **existing role in X**, any value (:119-128); `CONTENT_CREATOR` if none | **delete** then **insert** `invited` (:131-143) |
| `reinvite` invitation row | same | **no role field**, so the default `CONTENT_CREATOR` (`createInvitationToken`, :79-88; `baseline.sql` `invitations.role` default) | — |
| `/api/users/invite` → `inviteUser` | an active platform SA only (`requireUserAdminAccess`: `isSuperAdmin`, else `Role.ADMIN`, which `getUserRole` never returns) | **any** `role.toUpperCase()` (:83) | new row: DB default `invited`. **Existing row: role updated in place, status unchanged** (:91-97) |
| whitelisted paths | `admin/invite-user.ts`, `company/users.ts`, `superAdmin/usersShared.ts`, `usersCreateShared.ts` [015A, A] | whitelists excluding `SUPER_ADMIN` | — |

### 5.2 Can inactive or former privileged memberships be restored to invited?
**Yes (CONFIRMED)**, through `reinvite.ts`: an `inactive` `SUPER_ADMIN` row becomes `invited` `SUPER_ADMIN`.

### 5.3 Acceptance and expiry

| Check | Enforced where | Status |
|---|---|---|
| expiry at acceptance | `team/accept-invite.ts:75-76`; `auth/accept-invite.ts:74-77` (also revokes); `set-password.ts:87-89`; RPC `activate_invitation_membership` (`expires_at <= p_now`) | CONFIRMED |
| expiry at **authorization** | **nowhere**: invited-admin fallbacks read `user_company_roles` only, never `invitations` | CONFIRMED |
| role on acceptance | `team/accept-invite.ts:149-177` and the RPC (`ON CONFLICT … role = EXCLUDED.role`) both set **`invitation.role`** | CONFIRMED: P7 demotion after re-invite |
| `user_company_roles.status='expired'` writer | none (the only `'expired'` writers are other tables) | CONFIRMED |

### 5.4 Role changes without explicit authorization (P3)
`inviteUser` mutates the role of an existing membership (:93-96) with **no role whitelist, no step-up, no capability and no grant-governance check**, and leaves the status as it is. An active membership becomes an active `SUPER_ADMIN`.

This is only reachable by an active platform SA, so it is not escalation by a lesser user. It is a bypass of the Closure-014 identity-governance controls (`identity.admin.assign` with step-up and `validateCapabilityGrant`).

### 5.5 Invited administrators acting before acceptance
- Documented legacy policy: `userContextService.ts:142-145`; `SEC91_A.md:118`.
- Pinned as **allowed** by:
  - `sec91W2GInvitedAdminOrgStatus.test.ts`;
  - `sec91ACampaignAccess.test.ts`;
  - `sec91W2GContentWriteRbac.test.ts`;
  - `resolveCompanyAccess.test.ts`.
- **Company operational-state check:**
  - present on `enforceCompanyAccess` (`userContextService.ts:315`) and `requireCampaignAccess` (`campaignAccessService.ts:201-210`);
  - **absent** on `withRBAC`/`enforceRole`, direct `getUserRole` callers, `resolveCompanyAccess`, `requireExternalApiAccess` and `ensureCompanyAccess` [015A §4.2; `companyOperationalState` is called only from those two services].

### 5.6 Policy options (owner decision; compatibility vs security separated)

| Option | Security effect | Compatibility effect |
|---|---|---|
| B-0 Keep the fallback, but **exclude `SUPER_ADMIN`** from it (company-scoped invited SA never grants a role) | closes P1's precondition everywhere | the invited-SA state has no legitimate product use (SEC91_A says it is unreachable by design) and nothing pins it as allowed. Low risk. |
| B-1 B-0 **plus** an expiry check: honour the invited fallback only while a matching unexpired, unrevoked `invitations` row exists | closes indefinite pre-acceptance authority | needs a join to `invitations`; membership rows created without an invitation (super-admin "Create User", Phase 2.A pre-create) would lose fallback access. Product confirmation needed. |
| B-2 B-1 **plus** a company-state check on every invited-admin path | parity with SEC91-W2G | small; adds a company read on more paths |
| B-3 Remove the invited-admin fallback entirely | strongest | breaks the documented pre-acceptance flows and 4 test suites pinned as allowed. A product decision. |
| Reinvite fix (any option) | do not preserve `SUPER_ADMIN` (map to a whitelisted role or refuse); refuse when the target holds an active platform-SA row; write the intended role on the invitation | also fixes the P7 demotion |
| `inviteUser` fix | role whitelist; route platform-role changes through the Closure-014 identity-assign path | super-admin user-management UI must use the governed path |

## 6. Recommendation-audit isolation (Workstream C)

| Item | Evidence | Status |
|---|---|---|
| Reads | `audit/[id].ts:18` → `getAuditByRecommendationId` (`recommendationAuditService.ts:47-57`, `.eq('recommendation_id', id)`); `audit/campaign/[id].ts:18` → `getAuditByCampaignId` (:59-68, `.eq('campaign_id', id)`). **ID-only; no company predicate; `select('*')`.** | CONFIRMED |
| Tenant-owned fields for scoping | `company_id text` (nullable) on `recommendation_audit_logs` (`baseline.sql:21496-21510`); RLS = `service_role_full_access` only | CONFIRMED |
| Authorized company available to the handler | `req.rbac.companyId` (`withRBAC.ts:73-74`), unused | CONFIRMED |
| Platform vs company access | no code or document defines it | owner decision |
| **Writer vs schema** | the writer `logRecommendationAudit` inserts 15 columns incl. **`policy_id`, `policy_weights_used`** (:22-37). The baseline, all migrations and the cert catalog define 13 columns **without** them. | CONFIRMED (code + catalog metadata) |
| Writer failure handling | error only `console.warn`'d (:39-44); the caller (`recommendationEngine.ts:391`) continues | CONFIRMED: safe for the caller, but silent |
| Is audit data produced? | if the target schema matches the baseline, **every insert fails**, so no rows | INCONCLUSIVE (production schema) / BLOCKED (rows) |
| Writer content | `campaign_id: null`; `recommendation_id` unset (null), unchanged since `1d73f682`, so **repository-produced rows can never match either read** | CONFIRMED |

**Net:** the reads are a latent cross-tenant defect. The audit feature itself appears non-functional end to end (the writer fails or writes unmatched rows; the pages send no `companyId` → 400 [015 F-5]).

## 7. Destructive operations (Workstream D)

| Aspect | `POST /api/admin/delete-content` | `POST /api/admin/delete-activity` | `DELETE /api/campaigns?type=content-plan` |
|---|---|---|---|
| Authentication | `getSupabaseUserFromRequest` (:12-15) | same | yes (row-keyed ops authenticate first, :210-220) |
| Role / capability | `rbacService.isSuperAdmin` (:17-20); **no `requireCapability`** | same | **none** (`requireCampaignAccess` only, :243) |
| Active membership | yes (active SA) | yes | active, or invited admin (`campaignAccessService.ts:167-190`) |
| Tenant scope | **none** (`contentId` from body; `content_items` has no company column [A]) | **none** (`activityId` from body) | **yes** (server-resolved row → campaign → access) |
| Step-up | **no** | **no** | no |
| Rate limit / idempotency | **none / none** | **none / none** | **none / none** |
| Audit order | `super_admin_audit_logs` insert **before** the delete; failure only logged (:46-63) | same | none |
| Audit attributes | `ipAddress`, `userAgent` **from `req.body`** (:23, :56-57); the UI sends literal `'127.0.0.1'` | same | — |
| Result vs status | hard delete; no affected-row check | `deleteActivity` returns `{deleted}` (`executionPlannerPersistence.ts:46-60`), **ignored**, so 200 "deleted successfully" when nothing matched (:66-82) | `deleteActivity(existingRowId)` (:261-268) |
| Related records | none referencing `content_items` [A] | FKs `ai_enhancement_logs.day_id`, `platform_content_slots.daily_plan_id` with **no ON DELETE** (`baseline.sql:48000, 52430`), so the delete fails → 500 **after** the audit row; the linked `scheduled_posts` row and its queue job are **not** touched, so the post stays due to publish | same `deleteActivity` |
| Transaction / recovery | none (separate statements; no RPC) | none | none |
| Tests | **none** | **none** | binding only (`routeAuth001CampaignBinding2.test.ts:461-498` [A]); no role test |

**Safeguards to recommend** (mechanism and capability are owner decisions):
- a platform-tier write capability with step-up, the central platform-write guard, rate limit and idempotency;
- server-derived IP/UA (`getTrustedClientIpOrNull`, already used by `platformWriteAuthority.ts`);
- an outcome-bound audit (write after success, or a pre-/post- pair);
- 404 when nothing was deleted;
- handle the NO ACTION foreign keys before the audit write;
- for the content-plan delete: a role check, and apply the content-plan marker to DELETE/PUT.

## 8. Database-free regression-test matrix (Workstream E)

**Harness.** Use the existing **routeAuthHarness** fake (`backend/tests/helpers/routeAuthHarness.ts`): real route, real `withRBAC`/`enforceRole`/`getUserRole` over in-memory `user_company_roles`, with compare-and-set predicates evaluated. This is the pattern used by `sec91ASuperAdminStatus.test.ts`. Service boundaries with side effects are spied.

No database, network or credentials are needed. "Integration DB" marks cases that need real Postgres semantics.

| # | Case | Expected (proposed invariant) | Kind |
|---|---|---|---|
| T1 | active platform SA → unlock / restore / rebuild / refresh / health | allowed (writes: step-up required once the invariant lands) | unit (harness) |
| T2 | **invited** SUPER_ADMIN row in X, `companyId=X` → each of the 5 routes | **403**, handler/service never called (today: allowed, so the test fails before the fix) | unit |
| T3 | inactive / expired / NULL SUPER_ADMIN row → each route | 403 (today already 403; regression guard) | unit |
| T4 | active COMPANY_ADMIN of X → each route | 403 | unit |
| T5 | restore-snapshot: authorized for X, `snapshotId` whose snapshot `company_id=Y` | 403/404 before any restore write | unit (snapshot service fake) |
| T6 | rebuild-projection: authorized for X, `campaignId` of company Y | 403/404 | unit |
| T7 | reinvite by an active COMPANY_ADMIN of a target with an inactive SUPER_ADMIN row | never produces `role='SUPER_ADMIN', status='invited'` (policy: refuse or map) | unit |
| T8 | reinvite targeting an active platform SA | refused; the active row is untouched | unit |
| T9 | reinvite of a COMPANY_ADMIN, then acceptance (`team/accept-invite`) | role after acceptance equals the intended role (today: `CONTENT_CREATOR`; P7) | unit |
| T10 | invited admin whose invitation is expired or revoked → an invited-fallback route | per policy B-1: 403 | unit (fake `invitations`) |
| T11 | `/api/users/invite` changing an active member to `SUPER_ADMIN` | refused or routed through the identity-assign path | unit |
| T12 | audit `[id]` / `campaign/[id]` authorized for X, row `company_id=Y` | 404, no row data | unit (audit service fake) |
| T13 | audit writer emits only defined columns | insert payload ⊆ schema columns (contract test against baseline + migrations, like the Closure-014C Finding F test) | unit (static contract) |
| T14 | audit writer failure | caller continues; failure observable (metric/log) | unit |
| T15 | delete-content/delete-activity without step-up | 401 `STEP_UP_REQUIRED`, nothing deleted, no audit row | unit |
| T16 | non-SA / invited SA / company admin → delete routes | 403, nothing deleted | unit |
| T17 | delete-activity on a non-existent id | 404 (today 200) | unit |
| T18 | audit insert failure before delete | per decision: delete refused (5xx) or outcome audited after | unit |
| T19 | client-supplied `ipAddress`/`userAgent` | ignored; server-derived values recorded | unit |
| T20 | delete-activity of a scheduled activity | per owner decision: linked `scheduled_posts` cancelled + live queue job retired, or delete refused | unit (queue spies) |
| T21 | content-plan DELETE by VIEW_ONLY / CONTENT_CREATOR member | 403 per role decision; COMPANY_ADMIN allowed | unit |
| T22 | content-plan DELETE of a non-marker row | refused | unit |
| T23 | FK NO ACTION violation (23503) on delete-activity | honest 409/5xx, no false success, audit consistent | **integration DB** (real FK semantics) |
| T24 | real PostgREST/RLS behaviour of T2, T5, T12 | as unit | **integration DB** (synthetic rows: separately authorized) |

## 9. Owner decisions required before implementation

1. **Mechanism for the five global routes:** reuse an existing platform-tier capability (e.g. `platform.controls.manage` for writes, `super_admin.dashboard.view` for health) or a new one, or a direct `isPlatformSuperAdmin` check. Plus step-up for the writes.
2. **Company-scoped restore and rebuild:** allow with company binding, or platform-only.
3. **Invited-admin policy:** B-0 / B-1 / B-2 / B-3 (§5.6).
4. **Re-invite of privileged roles:** refuse, or map to which role; may a former SA be re-invited at all; may a company admin re-invite an active platform SA's row.
5. **`inviteUser` role changes:** whitelist and governed path.
6. **Recommendation audit:** platform visibility, company binding, and whether to repair the writer (`policy_*` columns need a migration, or drop them from the writer; populate the ids).
7. **Delete routes:** capability name, step-up, audit semantics, and **whether deleting an activity cancels its scheduled post or is refused while scheduled**.
8. **Content-plan delete:** role threshold; enforce the marker on DELETE/PUT.

## 10. Proposed remediation sequence (minimal shared-helper change)

1. **Per-route guards on the five global routes** (T1–T6). No `withRBAC` change, so no 81-route blast radius.
2. **Reinvite and `inviteUser` hardening** (T7–T9, T11), plus extend `superadminMembershipValidity001.test.ts` to every membership writer. This removes the only identified creator of invited-SA rows.
3. **B-0 in `getUserRole`** (exclude `SUPER_ADMIN` from the invited fallback). This one shared-helper change is narrow, because nothing pins invited SA as allowed; verify against the 4 invited-admin suites, which only use COMPANY_ADMIN.
4. **Delete routes** (T15–T22) behind the Closure-014 controls, after decision 7.
5. **Audit reads and writer** (T12–T14) after decision 6.
6. **B-1/B-2** (expiry and company-state parity) after decision 3.
7. Lower priority: Closure-015 F-1, F-5, F-7, F-8.

## 11. Verification limits and blocked checks

| Check | Status |
|---|---|
| Static tracing of the routes and services above | done (CONFIRMED items) |
| Runtime confirmation of T2, T5, T7, T12 against real Postgres/PostgREST | **BLOCKED**: needs synthetic rows (not authorized in this phase) |
| Production prevalence: invited/inactive SUPER_ADMIN rows; active accounts with invited admin memberships; expired-invitation memberships; audit rows with ids; whether production has the `policy_*` columns; snapshot ownership | **BLOCKED**: production-only, authorized operator |
| Whether `GovernanceSnapshotService` restore writes are confined to the snapshot's company (it is cross-tenant only from the caller's perspective) | CONFIRMED: company from the snapshot row; downstream write scope not exhaustively traced (INCONCLUSIVE beyond that) |
| Sub-agent inventory items marked [A] in 015A that are not re-read here | INCONCLUSIVE until re-verified in the implementation phase |
| Tests run | **none** (design only) |

**Statement:** no source or test change, no staging or commit, no database row access or write, no migration, no production access, no app/worker start, no remote operation. Existing reports and manifests are unmodified.
