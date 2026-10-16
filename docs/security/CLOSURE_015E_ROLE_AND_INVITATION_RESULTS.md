# Closure-015E — Role-Patch Bypass and Invited-Admin Policy Alignment: Results

**Status: LOCAL, UNSTAGED, UNCOMMITTED.**

Nothing in this phase touched production, credentials, the database (no row reads or writes, no migration, no schema change) or any remote system (no push, PR, merge or deploy). Nothing was staged or committed, no reset/stash/clean/rebase/amend/branch switch was run, and no app or worker was started.

**Evidence type.** All test evidence is unit/harness level: the real authorization code runs over **in-memory** membership, capability, step-up, trusted-device, invitation and company rows. Nothing ran against a real database, real PostgREST/RLS, the real `activate_invitation_membership` RPC or a real WebAuthn ceremony. **This is not a production-readiness claim.**

| Workstream | Classification |
|---|---|
| 1 — `PATCH /api/users/[userId]/role` bypass | **FIXED** (plus the same gate on `/api/users/invite`, whose existing-member branch was the same bypass) |
| 2 — invited company-admin authority | **FIXED** |
| 3 — invitation expiry | **FIXED** |
| 4 — company status in `withRBAC` | **PARTIAL:** `withRBAC` FIXED; direct `enforceRole` callers and `resolveCompanyAccess` not changed (out of scope); content-architect exemption is an owner decision (E-4) |
| 5 — route policy gate | **FIXED** for invited-role semantics; one documented divergence (company status) remains |

**Correction to Closure-015D (its report is unchanged).** 015D §5.1 said four places granted invited-`SUPER_ADMIN` authority. That was incomplete. **20 route-local guards** (§3.1) call `getCompanyRoleIncludingInvited` and still admitted invited `SUPER_ADMIN` / `COMPANY_ADMIN` / `ADMIN` rows. Six of them admitted **any** invited role. `external-apis/presets` then treats `role === 'SUPER_ADMIN'` as cross-tenant. All 20 are closed in this phase at the shared primitive (§3).

---

## 1. Baseline and working tree

| Item | Value |
|---|---|
| Root / branch / HEAD | `C:/tmp/closure-014a` / `integration/closure-014a` / `03724e86969cd9d022fd191e142e914e04963b8a`. All as expected, and unchanged at the end. |
| Staged at start / at end | 0 / 0 |
| Starting tree | The Closure-015D end state: 14 tracked files modified, 7 code files untracked. Snapshot `scratchpad/c15e/baseline.diff`, sha256 `1d134b08…f7d859`. |
| Earlier reports (byte-identical at end) | 015 `b8eb1988…`, 015A `7c996444…`, 015B_REVIEW `e4a155fd…`, 015C `45de3490…`, 015D `12afbc8d…` |

## 2. Workstream 1 — `PATCH /api/users/[userId]/role` (FIXED)

### 2.1 Trace

**Route.** `pages/api/users/[userId]/role.ts`:
- `withRBAC([SUPER_ADMIN, ADMIN])` → `updateUserRole`.
- `requireUserAdminAccess` admits a company admin only when `role === ADMIN`. `getUserRole` normalizes `ADMIN` to `COMPANY_ADMIN`, so that branch never matches. The route was therefore **effectively reachable only by an active platform super admin**, with no step-up.

**Defect.** `updateUserRole` wrote `role.toUpperCase()` onto any membership row. That meant:
- **Assignment bypass:** it could set `SUPER_ADMIN` on anyone.
- **Revocation bypass:** it could overwrite a `SUPER_ADMIN` row.
- Neither went through `identity.admin.assign` / `identity.admin.revoke`.

**Caller.** `pages/admin/users.tsx` `updateRole` (the only UI caller).

**Governed policy found.** Every super-admin cross-organization identity assignment gates on `requireCapability(IDENTITY_ADMIN_ASSIGN, organizationId)`:
- `admin/invite-user` (super-admin branch);
- `super-admin/users/create`;
- invitation resend;
- `super-admin/companies/promote-admin` (a role change).

That capability is platform-tier: the Closure-013 check refuses a holder that lacks platform write authority. It is also **step-up-mandatory**: it is a `CROSS_ORGANIZATION_IDENTITY_CAPABILITIES` member, and `requireStepUp: false` is ignored for it. The step-up requires a passkey on a trusted device, 10 minutes. `promote-admin` changes only an **active** membership (`STALE_MEMBERSHIP` → 409).

