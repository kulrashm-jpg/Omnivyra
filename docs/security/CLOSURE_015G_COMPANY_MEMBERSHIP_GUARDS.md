# Closure-015G — Company Membership Guards for SUPER_ADMIN: Results

**Status: LOCAL, UNSTAGED, UNCOMMITTED.** No database row reads or writes, no schema change, no migration. No production access or queries. No credential or `.env` inspection. No push, PR, merge, deploy, staging or commit. No reset, stash, clean, rebase, amend or branch switch. No app or worker started.

**Evidence type.** Unit/harness level only. The real route and authorization code runs over **in-memory** membership, company, step-up, trusted-device, idempotency and audit rows. Nothing ran against a real database, PostgREST/RLS or a real WebAuthn ceremony. **Not a production-readiness claim.**

| Workstream | Classification |
|---|---|
| A — `/api/company/users` PUT and DELETE never mutate a `SUPER_ADMIN` membership | **FIXED** |
| B — regression tests | **DONE**: 45 tests; 25 fail against the pre-fix code; 10/10 mutants killed |
| C — F-5 (`super-admin/users` DELETE) | **DIAGNOSED** (read-only + temporary probe); not changed, by instruction |

---

## 1. Verified baseline

| Item | Value |
|---|---|
| Root / branch / HEAD | `C:/tmp/closure-014a` / `integration/closure-014a` / `03724e86969cd9d022fd191e142e914e04963b8a`. All as expected, unchanged at end. |
| Staged at start / at end | 0 / 0 |
| Unstaged tracked / untracked at start | 34 / 19 (12 code + 7 reports), exactly the Closure-015F end state. Snapshot `scratchpad/c15g/baseline.diff`, sha256 `1e332989…62ad96`. |
| Earlier reports (byte-identical at end) | 015 `b8eb1988…`, 015A `7c996444…`, 015B_REVIEW `e4a155fd…`, 015C `45de3490…`, 015D `12afbc8d…`, 015E `7321db46…`, 015F `0a106b2c…` |

## 2. Affected handlers and exact changed files

### 2.1 Trace (before 015G)

**Route.** `pages/api/company/users.ts`, wrapped in `withIdempotency` (POST/PUT/DELETE need an `Idempotency-Key`). Every method first runs `requireCompanyContext` → `enforceCompanyAccess`: tenant membership plus an operational company.

**PUT** `{ companyId, userId, role, status? }`:
1. `ensureCompanyAdminAccess` admits an active platform SA (`isSuperAdmin`) or a member whose role holds `CREATE_USER`.
2. `hasPermission(role, 'ASSIGN_ROLE')`: in the default RBAC config, `ASSIGN_ROLE` = SUPER_ADMIN, COMPANY_ADMIN (`rbacService.ts:47`). The config can be overridden from `rbac_config`.
3. The requested role must be one of COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER or VIEW_ONLY. `SUPER_ADMIN` was never requestable.
4. The admin-transfer rule (one active COMPANY_ADMIN unless the caller is SA).
5. Then an **unconditional** `update({ role, updated_at, status?, deactivated_at? | accepted_at? })` keyed only by `(user_id, company_id)`.

Mutations PUT could perform:
- rewrite the role;
- set **any** `status` string, including deactivating (`inactive` / `deactivated`) and **re-activating** (`active`);
- stamp `deactivated_at` / `accepted_at`.

The target row was **never read first**, so a `SUPER_ADMIN` row in any status was demoted, deactivated or re-activated. A missing membership answered 200.

**DELETE** `{ companyId, userId }`: the same access and `ASSIGN_ROLE` checks, then an **unconditional** delete of `(user_id, company_id)`. A `SUPER_ADMIN` row was deleted, and a missing membership answered 200.

**Who could exploit it.** Any active COMPANY_ADMIN of a company holding another user's `SUPER_ADMIN` row. `assignSuperAdmin(userId, organizationId)` places the row in a chosen company. Demoting, deactivating or deleting it revokes platform authority if it is that user's only active SA row. The active platform SA could do the same with no step-up.

