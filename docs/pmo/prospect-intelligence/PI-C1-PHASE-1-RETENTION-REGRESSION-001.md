# PI-C1-PHASE-1-RETENTION-REGRESSION-001 — durable real-schema retention tests

**One new repository test file. No product-code change, no schema or migration change, no existing test file touched, no production or shared database, no provider call, no commit, push, merge or deployment. No Phase 2 work.**

> ## Result
>
> The retention verification is now **permanent repository coverage**. `backend/tests/realschema/ret_retention_pre_exclusion.test.ts` — **18 tests, all passing against real PostgreSQL** — runs in the repository's existing real-schema project, so a future change that regresses pre-exclusion, tenant-scoped deletes, short-count honesty or fail-closed reads **fails the suite**.
>
> The real-schema project went from **37 suites / 835 tests to 38 suites / 853 tests, all passing**, with no interference.
>
> Scenarios **R1–R4 and R6–R10 are VERIFIED AGAINST POSTGRESQL**; **R5 is VERIFIED AGAINST POSTGRESQL with HARNESS-ASSISTED timing**. This remains self-review, not independent verification.

---

## 1. Baseline and source hashes

Measured **2026-10-18T15:42:09+05:30 (IST)**.

| | Value |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree, start | **156 entries (72 M / 84 ??)**, inventory captured before editing |
| Working tree, end | **157 entries** — the single addition is the new test file |

**Hash gate (all four evidence reports, verified before use and unchanged at the end):**

| Report | SHA-256 (16) |
|---|---|
| `PI-C1-PHASE-1-PG-VERIFICATION-002.md` | `838729e55d21061d` — **matched the expected full hash** |
| `PI-C1-PHASE-1-F1-F2-REMEDIATION-001.md` | `f3bf6bff3bbcbd4d` |
| `PI-C1-PHASE-1-PG-VERIFICATION-001.md` | `02a7c1c9a39c66a9` |
| `PI-C1-PHASE-1-IMPLEMENTATION-001.md` | `953adb5e53185a83` |

**Phase 1 implementation files, hashed at start and byte-identical at end:**

| File | SHA-256 (16) |
|---|---|
| `backend/services/lifecycleGuardErrors.ts` | `d63e5165d127e75b` |
| `backend/types/retention.ts` | `60e9c05a8906fd8a` |
| `backend/services/retentionService.ts` | `b84a8605745130bd` |
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | `fde7e56c479a51a1` |
| `pages/api/active-leads/lifecycle.ts` | `249e2ac3943b305e` |
| `backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts` | `4a76e0c0155bb934` |

Nothing was reset, cleaned, stashed or reformatted. The frozen schedule baseline is unchanged and no float is claimed recovered (§11).

---

## 2. New test file and scope

| | |
|---|---|
| Path | **`backend/tests/realschema/ret_retention_pre_exclusion.test.ts`** |
| SHA-256 | **`23881754548d62b39b9d8179c1111438b62f41fd1f4b6f0735f1cba6c264c701`** |
| Lines | **693** · control bytes clean |
| Tests | **18**, in 11 `describe` blocks |

**In scope:** retention pre-exclusion of append-only-protected parents; confirmed deletion and counts; mixed batches; tenant scoping of both delete paths; the short-count `indeterminate` branch; fail-closed scan-count, candidate-select and protection-probe reads; empty runs; dry runs; retries; and three assertions pinning the database context the rest depend on.

**Deliberately out of scope**, per the brief: the 10 000-id scale case, policy-restricted RLS behaviour, and the wider lifecycle/B21 implementation.

**Test-only helpers added inside the file** (nothing exported, nothing shared): the `ownedDbTable` translator, a loopback isolation guard, an `asRestricted()` role switcher, and small fixture builders.

---

## 3. Why this follows the established conventions

The suite reuses the repository's real-schema infrastructure rather than importing the temporary harness wholesale. It was rewritten against the repo's own helpers, not copied.

| Convention | How this suite follows it |
|---|---|
| Project | Runs in the existing `jest.realschema.config.js` project; `testMatch` already covers `backend/tests/realschema/**/*.test.ts`, so **no config change was needed** |
| Database access | `import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup'` — the same client, tenants and transaction wrapper as every other suite |
| Isolation | **`inRollback()`**, the established pattern: every scenario is a transaction that is always rolled back, so the database is identical afterwards |
| Tenants | `seedTenants()` and the repo's deterministic synthetic `ORG_A` / `ORG_B` |
| Naming | `ret_` prefix, matching `ca_`, `ti_`, `i2l_`, `pl_`, `dl_`, `b1b_`, `aad_` |
| Driving a service through the real database | `jest.mock('../../db/writeOwner')` translating builder calls into real SQL — **exactly** the technique of `pl_prospect_lists.test.ts` and `dl_relationship_decisions.test.ts` |
| Managed-host refusal | `setup.ts`'s existing `FORBIDDEN` guard, **plus** a stricter loopback guard in this file (§7) |

