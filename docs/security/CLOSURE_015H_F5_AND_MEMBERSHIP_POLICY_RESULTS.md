# Closure-015H — F-5 Fix and Membership Policy Hardening: Results

**Status: LOCAL, UNSTAGED, UNCOMMITTED.** No staging, commit, push, PR, merge or deploy. No production access, production configuration change, database row read or write, or migration. No credential or `.env` inspection. No reset, stash, clean, rebase, amend or discard. No app or worker started. No invitation or external message sent.

**Evidence type.** All test evidence is **unit/harness level**. The real route, authorization, idempotency and UI code runs over **in-memory** rows; the UI runs in jsdom with a modelled server. Nothing ran against a real database, PostgREST/RLS, Supabase Auth or a real WebAuthn ceremony. **Not a production-readiness claim.**

| Item | Classification |
|---|---|
| F-5: `super-admin/users` DELETE + UI | **FIXED** |
| G-3: company DELETE conditional on id + role + status | **FIXED** |
| G-5: company PUT never activates an invited / expired membership | **FIXED** (inactive → active left as owner decision H-1) |
| G-4: one-active-company-admin invariant | **INVESTIGATED**; not changed (needs owner decision / migration) |
| G-6: database-backed permission configuration | **INVESTIGATED**; no exploitable bypass; hardening options are owner decisions |

---

## 1. Verified starting state

| Item | Value |
|---|---|
| Root / branch | `C:/tmp/closure-014a` / `integration/closure-014a` |
| HEAD | `03724e86969cd9d022fd191e142e914e04963b8a` (verified at start and end) |
| Staged / unstaged tracked / untracked at start | 0 / 36 / 21 (13 code + 8 reports), exactly the Closure-015G end state. Snapshot `scratchpad/c15h/baseline.diff`, sha256 `50c83a72…441585`. |
| Earlier reports (byte-identical at end) | 015 `b8eb1988…`, 015A `7c996444…`, 015B_REVIEW `e4a155fd…`, 015C `45de3490…`, 015D `12afbc8d…`, 015E `7321db46…`, 015F `0a106b2c…`, 015G `26e9121f…` |

## 2. Files changed in 015H

Cumulative totals versus HEAD: 38 tracked files, +727 / −164.

| File | Change | Rationale |
|---|---|---|
| `backend/apiHandlers/superAdmin/usersMutations.ts` | `handleUsersDelete`: (1) no `organizationId` binding on `IDENTITY_ADMIN_DELETE`; (2) Route 1 reads the target, refuses `SUPER_ADMIN` (any status, audited), deletes conditionally on `id + role + status`, 404/503/500/409 truthful; (3) Route 2 refuses a user with any `SUPER_ADMIN` membership before touching auth, `users` or memberships, and its bulk deactivation excludes `SUPER_ADMIN` rows; (4) audit rows carry the acting principal instead of `null`. Adds a `normalizeRole` import. | F-5, decision 2 |
| `components/super-admin/tabs/CompanyUsersTab.tsx` | `handleDeleteUser` sends a fresh `Idempotency-Key` per attempt and runs `runStepUpFlowIfNeeded`, with the same outcome handling as the tab's other governed mutations | F-5 UI |
| `pages/api/company/users.ts` | PUT: `status: 'active'` on an `invited` or `expired` target → 409 `INVITATION_ACCEPTANCE_REQUIRED`. DELETE: conditional on `id + role + status`. | G-5, G-3 |
| `backend/tests/unit/closure015hSuperAdminUsersDelete.test.ts` (new) | 36 tests | |
| `backend/tests/unit/closure015hCompanyUsersTabDelete.dom.test.tsx` (new) | 6 jsdom tests | |
| This report | | |

No other file changed. In particular `withRBAC`, `getUserRole`, invitation acceptance, the governed `admin/revoke-super-admin` route, `AuthorizationService` and the capability registries are untouched.

## 3. F-5 before and after

### Authorization

