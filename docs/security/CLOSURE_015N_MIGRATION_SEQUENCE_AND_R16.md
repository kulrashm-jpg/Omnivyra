# CLOSURE-015N — Migration Sequence Review and R-16 Repair

**Status:**
- Local only and uncommitted. Nothing is staged, committed, pushed or deployed.
- **No migration was applied to any shared or production database.**
- Every SQL execution happened inside newly created, verified, localhost-only throwaway containers.
- No env or credential file was read.

**Date:** 2026-10-16. **Worktree:** `C:/tmp/closure-014a`.

## 1. Repository state

| | Start (verified) | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86` | unchanged |
| Staged | 0 | 0 |
| Tracked diff | 57 files, +1971 / −344 (byte-identical to the 015M final diff) | **unchanged** (byte-identical; 015N changes no tracked file) |
| Untracked | 40 | 42 (40 + `closure015n_invitation_activation.test.ts` + this report; `supabase/proposals/` was already untracked, so `closure015n/` adds no new entry) |
| 015M report / 015L proposals / lifecycle realschema suite | sha256 `f1ff5e51` / `2f5fb831`, `3f4e83e5`, `59addb74` / `d57477a0` | all unchanged |

**015N files (all new, untracked):**

| File | Content |
|---|---|
| `supabase/proposals/closure015n/01_company_lifecycle_super_admin_guard.sql` | Byte-identical copy of 015L `01` |
| `supabase/proposals/closure015n/02_assign_super_admin_rpc.sql` | Byte-identical copy of 015L `02` |
| `supabase/proposals/closure015n/03_rbac_config.sql` | 015L `03` plus an explicit re-run refusal |
| `supabase/proposals/closure015n/04_activate_invitation_membership.sql` | **R-16 fix** |
| `supabase/proposals/closure015n/05_rbac_config_contract_legacy_insert.sql` | Contract step |
| `backend/tests/realschema/closure015n_invitation_activation.test.ts` | 27 real-Postgres tests |
| This report | — |

## 2. Migration sequence — review and exact order

**015M §9 reviewed:**
- Its rationale stands: each step is compatible before and after the application deploy; RBAC uses expand → verify → contract; rollback is per file.
- What changed: R-16 adds file **04**, and the RBAC contract becomes its own file **05**, so it can't be applied early by accident.

| Order | Proposed migration (unique 14-digit versions above `20261202000000`) | Kind | Old app × new DB | New app (015C–M) × old DB |
|---|---|---|---|---|
| 1 | `20261210000001_company_lifecycle_super_admin_guard.sql` ← `01` | Expand / guard | Safe. An old-app disable or soft delete of a company holding an active SA now gets a DB refusal that the old route reports as 500 (it has no 409 mapping); nothing is changed. Old hard delete (three statements) is unaffected by the trigger, which doesn't fire on DELETE. **Old onboarding R-14 is NOT closed by this** (the trigger checks lifecycle, not who grants). | Safe. Hard delete falls back to the 015K statement path; the RACE D residual remains until 1 is applied |
| 2 | `20261210000002_assign_super_admin_rpc.sql` ← `02` | Expand | Safe (the old app never calls it) | Safe (PGRST202 → the old two-statement path) |
| 3 | `20261210000003_rbac_config.sql` ← `03` (VARIANT A) | Expand | Safe. Old reads: an empty table → defaults (previously: missing table → defaults). Old legacy inserts work and get identity versions automatically (verified, S4). | Safe. The function is absent → legacy path, `version: null` |
| 4 | `20261210000004_activate_invitation_membership.sql` ← `04` | Fix (CREATE OR REPLACE, same signature) | Safe. `auth/set-password` exists in the old app too; it **starts working** (today it always fails, §3) | Same |
| — | **Deploy the application** (015C–015M) | — | — | — |
| 5 | Verify (operator check C-7, §6) | — | — | — |
| 6 | `20261210000005_rbac_config_contract_legacy_insert.sql` ← `05` | **Contract** | **Not safe for the old app:** its legacy insert then fails with 500. Apply only after **every** instance runs the new code. | Safe (the RPC path) |

**Rules that follow from the review:**
- **1–4 are order-independent with respect to the application deploy.** Among themselves the recommended order is 1 → 2 → 3 → 4: 02 relies on 01's trigger semantics for its documented behaviour, and 04 is independent.
- **6 must come last**, after the deploy has fully rolled out (Vercel switches atomically, but in-flight old instances and any Railway worker that writes RBAC must be on the new code; the worker does not write `rbac_config`, per repo-wide grep).
- **Rolling-deploy windows:**
  - (a) Old app with 1 applied: refusals surface as 500, not 409. That's cosmetic, and safe.
  - (b) New app without 1: RACE D residual (015K).
  - (c) New app without 3: RBAC saves 500 exactly as today.
  - No window weakens an invariant relative to today.

## 3. R-16 — root cause, invariant, fix, evidence

**Root cause** (reproduced on the fresh baseline, `probe` and suite `beforeAll`):
1. **42702** `column reference "company_id" is ambiguous`: `RETURNS TABLE(…, company_id, …)` makes `company_id` a PL/pgSQL variable, and the unqualified `ON CONFLICT (user_id, company_id)` collides with it.
2. **42P10** (with the ambiguity removed): no unique constraint or index matches `ON CONFLICT (user_id, company_id)`.

The function came from `20260420_lockdown_idempotency`, written against a full uniqueness that **never existed**. Effect: every invitation activation through `auth/set-password` fails.

**Schema invariant, established, not invented:**
- `20260406_multi_tenant_auth_migration` §8c created `idx_user_company_roles_user_company_active` = UNIQUE `(user_id, company_id) WHERE status = 'active'`: **at most one ACTIVE membership per user and company.**
- Non-active rows (invited, inactive, expired) may coexist.
- The invitation side already has `invitations_active_unique` (one pending invitation per `lower(email), company_id`).
- **The fix adds no constraint.** The upsert infers the existing partial index explicitly (`ON CONFLICT (user_id, company_id) WHERE status = 'active'`), and a precondition block refuses (`R16_PRECONDITION_FAILED`) if that index is missing or differs.

**Problems the baseline body would also have had, had it run, closed by `04`:**
- No single use (an accepted invitation re-activated on every call).
- No binding of `p_user_id` to the invited email.
- `DO UPDATE SET role = EXCLUDED.role` would overwrite a **SUPER_ADMIN** membership, removing platform authority outside `identity.admin.revoke`.
- An already-active member would be re-roled.
- It would activate into disabled or soft-deleted companies.

**What `04` does:**
- **Lock order:** invitation `FOR UPDATE`, then company `FOR SHARE`, then membership rows `FOR UPDATE`. Lifecycle never locks invitations, so no cycle.
- **Error codes:** `INVITATION_NOT_FOUND`, `REVOKED`, `EXPIRED`, `NOT_CONSUMED`, `ALREADY_ACCEPTED`, `USER_MISMATCH`, `ROLE_NOT_ALLOWED`, `COMPANY_NOT_ACTIVE`, `TARGETS_SUPER_ADMIN_MEMBERSHIP`, `MEMBERSHIP_ALREADY_ACTIVE`, `MEMBERSHIP_CHANGED_CONCURRENTLY`.
- **Replay:** a replay by the same accepting user with an active membership is idempotent.
- **Activation:** an existing non-active row is activated in place with the *invitation* role; otherwise insert via the partial-index inference.
- **Compatibility:** the signature and result shape are unchanged (`set-password` reads `activation.company_id`), and CREATE OR REPLACE keeps the grants.

**Regression evidence** (`backend/tests/realschema/closure015n_invitation_activation.test.ts`, 27 tests; real Postgres):

| Run | Result |
|---|---|
| **Negative control:** `c15n_ctl` = template copy with the **baseline body restored** (verified: `unqualified ON CONFLICT … DO UPDATE: true`); `C15N_SKIP_FIX=1` | **19 failed / 8 passed.** The 8 that pass are the recorders of the original 42702 and 42P10, the schema-invariant checks, the three early rejections the baseline also performs (expired, not consumed, revoked), and the re-apply check (a no-op in control mode). |
| **Fixed** (fresh baseline + sequence 01–05) | **27 / 27**, then two more full repeats: **27 / 27** each (three consecutive passes in total) |
| **SQL mutation check** (12 mutants of `04`, each applied to the throwaway DB, the suite run, the original re-applied and verified by md5) | **11 / 12 killed.** The survivor **S8** (dropping the status compare-and-set on the activating UPDATE) is **equivalent**: the rows are already held `FOR UPDATE` in the same transaction; removing that lock (**S7**) is killed. |

**Covered:**
- first acceptance;
- existing invited, inactive and expired rows activated in place;
- replay (same user idempotent; other user refused);
- expired, not-consumed, revoked and unknown invitations;
- a non-invitee;
- a disallowed role (with `invitations_role_check` dropped inside a rolled-back transaction);
- existing SUPER_ADMIN rows (active, invited, inactive);
- an already-active member;
- disabled and soft-deleted companies;
- a forced failure after the membership write (whole-function rollback);
- **concurrency:**
  - the same invitation twice (the second waits on the invitation lock, then is an idempotent replay);
  - the insert-path race against another path's uncommitted active row (waits on the partial index, then `MEMBERSHIP_ALREADY_ACTIVE`);
  - the row turned into SUPER_ADMIN concurrently;
  - the row activated concurrently;
  - a company disable committing first;
- a re-apply of `04`.

**Design correction during testing:** I first wrote a "two pending invitations for one user+company" race. The schema forbids that state (`invitations_active_unique`, 23505). It is now asserted as an invariant and replaced by the real insert-path race.

## 4. Real-Postgres validation from a clean state

**Environment:**

| Check | Evidence |
|---|---|
| Container | **New** `c15n-throwaway`, id `6b629cc23116…`, label `purpose=closure015n-throwaway`, `restart=no`, `127.0.0.1:55434` only, local image `pgvector/pgvector:pg17`, `--pull never`, anonymous volume. Docker was already running; `omnivyra-worker` does not exist (no worker container running). |
| Database | `system_identifier` **7697165753698512941** (a new cluster, different from 015M's); `public` had **0 tables** before load |
| Load | `schema-bootstrap.sql` + `baseline.sql` (0 unexpected errors) → 823 tables; 45 newer migrations, 0 failed |
| Password | Fresh random password; absent from every log (checked) |

**Commands:**
```
bash scratchpad/c15n/provision.sh      # create + identity evidence + load (isolation_evidence.txt)
bash scratchpad/c15n/sequence.sh       # S0 preconditions, S2 apply 01→04, S3 re-run, S4/S5 compatibility + contract, S6 suites
bash scratchpad/c15n/r16_runs.sh       # R-16 negative control (c15n_ctl) + fixed run
node scratchpad/c15n/sql_mutants.js    # SQL mutation check of 04
bash scratchpad/c15n/final_runs.sh     # stability repeats + cert / migration / typecheck
# suites:  W6_DB_URL=postgres://postgres:<pw>@127.0.0.1:55434/c15n \
#   node node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit <suite>
```

**Results:**

| Step | Result |
|---|---|
| S0 existing-data checks (on the fresh copy) | C-1 active duplicates 0. C-2 partial index present with the exact definition. C-3 non-active SA rows 0. C-4 active SA in non-active companies 0. C-5 `rbac_config` absent → VARIANT A. C-6 non-invitation roles in invitations 0. |
| S2 apply 01 → 02 → 03 → 04 | All exit 0 |
| S3 **re-run** each | 01, 02, 04: exit 0 (idempotent). **03: refused with `RBAC_CONFIG_ALREADY_EXISTS: public.rbac_config exists — this is VARIANT A …`** (an explicit diagnostic, not a generic 42P07) |
| S4 old-app legacy insert as `service_role` before the contract | OK, auto `version = 1` |
| S5 apply 05, re-run 05 | Exit 0 / exit 0. Legacy insert as `service_role` → **`permission denied for table rbac_config`**. Governed `save_rbac_config` as `service_role` → OK, version 2. |
| S6 015M lifecycle suite on the sequenced DB | **37 / 37**, then two more repeats: **37 / 37** each |
| S6 R-16 suite | 27 / 27 (§3) |

All 015M guarantees are re-verified on this clean, fully sequenced database:
- lifecycle protection across concurrent grant, disable, soft delete and hard delete;
- no orphaned SA;
- governed grants and lock order;
- RBAC versioned saves and stale edits across connections.

Nothing was mocked or skipped in these suites (`--verbose` lists every case).

## 5. Rollback limitations and recovery

| File | Rollback |
|---|---|
| 01 | Drop the trigger and its function plus `hard_delete_company`, and re-apply the baseline cascade. **That re-opens the race.** No data was migrated. |
| 02 | Drop the function. The app falls back automatically. |
| 03 | VARIANT A: drop the function and table, which **loses every saved RBAC config**. If 05 was applied, roll it back first. |
| 04 | Re-apply the baseline body. **That restores a function that cannot run** (42702), so rolling back R-16 means "invitation activation via set-password is broken again". No data or index changes. |
| 05 | `GRANT INSERT ON public.rbac_config TO service_role`. That re-opens the unversioned legacy write path. |

**Recovery from a partial apply:** each file is a single `BEGIN … COMMIT`. A failure leaves that file un-applied. Re-running 01, 02, 04 and 05 is safe; re-running 03 is refused with a diagnostic.

## 6. Operator checks required (production, read-only)

| ID | Check |
|---|---|
| C-1 | `SELECT user_id, company_id FROM user_company_roles WHERE status='active' GROUP BY 1,2 HAVING count(*)>1` → must be empty (the index makes this impossible if C-2 holds) |
| C-2 | `pg_get_indexdef` of `idx_user_company_roles_user_company_active` = `UNIQUE (user_id, company_id) WHERE status='active'` (04 refuses otherwise) |
| C-3 | Invited or inactive SUPER_ADMIN rows (R-14 exposure); active SA rows lacking a `super_admin_bootstrap_completed` security event |
| C-4 | Active SA rows in non-active or soft-deleted companies (the trigger only fires on transitions, but these should be reviewed) |
| C-5 | `to_regclass('public.rbac_config')` and its columns. **Absent → VARIANT A; present → VARIANT B** (03 refuses VARIANT A on an existing table) |
| C-6 | Invitations whose role is outside the invitation vocabulary (`invitations_role_check` present?) |
| C-7 | (between deploy and 05) `SELECT version, updated_at FROM rbac_config ORDER BY version DESC LIMIT 5`: new saves come from `save_rbac_config` |
| C-8 | `pg_get_functiondef` of `disable_company_cascade`, `soft_delete_company`, `activate_invitation_membership` equal the baseline (01 and 04 replace them wholesale) |
| C-9 | Seeds and scripts that insert or activate SA rows directly must target active companies |

## 7. Disposable test environment cleanup

**`c15m-throwaway` (Closure-015M): REMOVED**, after all evidence was captured and this report was otherwise complete.

Identity was re-verified immediately before removal:

| Check | Value |
|---|---|
| Container id | `96e6ee92ee7d3d2cd31d20d0fb38d679d930bc813f002a4531cfbf3e7b605454`, equal to the 015M evidence |
| State | `exited` |
| Label | `purpose=closure015m-throwaway` |
| Volume | `8bacf6170f0b86c0139b31d596fc81fd281da12676c1f3ec3e1e887e61e57e46`, Docker-labelled `com.docker.volume.anonymous`, created at the same instant as the container |
| Volume users | `docker ps -a --filter volume=…` lists **only** `c15m-throwaway` |

**Action:** `docker rm -v c15m-throwaway` (the guarded script removes only on an exact match of all five facts).

**Verification:** the container is gone and the volume is gone (`scratchpad/c15n/cleanup_precheck.log`, `cleanup.log`).

**`c15n-throwaway` (this phase): STOPPED, retained** for review. Databases `c15n` (sequenced 01–05) and `c15n_ctl` (negative control) live in its anonymous volume; id `6b629cc23116…`, `127.0.0.1:55434`, `restart=no`. Remove it with `docker rm -v c15n-throwaway` once review is finished. This phase did not remove it, because the brief authorizes removing only the 015M container.

**Untouched:** every other container (the `cert-supabase` stack, `par-test`), all images, and all other volumes and databases.

## 8. Gates

| Gate | Result |
|---|---|
| `typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259, **net-new 0** (the new realschema file type-checks) |
| `check-migration-quality.js` | **OK**: 70 new valid, 353 frozen, 0 violations. Nothing added to `supabase/migrations`; the package stays in `supabase/proposals/closure015n/`. |
| `npm run typecheck` | **3/3 projects clean** |
| Default jest regression gate | **Not re-run.** 015N changes **no tracked file** (the tracked diff is byte-identical to the 015M final), and the default jest config excludes `backend/tests/realschema/`. The 015M result (355 suites, 0 new failures versus 015L; 53 known failures including the real `governance_performance_guard` bug) therefore still describes this tree. |

## 9. Remaining blockers and exact authorization required next

1. **Promotion authorization.** Copy proposals 01–05 into `supabase/migrations/` under the versions in §2. That is a repo change requiring commit and PR authorization.
2. **Cert / staging application authorization.** Apply 01 → 04 to the cert database, run both realschema suites plus the negative controls there (`W6_DB_URL` = cert, which must be disposable or approved).
3. **Production authorization**, after the C-1…C-9 evidence:
   - apply 01 → 04 (PR281 discipline: applied **and** ledgered; `NOTIFY pgrst, 'reload schema'`);
   - deploy the 015C–015M application;
   - verify C-7;
   - apply 05.
4. **Commit, PR and merge authorization** for the whole 015C–015N series (nothing is committed).
5. **Still open from earlier phases:**
   - browser passkey verification of the step-up flows;
   - the optional DB-level "governed-only SA grant" GUC (015L §2.4.1);
   - the `governance_performance_guard` overlap bug.