**Equivalence to the successful verification (PG-VERIFICATION-002):** identical image and server (`pgvector/pgvector:pg17` → PostgreSQL 17.11), identical schema construction (bootstrap + committed baseline + 52 replayed migrations, **823** public tables), the identical seam and SAVEPOINT-per-statement model, the same product entry point (`runRetentionPolicy`), the same real `DELETE` statements and read-back assertions, and the same fixture identifier prefix. What changed is **where the test lives** — in the repository, so it is durable — and that scenarios now run under `inRollback()` rather than hand-rolled transactions.

**Why the SAVEPOINT model is required, not a convenience.** In production each `ownedDbTable` call is its own PostgREST request, hence its own transaction, so one failing call cannot poison the next. Inside `inRollback`'s single transaction a raised trigger would abort everything after it, which would make the per-item fallback untestable. Wrapping each statement in a SAVEPOINT **reproduces** production's statement-per-call isolation rather than inventing something laxer.

**This is a real-schema suite, not SQL against a mock:** the schema is the committed baseline plus every migration above its ledger position, and the properties asserted — a `BEFORE DELETE` trigger refusing a real cascade, column-level privileges refusing a real read, PostgreSQL's own affected-row count — cannot exist in a mock.

---

## 4. Scenarios R1–R10

Every scenario asserts **both** the product's return value **and** the resulting database state, read back by primary key.

