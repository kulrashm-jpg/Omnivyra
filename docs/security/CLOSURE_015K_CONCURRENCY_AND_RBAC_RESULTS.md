# CLOSURE-015K — Remaining Concurrency and RBAC Blockers

**Status:** local only and uncommitted. Nothing is staged, committed, pushed, deployed or migrated. There was no production access and no database query. No env or credential file was read.

**Date:** 2026-10-16.

**Worktree:** `C:/tmp/closure-014a`.

## 1. Repository state

| | Start (verified) | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86969c…` | unchanged |
| Staged | 0 | 0 |
| Tracked diff (015C–K combined) | 53 files, +1488 / −310 (byte-identical to the 015J final diff) | 53 files, +1612 / −314 |
| Untracked | 30 | 31 (+ the 015K suite; + this report) |
| 015A–015J reports | sha256 prefixes recorded at start (015J `b6d1643a`) | unchanged |

**015K changes:**

| File | Change |
|---|---|
| `pages/api/super-admin/companies.ts` | R-9 hard-delete race fix |
| `backend/services/rbacService.ts` | C: fail-closed stored-config read |
| `backend/tests/unit/closure015iPolicyResolution.test.ts` | One test updated: it pinned the superseded "malformed document → defaults" contract |
| `backend/tests/unit/closure015kConcurrencyRbac.test.ts` | New, 28 tests |

The diff stat above covers tracked files only; the 015I suite is untracked.

## 2. R-9 — company deletion concurrency

### 2.1 Traced mechanism

**Creating or activating a SUPER_ADMIN membership.** The only path is `bootstrap-super-admin` → `assignSuperAdmin` (`identity.admin.assign` + step-up).

- If the user already has a row in the target company, it is UPDATEd by id to `role='SUPER_ADMIN', status='active'`.
- Otherwise a new `SUPER_ADMIN`/`active` row is INSERTed.
- Each write is a single PostgREST statement in its own transaction.
- The role value is always the exact string `'SUPER_ADMIN'`.
- No other path can produce one: invitation acceptance applies `invitation.role`, and `invitations_role_check` excludes SUPER_ADMIN; the 015E–J routes refuse SA grants.

**Revoking.** `admin/revoke-super-admin` downgrades to COMPANY_ADMIN (015J R-10).

**Deleting, soft (default).** `softDeleteCompanyWithCascade` → RPC `soft_delete_company` (baseline.sql:4466). This is one plpgsql function, so one transaction. It calls `disable_company_cascade`:

- `UPDATE companies SET status='inactive'`;
- `UPDATE user_company_roles SET status='inactive' … WHERE company_id=$1 AND status='active'`, deactivating **every** active membership, SUPER_ADMIN included;
- revokes the affected users' sessions;
- then sets `companies.deleted_at`.

**Deleting, hard (`hard=true`).** Three independent app-side statements:

1. `DELETE user_company_roles WHERE company_id` (before 015K);
2. `DELETE company_profiles`;
3. `DELETE companies`.

There is **no FK** from `user_company_roles.company_id` to `companies`; only `user_id` has a foreign key.

**The 015J R-9 guard** is a read-only pre-check in the route: `SELECT … WHERE company_id AND status='active'`. It runs with no lock and in a different transaction from every deletion statement.

### 2.2 The precise race

There are two transactions. T1 is the route's pre-check plus the deletion; T2 is `assignSuperAdmin`.

| Step | Event |
|---|---|
| T1-a | Pre-check sees no active SUPER_ADMIN. |
| T2 | Commits: an existing row becomes SUPER_ADMIN/active, or a new active SA row is inserted. |
| T1-b soft | The cascade `UPDATE … WHERE status='active'` deactivates the new SA row: **platform authority is removed**. |
| T1-b hard | `DELETE … WHERE company_id` deletes it: **platform authority is removed**. |

No application pre-check can close this, because the check and the write are different statements in different transactions.

One edge is **not** a bypass: under READ COMMITTED, a row T2 inserts and commits *after* T1's statement snapshot is invisible to that statement and remains active.

### 2.3 What was fixed, and what cannot be fixed in the application

**Hard path: FIXED, statement-atomic (`companies.ts`).**

- The bulk `DELETE` now carries `AND role <> 'SUPER_ADMIN'`. Within that one statement, no SUPER_ADMIN row is ever deleted:
  - a row being concurrently UPDATEd to SUPER_ADMIN is re-evaluated against the predicate once its row lock is released (Postgres EvalPlanQual), so it is not deleted;
  - an inserted SA row has `role='SUPER_ADMIN'` and is not deleted.

  This relies on `assignSuperAdmin` writing the exact upper-case value (verified at `bootstrap-super-admin.ts:83`). A pre-existing *active* case-variant row is caught by the case-normalized pre-check.
- The leftovers are then re-read. An **active** SUPER_ADMIN leftover → **409 `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`** with `{partial:true, completed:['memberships_deleted']}`; the company is **not** deleted.
- Every other leftover (for example the inactive SA row, which confers nothing) is deleted **one by one**, conditional on `id + role + status` as read. A row activated in between matches nothing → **409 `STALE_MEMBERSHIP` (partial)**; the row is kept and the company is not deleted.
- **Residual, documented by test RACE D:** an activation that commits after the last membership statement leaves the company deleted. The new SA row is **never removed**, so authority stays intact, but it is orphaned.
- **Partial-operation behaviour:**
  - non-SA memberships deleted before an abort stay deleted (the hard path is not transactional; this was already so before 015K);
  - every abort reports `partial` + `completed` truthfully;
  - a bulk-delete error → 500 before anything else changes;
  - a re-read error → 503 (partial);
  - the company row is never deleted after an abort.

**Soft path: NOT closable in the application. A database-side enforcement design is proposed (§2.4).** The deactivation runs inside `disable_company_cascade`, so the route cannot add a predicate to it. A compensating re-activation after the RPC would not be atomic: sessions would already be revoked, and `session_revoked_after` bumped. It was deliberately **not** implemented. The suite contains a labelled **characterization** test that models the cascade exactly and pins this residual, rather than claiming a fix.

**New finding — R-9b.** `PATCH /api/super-admin/companies` (disable) calls `cascadeDisableCompany` → the same `disable_company_cascade`, with **no SUPER_ADMIN pre-check at all**. Disabling a company that holds an active SA membership deactivates it. The same DB guard (§2.4) covers both paths. An app-level pre-check like R-9's is an option for the owner; it was not added because it is outside this brief's scope.

### 2.4 Proposed database enforcement (not applied; needs authorization)

**Smallest atomic change:** detect SUPER_ADMIN rows in the **same statement** that deactivates them, and abort the whole transaction. Any row the cascade would deactivate is then checked under the statement's own row locks. Rows it cannot see stay active.

```sql
-- migration: 2026XXXXXXXXXX_cascade_refuses_super_admin.sql   (PROPOSAL — not in supabase/migrations)
CREATE OR REPLACE FUNCTION public.disable_company_cascade(p_company_id uuid, p_actor uuid, p_reason text)
RETURNS TABLE(affected_users integer, revoked_roles integer, revoked_sessions integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_affected_users INTEGER := 0; v_revoked_roles INTEGER := 0; v_revoked_sessions INTEGER := 0;
  v_super_admins INTEGER := 0;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_NULL_COMPANY'; END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_MISSING_REASON'; END IF;

  -- serialize concurrent disables/deletes of the same company
  PERFORM 1 FROM companies WHERE id = p_company_id FOR UPDATE;
  UPDATE companies SET status = 'inactive' WHERE id = p_company_id;

  WITH affected AS (
    UPDATE user_company_roles
       SET status = 'inactive', deactivated_at = v_now, updated_at = v_now
     WHERE company_id = p_company_id AND status = 'active'
    RETURNING user_id, role
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE UPPER(TRIM(role)) = 'SUPER_ADMIN')
    INTO v_revoked_roles, v_super_admins FROM affected;

  IF v_super_admins > 0 THEN
    -- aborts the WHOLE transaction: no membership, session or company change survives
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' USING ERRCODE = 'P0001',
      DETAIL = format('%s active SUPER_ADMIN membership(s); revoke through identity.admin.revoke first', v_super_admins);
  END IF;

  -- … unchanged remainder (affected_users / sessions) …
END $$;
```

- `soft_delete_company` needs no change: it calls the cascade, and the exception rolls back its `deleted_at` update too.
- The route must map the RPC error `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP` to 409, for both soft delete and disable. That is a small app change, to be made together with the migration.

**Prerequisites and evidence (operator):**

1. Confirm the production definitions of `disable_company_cascade` and `soft_delete_company` match `baseline.sql`: `pg_get_functiondef`, read-only.
2. Count companies holding active SUPER_ADMIN memberships. They become undeletable and undisablable until revoked; that is the intended policy.
3. Confirm no caller relies on disabling an SA's company to remove SA authority.
4. Replay the migration in the cert stack (`baseline.sql` + newer) and run a **real two-session Postgres test**:
   - session A: `BEGIN; UPDATE … SET role='SUPER_ADMIN', status='active' …` (held open);
   - session B: `SELECT soft_delete_company(…)` blocks on the row lock;
   - A commits;
   - B must raise and roll back.

   Then repeat with the INSERT variant, and with A committing before B starts.

**Concurrency semantics:**

- READ COMMITTED.
- A row being updated concurrently is re-checked after its lock is released, so it is caught.
- A row inserted and committed after the cascade statement starts is not seen and stays active. The invariant (SA authority is never removed by deletion) holds.

**Rollback limitation:** `CREATE OR REPLACE` back to the baseline body restores the old behaviour, including the race. No data migration or backfill is needed.

**Optional hardening:** extend the same proposal to the hard path by moving hard delete into one SQL function.

## 3. R-11 / R-12 — RBAC configuration persistence

| Question | Finding |
|---|---|
| What the code expects | `public.rbac_config` with columns `roles` (array/jsonb), `permissions` (jsonb object), `updated_by`, `updated_at`. Append-only rows; latest by `updated_at`. Accessed through `ownedDbTable('rbac_config')`. |
| Schema in this repository | **None:**<br>• not in `supabase/migrations` (453 files);<br>• not in the 823-table production-derived `supabase/_schema/baseline.sql` or `baseline.json`;<br>• not in the write-owner registry, `scripts/ci/schema-bootstrap.sql`, CI or the cert fixtures.<br>`git log --all -S rbac_config -- '*.sql'` finds **no SQL file ever**. The code has referenced the table since `760a3d24` (2026-02-10). |
| Managed outside the repo? | No evidence that it is: no external-schema note, no Studio-managed marker. Given that the production-derived dump lacks it, the most likely state is **the table does not exist in production**. That is unverified (§8). |
| If absent | `getRbacConfig` gets PostgREST `PGRST205` → built-in defaults (kept by 015K, see §4). `saveRbacConfig` fails → 500. RBAC customisation has therefore **never been functional**; separately, the RbacTab UI could never save (015J). |
| Ordering mechanism | Client-issued `updated_at`:<br>• 015J made it strictly increasing per process and after the newest row read;<br>• ties are resolved deterministically;<br>• in-flight loads cannot re-cache stale config.<br>**Not durable across processes or concurrent transactions:** two instances that read the same newest row can issue the same or skewed timestamps. There is no DB-assigned order and no compare-and-set, so a lost update between two concurrent super-admin edits is undetected. |
| Migration needed? | **Yes**, if RBAC customisation is meant to work at all: the table must exist. And yes for durable ordering. |

**Proposed migration** (not added to `supabase/migrations`; needs authorization):

```sql
-- 2026XXXXXXXXXX_rbac_config.sql   (PROPOSAL)
CREATE TABLE IF NOT EXISTS public.rbac_config (
  version     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- durable DB-assigned order
  roles       jsonb  NOT NULL CHECK (jsonb_typeof(roles) = 'array' AND jsonb_array_length(roles) > 0),
  permissions jsonb  NOT NULL CHECK (jsonb_typeof(permissions) = 'object' AND permissions <> '{}'::jsonb),
  updated_by  uuid   NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rbac_config ENABLE ROW LEVEL SECURITY;   -- service role only (ownedDbTable); no anon/auth policies
REVOKE ALL ON public.rbac_config FROM anon, authenticated;
```

**Code changes that ship with it:**

- read `order('version', desc).limit(1)` instead of `updated_at`;
- optional optimistic compare-and-set: the client sends the `version` it edited, and the save inserts only if the newest version still equals it, else 409 `RBAC_CONFIG_STALE`. That needs a small SQL function, or an INSERT … SELECT guarded by a check.

**Preconditions:**

1. Operator confirms whether `rbac_config` exists: `to_regclass('public.rbac_config')`, its columns and types, row count.
2. If it exists with a different shape, the migration must be rewritten as an `ALTER`. Backfill would add `version` by `updated_at` order (`ALTER … ADD COLUMN version bigint GENERATED … IDENTITY` assigns in physical order, so it must be ordered explicitly). Rows that fail the CHECKs must be listed and fixed first.
3. Ledger the migration according to `PR281` discipline.

**Rollback:** drop the table (data loss) if it was created by this migration. A `version` column, if added to an existing table, can be dropped; the code must then be reverted together with it.

## 4. Malformed stored configuration — explicit fail-closed policy (C)

**Before 015K:**

- a whole-document shape error → built-in defaults;
- a DB read error → defaults, cached 30 s;
- all-blank keys → defaults.

The defaults can be **wider** than a narrowed stored config: for example, they grant COMPANY_ADMIN `CREATE_USER`/`ASSIGN_ROLE` after an operator removed them.

**Implemented (`rbacService.getRbacConfig`):**

| Stored state | Effective config |
|---|---|
| Table missing (`PGRST205` / `42P01`) | Built-in defaults. Nothing narrower can have been stored, and deny-all here would disable every tenant permission platform-wide while table existence is unknown. |
| No row | Built-in defaults (never configured) |
| **Untrusted document**: `roles` not a non-empty array of strings; `permissions` not a non-empty plain object; or no usable permission key | **DENY-ALL** (every configurable permission false for every role), cached for the 30 s TTL |
| Other read failure | The last config this process trusted, else **DENY-ALL**. **Not cached**: the next check reads again. |
| Entry-level problems | Narrowing only, as before: unknown role names dropped; a malformed value grants nobody (015J); a stored wildcard on CREATE_USER/ASSIGN_ROLE dropped (015I) |

**Recovery** stays available and governed:

- `POST /api/super-admin/rbac` is gated by `requireCapability(identity.admin)` with step-up, **not** by `hasPermission`, so deny-all cannot lock it out.
- A valid save clears the cache and takes effect immediately on that instance, and within 30 s on others.
- A company admin is still refused (403).
- Super-admin routes do not depend on `hasPermission`.

**Implications for the owner:**

- While deny-all is in force, tenant features gated by `hasPermission` are unavailable until a super admin saves a valid config: user creation, role assignment, campaigns, external APIs and similar.
- This is the deliberate trade-off: no silent widening.
- The missing-table branch keeps today's production behaviour if the table is absent.

## 5. Tests and results

`closure015kConcurrencyRbac.test.ts`: 28 tests, on the same in-memory harness as 015J. Races are injected between statements; the harness does **not** model Postgres locks, EvalPlanQual or isolation.

**R-9 hard path:**

- ordinary delete (all rows and the company removed);
- existing active SA (pre-check, nothing deleted);
- **RACE A:** SA re-activated before the bulk delete → kept, 409 partial, company kept;
- **RACE B:** new SA row inserted during the bulk delete → kept;
- **RACE C:** SA activated after the re-read → its conditional delete matches nothing → 409 STALE partial, kept;
- **RACE D (residual):** activation after the last membership statement → company deleted, SA row intact;
- failures (bulk-delete error 500; re-read error 503 partial).

**R-9 soft path:** one characterization test that models `disable_company_cascade` and pins the residual.

**C:**

- 10 untrusted-document shapes → deny-all, checked over every (role, permission) pair;
- entry-level narrowing;
- no row → defaults;
- missing table (`PGRST205`, `42P01`) → defaults;
- read failure without LKG → deny-all, not cached;
- read failure after a narrowed LKG → that LKG, not the defaults;
- every corruption grants a **subset** of the narrowed config;
- failed write under deny-all → 500, still deny-all;
- **recovery** by the governed save → 200 and effective;
- a company admin cannot recover (403).

| Run | Result |
|---|---|
| 015K suite (final code) | **28 / 28 pass**, with 015I + 015J: **170 / 170** |
| 015K suite on the **pre-015K** code (2 files swapped in, restored and sha256-verified, tree byte-identical) | **19 fail / 9 pass**. The 9 that pass are unchanged-behaviour controls: ordinary delete, pre-check, defaults, missing table, entry-level narrowing, array-shaped permissions (already parsed to nothing), RACE D and the soft-path characterization, which hold on both trees by design. |
| **Mutation** (hardened: 24 suites / 1314 tests; clean baseline; KILLED = a failing test; files sha256-verified after) | **15 / 15 killed** |
| Gate: 352 suites (015J set + 015K suite), same placeholder env as 015J | **15 suites / 53 tests failing**, 2 skipped, 7858 passing, **0 load failures** |
| `node scripts/typecheck-certification.js` | **PASS**: backend 0/0, backend-tests 256/259 (no net-new identities) |
| `node scripts/check-migration-quality.js` | **OK**: 70 new valid, 353 frozen, 0 violations. 015K adds no migration. |
| `npm run typecheck` | **3/3 projects clean** (tsconfig.json, tsconfig.backend.json, tsconfig.scripts.json) |

**Mutants killed:**

| Group | Mutants |
|---|---|
| R-9 hard path | K1 the bulk delete no longer excludes SA; K2 the post-delete active-SA abort removed; K3 the leftover status compare-and-set dropped; K4 a zero-row leftover delete treated as success; K5 the re-read error ignored |
| C | K6 trust check removed; K7 untrusted → defaults; K8 read error → defaults; K9 LKG ignored; K10 missing table treated as transient; K11 no usable key → defaults; K12 trusted config not remembered; K13 empty roles trusted; K14 non-string roles trusted; K15 read error cached |

### 5a. Typecheck

`npm run typecheck` on the final tree: **3/3 projects clean**. The tracked diff was byte-identical after mutation and all gates.

## 6. Regression comparison and known failures

**Versus the Closure-015J final gate, same env, by test name:**

- **0 new failures.**
- **1 no longer failing:** the `publishNowService` timeout.
- The other 53 failures are identical to 015J's final run and to its pre-015J baseline.

Classification of the two known items, from evidence rather than history:

**`governance_performance_guard` › "second call skips when first is still running" is a real pre-existing defect, unrelated to Closure-015.**

- `backend/jobs/governanceAuditJob.ts` checks `auditJobRunning`, then `await evaluateAdmission(...)`, and only then sets `auditJobRunning = true`. Two concurrent calls both pass the check, so the audit runs twice; the test expects 1 call and receives 2.
- The `await` was inserted between the check and the set by commit `27fec12d` (OMNI-GOV-002, 2026-07-19).
- Neither the job nor its test is touched by 015C–015K (empty `git diff HEAD`).
- It fails deterministically in all five gate runs: 015I, 015J pre, 015J ×2, 015K.
- Fix (not in scope): set the flag before the `await`, or reset it on the not-admitted return.

**`publishNowService.capability` › "Instagram + image post WITH media" (015J gate 3): an environmental stall, not code.**

- In that run the suite's wall time was **9 774 s**, against **78 s** and **82 s** in the other two 015J gates. That matches host suspension overnight.
- It passed 3/3 in isolation, passes in this 015K gate, and neither the test nor `publishNowService` is in the diff.
- Separate observation: about 80 s for 5 tests under the placeholder env is slow, consistent with I/O against unreachable ports.

**The other 51 failures** (13 suites, e.g. `routeAuth001Scanner`, `routeAuthOrdering`, `sec91FRouteAuthMethod`, `community_ai_*`, `recommendation_engine`, `aiRuntimeFinalValidation`) fail identically on the pre-015J tree in the same env. They were not individually root-caused in this phase.

## 7. Policy decisions required

1. **Authorize (or reject) the §2.4 DB guard.** It is the only way to close the soft-delete and disable race.
2. **R-9b:** add an app-level pre-check to the disable PATCH now (non-atomic, like R-9), or wait for §2.4.
3. **Create the `rbac_config` table** (§3 proposal), and decide whether optimistic compare-and-set on `version` is wanted.
4. **Accept the C trade-off:** an untrusted stored document means deny-all of tenant permissions until a super admin re-saves.

## 8. Operator-only checks (not performed)

1. `to_regclass('public.rbac_config')`; its columns, types, row count; the two newest rows (ties); any stored document that 015K would classify untrusted, since such a document now means deny-all on deploy.
2. `pg_get_functiondef` for `disable_company_cascade` and `soft_delete_company` versus `baseline.sql`.
3. Companies holding active SUPER_ADMIN memberships (they become undeletable by policy); orphan `user_company_roles` rows whose `company_id` has no `companies` row (left by past hard deletes).
4. 015J §7 items remain open: `/api/users/invite` access logs, archive-abandoned denials, membership anomalies, and past SA demotions by the removed R-5/R-6 code.

## 9. Release blockers

1. Nothing is committed. The 015C–015K series needs commit authorization, review and a PR.
2. The soft-delete and disable race stays open until §2.4 is authorized, applied and verified in **real Postgres** with two sessions.
3. The `rbac_config` existence and schema decision (§3). The 015J/015K RBAC fixes are latent while the table is absent.
4. Real-Postgres verification of every conditional statement (the hard-delete `neq` predicate under concurrent UPDATE, per-row conditional deletes) and browser passkey verification of the step-up flows. All evidence here is in-memory.
5. The `governance_performance_guard` overlap defect is a separate, pre-existing bug to schedule.
