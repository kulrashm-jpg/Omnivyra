# PI-C1-LIFECYCLE-ORDERING-POSTGRES-INVESTIGATION-002 — disposable PostgreSQL evidence run

**Evidence gathering only.** No product-code change, no migration created or edited, no existing test changed, no production database contacted, no provider call, no commit, push, merge or deployment. No design implemented or selected. **Implementation authorization: NOT GRANTED.**

---

## 1. Executive findings

Every question the independent review left as `INFERRED` is now settled by execution, and **the review was right on each of them**.

| # | Finding | Status |
|---|---|---|
| **1** | **An identity value is allocated BEFORE the `BEFORE INSERT` trigger body runs.** The trigger logged `NEW.seq=1` on entry | **CONFIRMED (executed)** |
| **2** | **A lock taken inside that trigger cannot serialise allocation.** Session A allocated `seq=2` and paused; B allocated `seq=3`, **took the lock while A was still inside the trigger**, and **committed first**; A committed last holding the *lower* value | **CONFIRMED (executed)** |
| **3** | **"Sequence order equals commit order" — the claim in the repository's own sibling migration and reader — is FALSE** as written | **CONTRADICTED (executed)** |
| **4** | **The existing lifecycle path durably persists a wrong `previous_state`.** Two transitions in one transaction shared `now()`; the service's own query shape returned the *initial* state both times, so **both rows were written with `previous_state='detected'`** | **CONFIRMED (executed, authentic table)** |
| **5** | **The concurrent read-modify-write fork is real, not theoretical.** Two sessions on the existing two-transaction boundary both read `detected` and both inserted — two rows claiming the same predecessor, with **distinct** timestamps, so this is independent of the tie defect | **CONFIRMED (executed)** |
| **6** | **Neither fork can be repaired.** `UPDATE` and `DELETE` both raise `P0001`; the rows are permanent | **CONFIRMED (executed)** |
| **7** | **A one-statement `ADD COLUMN … DEFAULT nextval(...)` DOES silently backfill.** The filenode changed (rewrite) and **all 10 existing rows received values 1–10 in heap order** — including inventing an order for rows whose timestamps tie | **CONFIRMED (executed)** |
| **8** | **The append-only trigger does NOT protect against that rewrite.** It did not fire; all rows survived with new values | **CONFIRMED (executed)** |
| **9** | **The two-statement form is clean.** `ADD COLUMN` nullable: no trigger, **no rewrite** (filenode unchanged), **0 of 8 rows** given a value. `SET DEFAULT`: still 0, new inserts get values | **CONFIRMED (executed)** |
| **10** | **`GENERATED ALWAYS AS IDENTITY` cannot be nullable** — it is implicitly `NOT NULL` and refuses even an explicit `NULL`. **So "GENERATED ALWAYS + NULL legacy rows" is impossible**, and the independent review's re-specification contains an unresolved contradiction | **CONFIRMED (executed) — NEW** |
| **11** | **`GENERATED ALWAYS` is not absolute**: `OVERRIDING SYSTEM VALUE` succeeded with **no special privilege** | **CONFIRMED (executed)** |
| **12** | **The pinning hazard is real.** With a plain `DEFAULT`, a caller-supplied maximal value pinned `archived` as "latest" even after a legitimate later transition | **CONFIRMED (executed)** |
| **13** | **`NULLS LAST` ignores an out-of-band corrective append**, which is the only repair path available for a born-terminal row | **CONFIRMED (executed)** |
| **14** | **Option E is technically demonstrated.** Lock-before-allocation in one function produced a chain not a fork, blocked only the contended opportunity, correctly refused the second of two mutually exclusive transitions, left no row after a post-validation failure, and gave wrong-tenant and nonexistent identical refusals | **CONFIRMED (executed, proof of concept)** |
| **15** | **Cross-tenant lifecycle rows are accepted**, and **deleting either the parent opportunity or the company is refused with `P0001`** | **CONFIRMED (executed)** |

**What this does NOT establish:** nothing here speaks to production. The schema came from the committed baseline plus replayed migrations on a throwaway server, the role was a superuser, and no production version, configuration or execution path was compared. **No equivalence claim is made.**

---

## 2. Baseline and environment

| | Value |
|---|---|
| Task start | **2026-10-19T09:35:23+05:30 (IST)** · UTC **2026-10-19T04:05:23Z** |
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` — **as expected** |
| HEAD at start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — **as expected, unchanged** |
| Working tree at start | **162 entries (72 M / 90 ??)** |
| Working tree at end | **163 entries** — the one addition is this report |
| Scratch directory | `…/scratchpad/pgi002/` — **newly created by this run**, outside all tracked paths; 35 files (§6) |

**Hash gates — both verified before any experiment:**

| Report | Expected = actual | Lines |
|---|---|---|
| `PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` | `2be20d2d7300a4343884e7048a3247c30d3c1461fec12a99d4c7b1636f956e2e` **MATCH** | 403 |
| `PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001.md` | `36edb0b7f6a2d4206c6e207cb10e59e47832f3809f203636694668ab387c6d85` **MATCH** | 396 |

### 2.1 A stop condition was hit, reported, and cleared by the owner

At task start **the Docker daemon was not running** (`npipe:////./pipe/dockerDesktopLinuxEngine` absent), which is the §18 stop condition "disposable isolation cannot be proved". There was no native `psql` and nothing listening on a PostgreSQL port, so **no shared or production database was reachable either**. The blocker was reported with options rather than worked around; the owner authorized starting the daemon. **Starting it auto-restarted the pre-existing `cert-supabase` stack to the state it was already in** — 11 containers. That stack was never connected to, stopped, mutated or removed.