| ID | Scenario | Fixtures and ownership | Expected | Actual | Status |
|---|---|---|---|---|---|
| **R1** | Protected parent survives | A: signal→feed `…021` + lifecycle `…031` (`archived`) | parent, child evidence intact; pre-exclusion prevents the DELETE | parent present, lifecycle row present, outcome `excluded_protected / append_only_child_present`, `rows_affected=0`, `status=partial`, **zero DELETE statements issued** | **VERIFIED AGAINST POSTGRESQL** |
| **R2** | Eligible parent deleted | A: signal→feed `…022`, no child | absent; count confirmed | row **absent**, outcome `deleted`, `rows_scanned=1`, `rows_affected=1`, `status=completed`, `detail='deleted=1'` | **VERIFIED AGAINST POSTGRESQL** |
| **R3** | Mixed batch | A: 1 protected + 2 eligible | protected evidence preserved, eligible processed, counts truthful | both eligible **absent**, protected parent **and** lifecycle row present, `rows_scanned=3`, `rows_affected=2`, `status=partial`; **the number of `deleted` outcomes equals `rows_affected`**, so status and per-item outcomes cannot contradict | **VERIFIED AGAINST POSTGRESQL** |
| **R4a** | Cross-tenant negative control | A: feed `…022`; **B**: feed `…024` | B's row neither deleted nor reported | B present, **absent from the outcomes entirely**, `rows_scanned=1`; the single DELETE carries `"organization_id" = $1` with `$1 = ORG_A` | **VERIFIED AGAINST POSTGRESQL** |
| **R4b** | **The DELETE predicate is load-bearing** | same | a foreign id cannot be removed by the product's own statement | the product's **exact captured SQL** was re-issued with B's id under tenant A: **0 rows returned**, B's row still present | **VERIFIED AGAINST POSTGRESQL** |
| **R4c** | Per-item fallback is also scoped | A: feed `…022`; **B**: lifecycle row pointing at it | fallback carries the predicate | the tenant-scoped probe cannot see B's lifecycle row, so the guard refuses the batch and the fallback runs; every per-item DELETE carries `organization_id = ORG_A`; row survives as `excluded_protected / append_only_guard_P0001` | **VERIFIED AGAINST POSTGRESQL** |
| **R5** | Short batch count | A: 2 eligible; one removed out of band between select and delete | no per-item retry; count-only `rows_affected`; ambiguous ids `indeterminate`; no duplicate DELETE | `rows_affected=1`; **both** ids `indeterminate`; **no** outcome is `deleted`; `detail` contains `batch_count_short_1_of_2` and `per_id_attribution_unavailable`; `status=partial`; **exactly one** DELETE issued by the product | **VERIFIED AGAINST POSTGRESQL — HARNESS-ASSISTED timing** |
| **R6** | Scan-count failure | A: 1 eligible; role with **no** privilege on the target | failed execution, no probe, no DELETE | `status=failed`, `detail` contains `scan_count_failed`, `rows_affected=0`, no outcomes, **0 probes, 0 DELETEs**, row present | **VERIFIED AGAINST POSTGRESQL** |
| **R7** | Candidate-select failure, independent | A: 1 eligible; `SELECT (organization_id, created_at)` only | reports `candidate_select_failed`; no probe or DELETE; cannot look like an empty run | `status=failed`, `detail` contains `candidate_select_failed` and **not** `scan_count_failed`, 0 probes, 0 DELETEs, row present | **VERIFIED AGAINST POSTGRESQL** |
| **R8** | Protection-probe failure | A: 1 eligible; target `SELECT, DELETE` granted, **child unreadable** | fails closed, no DELETE | `status=failed`, `detail` contains `protection_probe_failed`, every candidate `failed / protection_undetermined`, **0 DELETEs**, row present | **VERIFIED AGAINST POSTGRESQL** |
| **R9a** | Genuine empty run | policy only | truthful, distinct from a failed read | `status=completed`, **`detail=null`**, `rows_scanned=0`, `rows_affected=0`, no outcomes, 0 DELETEs | **VERIFIED AGAINST POSTGRESQL** |
| **R9b** | Dry run | A: 1 protected + 1 eligible | previews, mutates nothing | `would_delete` + `excluded_protected`, both rows present, 0 DELETEs | **VERIFIED AGAINST POSTGRESQL** |
| **R10a** | Retry after success | A: 1 eligible | nothing more deleted, nothing invented | second run `rows_affected=0`, no outcomes, `status=completed`, **no `deleted` outcome** | **VERIFIED AGAINST POSTGRESQL** |
| **R10b** | Retry over a protected row | A: 1 protected | exclusion repeats, never escalates | `excluded_protected` again, `rows_affected=0`, parent and lifecycle row both present | **VERIFIED AGAINST POSTGRESQL** |
| **R10c** | Cleanup touches nothing unrelated | A: 1 old eligible + 1 **recent** row of the same tenant | the recent row is untouched | `rows_scanned=1`, `rows_affected=1`, old row absent, **recent row present and absent from the outcomes** | **VERIFIED AGAINST POSTGRESQL** |
| — | Database context | — | the guard is real | `opp_lifecycle_block_delete` is `BEFORE` / `ROW` / `DELETE` / `tgenabled='O'`; the lifecycle FK is `confdeltype='c'`; a direct delete of a lifecycle-bearing parent raises **`P0001`** and the row survives | **VERIFIED AGAINST POSTGRESQL** |

### 4.1 Effective database role, RLS and privileges — recorded as required

The suite connects as **`postgres`, a superuser**, which bypasses **every** privilege check. R6–R8 therefore cannot induce a permission failure as that role; each creates a per-scenario role and switches to it with `SET LOCAL ROLE`.

**RLS is enabled** on `opportunity_feed_items`, `opportunity_lifecycle_states`, `retention_policies` and `retention_executions` (not forced). The role is created **`BYPASSRLS`** deliberately: without it, a role with no policy would read **zero rows instead of raising**, silently turning a permission test into an empty-result test. The bypass also matches production, where the service role bypasses row-level security — so the **privilege** boundary is the one that actually governs these reads. **No production security control was weakened, and no application exception is mislabelled as a database permission failure.**

Grants per scenario: always `USAGE ON SCHEMA public`, `SELECT` on `retention_policies`, `INSERT, SELECT` on `retention_executions`; then **R6** nothing further, **R7** `SELECT (organization_id, created_at)` on the target, **R8** `SELECT, DELETE` on the target and nothing on the child.

**R7's separation is a genuine privilege boundary:** both failing reads target the same table, so a table-level revoke cannot distinguish them. A column-level grant permits `SELECT count(*)` while refusing `SELECT "id"`, and the service reported `candidate_select_failed` — proving the two reads failed **independently**.

### 4.2 R5's label, precisely

The product's branch requires PostgreSQL to report **fewer** affected rows than ids submitted. PostgreSQL will not produce that spontaneously, so the test interleaves a genuine race: the harness deletes one eligible row out of band **after** the candidate select and **before** the batch delete, using the narrowest seam available (a single hook on the translator). PostgreSQL then produces the short count itself, truthfully.