**Shared services invoked:** `requireCompanyContext`, `enforceCompanyAccess`, `ensureCompanyAccess`, `ensureCompanyAdminAccess`, `hasPermission`/`getRbacConfig`, `insertAuditLog` (which throws if the audit write fails), `withIdempotency`. `upsertUserCompanyRole` is used only by POST, which is unchanged.

### 2.2 Changed files (015G)

| File | Change |
|---|---|
| `backend/apiHandlers/company/usersShared.ts` | New `readTargetMembership(userId, companyId)`. It reads `(id, role, status)`, snapshots it at read time, and returns `privileged = normalizeRole(role) === SUPER_ADMIN`. Missing → 404 `MEMBERSHIP_NOT_FOUND`; read error → 503 `MEMBERSHIP_LOOKUP_FAILED`. Plus a `normalizeRole` import. |
| `pages/api/company/users.ts` | PUT and DELETE: after the existing permission checks, read the target; refuse privileged rows (audited); make the write conditional on the snapshot; 409 on no match. |
| `backend/tests/unit/closure015gCompanyMembershipGuards.test.ts` (untracked, new) | 45 tests |
| `docs/security/CLOSURE_015G_COMPANY_MEMBERSHIP_GUARDS.md` (new) | This report |

Diff versus HEAD: 36 tracked files, +598 / −146 (34 / +516 / −139 at the 015F baseline). No other file changed. `withRBAC`, `getUserRole`, the company-admin role PATCH and `/api/users/invite` are untouched.

## 3. Authorization invariants implemented

| # | Invariant |
|---|---|
| I-1 | **`/api/company/users` PUT and DELETE never change or remove a `SUPER_ADMIN` membership.** This holds in every stored status (active, invited, inactive, expired) and for legacy spellings such as `super_admin`, via `normalizeRole`. It applies to **every** caller, including an active platform SA: the route is company-scoped, and a privileged row being stored in a company does not let that company manage platform authority. Responses: PUT `403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE`, DELETE `403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE`. Each refusal writes an audit row `PRIVILEGED_MEMBERSHIP_MUTATION_DENIED` (actor, target, company, operation). |
| I-2 | Platform-authority changes stay on the governed paths: `identity.admin.assign` (grant) and `identity.admin.revoke` (`admin/revoke-super-admin`, downgrade), both with passkey step-up on a trusted device. Tested: a company admin gets 403; an SA without step-up gets `STEP_UP_REQUIRED`; an SA with step-up gets 200 and the row is downgraded. |
| I-3 | **The target is read before any write**, and the write acts only on that row. PUT is a compare-and-set on `id + role + status` (`status IS NULL` handled). DELETE is conditional on `id + role`. A concurrent promotion to `SUPER_ADMIN` or a concurrent status change matches nothing, giving **409 `STALE_MEMBERSHIP`**, never an overwrite or a delete of a newly privileged row. |
| I-4 | **Truthful responses.** Missing membership → 404 (was a false 200). Target-read failure → 503 (fail closed, nothing written). Write failure → 500, unchanged, no success audit. A user who exists only in another company gets the same 404 as a nonexistent one, so nothing about the other tenant is disclosed. |
| I-5 | **No partial change.** Every refusal (permission, missing, privileged, read failure) happens before the single write statement, and each operation is exactly one row-scoped write. The only side effect of a privileged refusal is its audit row. If that audit write fails, `insertAuditLog` throws and **no membership write happens**. |
| I-6 | **Legitimate operations preserved.** Company-admin role changes and deactivation of ordinary members, the admin-transfer rule (409 `ADMIN_TRANSFER_REQUIRED`), the requestable-role list, platform-SA edits of ordinary members, the existing `PERMISSION_DENIED` auditing, and tenant isolation through `requireCompanyContext`. POST (invite) is unchanged. |

## 4. Regression tests and outcomes

`closure015gCompanyMembershipGuards`: **45 tests, all pass** (in-memory, real chain).

**Pre-fix evidence.** The same suite was run against the HEAD versions of the two changed files, swapped in temporarily, then restored and sha256-verified: **25 of 43 then-existing tests fail**. This reproduces the exploit: a company admin demotes, deactivates, re-activates and deletes `SUPER_ADMIN` rows in every status; missing targets answer 200; concurrent changes are overwritten. Log: `scratchpad/c15g/before.log`.