### 2.2 The disposable instance

| | |
|---|---|
| Image / resolved digest | `pgvector/pgvector:pg17` · **`sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d`** |
| Server | **PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2)** |
| **Full container ID** | **`39253fc98fe32a8706e91fbd7fa82c96e5a35df404546b05be9ab3a2d5a886fe`** |
| Name | `pgi002-ordering-<pid>`; pre-existence checked, creation refused rather than reuse |
| Restart policy / network | **`no`** · `bridge` |
| **Host binding, asserted before connecting** | **`127.0.0.1:56678`** — a non-loopback binding would have removed the container and stopped |
| Credentials | throwaway (`POSTGRES_PASSWORD=pgi002throwaway`, db `pgi002`). **No production hostname, secret or URL was used, and no credential value appears in this report** |
| Connection method | `docker exec <container-id> psql` throughout — **no hostname and no connection string**, so it cannot resolve to a shared or production database |
| Schema | bootstrap + committed `baseline.sql` (**57 s, 0 unexpected errors, 823 public tables**) + **52/52 migrations replayed** above ledger `20260916000000` (**88 s, 0 failures**) |
| Role / RLS during tests | **`postgres`, `rolsuper = t`**; RLS **enabled** on `opportunity_lifecycle_states` and `opportunity_feed_items`. **A superuser bypasses RLS, so nothing here proves authenticated-role isolation** |

---

## 3. Source inventory and consumer reconciliation

The independent review's count of **eleven** query sites is used as a reconciliation target and **confirmed**: 9 literal sites plus 2 reached through indirection maps that a literal grep misses. (The earlier investigation reported 8, under-counting the two `is_initial` probes and collapsing retention's sites.)

| ID | File : line | Function / query | Caller status | Ordering or predicate | On tied timestamps | Reads/writes `previous_state` | Error handling | Test coverage |
|---|---|---|---|---|---|---|---|---|
| **A1** | `opportunityLifecycleService.ts:98` | `readCurrentLifecycleState` | **production** (internal, via `transitionLifecycle:256`) | `transitioned_at DESC LIMIT 1` | **arbitrary row** | **reads**, then its value is **written** at `:281` | `error` handled → `unreadable` | `pi_lifecycle_b21`, `pic1Phase1…` |
| **A2** | `:207` | `getCurrentLifecycleState` | **DEAD — zero callers anywhere** | same | arbitrary | reads | throws | **NONE FOUND** |
| **A3** | `:305` | `getLifecycleBoardCounts` | production (`pages/api/active-leads/lifecycle.ts:39`) | `transitioned_at DESC`, **no `LIMIT`**, org-wide; app reducer first-seen-wins | arbitrary | no | `error` handled | **NONE FOUND** |
| **A4** | `strategicDashboardsService.ts:153` | dashboard tile | production (`dashboards.ts`) | `transitioned_at DESC` + its **own** reducer | arbitrary | no | **`error` DISCARDED** → silently reports 0 | **NONE FOUND** |
| **B1** | `opportunityLifecycleService.ts:222` | `listLifecycleHistory` | production (`lifecycle.ts:44`) | `transitioned_at ASC` | arbitrary replay order | no | `error` handled | **NONE FOUND** |
| **C1** | `:166` | `is_initial` probe (initialise) | production | `is_initial = true`, no ordering | n/a | no | **`error` DISCARDED** → becomes "no initial row", then INSERTs | `pi_lifecycle_b21` (behaviour) |
| **C2** | `:190` | the same probe after `23505` | production | same | n/a | no | **`error` DISCARDED** | **NONE FOUND** |
| **C3** | `retentionService.ts:165` via `retention.ts:107` | `findProtectedIds` — **the actual deletion gate** | production | existence only, **no ordering** | **unaffected** | no | `error` → fails closed | `ret_retention_pre_exclusion` (behaviour) |
| **D1** | `auditExportService.ts:81` via `:27` | audit export window | production | `transitioned_at ASC`, `LIMIT 5000` | membership at the cap is arbitrary | no | handled | **NONE FOUND** |
| **D2** | `retentionService.ts:215` via `retention.ts:58` | retention scope count | production | `< cutoff`, no ordering | unaffected | no | `error` → fails closed | `ret_retention_pre_exclusion` |
| **D3** | `retentionService.ts:234` | retention candidate ids | production | `< cutoff`, `ASC`, `LIMIT 10000` | unaffected | no | `error` → fails closed | `ret_retention_pre_exclusion` |