### 2.2 Fix

**Route** (`users/[userId]/role.ts`): after `withRBAC`, `requireCapability(IDENTITY_ADMIN_ASSIGN, { organizationId: companyId, resourceId: userId })` runs before any membership is read or written. A company-scoped role check can no longer authorize a role change on its own.

**Service** (`updateUserRole`). Every refusal happens before any write:
- a requested role that normalizes to `SUPER_ADMIN` → `403 SUPER_ADMIN_NOT_ASSIGNABLE_HERE`;
- a role outside `INVITABLE_ROLES` → `400 UNSUPPORTED_ROLE` with `allowedRoles`;
- the target's membership is read: missing → `404`; lookup error → `503`;
- a target membership that normalizes to `SUPER_ADMIN`, in **any** status → `403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE`;
- a non-active membership → `409 STALE_MEMBERSHIP` (the `promote-admin` precedent);
- the update is a **compare-and-set** on `id`, `status='active'` and the role that was read; no row updated → `409`.

**Same gate on `POST /api/users/invite`.** The brief asked for a separate evaluation, and existing policy requires it. `inviteUser`'s existing-member branch **changes the role of an existing membership**, so without the gate it would bypass the role-PATCH fix. A test shows the bypass closed.

**UI** (`pages/admin/users.tsx`): `updateRole` and `handleInvite` now use `performSuperAdminWrite`, the existing Closure-014 step-up client. It runs the passkey ceremony on `STEP_UP_REQUIRED` and retries once, so legitimate updates keep working.

### 2.3 Tests

`closure015eRolePatchStepUp`, **41 tests**, all real-chain: route → `withRBAC` → `requireCapability` → `IdentityResolver` → `CapabilityService` → step-up evaluation → `updateUserRole`.

| Case | Result |
|---|---|
| Stepped-up active platform SA (passkey, trusted device) changes CONTENT_CREATOR → VIEW_ONLY / CONTENT_REVIEWER / COMPANY_ADMIN / CONTENT_MANAGER / ADMIN | 200; row updated; `elevated_route_accessed (identity.admin.assign)` and business audit recorded |
| Active SA with no step-up, expired step-up, TOTP step-up, or untrusted device | `STEP_UP_REQUIRED`; unchanged; no business audit |
| Active COMPANY_ADMIN; active legacy ADMIN; VIEW_ONLY with a **direct** `identity.admin.assign` grant; invited SA; inactive SA (all with passkey + trusted device) | 403; unchanged; no elevated access recorded |
| Unauthenticated | 401 |
| Company admin of A acting on a member of B | 403 |
| Assign `SUPER_ADMIN` / `super_admin` / `Super Admin` | 403 `SUPER_ADMIN_NOT_ASSIGNABLE_HERE` |
| Revoke (rewrite) a SUPER_ADMIN membership that is active / invited / inactive / expired | 403 `SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE` |
| Target membership invited / inactive / expired | 409 `STALE_MEMBERSHIP` |
| No membership | 404 |
| Roles `OWNER`, `CONTENT_ARCHITECT`, `COMPANYADMIN`, `' VIEW_ONLY '` | 400 `UNSUPPORTED_ROLE` + list |
| Membership lookup failure | Fails closed |
| `/api/users/invite`: stepped-up SA → 200; no step-up / TOTP / untrusted → `STEP_UP_REQUIRED`, no user created; **existing member's role change without step-up → refused, unchanged**; COMPANY_ADMIN / direct grantee / invited SA → 403 | As stated |

## 3. Workstream 2 — invited company-admin authority (FIXED)

### 3.1 Caller inventory (verified before changing the shared helpers)

- **`getUserRole`** (115 non-comment call lines) had its own invited fallback: COMPANY_ADMIN / ADMIN, and SUPER_ADMIN until 015D. It feeds `withRBAC` / `enforceRole` (81 `withRBAC` routes; 104 files call `enforceRole` directly) and `getUserCompanyRole` (`campaignAccessService`).
- **`getCompanyRoleIncludingInvited`** (`rbacPrimitives`, `status IN ('active','invited')`) has **20 call sites**. All are authorization fallbacks; none is an acceptance or onboarding flow:
  - `enforceCompanyAccess`;
  - `resolveCompanyAccess`;
  - `company/usersShared`;
  - `externalApis/indexShared`;
  - `admin/delete-campaign`;
  - `campaigns/index` ×2;
  - `campaigns/ai/plan` ×2;
  - `company/llm-config`;
  - `company/llm-providers`;
  - `external-apis/{access, company-config, platforms, presets, requests, requests/[id], [id], [id]/test-connection}`;
  - `social-platforms/configs`.

  Six of them admitted **any** invited role (`plan` ×2, `campaigns/index:350`, `llm-providers`, `external-apis/{access, platforms, requests, [id]}`), not just admins. `requests/[id]` additionally required `MANAGE_EXTERNAL_APIS`.