**The harness controls only the timing.** The short count is PostgreSQL's, the decision logic is the product's, and the harness's own out-of-band delete is excluded from the product's statement log — which is what makes "exactly one DELETE issued by the product" a meaningful assertion. **It is not claimed that the database spontaneously produces the race.**

---

## 5. PostgreSQL-backed versus harness-assisted

| Basis | What rests on it |
|---|---|
| **PostgreSQL execution** | R1, R2, R3, R4a, R4b, R4c, R6, R7, R8, R9a, R9b, R10a, R10b, R10c, and all three database-context assertions |
| **PostgreSQL execution, harness-assisted timing** | **R5 only** (§4.2) |
| **Harness, not product** | the `ownedDbTable` → SQL translation; SAVEPOINT-per-statement isolation; the R5 interleaving; `BYPASSRLS` on the per-scenario role |
| **Not established** | anything about the **production** database. The suite replays migrations onto a disposable server, so a green run is **not** evidence that any migration is applied in production |

**Passing assertions are not independent review.** The same agent implemented Phase 1, found F-1 and F-2, fixed them, and wrote both the unit and real-schema suites. This is self-review.

---

## 6. Commands, exit codes and results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `bash <scratchpad>/reg-provision.sh` | **0** | container created; binding **`127.0.0.1:59861`**; **823** public tables; **52/52** migrations replayed, 0 failures; baseline restore 157 s, replay 155 s |
| 2 | `node ./node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit --testPathPattern 'ret_retention_pre_exclusion'` | **0** | **1 suite / 18 tests — 18 passed**, 9.3 s |
| 3 | `node ./node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit` (whole project) | **0** | **38 suites / 853 tests — all passed**, 118.9 s |
| 4 | `node ./node_modules/jest/bin/jest.js backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts --runInBand --forceExit` | **0** | **1 suite / 56 tests — 56 passed** |

**No failed attempt to report for this task.** The suite passed on its first execution, 18/18. That is because the scenarios were already proven against PostgreSQL in PG-VERIFICATION-002 and were rewritten onto the repository's own helpers rather than designed afresh — the earlier task is where the failures and corrections happened, and they are recorded there. Exit codes were captured directly, not through a pipe. `scripts/ci/real-schema-ci.sh` was **not** used as the pass signal, because it exits 0 even when the suite fails.

**Regression value, measured:** the real-schema project was **37 suites / 835 tests** before and is **38 suites / 853 tests** after — the new suite's 18 tests, with **zero** interference in the other 37.

---

## 7. Isolation and cleanup evidence

| Check | Result |
|---|---|
| Container created by this run | **yes** — name checked for pre-existence first; the script refuses rather than reuse or force-remove |
| Full container id | **`dbc46ba78d5a92246ede15b9593fc2f4bd101ea9be7bf87f58699fda8fe42def`** |
| Image / restart policy | `pgvector/pgvector:pg17` · **`restart=no`**, read back from `docker inspect` |
| **Host-side binding, asserted before connecting** | **`127.0.0.1:59861`** — a non-loopback binding would have removed the container and stopped without connecting |
| Connection target | the expected disposable instance: provisioning via `docker exec <id>` (no hostname, no connection string); the test run over loopback TCP with that exact port |
| Accidental selection of a shared database | **impossible from two independent directions** — `setup.ts`'s `FORBIDDEN` guard refuses managed hosts, and **this suite adds a stricter guard** that throws unless `W6_DB_URL` matches `@(127.0.0.1\|localhost\|[::1]):port/`, with the reason stated in the error. That guard is now **durable repository code** |
| `cert-supabase` | **never connected to, modified, stopped or removed**; 11 containers before and after; total running containers 11 |
| Fixture identifiers | reserved `c0ffee00-…` prefix plus `migration_source='ret-regression'`; every scenario wrapped in `inRollback()` |
| **Residue after all 38 suites** | reserved feed rows **0**, lifecycle rows **0**, `ret-regression` signals **0**, policies **0**, `retention_executions` **0**, role `ret_restricted` **0** |
| Teardown | removed by **full container id**, never by name, wildcard or port; `docker inspect` confirms **absent**; no `reg-retention` container remains |
| Broad cleanup commands | **none** — no prune, no name globbing, no port matching |
| Temporary files | the provisioning script, container-id, db-url and scratch logs **removed**; two evidence logs retained for this report |

---

## 8. Checks not run, and remaining gaps