**Writers: two.** `initialiseLifecycleForOpportunity` (`:174`) and `transitionLifecycle` (`:276`); **neither supplies `transitioned_at`**, so both take `DEFAULT NOW()`. No `BEFORE INSERT` trigger, no lock.

**Counts:** 11 query sites · 8 distinct functions · **9 production sites, 1 dead (A2), 1 internal-only** · **3 discarded `error` values** (A4, C1, C2) · **5 consumers with no test naming them**.

**`isResolvedForAccountDeletion` is NOT a live deletion gate** — zero non-test callers, and no account-deletion service exists in `backend/services`. The live, ordering-independent control is **C3**.

---

## 4. Experiments A–F

### Experiment A — allocation versus trigger execution

Disposable `expa` schema: identity column + `BEFORE INSERT` trigger taking a per-entity advisory lock, with the pause placed **before** the lock so allocation and locking can be separated.

**A1 (single session).** The trigger logged `alloc_visible_in_trigger NEW.seq=1` **on entry**. A second table whose trigger `RETURN NULL`s logged `NEW.seq=1` then `NEW.seq=2` for two inserts that produced **0 rows** — allocation happened and was consumed anyway.

**A2 (two sessions, raw event log):**

```
A  alloc_visible_in_trigger NEW.seq=2   04:13:12.831
A  pre_lock_sleep_begin 5s              04:13:12.832
B  alloc_visible_in_trigger NEW.seq=3   04:13:15.244
B  lock_acquired NEW.seq=3              04:13:15.244
B  POST_COMMIT                          04:13:15.252
A  pre_lock_sleep_end                   04:13:17.834
A  lock_acquired NEW.seq=2              04:13:17.835
A  POST_COMMIT                          04:13:17.869
```

**A3 — required classifications:**

| Claim | Verdict | Evidence |
|---|---|---|
| Sequence allocation occurs before the `BEFORE INSERT` trigger | **CONFIRMED** | A1: `NEW.seq` already non-null on trigger entry |
| Advisory-lock acquisition order necessarily matches sequence order | **CONTRADICTED** | A2: allocation A→B, lock acquisition **B→A** |
| Sequence order necessarily matches insert order | **CONFIRMED for statement-start order only** — the value orders when the statement *began*; the row lands later, after the lock | A2 |
| Sequence order necessarily matches commit order | **CONTRADICTED** | A2: A holds `seq=2` and committed **last** |
| A trigger-level advisory lock is sufficient to guarantee business transition order | **CONTRADICTED** | A2 — the lock is downstream of allocation by construction |

### Experiment B — tied timestamps and durable `previous_state`

On the **authentic** table. Three rows written in one transaction, the two non-initial ones using the service's own read shape (`transitioned_at DESC LIMIT 1`).

- **3 rows, 1 distinct `transitioned_at`** — the tie.
- **Durably persisted:** `triaged` with `previous_state='detected'` **and** `reviewing` with `previous_state='detected'` — the read returned the initial state both times.
- **`readCurrentLifecycleState` shape returns `detected`** for an opportunity that has been triaged *and* reviewed.
- **Non-totality, four ways:** the same primary ordering with secondary `state ASC / state DESC / id ASC / id DESC` returns **`detected` / `triaged` / `reviewing` / `triaged`**.
- The board reducer shape also returns `detected`.

**B2 — negative control 7.** `UPDATE … SET previous_state` → **`ERROR: opportunity_lifecycle_states is append-only`**; `DELETE` → the same; the row is **unchanged**. **There is no ordinary write path that can repair a wrong `previous_state`.** No privileged correction mechanism was invented and no trigger was disabled on the authentic table.

**B3 — consequences.** Directly reproduced: incorrect persisted data (above) and a current-state read that disagrees with the recorded history. Directly reproduced reader disagreement **across ordering variants**; disagreement **between two live readers in the same instant** was **not** reproduced (both A1 and the A3/A4 shape returned `detected` here) — that remains `INFERRED`. Unaffected: C3, D1–D3.

### Experiment C — the concurrent transition race

Two sessions, each mirroring the existing boundary: the read is one autocommitted statement, the insert a **separate** one.

```
session A read current_state='detected'   → inserted triaged   previous_state='detected'  @04:19:38.922
session B read current_state='detected'   → inserted reviewing previous_state='detected'  @04:19:37.292
```

- **Two rows claim the same predecessor**, with **distinct** timestamps — so this is **not** the tie defect.
- `pg_locks` advisory count during the path: **0**.
- The later-timestamped row (`triaged`) becomes "current"; the other decision is silently dropped from the state view while remaining permanently in history with a now-false predecessor.