- **Who could use the fallback.** Invited *accounts* (`users.status='invited'`) are already refused at authentication (`supabaseAuthService`, `IdentityResolver`). Only an **active account holding an invited membership** ever reached it.
- **Every invited-membership producer has an acceptance path**, with one exception. Producers checked: reinvite; company/super-admin user creation; `admin/invite-user`. All 14 `user_company_roles` writers were scanned; onboarding writes `status='active'`. The exception is legacy **`/api/users/invite`**: its insert omits `status`, so the DB default `'invited'` applies, and it **creates no invitation**. Memberships it creates therefore cannot be accepted. Non-admin roles from it already conferred nothing before this phase; admin roles now confer nothing either (owner decision E-1).

### 3.2 Change

- `getCompanyRoleIncludingInvited` resolves **active** memberships only. The name is kept so its 20 callers are unchanged; a rename is recommended.
- `getUserRole`'s invited fallback is removed.
- Stale 015D comments in `userContextService`, `contentArchitectService` and `campaignAccessService` are updated.
- Ordinary invitation creation and acceptance are untouched. The 015D lifecycle suite (reinvite → email → accept → active role) still passes.

### 3.3 Tests

`closure015eInvitationAndCompanyStatus` §2:
- The primitive returns null for an invited COMPANY_ADMIN / ADMIN / SUPER_ADMIN / CONTENT_CREATOR row, and an active row still resolves.
- `withRBAC` (3 role sets), `enforceCompanyAccess`, `resolveCompanyAccess` and `requireCampaignAccess` refuse an invited COMPANY_ADMIN and admit the active admin.
- The same membership, once activated as `accept-invite` writes it, is admitted.

Tests that pinned the **previous** policy were updated deliberately, each with a Closure-015E note. Their "never an allow" invariants are kept:

| Suite | Change |
|---|---|
| `sec91ACampaignAccess` A2 | "invited COMPANY_ADMIN keeps the documented legacy fallback" → refused in both guards |
| `sec91W2GInvitedAdminOrgStatus` | "invited admin of ACTIVE company keeps legacy access" → refused. The lookup-error case: still never an allow, now a plain 403 because the company read is never reached. |
| `sec91W2GContentWriteRbac` | `INVITED_ADMIN` moved from the allowed set to the refused set (new 403 cases) |
| `closure015dIdentityLifecycle` (D) | Invited-admin fallback "unchanged" → "removed" |
| `closure015cInviteRoleGovernance` (T10) | Characterization → **FIXED**: an invited COMPANY_ADMIN with no invitation grants nothing |

## 4. Workstream 3 — invitation expiry (FIXED)

**Authoritative semantics.** The activation RPC `activate_invitation_membership` (`20260420_lockdown_idempotency.sql:166`) treats `expires_at <= p_now` as expired. `invitations.expires_at` is `NOT NULL` with a default.

**Defects found:**
- `team/accept-invite` and `auth/accept-invite` compared with `<`, so they **accepted the boundary instant**.
- All three TypeScript paths **accepted a missing or malformed value**: `new Date('garbage') < now` is `false`.

**Fix.** A new `backend/services/invitationExpiry.isInvitationExpired`:
- uses `<=`;
- treats missing, empty, whitespace or unparseable values (and non-string, non-Date values) as **expired**.

It is used by `team/accept-invite`, `auth/accept-invite` and `auth/set-password` (whose existing `<=` semantics are kept). No new field and no migration.

**Authorization time.** Since §3, an invitation-backed (`invited`) membership authorizes **nothing**, so no request can be authorized by it, expired or not. A test shows this holds before and after expiry.

