# CLOSURE-015L — Database Guards and RBAC Schema Design

**Scope:** owner decisions 1–4 of the 015L brief. Local code changes, migration *drafting* and isolated tests only.

**Status:**
- Local only and uncommitted. Nothing is staged, committed, pushed, deployed or migrated.
- **No SQL was executed against any database.**
- No env or credential file was read.

**Date:** 2026-10-16. **Worktree:** `C:/tmp/closure-014a`.

## 1. Repository state

| | Start (verified) | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86` | unchanged |
| Staged | 0 | 0 |
| Tracked diff | 53 files, +1612 / −314 (byte-identical to the 015K final diff) | 54 files changed, 1857 insertions(+), 320 deletions(-) |
| Untracked | 32 | 37 (32 + `supabase/proposals/` + 3 new test files + this report) |
| 015J / 015K reports | sha256 prefixes `b6d1643a` / `3246529b` | unchanged |

**015L source changes:**

| File | Change |
|---|---|
| `pages/api/super-admin/companies.ts` | Shared `activeSuperAdminCount` guard; **disable** guard (R-9b); DB-refusal → 409 on disable, soft delete and hard delete; hard delete calls the atomic function first |
| `backend/services/lifecycleGovernance.ts` | New `hardDeleteCompany` RPC wrapper; `FUNCTION_MISSING` is distinguished from real errors |
| `backend/services/rbacService.ts` | Version token (`getRbacConfigVersion`); stale-edit save through `save_rbac_config`; `RbacConfigStaleError`; exact-timestamp tie detection; untrusted-document deny-all is no longer cached |
| `pages/api/super-admin/rbac.ts` | GET returns `version`; POST takes `expectedVersion` → 409 `RBAC_CONFIG_STALE` |
| `components/super-admin/tabs/RbacTab.tsx` | Sends `expectedVersion`; adopts the version returned after a save |

**New files:**
- `supabase/proposals/closure015l/01_company_lifecycle_super_admin_guard.sql`
- `supabase/proposals/closure015l/02_assign_super_admin_rpc.sql`
- `supabase/proposals/closure015l/03_rbac_config.sql`

  These are **proposals**, deliberately outside `supabase/migrations`.
- `backend/tests/unit/closure015lDatabaseGuardsRbac.test.ts` (40 tests)
- `backend/tests/unit/closure015lRbacTabVersion.dom.test.tsx` (2 tests)
- `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts`: **written, not run**.

**Existing tests adapted** (test-side only):

| Suite | Change |
|---|---|
| `closure015iPolicyResolution`, `closure015jFinalReview`, `closure015kConcurrencyRbac` | Their supabase mock now models the **current deployment**: `save_rbac_config` is absent (PGRST202), so saves take the legacy path |
| `closure015jFinalReview`, `closure015kConcurrencyRbac` | The `lifecycleGovernance` mock gained `hardDeleteCompany` → `FUNCTION_MISSING`, so the hard-delete tests exercise the 015K statement path |
| `closure015jRbacTabSave.dom` | The expected POST body includes `expectedVersion: null` |

## 2. Company lifecycle invariant and concurrency design

### 2.1 Invariant

A company lifecycle operation — disable, soft delete, hard delete — must:
- never deactivate or delete an **active** `SUPER_ADMIN` membership;
- never complete while the company holds one, including one created or activated concurrently;
- never leave an active `SUPER_ADMIN` membership pointing at a disabled, soft-deleted or deleted company.

### 2.2 Why the application cannot close it

| Mechanism | Why it is not sufficient |
|---|---|
| Pre-check (015J) | A read in its own statement and transaction. A grant that commits after it is not seen. |
| Post-check / statement predicate (015K hard path) | Keeps the SA row alive, but cannot stop the company delete, which is a separate PostgREST statement. **RACE D (activation after the last membership statement) leaves an orphan.** |
| A single application transaction | Not available. PostgREST runs every call in its own transaction, and the app has no session-level transaction. |
| Soft delete / disable | The deactivation happens inside `disable_company_cascade`, a SQL function the route cannot add a predicate to. |

### 2.3 Membership writers that can produce an active `SUPER_ADMIN` row

| Writer | How | Governed? |
|---|---|---|
| `bootstrap-super-admin` → `assignSuperAdmin` | UPDATE an existing row to SA/active, or INSERT one | **Yes** (`identity.admin.assign` + step-up) — the only intended path |
| **`onboarding/setup-company`** paths A and the `existingRole` branch (`:232–:285`, `:456–:471`) | Activate the caller's **invited** row by id, **whatever its role** | **No — new finding R-14.** An invited SA row (they exist; 015E made them confer nothing) becomes an **active** SA through onboarding |
| `team/accept-invite`, `activate_invitation_membership` | Set `role = invitation.role`. `invitations_role_check` excludes SA, so these can never produce SA | n/a |
| Invite / role / transfer / free-credit / users-create routes | Refuse to write SA rows (015E–015J) | n/a |

**Removal paths:**
- `admin/revoke-super-admin` downgrades SA → COMPANY_ADMIN (governed);
- `disable_company_cascade` (disable, and soft delete through it);
- the hard-delete statements.

Because writers are spread across the application, the guard has to be **in the database, on `user_company_roles`**, not in any one route.

### 2.4 Design: one serialization point, the `companies` row

This is drafted in `01_company_lifecycle_super_admin_guard.sql`.

**Lifecycle side.** `disable_company_cascade` (also used by `soft_delete_company`) and the new `hard_delete_company`:
1. `PERFORM 1 FROM companies WHERE id = $1 FOR UPDATE` — **lock first**.
2. Refuse (`RAISE … 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'`, SQLSTATE P0001) if an active SA row exists. This is a fresh statement, so under READ COMMITTED it sees every grant committed before the lock was obtained.
3. Do the work in the same transaction. Disable also keeps an in-statement `RETURNING role` check as defence in depth.

