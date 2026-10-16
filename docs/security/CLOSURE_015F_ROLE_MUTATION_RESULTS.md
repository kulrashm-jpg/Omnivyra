# Closure-015F — Governed Super-Admin Role Mutation: Results

**Status: LOCAL, UNSTAGED, UNCOMMITTED.** No production access or queries. No database row reads or writes, no migration, no schema change. No credential or `.env` inspection. No push, PR, merge, deploy, staging or commit. No reset, stash, clean, rebase, amend or branch switch. No app or worker started. No invitation or external message sent.

**Evidence type.** Unit/harness level only. The real authorization code runs over **in-memory** membership, capability, step-up and trusted-device rows. Nothing ran against a real database, PostgREST/RLS or a real WebAuthn ceremony. **Not a production-readiness claim.**

| Workstream | Classification |
|---|---|
| A — `PATCH /api/company/users/[userId]/role` | **FIXED** |
| B — `DELETE /api/users/[userId]` | **FIXED**. A `SUPER_ADMIN` membership fails closed; what such a deletion should mean is an owner decision (F-2). |
| C — `/api/users/invite` lifecycle | **BLOCKED** (diagnosis complete; owner decision F-3) |

---

## 1. Baseline and working tree

| Item | Value |
|---|---|
| Root / branch / HEAD | `C:/tmp/closure-014a` / `integration/closure-014a` / `03724e86969cd9d022fd191e142e914e04963b8a`. All as expected, unchanged at end. |
| Staged at start / at end | 0 / 0 |
| Starting tree | The Closure-015E end state: 32 tracked files modified, 17 untracked (11 code + 6 reports). Snapshot `scratchpad/c15f/baseline.diff`, sha256 `579de76d…533d87`. |
| Earlier reports (byte-identical at end) | 015 `b8eb1988…`, 015A `7c996444…`, 015B_REVIEW `e4a155fd…`, 015C `45de3490…`, 015D `12afbc8d…`, 015E `7321db46…` |

## 2. Affected route and helper inventory

| Route / helper | Before 015F |
|---|---|
| `PATCH /api/company/users/[userId]/role` (`pages/api/company/users/[userId]/role.ts`) | `requireCompanyContext` (→ `enforceCompanyAccess`), then `ensureCompanyAdminAccess` (active platform SA, **or** `role === ADMIN`, which never matches because `getUserRole` normalizes ADMIN → COMPANY_ADMIN). Effectively **active platform SA only, no step-up**. A local `upsertUserCompanyRole` rewrote the role of **any** existing membership: any status, **including a `SUPER_ADMIN` row** (SA downgrade = revocation bypass). Its insert path was unreachable. **No caller** in the repository. |
| `DELETE /api/users/[userId]?companyId=` (`pages/api/users/[userId]/index.ts` → `userManagementService.removeUser`) | `withRBAC([SUPER_ADMIN, ADMIN])` + `requireUserAdminAccess` (same quirk). Effectively **active platform SA only, no step-up**. Deleted the target's membership **in that company only**, whatever its role, **including `SUPER_ADMIN`** (revocation bypass). It does **not** delete the user record or other companies' memberships. A missing membership still answered **200**. Caller: `pages/admin/users.tsx` `removeUser`. |
| Governed precedents reused | **Identity assignment:** `IDENTITY_ADMIN_ASSIGN`, used by `admin/invite-user` (super-admin branch), `super-admin/users/create`, invitation resend and `super-admin/companies/promote-admin`. It is platform-tier, and its step-up is **mandatory**: it is the only member of `CROSS_ORGANIZATION_IDENTITY_CAPABILITIES`, and `requireStepUp: false` is ignored for it. **Membership removal:** `IDENTITY_ADMIN_DELETE`, used by `super-admin/users` DELETE; platform-tier with a registered passkey + trusted-device step-up. **SA revocation:** `identity.admin.revoke` (`admin/revoke-super-admin`), which **downgrades** SA rows rather than deleting them. **Active-only role change:** `promoteMemberToAdmin` (`STALE_MEMBERSHIP` → 409). |