**Tests** (deterministic, fake system clock):
- **Helper:** 12 cases (±1 ms, boundary, Postgres text, Date object, null, undefined, `''`, whitespace, garbage, a number).
- **`team/accept-invite` (real route):** valid → 200 and activates `invitation.role`. Boundary, 1 ms past, malformed and missing → 404, with nothing activated.
- **`auth/accept-invite`:** malformed, missing and boundary → 400 `EXPIRED`; the invitation is revoked and the token is not consumed.
- **`auth/set-password`:** malformed, missing, empty and boundary → 400 `EXPIRED_INVITATION`, and the **activation RPC is never called**. Valid reaches the RPC.

## 5. Workstream 4 — company status in `withRBAC` (PARTIAL)

### Consumer map

All 81 `withRBAC` routes were reviewed by path. None is a billing, reactivation, export, account-deletion or recovery flow:
- the "health" routes are tenant analytics reads;
- `governance/*`, `omnivyra/health` and `refresh-slots` are platform-super-admin routes.

`TenantGuard`'s documented rule applies: a tenant member of a missing or non-`active` company is refused, and **the platform super admin bypasses**.

### Change

After `enforceRole` succeeds, `withRBAC` checks `companyOperationalState(companyId)` for **tenant** principals:
- `not_operational` (missing / suspended / inactive / deleted) → 403 `{ error: 'Access denied to company' }`. This is the same body `enforceCompanyAccess` uses.
- `lookup_error` → 503 `TENANT_LOOKUP_ERROR`, `retryable: true`. Never an allow.