| Aspect | Before | After |
|---|---|---|
| Gate | `requireCapability(IDENTITY_ADMIN_DELETE, { organizationId: companyId })`. `AuthorizationService` waives the actor-in-target-org check only for `IDENTITY_ADMIN_ASSIGN` (`CROSS_ORGANIZATION_IDENTITY_CAPABILITIES`), so a platform SA who is not a member of the target company got **403 `NOT_ORG_MEMBER`** | `requireCapability(IDENTITY_ADMIN_DELETE)` with no org binding (documented basis: `platformCapabilities.ts`, platform-tier routes may omit `organizationId`). Unchanged: platform-tier capability, platform write authority (pre-authorization + `requireCapability`), registered passkey + trusted-device step-up, `requireSuperAdminAccess` top guard, rate limit. No parallel authorization. The target company is recorded in the reason and resource id. |
| Route 1 (`companyId`) | Unconditional `DELETE (user_id, company_id)`, **including `SUPER_ADMIN` rows**; audit actor `null` | Read `(id, role, status)` first. Read error → **503**; missing → **404**. `SUPER_ADMIN` in any status (incl. legacy lower-case) → **403 `SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE`** plus audit `PRIVILEGED_MEMBERSHIP_DELETE_DENIED`. Delete conditional on the snapshotted `id + role + status` (NULL status handled); no match → **409 `STALE_MEMBERSHIP`**; write error → 500. Audit carries the actor. |
| Route 2 (no `companyId`: whole-user delete) | Deleted the auth account, soft-deleted `users`, and deactivated **every** membership, **including `SUPER_ADMIN` rows** (platform authority removed outside the governed flow) | First reads all memberships (read error → 503). Any `SUPER_ADMIN` in any status → 403 plus audit **before** the auth delete, the soft-delete or any deactivation. The bulk deactivation also excludes `role = 'SUPER_ADMIN'` as a backstop. Audit carries the actor. |
| Removing platform authority | — | Only the governed `admin/revoke-super-admin` (`identity.admin.revoke`, step-up), which downgrades. Regression-tested. |

### UI

| Aspect | Before | After |
|---|---|---|
| Request | No `Idempotency-Key`, so every UI delete got **400 `IDEMPOTENCY_KEY_REQUIRED`** before authorization; no step-up flow | `fire()` builds a **fresh** key per attempt via the tab's existing `newIdempotencyKey()` (the convention documented on `handleUserStatusChange` and pinned by `stepUpRetryIdempotency.test.ts`: a denied first attempt's response is stored per key, so the post-elevation retry must carry a new key; the refused attempt wrote nothing). It is wrapped in `runStepUpFlowIfNeeded(await fire(), fire)`. Cancel / unavailable → step-up message; session lost → auth message; any non-2xx → the server's `details`/`error` (never reported as success); success → reload. |

### Tests (`closure015hSuperAdminUsersDelete`: 36; `closure015hCompanyUsersTabDelete.dom`: 6; all pass)