| Item | Status |
|---|---|
| 10 000-id batch at `MAX_DELETE_BATCH` scale | **NOT RUN** — excluded by this brief; a PostgREST URL-length limit at scale stays **UNVERIFIED** |
| Policy-restricted RLS behaviour (no `BYPASSRLS`) | **NOT RUN** — excluded by this brief; §4.1 explains why it would otherwise confound the privilege tests |
| Wider lifecycle / B21 implementation (`readCurrentLifecycleState`, `isResolvedForAccountDeletion`, the SQLSTATE classifier, route responses) | **UNIT-TESTED ONLY** — excluded by this brief; still the largest coverage gap |
| Concurrency beyond R5's single interleaving | **NOT RUN** |
| Production behaviour | **UNVERIFIED**, and nothing here speaks to it |
| Independent review | **NOT RUN** |
| CI wiring | **NOT RUN / NOT AUTHORIZED.** The suite is picked up automatically by `jest.realschema.config.js`, so it runs wherever that project runs — but whether the `Real-Schema CI` job's configuration needs any change was **not** inspected, because this task did not authorize touching CI or the verification registry |

**No product defect was exposed.** Had one been, the brief required stopping before any product change; that did not arise.

---

## 9. Product code and migrations unchanged

| Check | Result |
|---|---|
| All 7 Phase 1 implementation files | **byte-identical** to §1 |
| Existing test files | **none changed.** The ` M` entries under `backend/tests/realschema/` and `supabase/migrations/` were **already present in the start-of-task inventory** — they are pre-existing work from earlier packages, untouched here |
| Migrations | **none created or edited** |
| Governance tooling / verification registry | **untouched** |
| All four prior reports | **unchanged** (`838729e5…`, `f3bf6bff…`, `02a7c1c9…`, `953adb5e…`) |

---

## 10. Final working-tree inventory and HEAD

| | |
|---|---|
| HEAD | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree | **156 → 157 entries** |
| Only difference | **`?? backend/tests/realschema/ret_retention_pre_exclusion.test.ts`** |
| Pre-existing entries lost or altered | **none**, confirmed by diffing the start and end inventories |
| Commits / merges / deployments | **none** |

---

## 11. Time ledger

| | |
|---|---|
| Start / end | **2026-10-18T15:42:09** → **15:54:00 +05:30 (IST)** |
| **Wall-clock** | **11 min 51 s** |
| **Machine time** | **≈ 7 min 40 s** — provisioning 5 min 12 s (restore 157 s + replay 155 s), whole-project run 119 s, targeted suite 9 s, unit suite ≈ 15 s, inspection and teardown ≈ 25 s |
| **Active engineering** | **≈ 4 min** |
| External waiting | **none** inside this task |
| Human engineer-days | **not consumed by agent wall-clock**; no substitution made. Frozen baseline unchanged: Milestone A′ **2026-11-25 / 28.5 d**, WP-7 **2026-11-17 / 4.0**, C-1 **8–12**, **OVERRUN RISK still raised with zero float at the high estimate**, next checkpoint **Friday 2026-10-23**. **No float is claimed recovered** |

---

## 12. Status

| Item | Status |
|---|---|
| Durable real-schema retention suite | **IMPLEMENTED** — `ret_retention_pre_exclusion.test.ts`, 693 lines, `23881754…c701` |
| R1 protected parent · R2 eligible parent · R3 mixed batch | **VERIFIED AGAINST POSTGRESQL** |
| R4 tenant-scoped deletes, incl. the load-bearing predicate and per-item fallback | **VERIFIED AGAINST POSTGRESQL** |
| R5 short batch count | **VERIFIED AGAINST POSTGRESQL — HARNESS-ASSISTED timing** |
| R6 scan-count · R7 candidate-select · R8 protection-probe failures | **VERIFIED AGAINST POSTGRESQL** |
| R9 empty and dry runs · R10 retries and unrelated-row safety | **VERIFIED AGAINST POSTGRESQL** |
| Real-schema project regression | **VERIFIED** — 38/38 suites, 853/853 tests |
| Phase 1 unit suite | **VERIFIED** — 56/56 |
| Batch scale · policy-restricted RLS · lifecycle/B21 coverage · CI wiring | **NOT RUN** |
| Independent review | **NOT RUN** |
| Production behaviour | **UNVERIFIED** |
| Phase 2 · Q3 · v0.3 | **UNAUTHORIZED · BLOCKED · NOT RATIFIED** |

**Nothing was committed or deployed. Phase 2 remains unauthorized, Q3 remains blocked, and v0.3 remains unratified.**