**Writer side.** A trigger `BEFORE INSERT OR UPDATE OF role, status, company_id ON user_company_roles` fires only for writes that **transition** a row *into* active SA. It runs `SELECT status, deleted_at FROM companies WHERE id = NEW.company_id FOR SHARE` and refuses if:
- the company is missing: `SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING`;
- the company is not `active`, or is soft-deleted: `…_COMPANY_NOT_ACTIVE`.

**Serialization.** `FOR UPDATE` conflicts with `FOR SHARE`:

| Interleaving | Outcome |
|---|---|
| Writer first | The lifecycle step 1 waits for the writer's commit; step 2 sees the SA → **lifecycle raises; its whole transaction rolls back** (no status change, no deactivation, no `deleted_at`, no deletion) |
| Lifecycle first | The writer's `FOR SHARE` waits for the lifecycle commit, then finds `inactive` / `deleted_at` / **no row** → **write raises; nothing is written**. This closes the 015K RACE D orphan: an insert after a hard delete can no longer succeed. |
| Two writers | Both take `FOR SHARE`; no mutual blocking |
| Two lifecycle operations | Both take `FOR UPDATE`; serialized |

**Lock ordering and deadlock.**
- The lifecycle side takes the company, then memberships.
- A writer **UPDATEing an existing membership** takes the membership row lock first (the row lock is taken before BEFORE ROW triggers fire), then the company lock.
- With opposite orders, a deadlock is possible: lifecycle holds the company → writer locks row M and waits for the company → lifecycle's cascade reaches M.
- Postgres detects this (SQLSTATE 40P01, after `deadlock_timeout`) and aborts **one** transaction. **Both outcomes preserve the invariant:**
  - writer aborted → M was never an active SA;
  - lifecycle aborted → nothing changed, and the SA stays active.
- It is a liveness cost, not a safety gap.
- `02_assign_super_admin_rpc.sql` (recommended) removes it for the governed writer: one function locks the company `FOR SHARE` **before** the membership row, the same order as the lifecycle side, and replaces `assignSuperAdmin`'s non-atomic read-then-write.
- A non-governed writer that still updates rows directly keeps the deadlock-but-safe behaviour.
- INSERTs never deadlock with it: there is no prior row lock.

**Rollback behaviour:**
- Every refusal is a RAISE inside the RPC transaction, so there are no partial effects.
- The hard-delete function also makes the previously three-statement deletion atomic. A non-cascading FK (`users.active_company_id`, `whatsapp_broadcasts`, `whatsapp_media_cache`, `whatsapp_templates`, `campaign_cost_breakdown`: 5 of the 238 FKs to `companies`; 224 cascade, 9 set null) now rolls back everything (23503). Previously it left memberships and the profile deleted.

**Not required for safety, owner options:**
1. Also refuse **non-governed** SA activation in the trigger (closes R-14 at the database). For example, require a transaction-local GUC that only `assign_super_admin` sets. Seed and fixture scripts that insert SA rows directly would then need to use the RPC.
2. App-side R-14 fix: onboarding must not activate an invited row whose role is SUPER_ADMIN.

**Owner decision embedded in the trigger:** activation is refused for `status <> 'active'`, which includes `suspended` and `inactive`. A super admin cannot be granted into a disabled company until it is re-enabled.