## 3. Authorization changes and rationale

### 3.1 Workstream A — `PATCH /api/company/users/[userId]/role` (FIXED)

**Gate.** After the existing company checks, `requireCapability(IDENTITY_ADMIN_ASSIGN, { organizationId, resourceId })` runs before the membership is read or written.
- A role change is identity assignment, so company-scoped authority never substitutes for platform authority.
- The capability is platform-tier: a direct grant without platform write authority is refused (Closure-013).
- Its step-up is mandatory: passkey on a trusted device, 10 minutes.

**Governed write** (`changeActiveMembershipRole`, replacing the ungoverned upsert). Every refusal happens before any write:
- missing membership → 404 (as before), and nothing is inserted;
- a `SUPER_ADMIN` membership in **any** status → `403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE` (assignment and revocation stay on `identity.admin.assign` / `identity.admin.revoke`);
- a non-active membership → `409 STALE_MEMBERSHIP` (the `promote-admin` precedent);
- the update is a **compare-and-set** on the `id`, `status='active'` and `role` captured **at read time**; no row updated → `409 STALE_MEMBERSHIP`, so a concurrent promotion or deactivation is never overwritten;
- read or write errors → 500, with nothing changed.

**Unchanged:** the allowed request roles (`COMPANY_ADMIN` → stored as legacy `ADMIN`; `USER` → `CONTENT_CREATOR`) and the response shapes. `SUPER_ADMIN` was never requestable.

**Not changed:** company admins still cannot use this route. That was already true, because of the normalization quirk, and enabling them would be a policy change (owner decision F-4).

### 3.2 Workstream B — `DELETE /api/users/[userId]` (FIXED)

**Gate.** `requireCapability(IDENTITY_ADMIN_DELETE)` runs before the membership is read or deleted: the capability the super-admin membership removal uses, platform-tier, with its registered passkey + trusted-device step-up.

**No `organizationId` binding, deliberately.** The target company goes into the audit `reason`/`resourceId` instead. `AuthorizationService` waives the actor-in-target-org check only for `IDENTITY_ADMIN_ASSIGN`, so binding `organizationId` refuses any platform SA who is not a member of the target company with `NOT_ORG_MEMBER`. A real-chain probe confirmed this (§6). `platformCapabilities.ts` documents that routes using platform-tier capabilities "can omit `organizationId`" because no tenant role can hold them. The gate is not weakened: platform tier, platform write authority and step-up all still apply.

**Governed delete** (`removeUser`):
- missing membership → **404** (was a false 200);
- lookup error → 503;
- a `SUPER_ADMIN` membership in **any** status → `403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE`. **Fail closed:** governed revocation downgrades rather than deletes, so what deleting a privileged membership should mean is owner decision F-2;
- the delete is **conditional** on the `id` and `role` captured at read time; nothing deleted → `409 STALE_MEMBERSHIP`, so a concurrent promotion to `SUPER_ADMIN` is never deleted;
- write error → 500, membership intact, no success audit.

**Isolation.** Only the target's membership in the named company is deleted. The user record, the target's other memberships and other members are untouched (tested). An inactive ordinary membership can still be cleaned up.

**UI.** `pages/admin/users.tsx` `removeUser` now uses `performSuperAdminWrite` (the existing step-up client), like `updateRole`/`handleInvite` in 015E.

### 3.3 Read-time snapshot for compare-and-set (also applied to 015E's `updateUserRole`)

While building the concurrency tests, a simulated concurrent promotion still produced a 200. The cause is in the harness, not the product: the in-memory DB returns **live** row objects, and the code read `row.role` lazily inside `.eq('role', row.role)` after the simulated concurrent write had mutated that same object. supabase-js returns fresh objects, so production was not affected.