Exempt:
- the active platform super admin (`enforceRole`'s bypass, the only path that yields `SUPER_ADMIN` since 015D);
- the **content-architect** principal. Before this phase `withRBAC` read company status for nobody, so this exemption **preserves** the architect's existing behaviour rather than broadening anything. Whether the architect should be subject to company status is undocumented: owner decision E-4.

### Not changed (out of scope)

- 104 files that call `enforceRole` directly;
- `resolveCompanyAccess` (42 call sites).

Neither reads company status. Decision E-3.

### Tests

- Active company → 200.
- Suspended / inactive / deleted / missing → 403.
- Lookup error → 503.
- Platform SA on a suspended company, and with a failing company read → 200.
- `withRBAC` agrees with `enforceCompanyAccess` on a suspended company.
- The content architect is pinned at 200 for both active and suspended companies.

**Fixture updates (six suites).** Six existing suites test other properties and fake a database with **no `companies` table**: `opportunitiesSec001ActionBinding`, `opportunitiesSec002PostBinding`, `governanceSec002VerifySnapshot`, `withRbacStruct001CompanyId`, `campaign_company_scope_fix`, `campaign_preplanning_gate`.
- Under the new check every company read as missing (403). This was proven per suite: none models `companies`, and each mocks `enforceRole` or the database.
- Each now mocks `companyOperationalState` as `operational`, with a note: **102/102 pass**.
- `user_lifecycle_management` got a `companies` stub, the identity-assignment stub, and `id`/`status` on the role-update target. It is back to exactly its 3 pre-existing failures.

## 6. Workstream 5 — route policy gate (FIXED; one documented divergence)

**Change.** `policyGate.organizationRoles` now holds **active** memberships only. 015D had already made `isPlatformSuperAdmin` active-only. Invited roles of any kind now confer nothing in the gate, matching `getUserRole` and `TenantGuard`.

**Agreement tests.** The gate's principal is built from **the same in-memory rows** the routes read. For seven principals, the gate's decision equals the route's outcome for each pair:
- `admin` policy ⇔ `withRBAC([COMPANY_ADMIN])`;
- `company-scoped` policy ⇔ `withRBAC(all roles)`;
- `super-admin` policy ⇔ `withRBAC([SUPER_ADMIN])` plus the active-platform guard.

The seven principals: active COMPANY_ADMIN; invited COMPANY_ADMIN / ADMIN / SUPER_ADMIN / CONTENT_CREATOR; inactive SA; active platform SA.

**Documented divergence (pinned by a test).** The gate is observation-only and does not read company status. For a suspended company, `withRBAC` now refuses an active admin while the gate would allow. Decision E-5, before Phase 2 enforcement.

## 7. Changed-file inventory (versus HEAD: 32 tracked files, +389 / −89, plus untracked)

**New in 015E, tracked files:**

| File | Reason |
|---|---|
| `backend/middleware/withRBAC.ts` | Company operational state for tenant principals (§5) |
| `backend/services/rbacPrimitives.ts` | `getCompanyRoleIncludingInvited` → active only (§3) |
| `backend/services/campaignAccessService.ts` | Comment only: the invited fallback no longer exists |
| `pages/api/users/[userId]/role.ts` | `IDENTITY_ADMIN_ASSIGN` gate; forwards `allowedRoles` (§2) |
| `pages/admin/users.tsx` | `updateRole` / `handleInvite` via `performSuperAdminWrite` (step-up client) |
| `pages/api/team/accept-invite.ts`, `pages/api/auth/accept-invite.ts`, `pages/api/auth/set-password.ts` | Shared expiry predicate (§4) |
| 6 suites (§5) + `user_lifecycle_management` | Fixture updates for the company-status check and the identity gate |
| `sec91ACampaignAccess`, `sec91W2GInvitedAdminOrgStatus`, `sec91W2GContentWriteRbac` | Pins of the old invited-admin policy updated (§3.3) |

**Already modified at the end of 015D, changed again in 015E:**

| File | Change |
|---|---|
| `backend/services/userManagementService.ts` | `updateUserRole` governance (§2) |
| `pages/api/users/invite.ts` | `IDENTITY_ADMIN_ASSIGN` gate |
| `backend/services/rbacService.ts` | Invited fallback removed |
| `backend/services/userContextService.ts`, `contentArchitectService.ts` | Comments |
| `lib/platform/policyGate.ts` | `organizationRoles` active only |

**Untracked files, new or changed:**

| File | Status |
|---|---|
| `backend/services/invitationExpiry.ts` | New |
| `closure015eRolePatchStepUp.test.ts` | New, 41 tests |
| `closure015eInvitationAndCompanyStatus.test.ts` | New, 64 tests |
| `closure015eSetPasswordAndArchitect.test.ts` | New, 7 tests |
| `closure015cInviteRoleGovernance.test.ts` | Updated: T10 |
| `closure015dIdentityLifecycle.test.ts` | Updated: D test; identity gate stubbed for its response-shape tests |
| This report | New |

## 8. Gates (exact commands; all unit/in-memory)

| Gate | Command | Result |
|---|---|---|
| Regression set: 337 suites (015D gate set ∪ every suite importing a 015E-changed module ∪ the 015E suites) | `node node_modules/jest/bin/jest.js --runInBand --forceExit --json <337 suites>` | First run: 315 passed / 22 failed suites; 7428 passed / 90 failed / 2 skipped tests; **0 suite-load failures**. Classified at test-name level against the 014C whole-repo run: **34 new** (all six fixture suites, §5; now 102/102) and **57 baseline**. The 57 are **identical** to the 57 baseline failures in 015D: none new, none lost. |
| Mutation-suite baseline (12 suites: all closure015c/d/e plus sec91ACampaignAccess, sec91W2GInvitedAdminOrgStatus, sec91W2GContentWriteRbac) | same runner | **12/12 suites, 675/675 tests** |
| Typecheck | `npm run typecheck` | **3/3 projects clean** |
| Certification | `node scripts/typecheck-certification.js` (re-run after the last test edit) | **PASS**: backend 0/0; backend-tests **256/259** (3 fewer than baseline, no net-new identities) |
| Migration quality | `node scripts/check-migration-quality.js` | **OK**, 0 violations (no migration) |
| Raw control bytes | `grep -laP '[\x00-\x08\x0b\x0c\x0e-\x1f]'` on every changed file | None |

### Mutation testing (`scratchpad/c15e/mutants3.js`)

The runner checks an unmutated baseline first and counts a mutant as **KILLED only when at least one test fails**. Every file is restored and sha256-verified.

**Result: 20/23 killed.**

| Survivor | Explanation |
|---|---|
| M2: `requireStepUp: false` on the role route | **Equivalent.** `IDENTITY_ADMIN_ASSIGN` is in `CROSS_ORGANIZATION_IDENTITY_CAPABILITIES`, so `requireCapability` forces step-up regardless. |
| M6: the pre-read `status !== 'active'` check dropped | **Mutually redundant with M7.** The double mutant M23 is **KILLED**. |
| M7: the compare-and-set `status='active'` filter dropped | Same: covered by M23. |

**Killed:**
- M1 role gate;
- M3 / M4 SUPER_ADMIN target and membership;
- M5 whitelist;
- M8 primitive;
- M9 `getUserRole` fallback;
- M10 / M11 policy gate;
- M12–M14 expiry boundary, malformed and missing;
- M15–M17 the three acceptance paths;
- M18–M21 `withRBAC` status check, lookup error, SA bypass and content-architect bypass;
- M22 invite gate;
- M23 (M6+M7).

> **Process note (recorded, not hidden).** The first 015E mutation run (`mutants.log`, 16/21) was valid. A second run (`mutants2.log`, "23/23") was **invalid**. A test I had appended contained an unescaped apostrophe, so `closure015eRolePatchStepUp` failed to compile, and the old runner counted any non-zero exit as a kill. An earlier "260/260" figure also missed that the suite had not loaded. Both were found and fixed, and the runner was hardened (baseline gate; kill = failing test). The figures above come from the hardened run (`mutants3.log`). Every kill in the 015C and 015D mutation logs reports at least one failing test, so those runs were not affected.

## 9. Known failures: reproduced and classified

| Failure | Reproduction | Classification |
|---|---|---|
| `governance_performance_guard` › "second call skips when first is still running" | 3 isolated runs: 3/3 fail (`runGovernanceAudit` called 2×) | Pre-existing, deterministic. In the 014A/014C sets; imports no changed file. |
| `user_lifecycle_management` ×3 (Super admin can invite / Admin can invite / Audit logs created) | Re-run: the same 3, `IDENTITY_CREATION_FAILED` | Pre-existing, same cause as the 014C log. The 3 extra failures the new checks caused (list / remove / role update) are fixed by fixtures (§5). |
| `external_api_company_scope` (015D load timeout) | Passed in the 337-suite run; 4/4 in isolation | Not failing in 015E |
| Route-auth scanners `routeAuth001Scanner`, `sec91FRouteAuthMethod`, `sec91W2FRouteAuthReExport` (the "repository" tests) | Violation lists compared with 014C | **Identical 12 entries**; none in a file changed in Closure-015 |
| The other 014C-baseline failures | In the 337-suite run | Unchanged: the same 57 test names as 015D |

## 10. Remaining owner decisions

| ID | Decision |
|---|---|
| E-1 | Legacy `/api/users/invite` creates memberships with DB-default status `invited` and **no invitation**, so they can never be accepted, and since §3 they confer nothing. Should it create an invitation (as `admin/invite-user` does), write `active`, or be retired? Retiring was deferred by the brief. |
| E-2 | Sibling **`PATCH /api/company/users/[userId]/role`**: same bypass class, not in this brief. Effectively active-platform-SA only. It rewrites **any** membership, including a `SUPER_ADMIN` row, to ADMIN or CONTENT_CREATOR (a SUPER_ADMIN revocation bypass) with no step-up. Same for **`DELETE /api/users/[userId]`** (`removeUser`), which can delete a SUPER_ADMIN row. |
| E-3 | Company status for the 104 direct `enforceRole` callers and for `resolveCompanyAccess`. |
| E-4 | Should the content-architect principal be subject to company status (in `withRBAC` and the legacy guards)? It is currently exempt, as before. |
| E-5 | Before the policy gate starts enforcing: should it read company status, so it agrees with `withRBAC` / `TenantGuard`? |
| E-6 | Rename `getCompanyRoleIncludingInvited` (now active-only) and collapse its 20 route-local fallbacks onto the canonical guards. |
| 015D A-1, A-2 | Deferred by the brief: `rebuild-projection` / `refresh-slots` with no step-up; restore-snapshot capability and global-lock semantics. |
| 015B 6–8 | Recommendation-audit scoping, deletion routes, content-plan threshold. Deferred by the brief. |

## 11. Integration-test limitations (blocked in this phase)

- **No real database.** Postgres column defaults (`user_company_roles.status`, `invitations.role`), `invitations_role_check`, the `activate_invitation_membership` RPC's own expiry, `companies.status` values in production, and RLS are unverified. These need the cert environment; not allowed in this phase.
- **No real step-up.** The WebAuthn ceremony and trusted-device minting behind `performSuperAdminWrite` were not exercised. Operators will now need a passkey step-up on a trusted device to change roles or invite users.
- **Production prevalence unknown.** Production was not queried for:
  - active accounts holding **invited** COMPANY_ADMIN/ADMIN memberships (these lose access with this change);
  - members of non-`active` companies using `withRBAC` routes.

  Both should be measured before release.
- **UI change typechecked only.** `pages/admin/users.tsx` was not exercised in a browser.

## 12. Statement

No production operation, production query, remote operation (push, PR, merge, deploy), migration, schema change, database row read or write, credential or `.env` inspection, staging or commit occurred in Closure-015E. No app or worker was started. Stopping for authorization.