### 2.5 Hard-delete orphan race — resolution

| | 015K (application only) | 015L |
|---|---|---|
| Bulk delete vs a concurrent grant | SA row kept (statement predicate) | Same, in the function |
| Activation after the last membership statement (RACE D) | **Company deleted, SA row orphaned** | **Refused by the writer guard** (company row locked, then gone → `…_COMPANY_MISSING`) |
| Activation before the lock | Pre-check or post-check catch it, or 409 | The function raises; nothing deleted |

**Status:**
- **Resolved by design** once `01_…` is applied *and* the route uses `hard_delete_company`.
- The route already prefers the function. It falls back to the 015K statement path **only** when PostgREST reports it missing (PGRST202 / 42883). Any other function error is a 500 with `partial: false` and no fallback.
- **Until the migration is deployed, the RACE D residual remains.** It is not claimed closed.

## 3. Soft-delete and disable guard behaviour (application, defence in depth)

| Operation | Application guard | Database refusal (after migration) |
|---|---|---|
| **Disable** (`PATCH status=inactive`) | **NEW (R-9b):** active SA → **409 `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`**; cascade not called. Lookup failure → **503**. Inactive/invited SA rows do not block. | RPC error → **409** (was 500 `CASCADE_FAILED`); other RPC errors stay 500 |
| **Soft delete** | 015J pre-check (now the shared helper) | RPC error → **409**; no success audit |
| **Hard delete** | 015J pre-check, then `hard_delete_company` | 409 / 404 `COMPANY_NOT_FOUND` / 500 (rolled back) |
| Authorization | Unchanged: `IDENTITY_ADMIN_ASSIGN` (PATCH) / `ORGANIZATION_DELETE` (DELETE), step-up. A company admin gets 403. | — |

The application guard is a read and cannot be atomic. It gives a clear error in the common case; **the database guard is the concurrency boundary.**

## 4. Proposed SQL and preconditions (not executed)

| File | Content |
|---|---|
| `01_company_lifecycle_super_admin_guard.sql` | Trigger function + trigger; `disable_company_cascade` (baseline body plus a lock-first refusal and in-statement check); `soft_delete_company` unchanged (inherits through the cascade); new `hard_delete_company`; grants (service_role only); manual rollback |
| `02_assign_super_admin_rpc.sql` | Recommended governed writer: company lock first, then the membership row |
| `03_rbac_config.sql` | §5 |

**Preconditions (operator; read-only unless stated):**
1. `pg_get_functiondef` of production `disable_company_cascade` and `soft_delete_company` equals `baseline.sql`. `01_…` replaces the cascade body wholesale.
2. List the active SA memberships per company. Those companies become non-disableable and non-deletable until the governed revoke; that is the approved policy.
3. Check that no active SA row already sits in a non-active or soft-deleted company. The trigger only fires on transitions, but the operator should know.
4. Seeds, fixtures and scripts that insert or activate SA rows directly must target an active company. This includes `scripts/ci/schema-bootstrap.sql` and cert seeding.
5. Run `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts` on a **disposable** database (`npm run test:realschema -- closure015l`). It applies the proposals to that throwaway database.
6. Then promote to a dated migration, apply under PR281 discipline (ledgered), deploy the route changes, and run the same suite on cert.

**Rollback:**
- Drop the trigger, its function and `hard_delete_company`, then re-apply the baseline cascade body. That restores the race.
- No data is migrated.

## 5. `rbac_config` schema, stale-edit semantics, recovery

**Actual contract (derived from code):**

| Aspect | Detail |
|---|---|
| Table | `public.rbac_config` through `ownedDbTable` |
| Columns used | `roles`, `permissions`, `updated_by` (written), `updated_at` (written; the read key) |
| Read | `order(updated_at desc).limit(2)`, plus a tie query, 30 s per-process cache |
| Write | Append one row per save |
| Validation | `validateRbacConfigInput` (015J) |
| Fail-closed read | 015K, extended here |

**Schema design** (`03_rbac_config.sql`, VARIANT A: the table does not exist):

