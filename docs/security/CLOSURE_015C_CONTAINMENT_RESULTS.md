# Closure-015C — Containment Results

Status: **LOCAL, UNSTAGED, UNCOMMITTED.** Nothing was read from or written to any database, and no production system was touched. Nothing was pushed, no PR was opened and nothing was deployed. No migration or schema change was made. `withRBAC`, `enforceRole` and `getUserRole` were not changed.

Inputs: Closure-015 (`CLOSURE_015_SUPER_ADMIN_STATUS_AUDIT.md`), Closure-015A (`CLOSURE_015A_AUTHORIZATION_IMPACT_ASSESSMENT.md`) and Closure-015B (`CLOSURE_015B_CONTAINMENT_AND_TEST_PLAN_REVIEW.md`).

---

## 1. Baseline

| Item | Value |
|---|---|
| Worktree | `C:/tmp/closure-014a` |
| HEAD | `03724e86969cd9d022fd191e142e914e04963b8a` (014C remediation plus the 014D placeholder fix; parent `77760314`) |
| Staged changes at start / at end | 0 / 0 |
| Branch operations | none (no reset, stash, clean, rebase, amend or switch) |

## 2. Changed files

**Modified (8 files; +50 / −1 lines):**

| File | Change |
|---|---|
| `pages/api/governance/unlock.ts` | Calls the guard `governance.unlock` before `releaseGovernanceLock` |
| `pages/api/governance/restore-snapshot.ts` | Calls the guard `governance.restore_snapshot` before `restoreGovernanceSnapshot` |
| `pages/api/governance/rebuild-projection.ts` | Calls the guard `governance.rebuild_projection` before `rebuildGovernanceProjection` |
| `pages/api/opportunities/refresh-slots.ts` | `withRBAC` now wraps `runRefreshAsPlatformSuperAdmin` (guard `opportunities.refresh_slots`, then `runRefresh`). The cron-secret branch is unchanged. |
| `pages/api/omnivyra/health.ts` | Calls the guard `omnivyra.health` before `getOmnivyraHealthReport` |
| `backend/services/userManagementService.ts` | `inviteUser` refuses `SUPER_ADMIN` as a requested role, and refuses to rewrite an existing `SUPER_ADMIN` membership (§6) |
| `backend/tests/integration/governance_lockdown.test.ts` | Stubs the new guard. These are functional suites with authorization already mocked; the real decision is tested in §4.1. |
| `backend/tests/integration/governance_snapshot.test.ts` | Same stub, same reason |

**New (4 files):**

| File | Purpose |
|---|---|
| `backend/security/requireActivePlatformSuperAdmin.ts` | Route-local guard that re-applies `rbacService.isPlatformSuperAdmin(req.rbac.userId)` |
| `backend/tests/unit/closure015cGlobalRouteContainment.test.ts` | T1–T6 for the five routes, plus cron-path regression (31 tests) |
| `backend/tests/unit/closure015cInviteRoleGovernance.test.ts` | T7–T11 (22 tests) |
| `backend/tests/unit/closure015cAuditAndDeleteRegression.test.ts` | T12, T13, T17 (8 tests) |

Plus this report.

## 3. Rename of the ignored 015B report

The old name matched `.gitignore:57` (`*_PLAN.md`).

| | Path | sha256 |
|---|---|---|
| Before | `docs/security/CLOSURE_015B_CONTAINMENT_AND_TEST_PLAN.md` | `e4a155fdeef61342efc9eff464b1b97becec9f69b824aeeb1d7ad95c8693f342` |
| After | `docs/security/CLOSURE_015B_CONTAINMENT_AND_TEST_PLAN_REVIEW.md` | `e4a155fdeef61342efc9eff464b1b97becec9f69b824aeeb1d7ad95c8693f342` (identical) |

- The old path no longer exists.
- `git check-ignore` reports nothing for the new path or for this report (exit 1).
- Earlier reports are unchanged: 015 is `b8eb1988740b9c9b01935c856e430049b9411a0729ce80ee01b35b9f861294f2` and 015A is `7c9964440d9783d3298737f24f88f4c6736aa799ef31a5f93d4cf9e49a98fe78`.
- No historical report or evidence manifest was edited.

## 4. Tests

### What the tests are and are not