**C2 — lock scope in the current implementation:** none. No lock is acquired before or after the read, none is held through validation, insert or commit, and there is no per-opportunity or tenant-qualified serialisation. `uq_opp_lifecycle_initial` covers `is_initial = TRUE` only.

**C3 — conclusion: a demonstrated concurrency defect**, reachable through the ordinary caller, not dependent on a special arrangement. Production equivalence is unresolved (§10).

### Experiment D — Option E feasibility

Disposable `expd` schema. A function that takes the per-opportunity, **tenant-qualified** advisory lock **first**, then reads, validates against the existing graph transcribed from `opportunityLifecycle.ts:35-45`, then inserts — so **allocation happens inside the lock**. `SECURITY INVOKER`, `search_path` pinned to `expd, pg_temp`.

| Case | Result |
|---|---|
| Valid transition | `{"ok":true,"from":"detected","to":"triaged","seq":3}` |
| `from = to` | `no_op_same_state` — matches the existing rule |
| Not in the graph (`triaged→converted`) | `transition_not_permitted` |
| No history | `lifecycle_history_missing`, nothing written |
| **Wrong tenant, valid opportunity id** | `opportunity_not_found_for_tenant` |
| **Nonexistent opportunity** | **the identical message** — no existence oracle |
| **Failure after validation, before commit** | raises; **row count unchanged**; retry then succeeded |
| Terminal state | `archived` reached; every exit refused |
| **Concurrent, same opportunity** | A locked @39.494 and held to 42.5; **B blocked until 42.530, re-read `triaged`, inserted `triaged→reviewing`** — a **chain, not a fork** |
| **Concurrent, different opportunity** | **not blocked** — locked @39.826 while A still held its lock |
| **Two mutually exclusive transitions** (`converted→archived` twice) | first succeeded; second **correctly refused** `no_op_same_state` after re-reading |

**D4 — feasibility conclusion.** The function demonstrably provides: atomic read-validate-insert; per-entity serialisation that does **not** block unrelated entities; allocation **inside** the lock (the property A2 shows a trigger cannot give); tenant-qualified refusal without leaking existence; and no partial evidence on failure. It does so **without** a second source of truth (the ledger remains the only state store), **without** bypassing the write-owner architecture (`ownedDbRpc` is the documented seam at `backend/db/writeOwner.ts:11-23`), **without** weakening append-only protection (INSERT is not blocked), and **without** weakening tenant isolation. It does **not** rely on sequence allocation alone to establish order.

**Known cost, observed:** rolled-back attempts consume sequence values (gaps at 2, 4, 8, 12). Harmless for ordering, but gaps are not evidence of lost rows and should not be read as such.

### Experiment E — ordering column and migration safety

**E1 — generation modes:**

| Mode | Caller-supplied value | Explicit `NULL` | Duplicate | `is_nullable` |
|---|---|---|---|---|
| `DEFAULT nextval(...)` | **accepted** | **accepted** | **accepted** | `YES` |
| `GENERATED ALWAYS AS IDENTITY` | **refused** (`cannot insert a non-DEFAULT value`) | **refused** | n/a | **`NO`** |
| …same, `OVERRIDING SYSTEM VALUE` | **accepted, no privilege required** | — | — | — |
| `GENERATED BY DEFAULT AS IDENTITY` | **accepted** — the trap | — | — | `NO` |

**Finding 10 in full:** because `GENERATED ALWAYS` is implicitly `NOT NULL` **and refuses an explicit `NULL`**, a column cannot be both `GENERATED ALWAYS` and left `NULL` for legacy rows. **The review's "re-specified A" (GENERATED ALWAYS + no backfill) is therefore not constructible as stated.** The owner must choose between protection-from-callers and leaving history unsequenced — see §9 D-8.

**E2 — uniqueness and ordering:**
- **Pinning reproduced:** with `DEFAULT`, a caller-supplied `9223372036854775807` on an `archived` row made "latest by seq" return `archived` **even after a legitimate later `triaged`**.
- A `UNIQUE` index refused a *second* maximal value but **does not prevent the first pin**.
- **`NULLS LAST`** over mixed rows returned `new_second` (seq 11) and **ignored a `NULL`-seq corrective append dated 2030** — the only repair route for a born-terminal row.
- **Omitting the `NULLS` clause flips the result**: `DESC` defaults to `NULLS FIRST`, which returned the legacy row instead.
- Two legacy rows with tied timestamps stayed ambiguous (`tie_a` vs `tie_b` by secondary key).

**Which ordering property is intended must be named.** The evidence distinguishes four: *deterministic total order for future rows* (achievable by a sequence), *commit order* (needs the lock before allocation — Option E), *serialized transition order* (same), and *historically truthful order for legacy rows* (**not achievable** — §E4). "Correct order" is not a specification.

**E3 — the two-statement migration, on the authentic table:**