| Item | Design |
|---|---|
| Columns | `roles jsonb NOT NULL`, `permissions jsonb NOT NULL`, `updated_by uuid NULL`, `updated_at timestamptz NOT NULL`. These exactly match the code. **One added column, `version bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`**: the concurrency token required by decision 3. |
| Constraints | CHECKs mirroring the structural write rules (non-empty array / non-empty object). Finer rules stay in the app. |
| Access | RLS on with no policies; `REVOKE` from anon/authenticated; service_role only. After the app uses the RPC, `REVOKE INSERT` from service_role (step 3; owner timing). |
| Initial state | **No seed row.** An empty table means the built-in defaults: today's behaviour, no widening, no invented configuration. |
| `save_rbac_config(p_roles, p_permissions, p_updated_by, p_expected_version)` | `pg_advisory_xact_lock(hashtext('public.rbac_config'))` serializes **every** save across all instances. Then, if `p_expected_version IS DISTINCT FROM` the newest version → `RAISE 'RBAC_CONFIG_STALE'` (DETAIL = current version). Otherwise insert with a strictly increasing `updated_at`, so the existing updated_at-ordered read equals version order equals commit order. |

**Owner flags:**
- an FK on `updated_by` (not added, so history survives user deletion);
- the timing of step 3.

**Application semantics (implemented, forward-compatible):**

| Case | Behaviour |
|---|---|
| GET | Returns `version`: the newest stored version, or `null` for the defaults, a legacy row, a read failure or an absent table |
| POST | `expectedVersion` (positive integer or null/absent; anything else → **400 `RBAC_EXPECTED_VERSION_INVALID`**) is passed to the function |
| Stale | → **409 `RBAC_CONFIG_STALE`** `{ currentVersion }`; nothing written; the cache is untouched |
| Function absent (current deployment) | Legacy append (015J monotonic `updated_at`), `version: null`. **Stale edits cannot be detected there**, because no version exists. |
| Any other function error | 500, **no fallback** to the unguarded insert |
| UI | `RbacTab` sends the version it loaded, adopts the server's version after a save, and shows the 409 through the standard super-admin write banner |

**Cache:**
- A local save clears the cache.
- Other instances converge within the 30 s TTL. No cross-instance invalidation exists, and none was added.
- Ties are now detected by **exact** `updated_at` string, so microsecond-distinct rows are no longer treated as tied.

**Rollback limitations:**
- VARIANT A: dropping the table loses every saved configuration.
- VARIANT B (an existing table, documented in the file) adds `version` with an **explicit** `updated_at` backfill order, not physical order, and validates CHECKs `NOT VALID` → `VALIDATE`. Rollback drops the column and function, and the code must revert with it.

**Production:** do **not** assume the feature works there. 015K found no evidence the table exists. An authorized operator must verify the deployed schema (§8).

## 6. Malformed configuration and recovery (decision 4)

| Stored state | Effective tenant permissions |
|---|---|
| Untrusted whole document (015K rules) | **Deny-all.** 015L: **no longer cached**, and never stored as the last trusted config, so a repair saved by another instance takes effect on the next check (malformed reads do not poison the cache) |
| Malformed individual entries | Narrowing only (unknown roles dropped; a malformed value grants nobody) |
| Failed read | The last config **this process validated**, else deny-all; not cached |
| Missing table | Built-in defaults (unchanged; nothing narrower can exist) |

