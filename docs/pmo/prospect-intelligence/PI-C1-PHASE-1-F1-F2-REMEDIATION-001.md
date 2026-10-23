# PI-C1-PHASE-1-F1-F2-REMEDIATION-001 — F-1 and F-2 corrected

**Local, uncommitted product-code and targeted test changes for F-1 and F-2 only.** No database operation, schema change, migration, production access, provider call, commit, push, merge, deployment, or Phase 2 work.

**Status: IMPLEMENTED and VERIFIED by source inspection and unit tests. NOT PostgreSQL-verified — that needs a separate authorization.**

---

## 1. Baseline and preservation

| | Value |
|---|---|
| Start | **2026-10-18T05:19:34+05:30 (IST)** |
| End | **2026-10-18T06:09:31+05:30 (IST)** |
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged, nothing committed |
| Working tree, start | **154 entries (72 M / 82 ??)**, manifest captured before editing |
| Working tree, end | **154 entries** — unchanged in count: both files edited were already modified entries |
| Pre-existing work | **no entry lost or altered**, confirmed by diffing the two manifests |

**Hash gate before any edit:** `PI-C1-PHASE-1-PG-VERIFICATION-001.md` = `02a7c1c9a39c66a95200e552d7b08a4c7ca6bcd1ac266072a484006c9f946afa` — **MATCH**. Re-verified unchanged at the end, as was `PI-C1-PHASE-1-IMPLEMENTATION-001.md` (`953adb5e…`).

Nothing was cleaned, reset, stashed or reformatted. The frozen schedule baseline is untouched: Milestone A′ **2026-11-25 / 28.5 human engineer-days**, WP-7 **2026-11-17 / 4.0**, C-1 **8–12**, **OVERRUN RISK still raised with zero float at the high estimate**, next checkpoint **Friday 2026-10-23**.

---

## 2. Changed paths

| Path | Change | SHA-256 (16) | Lines |
|---|---|---|---|
| `backend/services/retentionService.ts` | F-1 tenant predicates, F-2 fail-closed reads, truthful short-count attribution | `b84a8605745130bd` | 452 |
| `backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts` | 11 new tests, plus two double capabilities | `4a76e0c0155bb934` | 711 |

Diffstat for this task: **1 product file, +267 / −20**.

**Deliberately untouched**, hashes identical to the previous report:

| Path | SHA-256 (16) |
|---|---|
| `backend/services/lifecycleGuardErrors.ts` | `d63e5165d127e75b` |
| `backend/types/retention.ts` | `60e9c05a8906fd8a` |
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | `fde7e56c479a51a1` |
| `pages/api/active-leads/lifecycle.ts` | `249e2ac3943b305e` |

---

## 3. F-1 — tenant-scoped DELETEs

### 3.1 Defect

Both delete paths ran without an `organization_id` predicate:

```
.delete({ count: 'exact' }).in('id', eligible)   // batch   — pre-existing
.delete({ count: 'exact' }).eq('id', id)         // per-item — propagated by Phase 1
```

All four read paths were tenant-scoped; the two write paths were not.

### 3.2 Change

Both now carry `.eq('organization_id', input.organizationId)`. The tenant identity is the **authoritative tenant of the retention operation** — `input.organizationId`, which the caller supplies and the policy load already validates against. It is **never** derived from a row, a fixture, or anything the candidate batch carries.

Protection predicates and per-item outcome semantics are unchanged, and no database guard was weakened or removed.

### 3.3 A second falsehood the fix exposed, and a defect I introduced while fixing it

Adding the predicate made a latent bug reachable: on a **successful** batch the code marked **every** eligible id `deleted`, taking the statement's success as per-id confirmation. With a tenant predicate in place a submitted id can now legitimately match nothing, so that would have been a **false confirmation** — exactly what the brief's fourth F-1 assertion targets.

My first attempt at handling it was wrong, and the tests caught it: I routed a short count into the **per-item pass**, which **re-deletes rows the batch had already removed**, then reports them `already_absent` and **under-counts `rows_affected`**. Re-deleting after a partially successful batch is simply incorrect.

**Final behaviour:**

| Case | Handling |
|---|---|
| Batch succeeds, `count === eligible.length` | every id `deleted`; `rows_affected = count` |
| Batch succeeds, `count < eligible.length` | `rows_affected = count` (the database is authority over **how many**), every id **`indeterminate`** with reason `batch_count_short_<n>_of_<m>`, `detail` records `per_id_attribution_unavailable`. **No re-delete.** No id is reported `deleted` on a count alone |
| Batch errors | per-item pass isolates the refusal, as before |