| Step | Trigger fired? | Rewrite (filenode) | Existing rows with a value |
|---|---|---|---|
| before | — | `24287` | — |
| **1.** `ADD COLUMN seq_test bigint` (nullable, no default) | **No** | **`24287` — unchanged** | **0 of 8** |
| insert arriving **between** the statements | — | — | **NULL** — indistinguishable from legacy |
| **2.** `ALTER COLUMN … SET DEFAULT nextval(...)` | **No** | **`24287` — unchanged** | **0 of 9** |
| a new insert afterwards | — | — | gets `1` |
| **negative control 6:** `UPDATE … SET seq_test = 1 WHERE seq_test IS NULL` | **YES → `P0001`** | — | **still 9 NULL** |

**E3b — the one-statement form, on a copy carrying the same guard function:**

| Step | Rewrite | Existing rows given a value |
|---|---|---|
| non-volatile `DEFAULT 42` | **No** — filenode `36695` unchanged | all 10 (fast default) |
| **volatile `DEFAULT nextval(...)`** | **YES — filenode `36695 → 36717`** | **all 10, values 1–10** |

The assigned order was **heap order**: the three rows sharing `04:18:55.257` received 1, 2, 3 — an order the data does not support. **The append-only trigger did not fire during the rewrite** and all rows survived.

**Answers to the E3 checklist:** (1) after statement 1, historical rows hold `NULL`; (2) after statement 2, still `NULL`; (3) inserts during the intermediate state receive **`NULL`**; (4) interruption between the statements leaves a harmless nullable column with no default — safe, and re-runnable; (5) a concurrent insert in that window gets an **ambiguous missing value**, which is the one real hazard of the sequence; (6) retry is safe, and rollback is `DROP COLUMN`; (7) **no rewrite and no row trigger for the two-statement form, a rewrite for the one-statement form — determined by filenode comparison, not inference**; (8) a `UNIQUE` index on the column builds over `NULL`s without complaint (multiple `NULL`s are permitted).

**Deployment requirement, explicit:** writer coordination is required. Because `transitionLifecycle` persists its read (`:281`), a mixed-version window in which two code versions order differently can write permanently contradictory predecessors. The reader change must reach **100 % of instances in one release** before anything depends on it, or ordering must be moved database-side so no skew is possible.

**E4 — legacy rows.** `seq DESC NULLS LAST, transitioned_at DESC` is **deterministic for sequenced rows and still non-total for legacy rows**; it **can disagree with actual historical order** (demonstrated: the 2030 corrective append was ignored); it is only consistent across readers if **all** of them adopt it; and **the true chronology of tied legacy rows is unrecoverable from the available fields** — `transitioned_at` ties, `id` is `gen_random_uuid()`, `ctid` is a physical artifact, and the `previous_state` chain cannot be linearised because the transition graph permits a state to repeat.

**E5 — DDL versus the append-only trigger.** Trigger definitions, enabled state (`O`), PostgreSQL version and exact DDL are recorded above. `ADD COLUMN` did **not** fire either trigger, in both the nullable and the rewriting form. **No trigger was disabled or bypassed on the authentic table**; the one-statement experiment ran on a copy carrying the same guard function, and the copy was destroyed with the container.

### Experiment F — cross-tenant references and integrity