**Recovery:**
- The governed `POST /api/super-admin/rbac` is gated by `requireCapability(identity.admin)` with step-up, **not** by `hasPermission`.
- A company admin is refused (403) even while deny-all is in force.
- With the versioned schema, the recovering super admin GETs the current token (the malformed row's version) and saves with it.

## 7. Tests and results

| Run | Result |
|---|---|
| `closure015lDatabaseGuardsRbac` (final code) | **40 / 40** |
| `closure015lRbacTabVersion.dom` | **2 / 2** |
| Earlier suites after adaptation (`015I`, `015J`, `015K`, `015J` DOM, `closure013PlatformTierWriteSiblings`) | **796 / 796** |
| 015L suites on the **pre-015L** source (5 files swapped in, restored and sha256-verified, tree byte-identical) | **23 fail / 14 pass**. The 14 that pass are controls (ordinary disable, inactive SA, authorization, other cascade failure, pre-check order, statement path), the static SQL-structure tests (proposal files not swapped) and the UI no-success check. *(The wrapper tests were added after this run.)* |
| Mutation (hardened: clean baseline, KILLED = a failing test, files sha256-verified) | **20 / 20 killed** (26 suites, 1356 tests; baseline clean; 0 survivors). L1–L7 route guards and refusal mapping; L8–L9 the hardDeleteCompany wrapper; L10–L15 stale-edit path (route mapping, detection, no fallback on real errors, expectedVersion validation and passing, cache clear); L16–L17 cache non-poisoning; L18–L20 version token (GET, UI send, UI adopt). |
| Gate (015K set + 015L suites), same placeholder env | 354 suites: **15 failing suites / 53 failing tests**, 2 skipped, 7900 passing, **0 load failures** |
| `node scripts/typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259 (no net-new identities; the realschema file type-checks) |
| `node scripts/check-migration-quality.js` | **OK**: 70 new valid, 353 frozen, 0 violations. Unchanged: the proposals are outside `supabase/migrations`; 015L adds no migration. |
| `npm run typecheck` | **3/3 projects clean** |

**Commands:** `CI=true` plus the 015J/015K hermetic env (loopback addresses on unreachable ports, dummy keys); `node node_modules/jest/bin/jest.js --runInBand --forceExit <suites>`.

**Not run:** `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts`. It needs a database, which was not authorized. **No in-memory result here proves Postgres locking, isolation or deadlock behaviour.** The unit suite checks the proposal SQL's *structure* only: lock before membership statements, FOR SHARE in the trigger, delete order, grants, advisory lock, nothing in `supabase/migrations`.

**Regression versus the Closure-015K gate (same env, by test name): 0 new failures, 0 newly passing.** The 53 failures are identical to 015K, which were identical to the pre-015J tree, including the real pre-existing `governance_performance_guard` overlap bug (015K §6). The 015J host-stall timeout did not recur. The tracked diff was byte-identical after mutation and all gates.

## 8. Required real-Postgres and operator-only evidence

**Real-Postgres (disposable database; `closure015l_company_lifecycle_guard.test.ts`):**

| Case | Expected |
|---|---|
| Writer first (UPDATE to SA, and INSERT) vs disable / soft delete / hard delete | Lifecycle blocked, then **P0001 `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`**; SA still active; company unchanged |
| Lifecycle first vs writer: hard delete → INSERT (RACE D) | **`…_COMPANY_MISSING`**, **no orphan** |
| Soft delete → UPDATE | `…_NOT_ACTIVE` |
| Disable → INSERT, then re-enable | Grant allowed again after re-enable |
| Deadlock window | Exactly one transaction gets 40P01; no active SA is deactivated or orphaned |
| Ordinary operations | Succeed; an inactive SA row does not block and is removed by hard delete |
| A non-cascading FK | Rolls back everything (23503) |
| No-transition update or governed revoke in a disabled company | Allowed |
| `save_rbac_config`, concurrent first saves | Second blocks on the advisory lock, then `RBAC_CONFIG_STALE` |
| `save_rbac_config`, sequential saves | Versions 1, 2, 3 with strictly increasing `updated_at` |
| `rbac_config` CHECKs | Enforced (23514) |

**Operator, production read-only:**
1. `to_regclass('public.rbac_config')`, its columns and types, rows that would be untrusted (deny-all on deploy). This selects VARIANT A or B.
2. `pg_get_functiondef` of `disable_company_cascade` / `soft_delete_company`.
3. Active SA memberships per company; SA rows in non-active or soft-deleted companies; **invited SA rows** (R-14 exposure).
4. **R-15:** whether production `companies_status_check` matches the baseline (`active|inactive|suspended`). If it does, `archive-abandoned`'s `status='archived'` fails on every call.

## 9. New findings

| ID | Finding | Status |
|---|---|---|
| **R-14** | `onboarding/setup-company` activates an **invited** membership without checking its role, so an invited SUPER_ADMIN row becomes active outside `identity.admin.assign` | Not fixed (outside 015L scope). DB option §2.4.1, app option §2.4.2 |
| **R-15** | `archive-abandoned` writes `companies.status = 'archived'`, which `companies_status_check` (baseline: `active, inactive, suspended`) does not allow | Not fixed; operator evidence §8.4; owner decision (add `archived` to the CHECK, or use `inactive` + `deleted_at`) |
| `governance_performance_guard` | Pre-existing check-then-await overlap bug (015K §6) | Unchanged |

## 10. Remaining release blockers

1. Nothing is committed. The 015C–015L series needs commit authorization, review and a PR.
2. **Authorization to promote** `01_…` (and `03_…`, optionally `02_…`) into dated migrations, followed by the §8 real-Postgres suite on a disposable database and on cert. Until then:
   - the soft-delete/disable race is closed only by the application pre-check (not atomic);
   - the hard-delete RACE D orphan remains.
3. Operator schema evidence for `rbac_config` (§8.1). The RBAC feature, its stale-edit detection and the fail-closed read are unverified in production.
4. Owner decisions:
   - non-active-company refusal in the trigger (§2.4);
   - R-14 enforcement option;
   - R-15;
   - the FK on `updated_by` and INSERT revocation timing (§5);
   - adoption of `assign_super_admin` (deadlock removal).
5. Browser passkey verification of the step-up flows, which is unchanged from 015J/015K.