A new disposition `indeterminate` carries this. It is a code-level type on the returned value — **no new persistence field, no schema change**. `already_absent`, `indeterminate`, `excluded_protected` and `failed` all now demote a run from `completed`, because in each case the scope announced and the work provable do not match.

**Why `indeterminate` and not `already_absent`:** a tenant-scoped operation genuinely cannot distinguish "this row was deleted" from "this row was never mine". Claiming either would be inventing knowledge the operation is not entitled to.

### 3.4 Tests — 5 new

| Test | Asserts |
|---|---|
| batch DELETE carries the organization predicate | the recorded query filters contain `['eq','organization_id',ORG_A]` |
| per-item fallback DELETE carries it too | every per-item delete query carries the same predicate |
| another tenant's row cannot be deleted even if its id reaches the batch | with the **selection path deliberately leaked**, the ORG_B row survives, `rows_affected = 0`, and its disposition is not `deleted` |
| a zero-row deletion is never reported as a confirmed deletion | disposition `indeterminate`, explicitly **not** `deleted`; status not `completed`; `detail` contains `batch_count_short_0_of_1` |
| tenant isolation holds in a mixed batch | ORG_B's row survives, ORG_A's does not, `rows_affected = 1`, status `partial`, both ids `indeterminate`, `detail` contains `batch_count_short_1_of_2` |

**On the leak mode:** the double can be told to ignore the `organization_id` predicate on SELECTs against one table, simulating a selection path that has been widened or mis-filtered. **Nothing in the product does this.** Its purpose is to prove the DELETE's own predicate is **load-bearing rather than redundant** — without it, a test could only show that a tenant-scoped select feeds a tenant-scoped delete, which proves nothing about the delete.

---

## 4. F-2 — fail-closed read errors

### 4.1 Defect

The scan count and the candidate select both discarded their `error`. A failure produced `rowsScanned = 0` or an empty candidate list, every branch that could record a problem was skipped, and the execution was stored as **`status='completed'`, `rows_affected=0`, no outcomes** — indistinguishable from "there was nothing to do".

### 4.2 Change

Each read's error is now captured into a single `readFailure`, which short-circuits everything:

- scan count error → `scan_count_failed:<message>`
- candidate select error → `candidate_select_failed:<message>`
- `readFailure` ⇒ `status='failed'`, `detail=readFailure`, **no protection probe and no DELETE**
- `rowsScanned` is forced to `0` on a scan error rather than carrying a half-read count

**Within the existing contract.** `status` ∈ `completed | partial | failed` and `detail: string | null` already exist on `retention_executions`; the failure is expressed through them. **No new persistence field and no migration** — so the stop condition in the brief ("if the existing contract cannot represent these failures truthfully, stop") was not reached. Per-item outcomes are deliberately **empty** for a read failure: no candidate id is known to be reportable, and listing any would be inventing scope.

A genuine empty run remains distinguishable: scan succeeds with count 0 ⇒ `status='completed'`, `detail=null`, `rows_scanned=0`, no outcomes.

### 4.3 Tests — 6 new

| Test | Asserts |
|---|---|
| failed scan count reports failure | `status='failed'`, `detail` contains `scan_count_failed`, `rows_affected=0` |
| failed scan count performs no DELETE | zero delete queries; both rows still present |
| failed candidate select reports failure | `status='failed'`, `detail` contains `candidate_select_failed` |
| failed candidate select performs no DELETE **and no protection probe** | zero delete queries, zero probe queries, rows intact |
| **genuine empty run stays distinguishable** | `status='completed'`, `detail` **null**, `rows_scanned=0`, no outcomes, no delete |
| failed read in `dry_run` also reports failure | `status='failed'`, no empty preview emitted |

The double gained **per-operation** failure injection keyed `table:op:head|rows`, because the service issues two different reads against the **same** table and F-2 requires each to be provably fail-closed on its own — a whole-table failure cannot distinguish them.

---

## 5. Test commands, exit codes, results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node ./node_modules/jest/bin/jest.js backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts --runInBand --forceExit` | **1** | **FAILED — 2 of 56** (my own wrong expectations plus the re-delete defect, §3.3) |
| 2 | same, after the §3.3 correction | **0** | **56/56 passed** |
| 3 | `… --testPathPattern 'backend/tests/unit/pi.*\.test\.ts$'` | **0** | **89 suites / 2441 tests — all passed** (2430 → 2441, the 11 new tests) |
| 4 | `… --testPathPattern '…(tenant\|isolation\|authz\|crossOrg…)…'` | **0** | **53 suites / 1360 tests — all passed** |
| 5 | `npm run typecheck` (run alone) | **`TYPECHECK_EXIT=0`** | **3/3 projects clean, 0 error lines** |