All three compare-and-set sites (company role route, `removeUser`, and 015E's `updateUserRole`) now capture `readId` and `readRole` immediately after the read. This is more robust, and it makes the race tests meaningful: they now pass, and the mutants that drop the conditions are killed.

## 4. Tests

### `closure015fRoleMutation` (45 tests, real chain)

The chain is route → (`requireCompanyContext`/`enforceCompanyAccess` | `withRBAC`) → `requireCapability` → `IdentityResolver` → `CapabilityService` → step-up → governed write. For the race and write-failure cases only, an in-memory builder hook changes or fails the row between the route's read and its write.

| Area | Cases |
|---|---|
| Policy wiring | Both capabilities are platform-tier, step-up-required, passkey + trusted device |
| A authorized | Stepped-up active SA: COMPANY_ADMIN → stored ADMIN; USER → CONTENT_CREATOR; 200; the B membership is untouched; `elevated_route_accessed (identity.admin.assign)` |
| A step-up failures | No step-up / TOTP / untrusted device → `STEP_UP_REQUIRED`, unchanged |
| A unauthorized | Active COMPANY_ADMIN, legacy ADMIN, VIEW_ONLY with a **direct** `identity.admin.assign` grant, invited SA (each with passkey + trusted device) → 403, unchanged, no elevated access; unauthenticated → 401 |
| A privileged target | SUPER_ADMIN target active / invited / inactive / expired × {USER, COMPANY_ADMIN} → 403, **no downgrade** |
| A inactive memberships | Invited / inactive / expired ordinary target → 409, unchanged; missing → 404, nothing inserted; requested role SUPER_ADMIN / OWNER / CONTENT_CREATOR → 400 |
| A concurrency / failure | Promoted to SUPER_ADMIN between read and write → **409, promotion preserved**; deactivated between read and write → 409, still inactive; write failure → 500, unchanged; lookup failure → never 200 |
| B authorized | Stepped-up active SA removes an ordinary member → 200; **only** that company's membership is deleted (other company, other member and user record untouched); `elevated_route_accessed (identity.admin.delete)` and business audit recorded; an inactive ordinary membership can be cleaned up |
| B step-up / unauthorized | No step-up / TOTP / untrusted → `STEP_UP_REQUIRED`, nothing deleted. COMPANY_ADMIN, legacy ADMIN, VIEW_ONLY with a **direct** `identity.admin.delete` grant, invited SA → 403, nothing deleted. Unauthenticated → 401 |
| B privileged membership | SUPER_ADMIN membership active / invited / inactive / expired → 403, preserved, no audit |
| B cross-company / partial failure | Missing membership in A → 404 (was 200), B untouched. Promoted to SUPER_ADMIN between read and delete → 409, **not deleted**. Delete failure after a successful read → 500, intact, no success audit. Lookup failure → never 200. Removing from B deletes only B. |

**Existing suites.** `user_lifecycle_management` (a mocked functional suite) needed its delete fixture extended: match by row `id` (+ `role`) and return the deleted rows, with an `id` on the target. It is back to exactly its **3 pre-existing failures**, with the same cause (§5). The 015C/D/E suites and the SEC-91 authorization suites pass unchanged.

### Mutation testing (`scratchpad/c15f/mutants.js`)

Hardened runner: unmutated baseline **13/13 suites, 720/720 tests**; a kill counts only on a failing test; every file is restored and sha256-verified.

**Result: 12/13 killed.**

| Mutant | Result |
|---|---|
| F1 company-role gate removed | KILLED |
| F2 SUPER_ADMIN target allowed | KILLED |
| F3 read-time status check removed | SURVIVED: **redundant** with the compare-and-set status filter; the double mutant F7 is KILLED |
| F4 compare-and-set role filter dropped | KILLED |
| F5 compare-and-set status filter dropped | KILLED |
| F6 empty-result check removed | KILLED |
| F7 F3 + F5 together | KILLED |
| F8 delete gate removed | KILLED |
| F9 SUPER_ADMIN removable | KILLED |
| F10 conditional-delete role filter dropped | KILLED |
| F11 deleted-empty check removed | KILLED |
| F12 missing membership → 200 | KILLED |
| F13 write error ignored | KILLED |

## 5. Gates (exact commands; all unit/in-memory)

| Gate | Command | Result |
|---|---|---|
| Regression: 340 suites (015E gate set ∪ every suite importing a 015F-changed file ∪ the 015F suite) | `node node_modules/jest/bin/jest.js --runInBand --forceExit --json <340 suites>` | 324 passed / 16 failed suites; 7539 passed / 56 failed / 2 skipped tests; **0 suite-load failures**. The 57 failing test names are **identical** to the 015E baseline set, and none is missing from the 014C whole-repo baseline. No new failure; none lost. |
| Typecheck | `npm run typecheck` | **3/3 projects clean** |
| Certification | `node scripts/typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259 (no net-new identities) |
| Migration quality | `node scripts/check-migration-quality.js` | **OK**, 0 violations (no migration added) |
| Raw control bytes | `grep -laP '[\x00-\x08\x0b\x0c\x0e-\x1f]'` on every changed file | None |

**Known failures:**
- `governance_performance_guard` › "second call skips when first is still running": still failing inside the identical baseline set (deterministic, 3/3 in 015E).
- `user_lifecycle_management`: exactly 3 pre-existing failures (Super admin can invite / Admin can invite / Audit logs created), cause `IDENTITY_CREATION_FAILED`, re-run in isolation in 015F.

Both are pre-existing and unrelated to 015F.

## 6. Observation outside scope (not changed)

**Existing `super-admin/users` DELETE (`usersMutations.ts:299-303`)** calls `requireCapability(IDENTITY_ADMIN_DELETE, { organizationId: companyId })`. A real-chain probe of exactly that call (unit level, saved as `scratchpad/c15f/probe_orgbinding.test.ts.txt`, removed from the tree) gave:

| Call | Result |
|---|---|
| Stepped-up active platform SA, **not a member** of the target company | **403 `NOT_ORG_MEMBER`** |
| Same SA, without `organizationId` | 200 |
| `IDENTITY_ADMIN_ASSIGN` with `organizationId` (waived) | 200 |
| SA **is a member** of the target company | 200 |

So that governed route probably cannot remove members of companies the SA does not belong to. This was not verified through that route's full stack (rate limit, idempotency, pre-authorization). Decision F-5.

## 7. Workstream C — `/api/users/invite` lifecycle (BLOCKED: owner decision)

| Question | Finding |
|---|---|
| Does the route create a durable, acceptable invitation? | **No.** `inviteUser` inserts a `user_company_roles` row **without `status`**, so the DB default `'invited'` applies. It creates **no `invitations` row and sends no email.** Nothing can accept it (`team/accept-invite`, `auth/accept-invite` and `auth/set-password` all require an `invitations` row). Since Closure-015E an invited membership confers nothing, so these memberships are **inert**. For an existing member it changes the role in place (now behind `IDENTITY_ADMIN_ASSIGN` step-up, 015E). |
| Does a supported delivery service exist? | **Yes.** `backend/services/invitationService.createAndSendInvitation({ email, companyId, role, invitedBy, idempotencyKey })` creates a token-hashed invitation and enqueues the email (`email_jobs` → edge function `team_invite`). It returns `{ id, inviteLink, expiresAt, replayed }`. Used by `admin/invite-user`, `/api/company/users` POST and the super-admin user flows. |
| Is the route obsolete or redundant? | **Redundant.** The governed `POST /api/admin/invite-user` covers both actors: platform SA via `IDENTITY_ADMIN_ASSIGN` with step-up, and company admin via an active COMPANY_ADMIN row. It validates roles against `invitations_role_check` and uses the delivery service. `/api/company/users` POST covers company-admin roster invites. |
| Do clients depend on it? | **One:** `pages/admin/users.tsx` `handleInvite` (canonical registry `admin.users`, "Platform user management", linked from `admin/engagement-health`). That page sends legacy role names (CONTENT_MANAGER, CONTENT_PLANNER, CONTENT_ENGAGER, ADMIN) that `invitations_role_check` rejects. Any rewiring needs the `normalizeRole` mapping (as reinvite uses since 015D). |

**Options (none implemented; no membership activated as a shortcut; nothing sent):**
1. **Rewire** `/api/users/invite` → `createAndSendInvitation` (role mapped onto the invitation vocabulary). This sends real email when exercised.
2. **Repoint** `pages/admin/users.tsx` to `POST /api/admin/invite-user`, then retire `/api/users/invite`.
3. Keep the route but split it: existing-member role changes only (as now), with no new-member creation.

## 8. Changed-file inventory (versus HEAD: 34 tracked files, +516 / −139, plus untracked)

**Changed in 015F:**

| File | Change |
|---|---|
| `pages/api/company/users/[userId]/role.ts` *(new to the diff)* | `IDENTITY_ADMIN_ASSIGN` gate; governed `changeActiveMembershipRole` replaces the ungoverned upsert |
| `pages/api/users/[userId]/index.ts` *(new to the diff)* | `IDENTITY_ADMIN_DELETE` gate (no org binding, §3.2) |
| `backend/services/userManagementService.ts` | `removeUser` governed delete; read-time snapshot in `updateUserRole` |
| `pages/admin/users.tsx` | `removeUser` via `performSuperAdminWrite` |
| `backend/tests/integration/user_lifecycle_management.test.ts` | Delete fixture by `id`; returns deleted rows |
| `backend/tests/unit/closure015fRoleMutation.test.ts` (untracked, new) | 45 tests |
| `docs/security/CLOSURE_015F_ROLE_MUTATION_RESULTS.md` (new) | This report |

No other file was changed in 015F. All earlier Closure-015 changes, tests and reports are preserved.

## 9. Remaining owner decisions and limitations

| ID | Decision |
|---|---|
| **F-1 (high, outside this phase's scope)** | **`/api/company/users` PUT and DELETE** (`pages/api/company/users.ts:222-345`) are **company-scoped**: `ensureCompanyAdminAccess` + `ASSIGN_ROLE`, which COMPANY_ADMIN holds (`rbacService.ts:47`; overridable from config). They update the role/status of, or **delete, any membership in the company with no `SUPER_ADMIN` check**. If a platform super admin's active `SUPER_ADMIN` row sits in tenant X (`assignSuperAdmin` takes an `organizationId`), a company admin of X can demote, deactivate or delete it, revoking platform authority if it is their only active SA row. Same bypass class as A and B, but a different route, so it was **not changed** here. |
| F-2 | What should deleting a privileged (`SUPER_ADMIN`) membership mean? Today it is refused; governed revocation downgrades instead. |
| F-3 | `/api/users/invite`: options 1–3 above. |
| F-4 | Should company admins be able to use `PATCH /api/company/users/[userId]/role`? They cannot today, because of the `role === ADMIN` normalization quirk in `ensureCompanyAdminAccess` and `requireUserAdminAccess`. |
| F-5 | `super-admin/users` DELETE's `organizationId` binding (`NOT_ORG_MEMBER` for non-member SAs, §6). |
| Carried over | 015E E-1 (= F-3), E-3 … E-6; 015D A-1, A-2; 015B 6–8 |

**Limitations:**
- No real database: Postgres row-level atomicity of the conditional update/delete, column defaults, constraints and RLS are unverified.
- No real step-up: the WebAuthn ceremony behind `performSuperAdminWrite` was not exercised. Operators now need a passkey step-up on a trusted device to change or remove memberships.
- No browser test of `pages/admin/users.tsx`. `PATCH /api/company/users/[userId]/role` has no in-repo caller to exercise.
- Production prevalence unknown: `SUPER_ADMIN` rows outside the platform tenant (relevant to F-1), and inert memberships created by `/api/users/invite`.

## 10. Statement

No production operation or query, remote operation (push, PR, merge, deploy), migration, schema change, database row read or write, credential or `.env` inspection, staging or commit occurred in Closure-015F. No app or worker was started and no invitation or external message was sent. Stopping for authorization.