| Area | Cases (all ✓) |
|---|---|
| PUT on a SUPER_ADMIN row (active / invited / inactive / expired / legacy lower-case) | Company admin demotes → 403, row unchanged, **no membership write**, audited. Company admin deactivates → 403. Re-activating an inactive SA → 403, stays inactive. Active platform SA → also 403 on this route. |
| PUT on ordinary members | Role change → 200 (other company untouched; `UPDATE_USER_ROLE` audit). Deactivation → 200 (`deactivated_at` set; `DEACTIVATE_USER` audit). Promotion with an existing admin → 409 `ADMIN_TRANSFER_REQUIRED`. Platform SA edit → 200. Requesting `SUPER_ADMIN` → 400. |
| PUT authorization / missing | VIEW_ONLY → 403 `PERMISSION_DENIED`. Cross-company (admin of A naming B) → 403, B unchanged. A B-only user "in A" → 404 with no B data. Missing → 404. Unauthenticated → 401. Lookup failure → never 200, no write. |
| Target-read failure (guards pass; only the target read fails) | PUT and DELETE → 503 `MEMBERSHIP_LOOKUP_FAILED`, no write |
| PUT concurrency | Promoted to SA between read and write → **409, promotion kept**. Deactivated concurrently → 409, the concurrent change stands. Write failure → 500, unchanged. |
| DELETE on a SUPER_ADMIN row (5 states) | Company admin → 403 `…NOT_REMOVABLE_HERE`, preserved, no write, audited. Platform SA → 403. |
| DELETE on ordinary members / isolation | Ordinary member → 200; **only** the CO_A membership is deleted (the user's CO_B membership, the SA row and other members are intact). Cross-company → 403. B-only user "in A" → 404, no B data. Missing → 404. VIEW_ONLY → 403. Promoted to SA between read and delete → **409, not deleted**. Delete failure → 500, intact, no `REMOVE_USER` audit. Lookup failure → never 200. |
| Governed path still required | `admin/revoke-super-admin`: company admin → 403; SA without step-up → `STEP_UP_REQUIRED`; SA with passkey on a trusted device → 200, SA row downgraded, `elevated_route_accessed (identity.admin.revoke)` |

### Mutation testing (`scratchpad/c15g/mutants.js`)

Hardened runner: baseline **14/14 suites, 765/765 tests**; a kill counts only on a failing test; files restored and sha256-verified.

**Result: 10/10 killed**: G1 PUT guard, G2 DELETE guard, G3 un-normalized role match, G4/G5 PUT compare-and-set role/status filter, G6 PUT empty-result check, G7 DELETE role filter, G8 DELETE empty-result check, G9 missing → proceed (old false-200), G10 read error → proceed.

G10 **survived** the first run (`mutants.log`): `failTable` fails every membership read, so the access guards refused first and the target-read error branch was never reached. Two targeted tests (fail only the route's `select('id, role, status')`) were added, and the re-run (`mutants2.log`) kills it.

## 5. Race-condition analysis

| Window | Protection | Residual |
|---|---|---|
| Promotion to `SUPER_ADMIN` between the route's read and its write | PUT: `role` in the compare-and-set predicate; DELETE: `role` in the delete predicate → 0 rows → 409. Tested both ways, and both mutants are killed. | None in-memory. In Postgres a single `UPDATE … WHERE id=… AND role=… AND status=…` / `DELETE … WHERE id=… AND role=…` is atomic per row under READ COMMITTED: the predicate is re-checked on the latest row version. **Not verified against a real database (I-1 limitation).** |
| Status change between read and write | PUT: `status` in the predicate (`IS NULL` handled) → 409; tested. DELETE: deliberately not status-conditional, since deleting a concurrently deactivated ordinary membership is still a removal of a non-privileged row. | Owner may prefer status-conditional deletes too (G-3). |
| Row deleted and re-inserted (new `id`) between read and write | Predicate on `id` → 0 rows → 409 | None |
| Two concurrent requests with the same Idempotency-Key | `withIdempotency` (unchanged) | Unchanged behaviour |
| Admin-transfer check vs a concurrent promotion of another member | Unchanged: a read-then-write check, not atomic | Pre-existing; outside 015G (G-4) |
| Harness artifact | The in-memory DB returns **live** row objects. `readTargetMembership` copies `id`/`role`/`status` at read time (the 015F lesson), so the conditional write cannot compare the row with itself. | n/a |

## 6. F-5 diagnosis: `super-admin/users` DELETE (no change made)

### Code path

1. **`pages/api/super-admin/users.ts`.** `withIdempotency(handler, { methods: [POST, PATCH, DELETE], authorize: mayAttemptCapability(usersWriteCapability) })` → `requireAdminRateLimit` → `requireSuperAdminAccess`. That is `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)`, with no org binding (`usersShared.ts:32-42`). Then it dispatches to `handleUsersDelete`.
2. **Capability selection.** `usersWriteCapability` maps DELETE to `IDENTITY_ADMIN_DELETE` and POST/PATCH to `IDENTITY_ADMIN_ASSIGN` (`users.ts:18-23`).
3. **Pre-authorization.** `mayAttemptCapability` (`preAuthorization.ts:24-37`) checks only that the principal holds the capability and, for platform-tier writes, has platform write authority. **There is no org check.**
4. **Handler.** `handleUsersDelete` (`usersMutations.ts:284-…`) calls `requireCapability(IDENTITY_ADMIN_DELETE, { resourceId: userId, organizationId: companyId })`. **The capability is bound to the target company.**
5. **Org-scope check.** `AuthorizationService.ts:153-175`: when `organizationId` is set and the actor is not an active member of it, the request is refused unless `allowsCrossOrganizationIdentityAdministration(principal, capability)` holds. That function (`platformCapabilities.ts:247-254`) is true only for capabilities in `CROSS_ORGANIZATION_IDENTITY_CAPABILITIES`, which contains **only `IDENTITY_ADMIN_ASSIGN`** (`:206-208`). `IDENTITY_ADMIN_DELETE` is therefore refused with **`NOT_ORG_MEMBER`**.
6. **Platform authority and step-up.** Platform-tier `IDENTITY_ADMIN_DELETE` requires platform write authority (`requireCapability` Closure-013 check plus pre-authorization) and its registered step-up (passkey, trusted device, 10 min). Both are independent of the org binding.
7. **What it deletes.**
   - **Route 1, with `companyId`:** an **unconditional** `DELETE user_company_roles WHERE user_id AND company_id`, with no role or status check. A `SUPER_ADMIN` row is deleted. Missing → 404.
   - **Route 2, no `companyId`:** delete the Supabase Auth user, soft-delete `users`, and deactivate **all** of the user's memberships, including SA rows. Here `organizationId` is undefined, so there is no org binding.
8. **Independent target-company restriction.** None besides the binding in step 4: no tenant guard, no company-status check.

### Temporary full-stack probe (unit level, removed; saved as `scratchpad/c15g/probe_f5.test.ts.txt`)

| Request | Result |
|---|---|
| The UI's exact request (`CompanyUsersTab.tsx:461-465`: no `Idempotency-Key`, no step-up flow) | **400 `IDEMPOTENCY_KEY_REQUIRED`**. `withIdempotency` rejects before any authorization, so **every UI "remove from company" / "delete user" fails today**. |
| Stepped-up active platform SA, **not** a member of the target company | **403 `NOT_ORG_MEMBER`**, target untouched. **Incorrectly refused: confirmed.** |
| Same SA, who **is** a member of the target company | 200, target deleted |
| Same SA (member) deleting a **`SUPER_ADMIN`** row in that company | 200, **SA row deleted**. This is behind `IDENTITY_ADMIN_DELETE` and step-up, but inconsistent with the refuse-privileged policy of 015F and 015G (F-2). |

### Minimal proposed fix (not implemented)

1. **`usersMutations.ts` `handleUsersDelete`:** drop `organizationId` from the `IDENTITY_ADMIN_DELETE` gate and record `companyId` in `reason`/`resourceId`. This is the same treatment as 015F's `DELETE /api/users/[userId]`. The documented basis: platform-tier capabilities can omit `organizationId`, and platform write authority and step-up are unchanged.
   - **Alternative (wider):** add `IDENTITY_ADMIN_DELETE` to `CROSS_ORGANIZATION_IDENTITY_CAPABILITIES`. That changes shared policy, so it would need the owner's approval.
2. **Route 1:** read the target first and refuse a `SUPER_ADMIN` row (F-2 policy), then make the delete conditional on `id + role`, as `removeUser` does.
3. **`CompanyUsersTab.tsx` `handleDeleteUser`:** send a fresh `Idempotency-Key` and wrap the call in `runStepUpFlowIfNeeded`, exactly as the neighbouring PATCH does (`:422-427`).

## 7. Gates (exact commands; all in-memory unit tests)

| Gate | Command | Result |
|---|---|---|
| Regression: 341 suites (015F gate set ∪ every suite touching `/api/company/users`, `usersShared`, `revoke-super-admin` ∪ the 015G suite) | `node node_modules/jest/bin/jest.js --runInBand --forceExit --json <341 suites>` | 325 passed / 16 failed suites; 7584 passed / 56 failed / 2 skipped tests; **0 suite-load failures**. The 57 failing test names are **identical to the 015F baseline set**: none new, none lost. |
| Typecheck | `npm run typecheck` | **3/3 projects clean** |
| Certification | `node scripts/typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259 |
| Migration quality | `node scripts/check-migration-quality.js` | **OK**, 0 violations (no migration) |
| Raw control bytes | `grep -laP '[\x00-\x08\x0b\x0c\x0e-\x1f]'` on every changed file | None |

**Known failures (reproduced in isolation; not fixed, not claimed fixed):**
- `governance_performance_guard` › "second call skips when first is still running": 1 failed / 7 passed. Pre-existing.
- `user_lifecycle_management`: 3 failed / 5 passed (Super admin can invite / Admin can invite / Audit logs created), cause `IDENTITY_CREATION_FAILED`. Pre-existing.

## 8. Remaining policy decisions and validation limits

| ID | Decision |
|---|---|
| G-1 (F-5) | Apply the §6 minimal fix: drop the `organizationId` binding (or extend the cross-org list), refuse SA rows in Route 1, and fix the UI's missing Idempotency-Key and step-up flow. |
| G-2 (= F-2) | What deleting a `SUPER_ADMIN` membership should mean. Refused on company-scoped routes (015F/015G); still allowed by `super-admin/users` DELETE Route 1 and Route 2. |
| G-3 | Should `/api/company/users` DELETE also be conditional on `status`? Today it is conditional on `id + role` only (§5). |
| G-4 | The admin-transfer "one active COMPANY_ADMIN" check is read-then-write (not atomic). Pre-existing. |
| G-5 | `/api/company/users` PUT accepts **any** `status` string, including `active`. A company admin can therefore activate an **invited** ordinary membership without invitation acceptance (it now refuses SA rows). Should status transitions be restricted, given 015E's "invited confers nothing until accepted"? |
| G-6 | `ASSIGN_ROLE` / `CREATE_USER` come from `rbac_config` (database-overridable). A config granting them to more roles widens who reaches these handlers; I-1 still holds for SA rows. |
| Carried over | 015F F-3 (`/api/users/invite`), F-4; 015E E-3 … E-6; 015D A-1, A-2; 015B 6–8 |

**Validation limits:**
- No real Postgres: per-row atomicity of the conditional `UPDATE`/`DELETE`, the `user_company_roles` status `CHECK`, `audit_logs` constraints and RLS are unverified.
- No real WebAuthn ceremony.
- No browser test of `team-management.tsx`; the API contract is unchanged except the new 404/409/403/503 refusals.
- Production prevalence of `SUPER_ADMIN` rows outside the platform tenant (the population I-1 protects) is unknown.

## 9. Confirmation

No database row read or write, schema change or migration; no production access or query; no credential or `.env` inspection; no remote operation (push, PR, merge, deploy); no staging or commit; no reset, stash, clean, rebase, amend or branch switch. No app or worker was started, and `super-admin/users` was not modified. The F-5 probes ran only against in-memory fixtures and were removed from the tree. Stopping for authorization.