Exit codes captured directly, not through a pipe, which masks them. No unbounded full-app suite was run.

---

## 6. Defect → change → test mapping

| Defect | Change | Tests |
|---|---|---|
| **F-1** batch DELETE unscoped | `.eq('organization_id', input.organizationId)` on the batch delete | predicate-presence; cross-tenant id rejected; mixed-batch isolation |
| **F-1** per-item DELETE unscoped | same predicate on the fallback | per-item predicate-presence; mixed-batch isolation |
| **F-1b** success treated as per-id confirmation | exact-count check; short count ⇒ `indeterminate`, no re-delete | zero-row never confirmed; mixed batch |
| **F-2** scan count error discarded | captured ⇒ `status='failed'`, `detail='scan_count_failed:…'` | 2 tests + dry-run variant |
| **F-2** candidate select error discarded | captured ⇒ `status='failed'`, `detail='candidate_select_failed:…'` | 2 tests |
| **F-2** failure indistinguishable from empty | empty run keeps `completed` + `detail=null` | genuine-empty-run test |

---

## 7. Residual risks

1. **Not PostgreSQL-verified.** Everything here rests on source inspection and a test double. The double reproduces the append-only guard's `P0001` and now honours filter semantics on deletes, but **it is not PostgreSQL**, and a double accepting a query is not evidence PostgreSQL behaves identically. The `NOT RUN` cases from `PI-C1-PHASE-1-PG-VERIFICATION-001.md` §5 are **still NOT RUN**.
2. **The `indeterminate` path is untested against a real database.** It triggers on a short count, which in production would mean a genuine discrepancy between submitted and affected rows. Its handling is deliberately conservative — report the count, claim nothing per id — but the *circumstances* that produce it have not been observed on PostgreSQL.
3. **`RETENTION_PROTECTED_CHILDREN` remains a hand-maintained mirror** of database reality. A new append-only child added without updating it would not be pre-excluded; the per-item pass contains the damage but is a fallback, not a guarantee.
4. **The `.in()` list can reach 10 000 ids.** A PostgREST URL-length limit would surface as a read or delete failure. After F-2 that now **fails closed and is reported** rather than looking like an empty scope — an improvement — but whether the limit is actually hit is unknown without a real run.
5. **`isResolvedForAccountDeletion` still has no caller** — the account-deletion gate does not exist. Phase 2.
6. **Not independent.** The same agent found F-1 and F-2, fixed them, and wrote these tests. **This is self-review and is not presented as independent verification.**

---

## 8. Effort versus machine time

| | |
|---|---|
| Wall-clock | **49 min 57 s** (05:19:34 → 06:09:31) |
| **Machine gate time** | **≈ 48 min** — typecheck **35 min 29 s** alone, plus ≈ 8 min 30 s for the PI and tenant suites and ≈ 25 s for the targeted runs |
| **Agent active engineering** | **≈ 12 min** |
| External waiting | none inside this task |
| Human engineer-days | **not consumed by agent wall-clock**; no substitution is made and the Phase 1 estimate of record (1.5–3.0 engineer-days) is unrevised |

---

## 9. Status

| Item | Status |
|---|---|
| **F-1** tenant predicate on both DELETEs | **IMPLEMENTED · VERIFIED** (source inspection + 5 unit tests) |
| **F-1b** zero-row / short-count never falsely confirmed | **IMPLEMENTED · VERIFIED** (2 unit tests) |
| **F-2** both required reads fail closed | **IMPLEMENTED · VERIFIED** (6 unit tests) |
| Genuine empty run remains distinguishable | **VERIFIED** |
| Typecheck | **VERIFIED — 3/3 clean** |
| PI and tenant/authz regression scope | **VERIFIED — 2441/2441 and 1360/1360** |
| Behaviour against PostgreSQL | **NOT RUN — separate authorization required** |
| Independent review | **NOT RUN** |
| Production behaviour | **UNVERIFIED** |
| Phase 2 · Q3 · v0.3 ratification | **UNAUTHORIZED · BLOCKED · NOT RATIFIED** |

**Nothing was committed or deployed. The subsequent PostgreSQL verification requires a separate authorization, Phase 2 remains unauthorized, Q3 remains blocked, and the frozen schedule baseline is unchanged.**