| Area | Evidence |
|---|---|
| Non-member platform SA | Stepped-up SA (no membership in CO_A or CO_B) removes an ordinary CO_A member → **200**; the CO_B membership is untouched; `elevated_route_accessed (identity.admin.delete)`; no `NOT_ORG_MEMBER`; audit actor = SA |
| Without authority / step-up | SA without step-up → `STEP_UP_REQUIRED`. Active COMPANY_ADMIN and VIEW_ONLY with a **direct** `identity.admin.delete` grant (each with passkey + trusted device) → 403. Unauthenticated → 401. Nothing deleted in any case. |
| Idempotency | Missing key → 400 `IDEMPOTENCY_KEY_REQUIRED`, no authorization attempted, nothing deleted. A valid key → 200; replaying the same key replays the 200 with **no second delete** and a single audit row. |
| `SUPER_ADMIN` targets, Route 1 | Active / invited / inactive (revoked by deactivation) / expired / legacy lower-case → 403, row preserved, no write, audited with the actor |
| `SUPER_ADMIN` targets, Route 2 | Same 5 states → 403. Supabase Auth `deleteUser` **not called**, `users` not soft-deleted, no membership write. |
| Ordinary deletion | Route 1 → 200 (only that company's membership). Route 2 → 200 (auth deleted, soft-deleted, all memberships inactive; audit actor). |
| Failures / staleness | Missing → 404. Target lookup failure → 503. Write failure → 500, intact, no success audit. Promoted to SA between read and delete → **409, not deleted**. Status changed between read and delete → **409, not deleted**. Route 2 membership-lookup failure → 503, nothing touched. Route 2 backstop: a promotion landing after the check is **not** deactivated. |
| Governed revoke regression | Stepped-up SA → 200, SA row **downgraded** to COMPANY_ADMIN, `elevated_route_accessed (identity.admin.revoke)`. Without step-up → `STEP_UP_REQUIRED`. Company admin → 403. |
| UI | Every DELETE carries a non-empty key and the `{userId, companyId}` body, with zero keyless calls. Step-up runs once; the retry carries a **different** key; exactly **one** mutation (modelled `withIdempotency` server); the list reloads. "Delete unassigned user" sends `companyId: null` through the same flow. Cancel / session-lost messages; a 403 refusal is surfaced. |

**Pre-fix evidence.** The suites were run against the pre-015H files (HEAD `usersMutations.ts` and `CompanyUsersTab.tsx`; the 015G `company/users.ts`, verified byte-identical to the reconstruction from `baseline.diff`), swapped in temporarily, then restored and sha256-verified:
- Route suite: **24 of 36 fail**.
- DOM suite: **6 of 6 fail**.

Logs: `scratchpad/c15h/before.log`, `dom_before.log`.

## 4. G-3 and G-5 (company membership routes)

| Rule | Implementation | Tests |
|---|---|---|
| G-3: DELETE conditional on id + role + status | `DELETE … WHERE id = :read.id AND role = :read.role AND status = :read.status` (`IS NULL` when null); no match → 409 | Status changed between read and delete → 409, **not deleted**. Role changed (→ SA) → 409, not deleted. Unchanged → 200. |
| G-5: PUT never activates the invitation lifecycle's memberships | `status === 'active'` while the target is `invited` or `expired` → **409 `INVITATION_ACCEPTANCE_REQUIRED`**, before any write. Invitation acceptance (`team/accept-invite`, `activate_invitation_membership`) stays the activation path; an expired invitation needs a new one. | Invited → active and expired → active: 409, unchanged, no write. An invited member's **role change without status** → 200, still invited. Invited → inactive → 200. Active role change + deactivation → 200. **Characterization:** inactive → active → 200 (H-1). |

**Other transitions checked:**
- **inactive → active** is still accepted. `accepted_at` cannot tell a never-accepted inactive row from an accepted one: migration `20260323_user_company_roles_columns.sql` backfilled only `invited_at`, not `accepted_at`. Blocking it could lock out legitimately reactivated members, so it is left to the owner (H-1). The team-management UI never sends `active`; it sends only `inactive` or no status.
- PUT also accepts any `status` string the DB `CHECK` allows (`invited`, `active`, `inactive`, `expired`), and `deactivated`, which the code handles but the DB check rejects (→ 500). Status vocabulary: H-2.

## 5. Conditional-write and concurrency evidence

| Window | Protection | Evidence |
|---|---|---|
| `super-admin/users` Route 1: promotion or status change between read and delete | Conditional on the snapshotted `id + role + status` | Race tests (builder hook between read and write) → 409, row preserved. Mutants H3 (status filter), H4 (role filter) and H5 (409 check) **killed**. |
| Route 2: promotion between the membership check and the bulk deactivation | `.neq('role', 'SUPER_ADMIN')` on the deactivation | Backstop test → promoted row stays active. H8 **killed**. **Residual:** the Supabase Auth account deletion (step B) precedes the deactivation; a promotion landing in that window leaves an SA membership whose auth account is gone (cannot sign in; row intact). It also matches the exact spelling only (lower-case legacy rows are caught by the pre-check, not the backstop). |
| Company DELETE (G-3) | Conditional on `id + role + status` | Status and role race tests → 409. H13 **killed**. |
| Company PUT (015G) | Compare-and-set on `id + role + status` | 015G tests (unchanged, passing) |
| Snapshot correctness | Compared values are captured at read time (the in-memory harness returns live row objects — 015F lesson) | All race tests pass and fail meaningfully against mutants |
| Real database | A single row-scoped `DELETE … WHERE` / `UPDATE … WHERE` re-checks its predicate on the latest row version under READ COMMITTED | **Not verified against Postgres** (operator / integration evidence required) |

### Mutation testing (`scratchpad/c15h/mutants.js`)

Hardened runner: unmutated baseline **19/19 suites, 841/841 tests**; a kill counts only on a failing test; every file is restored and sha256-verified.

**Result: 15/15 killed. No survivors.**

| Group | Mutants |
|---|---|
| F-5 routes | H1 org binding restored · H2 Route 1 SA guard · H3/H4 Route 1 status/role filter · H5 409 check · H6 lookup error → proceed · H7 Route 2 SA pre-check · H8 deactivation backstop · H9 Route 2 lookup error ignored · H10 audit actor null |
| G-5 / G-3 | H11 G-5 check removed · H12 expired activatable · H13 G-3 status filter |
| UI | H14 no Idempotency-Key · H15 one key reused across the step-up retry |

## 6. G-4 and G-6 findings

### G-4: one active COMPANY_ADMIN per company (not changed)

**Where it is enforced:** only as read-then-write application checks in `/api/company/users`.
- POST: count of active `role='COMPANY_ADMIN'` must be 0 unless the caller is SA.
- PUT: "another active COMPANY_ADMIN with `user_id ≠ target`" must not exist unless the caller is SA.

**No database constraint.** The only partial unique index is `idx_user_company_roles_user_company_active` (one active row per `(user_id, company_id)`). Migration `20260510_company_membership_identity_hardening` adds domain/membership triggers but nothing about admin count.

**Company-admin callers cannot race it.** PUT/POST require `ASSIGN_ROLE`/`CREATE_USER` (default SUPER_ADMIN, COMPANY_ADMIN). For a COMPANY_ADMIN caller, the "another admin" query **always finds the caller**, so a company admin's promotion or admin invite of anyone else is refused deterministically. Super admins are exempt by design.

**Interleavings that do violate it:**

| # | Interleaving | Notes |
|---|---|---|
| (a) | **Activation is unchecked.** `team/accept-invite` and the `set-password` RPC path set `role = invitation.role, status = 'active'` with **no admin-count check**. A pending COMPANY_ADMIN invitation, created by an SA (`admin/invite-user`, super-admin flows) or by a company admin's **reinvite** of a former admin (015D carries the role onto the invitation), produces a second active admin on acceptance. Two pending admin invitations can both be accepted. | — |
| (b) | **Legacy spelling escapes the count.** The checks match `role = 'COMPANY_ADMIN'` only; an active legacy `'ADMIN'` row (normalized to COMPANY_ADMIN everywhere else, and written by `PATCH /api/company/users/[userId]/role`) is not counted. | — |
| (c) | **SA paths** (`promote-admin`, `transfer-ownership`, `super-admin/users`) intentionally bypass the count. | Whether ">1 admin" is ever legitimate is therefore an owner question. |

**Current tests:** only 015G's single-request `ADMIN_TRANSFER_REQUIRED` case. No concurrency or activation-time test exists.

**Smallest safe atomic option (not implemented: needs a migration and an owner decision):**
1. **Recommended:** a partial unique index `ON user_company_roles (company_id) WHERE status='active' AND role IN ('COMPANY_ADMIN','ADMIN')`. This is atomic. It conflicts with the SA exemption, and creation fails if production already has companies with more than one active admin, so it needs read-only production evidence first.
2. **No-migration interim:** an admin-count check at acceptance (`team/accept-invite`) plus counting legacy `'ADMIN'` in the existing checks. Still read-then-write, and the RPC path would need SQL.

### G-6: database-backed permission configuration (not changed)

| Aspect | Finding |
|---|---|
| Load | `getRbacConfig()` reads the latest `rbac_config` row. Per-process cache `RBAC_CACHE_TTL_MS` (5 min). A read error or empty table falls back to the compiled `PERMISSIONS` defaults. |
| Validation | `normalizeRoles` keeps only known `Role` values and always re-adds `SUPER_ADMIN`. `normalizePermissions` keeps only known roles **or `'*'`** per permission. An empty or invalid object falls back to the defaults. A permission the stored row omits resolves to **no one** (`hasPermission` → `[]` → false). |
| Writer | `POST /api/super-admin/rbac`: `requireCapability(IDENTITY_ADMIN)` (platform-tier, platform write authority, passkey + trusted-device step-up), `withIdempotency` with `mayAttemptCapability`, rate limit, `recordAdminAudit`. **No tenant path writes it.** |
| Consumers | `hasPermission` for tenant-level permissions: `ASSIGN_ROLE`, `CREATE_USER` (`/api/company/users`), `MANAGE_EXTERNAL_APIS`, `CREATE_CAMPAIGN`, `VIEW_*`, and others. **Not** consulted by `requireCapability`/platform capabilities, and **not** by the `SUPER_ADMIN` membership guards of 015F–015H, which are code-level and independent of config. |
| What can be widened | Any tenant-level permission, to any role or to `'*'` (every role). Example: `ASSIGN_ROLE: ['*']` lets a VIEW_ONLY member use `/api/company/users` PUT/DELETE on ordinary memberships. |
| Exploitable bypass? | **No.** Widening requires a platform SA with step-up through the governed, audited route. It cannot grant platform capabilities or touch `SUPER_ADMIN` rows. This is an intended configurable permission. |
| Hardening options (owner decisions; none implemented) | Forbid `'*'` (or non-admin roles) on security-sensitive permissions (`ASSIGN_ROLE`, `CREATE_USER`). Shorten or invalidate the 5-minute cache across instances so that **narrowing** takes effect promptly. |

## 7. Exact commands and results (all in-memory unit tests)

| Command | Result |
|---|---|
| `node node_modules/jest/bin/jest.js --runInBand --forceExit backend/tests/unit/closure015hSuperAdminUsersDelete.test.ts` | **36/36** (pre-fix: 24 failed) |
| `… backend/tests/unit/closure015hCompanyUsersTabDelete.dom.test.tsx` | **6/6** (pre-fix: 6 failed) |
| `… closure015gCompanyMembershipGuards.test.ts companyUsersTabGovernedMutation.dom.test.tsx companyUsersTabEmailStepUp.dom.test.tsx` (after G-3/G-5 edits) | **75/75** |
| `node scratchpad/c15h/mutants.js` (19 suites) | Baseline 841/841; **15/15 killed** |
| Regression: 344 suites (015G gate set ∪ every suite touching the changed modules ∪ the 015H suites), `--json` | 328 passed / 16 failed suites; 7655 passed / 56 failed / 2 skipped tests; **0 suite-load failures**. The 57 failing test names are **identical to the 015G baseline set**: no new failure, none lost. |
| `npm run typecheck` | **3/3 projects clean** |
| `node scripts/typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259 |
| `node scripts/check-migration-quality.js` | **OK**, 0 violations (no migration added) |
| Raw control-byte scan of every changed file | None |

**Known baseline failures (still failing; not claimed fixed):**
- `governance_performance_guard` › "second call skips when first is still running";
- `user_lifecycle_management` ×3 (`IDENTITY_CREATION_FAILED`);
- the other 014C-baseline tests.

All are inside the identical 57-name set. **New failures: none.**

## 8. Remaining decisions, release blockers and operator-only evidence

**Owner decisions:**

| ID | Decision |
|---|---|
| H-1 | Should company-scoped PUT allow inactive → active? It cannot be distinguished from never-accepted without `accepted_at` data. |
| H-2 | Restrict PUT `status` to the DB vocabulary (`deactivated` currently 500s). |
| H-3 (G-4) | Is more than one active company admin ever legitimate (SA paths)? If not, the partial unique index (migration) plus an acceptance-time check. |
| H-4 (G-6) | Forbid `'*'` / non-admin roles on `ASSIGN_ROLE`/`CREATE_USER`; cache invalidation for narrowing. |
| H-5 | Route 2 residual: auth-account deletion precedes the deactivation backstop (§5). Consider reordering (memberships first) or a transactional RPC. |
| Carried over | 015F F-3 (`/api/users/invite`), F-4; 015E E-3 … E-6; 015D A-1, A-2; 015B 6–8 |

**Release blockers (operator-only evidence; none obtainable in this phase):**
1. Read-only production counts:
   - `SUPER_ADMIN` rows outside the platform tenant (the population 015F–015H protect);
   - companies with more than one active `COMPANY_ADMIN`/`ADMIN` (gates H-3's index);
   - `invited`/`expired` memberships that clients may currently activate via PUT (G-5 behaviour change);
   - the current `rbac_config` row contents (G-6 exposure).
2. A real-Postgres run of the conditional `UPDATE`/`DELETE` predicates, the `user_company_roles` CHECK, and the `activate_invitation_membership` RPC (cert environment).
3. A real WebAuthn step-up through `CompanyUsersTab` delete and `pages/admin/users.tsx` in a browser.
4. Review and authorization to stage and commit the whole Closure-015 series (015C–015H): currently **38 tracked files** modified and **15 untracked test/helper files**, all uncommitted.

## 9. Confirmation

No staging, commit, push, PR, merge or deployment. No production access, production configuration change, database operation or migration. No credential or `.env` inspection. No reset, stash, clean, rebase, amend or discard. No app or worker started; no invitation or external message sent. Stopping for review.