- **Real code:** the routes, `withRBAC`, `enforceRole`, `getUserRole`, `isPlatformSuperAdmin`/`hasActiveSuperAdminRow`, `isSuperAdmin`, `inviteUser`/`requireUserAdminAccess`, the reinvite route's own authorization and writes, the audit service, and the persistence `deleteActivity`. All of it runs over the `routeAuthHarness` in-memory tables.
- **Mocked:** authentication (`sec91AHarness` tokens), the company-context guard, email, the audit logger, and each global route's effect service (as spies).
- **Limits:** these tests prove each route's authorization decision in code. They do **not** prove Postgres/PostgREST behaviour, column defaults, RLS, or runtime containment in a deployed process. The application and worker were not started.
- **Known defects:** each is pinned with `test.failing`. Such a test states the correct behaviour, passes while the defect exists, and must be converted to a plain test once the fix lands.

### 4.1 `closure015cGlobalRouteContainment` — the five global routes

Each of the five routes was tested with these cases (`describe.each`):

| ID | Principal | Expected | Before fix | After fix |
|---|---|---|---|---|
| T1 | Active platform super admin | 200; the effect runs exactly once | pass | pass |
| T2 | Invited `SUPER_ADMIN` membership in the requested company | 403 `PLATFORM_SUPER_ADMIN_REQUIRED`; the effect never runs | **FAIL (5/5 routes: 200, effect ran)** | pass |
| T3 | Inactive (deactivated) `SUPER_ADMIN` row | 403; the effect never runs | pass | pass |
| T4 | Active COMPANY_ADMIN | 403; the effect never runs | pass | pass |
| — | Unauthenticated | 401; the effect never runs | pass | pass |

Further cases:

| ID | Case | Before | After |
|---|---|---|---|
| T5 | restore-snapshot: an invited SA of A sends B's snapshot ID with `companyId=A` → 403 before the service runs | **FAIL** | pass |
| T6 | rebuild-projection: an invited SA of A sends B's campaign ID with `companyId=A` → 403 before the service runs | **FAIL** | pass |
| — | An active platform SA keeps platform-wide authority (restores B's snapshot while naming A) | pass | pass |
| — | refresh-slots: a valid `CRON_SECRET` runs the scheduler with no membership (cron path unchanged) | pass | pass |
| — | refresh-slots: a wrong secret falls through to `withRBAC`; the invited SA gets 403 | **FAIL** | pass |
| — | Harness fidelity: the real `isPlatformSuperAdmin` and `getUserRole` give the expected results over the fake rows | pass | pass |

**Totals:** before the fix, 8 failed and 23 passed (31). After the fix, 31/31 pass.

### 4.2 `closure015cInviteRoleGovernance` — membership-writer role governance

**Part 1: `inviteUser` (`/api/users/invite`). FIXED.**

| ID | Case | Before | After |
|---|---|---|---|
| T11 | Requested role `SUPER_ADMIN` / `super_admin` / `Super_Admin` → 403 `SUPER_ADMIN_NOT_ASSIGNABLE_HERE`; no user is created | **FAIL ×3** | pass |
| T11 | An active VIEW_ONLY member cannot be made `SUPER_ADMIN` (the P3 in-place update) | **FAIL** | pass |
| — | An existing `SUPER_ADMIN` membership cannot be rewritten → 403 `SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE` | **FAIL** | pass |
| — | Legacy and current roles are still invitable: CONTENT_MANAGER, CONTENT_PLANNER, CONTENT_CREATOR, CONTENT_ENGAGER, ADMIN, COMPANY_ADMIN, VIEW_ONLY (×7) | pass | pass |
| — | An existing non-SA member's role can still be changed | pass | pass |
| — | Active COMPANY_ADMIN requester → 403; invited-SA requester → 403 (authorization unchanged) | pass | pass |

**Part 2: reinvite and acceptance. NOT remediated (owner decision 4).**

| ID | Case | Status |
|---|---|---|
| — | Fidelity: an active COMPANY_ADMIN of the company is authorized to reinvite (real `isActorAuthorized`) | pass |
| T7 | A company admin's reinvite never yields an invited `SUPER_ADMIN` membership (deactivated former SA) | `test.failing`: **defect present** |
| T8 | Reinvite never removes an active platform SA's membership | `test.failing`: **defect present** |
| T9 (P7) | The reinvite invitation carries the role the membership keeps | `test.failing`: **defect present.** The insert omits `role`, so the DB default `CONTENT_CREATOR` applies at acceptance. The DB default is static evidence; the fake DB does not apply defaults. |
| T10 | Characterization only: an invited COMPANY_ADMIN membership grants its role with no invitation row | pass (documents the gap; B-1 is pending) |
| — | Cross-company reinvite → 403 | pass |
| — | Fixture sanity | pass |

**Totals:** before the fix, 5 failed and 17 passed (22). After the fix, 22/22 pass (including the 3 `test.failing` pins).

### 4.3 `closure015cAuditAndDeleteRegression` — pins only (remediation not authorized)

| ID | Case | Status |
|---|---|---|
| T12 | An invited (company-scoped) SA of A never reads B's recommendation-audit row by recommendation ID | `test.failing`: **defect present** |
| T12 | … nor by campaign ID | `test.failing`: **defect present** |
| — | Fidelity: an active COMPANY_ADMIN gets 403 | pass |
| T13 | Every column the writer inserts is defined in the schema, except exactly `policy_id` and `policy_weights_used` | pass. The test fails if that gap grows or is closed. |
| — | A writer failure is only logged and never reaches the caller (current contract) | pass |
| T17 | A missing activity ID → 404 (pre-read existence check) | pass |
| T17 | Row removed between the pre-read and the delete → must not answer 200 "deleted successfully" | `test.failing`: **defect present** |
| — | An invited SA gets 403 on delete-activity (unchanged) | pass |

**Total:** 8/8 pass.

> **Correction to 015A/015B (recorded here; those reports are not edited).** Both described T17 as "false 200 when nothing matched." That overstates the defect. `pages/api/admin/delete-activity.ts:30-42` pre-reads the row and returns **404** when the ID does not exist. The false 200 happens only when the row disappears **between** the pre-read and the delete (a concurrent delete), because the route ignores `{ deleted: false }` (`:66-82`). The defect is real but narrower: it needs a race.

### 4.4 Tests not added

| ID | Reason |
|---|---|
| T15, T16 | Step-up or capability on the delete routes needs a capability choice (owner decision 7) |
| T18 | Audit-failure semantics (fail-open vs fail-closed) are owner decision 7 |
| T19 | Server-derived IP for audit: remediation not authorized in this phase (owner decision 8) |
| T20 | Deleting an activity that has a scheduled post: deletion-route remediation not authorized (owner decision 7) |
| T21 | Content-plan role threshold: no established policy (owner decision 8) |
| T22 | Marker test: depends on the T21 decision |
| T10 (as a policy test) | B-1 (invited-admin authority) is pending. Only the characterization was added. |
| T23, T24 | Need a real database; not allowed in this phase |

### 4.5 Mutation check

Each mutant was applied in a temporary copy and reverted; `cmp` verified the files were restored.

| Mutant | Result |
|---|---|
| M1: guard always allows | KILLED (8 failed) |
| M2: restore-snapshot guard removed | KILLED (2 failed) |
| M3: refresh-slots wrapper bypassed | KILLED (2 failed) |
| M4: `inviteUser` requested-role check removed | KILLED (4 failed) |
| M5: `inviteUser` existing-row check removed | KILLED (1 failed) |

**Result: 5/5 killed.**

## 5. Route-by-route status

The guard re-checks active, exact `SUPER_ADMIN` through `isPlatformSuperAdmin`, and fails closed if the lookup errors.

| Route | Effect | P1 invited-SA path | Full 015B invariant (incl. step-up) | Status |
|---|---|---|---|---|
| `POST /api/governance/unlock` | Releases the one platform-global `governance_lockdown` row | **Closed** | Step-up not added | **PARTIAL**: authorization FIXED; step-up BLOCKED (decision 1) |
| `POST /api/governance/restore-snapshot` | Restores the snapshot's own company, whatever company the request names | **Closed** (T5) | Step-up not added | **PARTIAL**: as above |
| `POST /api/governance/rebuild-projection` | Rebuilds the campaign's own company | **Closed** (T6) | Step-up not added | **PARTIAL**: as above |
| `POST /api/opportunities/refresh-slots` | Runs the scheduler for every active company | **Closed** on the `withRBAC` path; cron-secret path unchanged | Step-up not added | **PARTIAL**: as above |
| `GET /api/omnivyra/health` | In-process platform health report | **Closed** | Read-only; step-up likely not needed (decision 1) | **PARTIAL**: as above |

**Guard evidence:**
- Each route's `withRBAC([SUPER_ADMIN])` admits exactly two principals: the active platform-SA bypass (`rbacService.ts:282-341`, `hasActiveSuperAdminRow` at `:266-276`) and an invited `SUPER_ADMIN` membership via `getUserRole`'s fallback (`:197-211`).
- The guard keeps only the first, so no legitimate caller loses access (T1 and the B-authority test).
- The guard runs **after** `withRBAC` and **before** each effect, and the tests prove the effect never runs on refusal.
- `withRBAC`, `enforceRole` and `getUserRole` are byte-unchanged (`git diff` touches none of them).
- No capability was invented. `PLATFORM_CONTROLS_MANAGE` and similar capabilities exist, but mapping these routes onto them is decision 1.
- **Runtime containment is NOT claimed.** The evidence is unit/harness level only.

## 6. `/api/users/invite` outcome

**FIXED for the established policy. PARTIAL against the full 015B invariant.**

- **Established policy applied:** a `SUPER_ADMIN` membership is granted only through `identity.admin.assign` (`pages/api/admin/invite-user.ts`, which requires step-up) and revoked only through `identity.admin.revoke` (`pages/api/admin/revoke-super-admin.ts`).
- `inviteUser` now refuses both (§2). The role check runs **before** `getOrCreateUserByEmail`, so a refused call creates no user row.
- **Not changed (decision 2):** a full role whitelist. The governed `VALID_ROLES` is COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER and VIEW_ONLY. But `pages/admin/users.tsx` sends legacy roles (CONTENT_MANAGER, CONTENT_PLANNER, CONTENT_ENGAGER, ADMIN), so applying that whitelist would break the page. Which vocabulary is authoritative is an owner decision.
- **Not changed:** step-up on `/api/users/invite`. That needs a capability or step-up choice (decision 2).

## 7. Gates

| Gate | Result |
|---|---|
| Focused suites (closure015c ×3, governance_*, sec91A/C, related authz suites) | 16 suites: 15 passed, 1 failed (295 tests: 294 passed, 1 failed). The failure is `governance_performance_guard` › "second call skips when first is still running" (`runGovernanceAudit` was called 2 times, expected 1). It is **pre-existing**: listed in both the 014A and 014C whole-repo failing sets, and the suite imports only services and `replay-event`, none of which this phase changes. |
| Combined gate suite set (014D gate list ∪ focused) | 190 suites: 189 passed, 1 failed (4630 tests: 4627 passed, 1 failed, 2 skipped). The only failure is the same pre-existing `governance_performance_guard` test. |
| `node scripts/typecheck-certification.js` | **PASS**. backend 0/0; backend-tests 259/259 (no net-new error identities); 0 uncovered files. |
| `npm run typecheck` | **3/3 projects clean** (exit 0) |
| `node scripts/check-migration-quality.js` | OK: 0 violations (no migration added) |
| `user_lifecycle_management.test.ts` | 3 failures, **pre-existing.** They reproduce identically with HEAD's `userManagementService.ts` (temporary swap, restore verified with `cmp`), and the suite is in both the 014A and 014C whole-repo failing sets. |

## 8. Remaining owner decisions

Numbering follows 015B.

1. **Step-up and capability for the five global routes.** Should they use `PLATFORM_CONTROLS_MANAGE`, a new capability, or step-up only? Does read-only `omnivyra/health` need step-up?
2. **`/api/users/invite` vocabulary and step-up.** Which role vocabulary is authoritative (governed `VALID_ROLES` vs the `/admin/users` legacy roles), and should this route require step-up or be retired in favour of `admin/invite-user`?
3. **B-1: authority of invited COMPANY_ADMIN/SUPER_ADMIN memberships** in `getUserRole`. Should they grant authority before acceptance, and should invitation expiry apply at authorization time? T10 characterizes the gap; `getUserRole` was not changed, by mandate.
4. **Reinvite and acceptance.**
   - Whether reinvite may touch `SUPER_ADMIN` rows at all (T7, T8).
   - Whether the invitation must carry the preserved role (T9). Note: `invitations_role_check` excludes `SUPER_ADMIN`, so acceptance can never yield an active SA.
5. **The intended invited → active SA transition.** No governed path completes it today.
6. **Recommendation audit.**
   - Tenant isolation for company-scoped principals (T12).
   - Whether to fix the writer/schema gap (`policy_id`, `policy_weights_used`) by migration or by changing the writer (T13).
7. **Delete routes.**
   - Capability/step-up (T15, T16).
   - Truthful outcome on a concurrent delete (T17, narrowed above).
   - Audit-failure semantics (T18).
   - Scheduled-post handling (T20).
8. **Content-plan role threshold and server-derived IP** (T19, T21, T22).

## 9. Integration blockers

- **T23/T24** (real-Postgres tests of membership defaults, `invitations_role_check` and the acceptance RPC) need a database. Not allowed in this phase.
- **Production prevalence of invited `SUPER_ADMIN` rows is unknown.** Production was not queried. The exposure window before this fix ships depends on it.
- **Runtime containment is unverified.** The app and worker were not started; startup and network behaviour were not inspected, so safe isolation has not been established.
- **Nothing ships until commit, PR and deploy are authorized.** These changes are local and uncommitted.