| Case | Result |
|---|---|
| Valid same-tenant insert | accepted |
| **Cross-tenant insert** (tenant A citing tenant B's opportunity) | **ACCEPTED — the row landed** |
| Nonexistent tenant | `23503` on `…_organization_id_fkey` |
| Nonexistent opportunity | `23503` on `…_opportunity_feed_item_id_fkey` |
| Multi-column (tenant-qualified) FKs on the table | **0** |
| Composite parent key available on `opportunity_feed_items` | **No** — only `PRIMARY KEY (id)` and `UNIQUE (organization_id, signal_id)`, so a tenant-qualified FK is **not currently expressible** without adding one |
| **Delete the parent opportunity** with lifecycle rows | **REFUSED `P0001`** via the cascade; parent survives |
| **Delete the company** with lifecycle rows | **REFUSED `P0001`**; company survives |

**Classification, as required:** the same-tenant pairing is **not** a schema-level invariant; it is an **application-level predicate** only (both writers set `organization_id` from the caller's argument). RLS is enabled but **these tests ran as a superuser, which bypasses RLS — so authenticated-role isolation is NOT established here.**

---

## 5. Negative-control results

| # | Control | Expected | Actual | Would it distinguish a broken implementation? |
|---|---|---|---|---|
| 1 | Unprotected sequence column accepts a caller value | accepted, and pins state | **accepted**; `archived` pinned over a later legitimate transition | **Yes** — `GENERATED ALWAYS` refused the same statement |
| 2 | Concurrent transitions without serialization | both succeed, same predecessor | **both succeeded**, two rows `previous_state='detected'` | **Yes** — the Option E function produced a chain under the same arrangement |
| 3 | Cross-tenant reference on the baseline schema | accepted (no composite FK) | **accepted** | **Yes** — nonexistent ids were refused `23503`, so the FKs do fire when they can |
| 4 | Failure after validation, before commit | raises; no row persists | **raised**; row count unchanged; retry succeeded | **Yes** — a leaked row would have shown in the count |
| 5 | Tied timestamps expose ambiguous ordering | one tie, multiple answers | **1 distinct timestamp for 3 rows**; four secondary keys → four answers | **Yes** — distinct timestamps ordered deterministically in C |
| 6 | Migration intermediate state / `UPDATE` backfill | `UPDATE` refused; intermediate rows `NULL` | **`P0001`**, 9 rows still `NULL`; intermediate insert `NULL` | **Yes** — the rewriting form, by contrast, filled all 10 |
| 7 | `UPDATE`/`DELETE` against append-only evidence | both refused | **both `P0001`**, row unchanged | **Yes** — INSERT on the same table succeeded throughout |

No control is reported on exit status alone; each observed result is quoted.

---

## 6. Raw evidence and reproducible commands

All raw SQL, session scripts and captured output are in the scratch directory `…/scratchpad/pgi002/` (35 files, outside tracked paths): `expA_setup.sql`, `expA2_patch.sql`, `A1_raw.txt`, `A2_raw.txt`, `A2_sessA.out`, `A2_sessB.out`, `expE12.sql`, `E12_raw.txt`, `expD_setup.sql`, `D_single_raw.txt`, `dA/dB/dC/dD1.sql`, `D_A..D_D2.out`, `D_conc_raw.txt`, `expBF.sql`, `BF_raw.txt`, `c_A.sql`, `c_B.sql`, `C_A.out`, `C_B.out`, `C_raw.txt`, `expE35.sql`, `E35_raw.txt`, `apply_real_schema.sh`, `replayed.txt`, `restore.err`, `container-id`.

Reproduction outline: create a uniquely named `pgvector/pgvector:pg17` container published on `127.0.0.1` with throwaway credentials; assert the binding; run `apply_real_schema.sh` (bootstrap + `supabase/_schema/baseline.sql` + migrations above `20260916000000`, all via `docker exec`); then run `expA_setup.sql`, `expA2_patch.sql` with the two session scripts, `expE12.sql`, `expD_setup.sql` with the four D scripts, `expBF.sql`, `c_A.sql`/`c_B.sql`, `expE35.sql`; remove the container by full ID. **Nothing depends on unrecorded terminal history.**

---

## 7. Proposed regression matrix

**Proposal only — no product test was added or modified.**

| # | Test | Precondition | Action | Expected | Defect detected | Status | Level |
|---|---|---|---|---|---|---|---|
| R1 | Tied-timestamp current state (original L3) | one initial row | two transitions in one transaction | the later transition is current | the tie defect | **existing L3, currently neutralised by its earlier-timestamp fixture** | real-PG |
| R2 | L3b structural assertions | — | inspect columns/indexes | ordering column exists, total, indexed | regression of the fix | **existing L3b — rewrite, do not weaken** | real-PG |
| R3 | Tied timestamps, different destinations | tie | read via every reader | all agree | reader divergence | **NOT COVERED** | real-PG |
| R4 | Repeated state (`dismissed→triaged→dismissed`) | chain | replay | order unambiguous | linearisation failure | **NOT COVERED** | real-PG |
| R5 | **Two concurrent competing transitions** | one initial row | both read then insert | **no two rows share a predecessor** | the C fork | **NOT COVERED — needs a two-session harness** | real-PG |
| R6 | Failed transition rollback | valid state | fail after validation | no row, no gap claim | partial evidence | **NOT COVERED** | real-PG |
| R7 | Retry after successful commit | committed transition | retry | refused or idempotent, never duplicated | lost-update | **NOT COVERED** | real-PG |
| R8 | **`previous_state` consistency invariant** | any history | scan | **no predecessor claimed twice** | B and C both | **NOT COVERED — highest value** | real-PG |
| R9 | Sequence uniqueness | sequenced rows | insert | unique, monotonic | duplicate/pinning | **NOT COVERED** | real-PG |
| R10 | Caller supplies an ordering value | column exists | insert with explicit `seq` | refused | the pinning hazard | **NOT COVERED** | real-PG |
| R11 | Legacy rows with `NULL seq` | mixed | read | fallback consistent; corrective append not hidden | `NULLS LAST` masking | **NOT COVERED** | real-PG |
| R12 | Ordering consistent across all readers | mixed | A1/A3/A4/B1 | identical current state | partial migration | **NOT COVERED** | real-PG |
| R13 | Both `is_initial` probes | read failure injected | initialise | fails closed, does not INSERT | the discarded `error`s at `:166`, `:190` | **NOT COVERED** | unit + real-PG |
| R14 | All three retention sites | protected and eligible rows | run retention | unchanged by ordering | regression | **existing `ret_retention_pre_exclusion`** | real-PG |
| R15 | Board and dashboard consumers | mixed history | read | agree with A1 | A3/A4 divergence; A4's discarded `error` | **NOT COVERED** | unit + real-PG |
| R16 | Append-only `UPDATE`/`DELETE` | evidence row | attempt both | `P0001`, unchanged | guard removal | **existing `pi_lifecycle_b21`** | real-PG |
| R17 | Cross-tenant reference | two tenants | insert mismatched pair | **current: accepted** (pin the fact) | silent cross-tenant write | **existing `pi_lifecycle_b21`** | real-PG |
| R18 | Tenant / opportunity deletion | lifecycle rows exist | delete parent, delete company | `P0001`, both survive | cascade regression | **partially existing** | real-PG |
| R19 | Migration interruption and retry | legacy rows | stop between statements, re-run | rows `NULL`, re-runnable | accidental backfill | **NOT COVERED** | real-PG |
| R20 | **No accidental backfill** | legacy rows | apply the migration | count with a value equals post-migration inserts only | the one-statement rewrite | **NOT COVERED — premise of the whole design** | real-PG |
| R21 | Authenticated-role tenant isolation | non-superuser role with RLS | read/write cross-tenant | refused | RLS regression | **NOT RUN — superuser was used here** | real-PG |

**L3 / L3b after any approved remediation:** L3 should **drop its earlier-timestamp fixture** and become R1, the semantic regression test that fails today. L3b should be **rewritten, never weakened**, to assert the new structural guarantees plus **R20**.

---

## 8. Option comparison

| | **A re-specified** | **Option E (+ ordering)** | **Interim C** |
|---|---|---|---|
| Defect addressed | the tie (B) | **the fork (C) and the tie** | reader disagreement only |
| Defect NOT addressed | **the fork (C)** — and it makes the wrong answer *stable* | legacy-row chronology | both B and C |
| Future ordering | total for sequenced rows | total, **and commit-ordered** (D proved lock-before-allocation) | total but **semantically arbitrary** |
| Historical ordering | **unrecoverable** (E4) | unrecoverable | unchanged |
| Concurrency | none | **demonstrated** (D) | none |
| Tenant integrity | unchanged | **improved** in the PoC (tenant-qualified lock and lookup) | unchanged |
| Append-only compatibility | **confirmed** for the two-statement form (E3) | confirmed — INSERT is not blocked | n/a |
| Migration / rollout risk | **the one-statement trap (E3b)** + mandatory single-release reader rollout | the same, plus a function to deploy | **none** — reader-only |
| Reader compatibility | all 11 sites | all 11 sites | all 11 sites |
| Test coverage required | R1–R2, R9–R12, R19–R20 | adds R5–R8 | R3, R12 |
| Unresolved | **D-8: `GENERATED ALWAYS` cannot be nullable** | which ordering property is contractual | that it is not chronology |
| Effort (engineer-days, excluding this investigation) | **1.5–3.0** | **+2.0–3.5** on top | **0.25–0.5** |

**These are not interchangeable.** A addresses ties; E addresses the fork; C addresses neither and only makes readers agree. **No option is selected here**, and the PI sibling ledger is **not** a drop-in replacement — it anchors to a different entity (`canonical_leads`), uses a different seven-state vocabulary, has composite tenant FKs the Community table lacks, and its own lock is downstream of allocation (A2).

---

## 9. Unresolved questions and owner decisions

| ID | Decision | Classification |
|---|---|---|
| **D-1** | Which design to adopt | **OWNER DECISION REQUIRED** — the evidence now distinguishes them clearly, but the choice is a tradeoff |
| **D-2** | No historical backfill | **SUPPORTED BY EVIDENCE** — E4 shows chronology is unrecoverable; E3 shows the two-statement form achieves it; **and E3b shows it must be two statements** |
| **D-3** | Accept sequence-assignment ordering without serialization | **NOT SUPPORTED** — A2 contradicts it. If commit-ordered semantics are wanted, the lock must precede allocation, i.e. Option E |
| **D-4** | Remove the dead `getCurrentLifecycleState` | **SUPPORTED BY EVIDENCE** — zero callers, no test, unsafe variant |
| **D-5** | Treat the write race as a separate package | **SUPPORTED WITH MATERIAL CAVEATS** — C makes it a demonstrated defect, not a risk; "separate" must not mean deferred |
| **D-6** | Authorize this investigation | **DISCHARGED** by this run |
| **D-7** | Authorize implementation | **NOT SUPPORTED YET** — D-1 and D-8 first |
| **D-8** | **NEW:** `GENERATED ALWAYS` cannot be nullable (E1). Choose: (a) `GENERATED ALWAYS` + every legacy row gets a value (an invented order), (b) plain `DEFAULT` + nullable legacy rows but **caller-writable** with the pinning hazard, (c) `DEFAULT` + nullable + a `CHECK`/trigger restricting who may supply it, (d) no ordering column and fix only the fork | **OWNER DECISION REQUIRED** |
| **D-9** | **NEW:** which ordering property is contractual — deterministic, commit-ordered, or business-ordered (E2) | **OWNER DECISION REQUIRED** |
| **D-10** | **NEW:** the three discarded `error` values (A4, C1, C2) | **SUPPORTED BY EVIDENCE** that they exist; whether to fix now is scope |
| **D-11** | **NEW:** cross-tenant lifecycle rows are accepted and a composite parent key does not exist (F) | **OWNER DECISION REQUIRED** |

---

## 10. Limitations and non-production scope

**Nothing here establishes production behaviour.** The schema was built from the committed baseline plus replayed migrations onto a throwaway server; **a green or red result here is not evidence about the production database**, and no production version, configuration, extension set or execution path was compared. **No equivalence claim is made.**

Further limits: all experiments ran as a **superuser**, so **authenticated-role RLS isolation was not tested** (R21 `NOT RUN`); experiments A, D, E1 and E2 used purpose-built disposable schemas rather than product tables, so they establish **PostgreSQL semantics**, not product behaviour; Experiments B and C reproduce the service's **query shapes and transaction boundary**, not the TypeScript executing — the shapes were read from source and are cited, but the product code did not run; the concurrency results are from a handful of trials, enough to show reproducibility, not a statistical distribution; the one-statement rewrite was observed on a **copy** carrying the same guard function, not the authentic table; and the heap order observed in E3b may differ on a table that has been `CLUSTER`ed, `VACUUM FULL`ed or dump/restored.

**This is not independent review.** The same agent authored the earlier investigation, commissioned the independent review, and ran these experiments.

---

## 11. Effort accounting and schedule impact

**The frozen baseline is unchanged:** Milestone A′ **25 November 2026 / 28.5 human engineer-days**; WP-7 **17 November 2026 / 4.0**; C-1 **8–12**, zero float at the high end; **`OVERRUN RISK` remains raised**; next checkpoint **Friday 23 October 2026**. **No baseline or deadline change is authorized or made, and no float is claimed recovered.** The independent review's 3.5–6.5 engineer-day figure remains planning evidence only.

| | |
|---|---|
| Start / end | **2026-10-19T09:35:23** → **09:52:18 +05:30 (IST)** |
| **Wall-clock elapsed** | **≈ 16 min 55 s** |
| **Machine / container time** | **≈ 8 min** — image pull and container create ≈ 2 min, baseline restore 57 s, migration replay 88 s, experiments ≈ 3 min, teardown ≈ 10 s |
| Waiting on another agent | **none** |
| External waiting | **one owner round trip** on the Docker stop condition (§2.1); not engineering effort |
| **Active engineering effort** | **≈ 12 min** |
| Estimate discipline | **Process deviation, disclosed:** §17 required recording an effort estimate at task start, and I recorded the timestamp and scope but **not a numeric estimate**. Actual active effort (≈12 min) is far below any plausible estimate for this scope, so **no `75% ESTIMATE CONSUMED` warning was warranted and none is issued**, and there is **no overrun** of this task |
| Conversion basis | **None applied.** Machine time and delegated-agent wall time are **not** converted into human engineer-days, and this investigation's elapsed time is **not** added to any implementation estimate |

**Does the defect block dependent work?** No terminality gate consumes the ambiguous read today (`isResolvedForAccountDeletion` has zero non-test callers and no account-deletion service exists). But **every transition performed now already writes a possibly-false predecessor permanently** — B and C both demonstrated it — so the evidence record degrades with use, and any Phase 2 terminality or deletion gate would inherit it.

---

## 12. Final authorization statement

**No design was selected. No owner decision is inferred. No implementation, schema migration, production database operation, commit or deployment was performed or authorized.** Phase 2 remains unauthorized; Q3 remains blocked unless verified policy evidence closes it; addendum v0.3 remains unratified.

---

## 13. Final repository and container integrity

| Check | Result |
|---|---|
| `PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` | **byte-identical** — `2be20d2d…6e2e`, 403 lines |
| `PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001.md` | **byte-identical** — `36edb0b7…6d85`, 396 lines |
| Product code, existing tests, migrations | **unchanged** — verified by hash (§13.1) |
| HEAD / branch | **`29fea38a…` / `fix/r1-profile-context` — unchanged** |
| Pre-existing tracked modifications | **all 72 intact** |
| Pre-existing untracked files | **all 90 present; none disappeared** |
| Working-tree delta | **162 → 163 entries. The only new entry is this report.** The working tree is **not** clean and was never expected to be |
| Commit / deployment | **none** |
| Disposable container | removed by **full ID `39253fc98fe32a8706e91fbd7fa82c96e5a35df404546b05be9ab3a2d5a886fe`**; `docker inspect` → **absent**; no `pgi002` container remains |
| Other containers | **17 total still present** (11 running `cert-supabase` + 6 pre-existing exited) — **none removed, stopped or mutated** |
| Volumes / networks | **145 volumes untouched**; no volume or network was created by name or removed |
| Scratch artifacts | retained in `…/scratchpad/pgi002/` for reproducibility; no other agent's scratch was read or deleted |
