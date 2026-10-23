# PI-C1-LIFECYCLE-ORDERING-DESIGN-PROPOSAL-001 — evidence-constrained design proposal

**Design proposal only.** No product code, schema, migration, test or configuration was changed. **No database was created, connected to, queried or migrated for this task, and no container was started.** No commit, push, merge or deployment. **Implementation authorization: NOT GRANTED. No owner decision is inferred or adopted.**

---

## 1. Executive recommendation

**Recommended candidate: fix the write path first, and let the ordering field be a by-product of it.**

The decisive evidence is that the two defects are not peers. The tie (ambiguous read) is **latent** — it needs two writes in one transaction. The fork (two transitions validating against the same stale predecessor) is **live**, was reproduced across the real two-transaction boundary, and **durably writes a false `previous_state` into a table whose `UPDATE` and `DELETE` both raise `P0001`**. An ordering column alone does not touch the fork; it only makes the fork's arbitrary resolution *stable*, which is harder to notice.

So the proposal is, in order:

1. **An authoritative atomic transition operation** behind the existing `ownedDbRpc` seam: acquire a per-opportunity lock **first**, then read the authoritative state, validate, insert, and hold the lock to transaction end. This is the only mechanism in evidence that prevents the fork.
2. **An ordering value allocated inside that operation**, after the lock. Because the lock precedes allocation and is held through commit, the value then represents **per-opportunity serialized transition order** — a guarantee that is real, and that a column default or a trigger-held lock demonstrably cannot provide.
3. **Legacy rows are never given a value.** Their chronology is unrecoverable and the proposal says so rather than manufacturing one.

**Two corrections to earlier recommendations, forced by the executed evidence.** The ordering column must **not** be declared `GENERATED ALWAYS AS IDENTITY` *and* nullable — the experiment showed that combination is not constructible. And it must **not** be added with a one-statement volatile `DEFAULT nextval(...)` — that rewrote the table and silently backfilled every historical row in heap order.

**The critical unresolved question is not which mechanism to use. It is what the ordering field is contractually allowed to mean** (D-3), because "latest" currently drives a terminality predicate. Per-opportunity serialized order is achievable; global commit order and business-event order are not.

---

## 2. Evidence basis and confidence labels

| Source | SHA-256 | Lines | Verified |
|---|---|---|---|
| `PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` | `2be20d2d7300a4343884e7048a3247c30d3c1461fec12a99d4c7b1636f956e2e` | 403 | **MATCH** |
| `PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001.md` | `36edb0b7f6a2d4206c6e207cb10e59e47832f3809f203636694668ab387c6d85` | 396 | **MATCH** |
| `PI-C1-LIFECYCLE-ORDERING-POSTGRES-INVESTIGATION-002.md` | `74bdb3608766360b77ad6c68bbd4706ac47fcb6a2f9bdec4267241e96612f810` | 394 | **MATCH** |

Labels used throughout: **`EXECUTED`** — reproduced in the disposable PostgreSQL run and reported in evidence 3. **`SOURCE`** — established by reading repository source. **`INFERRED`** — follows from documented PostgreSQL semantics but was not executed. **`UNVERIFIED`** — insufficient evidence, including everything about production. **`OWNER DECISION REQUIRED`** — not resolvable from technical evidence.

**I did not re-run the experiments and do not claim to have.** The executed results are cited as reported evidence.

### 2.1 Facts this proposal is built on

| # | Fact | Label |
|---|---|---|
| E-1 | An identity value is allocated **before** the `BEFORE INSERT` trigger body runs | `EXECUTED` |
| E-2 | A transaction holding a **lower** sequence value committed **after** one holding a higher value; lock acquisition order was the **reverse** of allocation order | `EXECUTED` |
| E-3 | Therefore "sequence order equals commit order" is **false**, and a lock inside a `BEFORE INSERT` trigger cannot serialise allocation | `EXECUTED` |
| E-4 | Two sessions across the existing two-transaction boundary both read `detected` and both inserted — **two rows claiming the same predecessor, with distinct timestamps**. Zero advisory locks held | `EXECUTED` (query shape and transaction boundary; **not** the product TypeScript) |
| E-5 | Two writes in one transaction share `now()`; the service's read shape then returned the **initial** state, and **both rows persisted `previous_state='detected'`** | `EXECUTED` |
| E-6 | `UPDATE` and `DELETE` on lifecycle evidence both raise `P0001`; the rows are permanent | `EXECUTED` |
| E-7 | One-statement `ADD COLUMN … DEFAULT nextval(...)` **rewrote the table** (filenode changed) and **backfilled all rows in heap order**, including inventing an order for tied rows; **the append-only trigger did not fire** | `EXECUTED` |
| E-8 | Two-statement form: **no rewrite, no trigger, 0 of 8 rows valued**; an insert arriving between the statements gets **`NULL`**; an `UPDATE` backfill is refused `P0001` | `EXECUTED` |
| E-9 | `GENERATED ALWAYS AS IDENTITY` is implicitly `NOT NULL` and **refuses an explicit `NULL`**, so it cannot coexist with unsequenced legacy rows. `OVERRIDING SYSTEM VALUE` succeeded **without special privilege** | `EXECUTED` |
| E-10 | With a plain `DEFAULT`, a caller-supplied maximal value **pinned** `archived` as "latest" over a later legitimate transition. A `UNIQUE` index blocks a *second* maximal value, not the first | `EXECUTED` |
| E-11 | `NULLS LAST` ignored a `NULL`-seq corrective append; omitting the `NULLS` clause flips the result (`DESC` defaults to `NULLS FIRST`) | `EXECUTED` |
| E-12 | A cross-tenant lifecycle row was **accepted**; the table has **0 multi-column FKs**; `opportunity_feed_items` has no `(id, organization_id)` unique key, so a tenant-qualified FK is **not currently expressible** | `EXECUTED` |
| E-13 | Deleting the parent opportunity **or** the company is refused `P0001` via the cascade | `EXECUTED` |
| E-14 | A proof-of-concept function taking the lock **before** the read produced a **chain not a fork**, did not block a different opportunity, refused the second of two mutually exclusive transitions, left no row after a post-validation failure, and returned **identical** refusals for wrong-tenant and nonexistent ids | `EXECUTED` (proof of concept only) |
| S-1 | `ownedDbRpc` exists as a documented write seam **and has a production caller** — `prospectIdentity/ingestionBoundary.ts:1014` invokes `pi_apply_canonical_decisions` | `SOURCE` |
| S-2 | That precedent function is `LANGUAGE plpgsql` with **no explicit `SECURITY` clause** (hence `SECURITY INVOKER`), **no `SET search_path`**, and serialises with **`SELECT … FOR UPDATE`** on the subject row, not an advisory lock | `SOURCE` (`supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql:86-148`) |
| S-3 | `transitionLifecycle` persists its read: `previous_state: from` at `opportunityLifecycleService.ts:281` | `SOURCE` |
| S-4 | `isResolvedForAccountDeletion` has **zero non-test callers** and no account-deletion service exists | `SOURCE` |
| U-1 | **Production behaviour of every item above** — version, configuration, role model, grants, deployment topology | **`UNVERIFIED`** |

---

## 3. Proposed invariants

Mechanisms are chosen in §4–§6 only after these.

| ID | Required behaviour | Why it matters | Motivating evidence | How it could be tested | Unresolved |
|---|---|---|---|---|---|
| **I-1 Serialized transition validation** | For one opportunity, two competing transitions must not both validate against the same predecessor and both commit. The serialization mechanism must be **per-opportunity, tenant-qualified, acquired before the state read, and held until the transaction's outcome is determined** | E-4 showed the fork is live and reachable through the ordinary caller | E-4, E-14 | Two sessions, same opportunity, forced interleave; assert **no predecessor is claimed twice** | Mechanism choice (§6.1) |
| **I-2 Atomic transition** | Read, validate and insert are one atomic operation; a failure leaves no partially committed transition | E-4's fork exists only because the read and the insert are separate transactions | E-4, E-14, S-1 | Inject a failure after validation; assert row count unchanged | — |
| **I-3 Evidence-chain consistency** | Each accepted transition's `previous_state` equals the authoritative state it was validated against. **Historical rows are never repaired or reinterpreted** | E-5 and E-4 both produced false predecessors; E-6 makes them permanent | E-3, E-4, E-5, E-6, S-3 | Scan invariant: no `(opportunity, previous_state)` claimed by two rows **after** the fix | Whether to add a detection report for existing violations — **OWNER DECISION** |
| **I-4 Deterministic current-state reading** | All active consumers derive compatible results from **one documented rule**. Determinism and historical truth are separate properties and must be named separately | Four readers each re-derive "latest"; two re-implement the reducer | §7 consumer table | Same history through every reader; assert identical state | — |
| **I-5 Honest historical semantics** | Rows whose chronology cannot be established are **not** assigned one. Where legacy ties exist, the system must either expose the uncertainty or fail closed — never silently pick | E-7 showed a backfill invents order; E-8 showed the honest alternative | E-7, E-8 | Legacy tied rows: assert no ordering value and the declared fallback behaviour | **OWNER DECISION REQUIRED** — see D-8 |
| **I-6 Tenant integrity** | A lifecycle row must not reference another tenant's opportunity. Defence in depth: tenant-qualified lookup in the authoritative operation, plus schema-enforced integrity where expressible, plus RLS as a separate layer | E-12: the schema accepts a cross-tenant row today | E-12, E-14 | Cross-tenant pair refused; wrong-tenant and nonexistent indistinguishable | Whether to add the parent unique key — **OWNER DECISION** |
| **I-7 Append-only integrity** | Existing protections are preserved. **No ordinary repair path may rewrite lifecycle history**, and no migration may disable a trigger | E-6, E-7 (DDL bypasses the guard), E-8 | `UPDATE`/`DELETE` still `P0001` after any change | — |
| **I-8 Error and fail-closed behaviour** | Each consumer declares what it does on a read or transition failure, **appropriate to its role** — not a uniform fallback. The three discarded `error` values are addressed explicitly | Two `is_initial` probes and one dashboard reader discard `error`; one probe then proceeds to INSERT | §7 table | Inject a read failure per site; assert the declared behaviour | Per-role policy — partly **OWNER DECISION** |
| **I-9 Retention and terminality consistency** | No record becomes deletion-eligible because of a fabricated sequence, an arbitrary tie-break, or an unverified state. **No retention period or erasure rule is invented** | The live deletion gate is an ordering-independent existence probe; the terminality predicate has no caller | S-4, E-13 | Retention outcomes unchanged by the ordering change | **Q3 remains blocked** |
| **I-10 Single transition authority** | Exactly one authoritative transition operation and one evidence table. No helper, reader, ordering column or compatibility path becomes a competing source of truth | The sibling ledger's design notes reject a second authority for this reason | S-1 | Scan: no write path to the table outside the authoritative operation | Whether to revoke direct INSERT — **OWNER DECISION** |

---

## 4. Atomic transition design

### 4.1 Proposed flow

Pseudocode, **labelled as proposed design**. No SQL function is written here.

```
function transition(org, opportunity, to_state, actor, reasoning) -> result
  1. resolve identity:  the (opportunity, org) PAIR must exist
                        → else refuse 'opportunity_not_found_for_tenant'
  2. acquire per-opportunity serialization   ← BEFORE any read or allocation
  3. read authoritative current state        ← ordered by the ordering field
                        → none    → refuse 'lifecycle_history_missing'
                        → unknown → refuse 'lifecycle_evidence_unreadable'
  4. validate to_state against the EXISTING allowed-transition graph
                        from == to → refuse 'no_op_same_state'
                        not an edge → refuse 'transition_not_permitted'
  5. allocate the ordering value and INSERT the evidence row
                        with previous_state = the state read at step 3
  6. return a structured result (ok | reason)
  7. the lock is released only at transaction end
```

| Step | Responsibility | Failure modes | Tenant isolation | PoC demonstrated? | Application integration |
|---|---|---|---|---|---|
| 1 | Prove the pair exists | pair absent; wrong tenant | **The refusal is identical for both**, so it cannot be used to probe another tenant's existence | **Yes** (E-14) | **UNVERIFIED** |
| 2 | Serialize this opportunity only | lock wait, deadlock, timeout | Lock key must be tenant-qualified | **Yes** — a different opportunity was not blocked | **UNVERIFIED** |
| 3 | Authoritative read **after** the lock | read failure; absent history | Tenant predicate on the read | **Yes** | **UNVERIFIED** |
| 4 | Validate against the existing graph | not an edge; `from == to` | n/a | **Yes** | **UNVERIFIED** |
| 5 | Allocate **inside** the lock, then insert | constraint violation; insert failure | Tenant columns written from arguments, never from row data | **Yes** | **UNVERIFIED** |
| 6 | Structured result | — | Refusal text must not leak | **Yes** | **UNVERIFIED** |
| 7 | Hold the lock to transaction end | long transactions block the same opportunity | n/a | **Yes** — the contended session waited and then re-read | **UNVERIFIED** |

### 4.2 The design questions in §6, answered

| Question | Proposed answer | Label |
|---|---|---|
| Lock scoped to one opportunity and held through completion? | Yes, both — and the PoC showed a different opportunity proceeding concurrently | `EXECUTED` for the PoC |
| Can other application paths bypass it? | **Yes, today.** `ownedDbTable` can INSERT directly, and the database has no `BEFORE INSERT` guard. Closing this needs either a privilege change (revoke INSERT from the application role) or a guard trigger | `SOURCE`; the privilege state is **UNVERIFIED** |
| Lock identifier collision-safe and tenant-qualified? | The PoC hashed `org:opportunity`. **A `SELECT … FOR UPDATE` on the parent row is collision-free and tenant-qualified by its `WHERE`**, and it is the repo's own precedent (S-2). See §6.1 | `SOURCE` + `INFERRED` |
| Retries safe after a commit whose response was lost? | **Not fully.** A blind retry re-reads the now-advanced state and is refused as `no_op_same_state` or `transition_not_permitted` — safe but opaque. An idempotency key would make it explicit | **OWNER DECISION** (D-12) |
| Repeated destination states? | Governed by the existing graph: `from == to` is refused; a revisit via another state is permitted. **No semantics invented** | `SOURCE` |
| Result for invalid transitions? | A structured refusal, not an exception, so the caller can distinguish "not allowed" from "could not determine" | Proposal |
| Wrong-tenant vs nonexistent? | **Identical refusal** | `EXECUTED` |
| Execution privileges and `search_path`? | `SECURITY INVOKER` is sufficient and is the precedent (S-2). **If** a future variant needs `SECURITY DEFINER`, `SET search_path` becomes mandatory — the precedent does **not** pin it, which is a gap to close in any definer function | `SOURCE` |
| Direct invocation outside the seam? | Possible for anyone with EXECUTE. Acceptable **only if** the function is itself safe when called directly — which is why every tenant predicate lives inside it | Proposal |
| Append-only preserved? | Yes — the operation only INSERTs | `EXECUTED` |
| Concurrent transitions to the same destination? | Serialized: the second re-reads and is refused `no_op_same_state` | `EXECUTED` |
| Does it need a migration? | **Yes** — a function, an ordering column, an index, and a constraint. Exact scope in §6 | Proposal |

---

## 5. Future ordering semantics

### 5.1 What the field would represent — and what it would not

| Property | Guaranteed? | Why |
|---|---|---|
| **Per-opportunity serialized transition order** | **Yes**, if allocated after the lock and the lock is held to commit | the next writer for that opportunity cannot allocate until the previous transaction ends |
| **Per-opportunity commit order** | **Yes**, for the same reason | the critical section spans allocation *and* commit |
| **Global commit order across opportunities** | **No** | E-2: unrelated transactions interleave freely |
| **Business-event order** (when the decision was made) | **No** | nothing records decision time; `transitioned_at` is transaction start |
| **Any order for legacy rows** | **No** | E-7/E-8 and the unrecoverability argument |

**This proposal therefore claims only per-opportunity serialized transition order.** Any document or comment asserting commit order generally would repeat the error E-2 disproved.

### 5.2 The approaches in §7, compared

**A — database-assigned ordering field for future rows.** A column default is the wrong instrument. `DEFAULT nextval(...)` is caller-writable, accepts explicit values, `NULL`s and duplicates (E-1 family), and enabled the demonstrated pinning (E-10). `GENERATED ALWAYS` blocks the ordinary path but **cannot be nullable** (E-9), which forces a backfill the data cannot justify. `GENERATED BY DEFAULT` is caller-writable. **A is rejected as the primary mechanism** — not because a monotonic value is wrong, but because *letting the column assign it* is.

**B — ordering established inside the authoritative operation. ← recommended.** The function calls `nextval()` explicitly **after** the lock and writes the value. Consequences:
- the column needs **no DEFAULT and no identity declaration**, so it can be plain `bigint NULL`, and **E-9's contradiction simply disappears**;
- allocation is inside the critical section, which is what gives §5.1's guarantee;
- protection against caller-supplied values comes from the **write path** (only the function writes), not from a column attribute — which is the honest place for it, since E-9 showed even `GENERATED ALWAYS` yields to `OVERRIDING SYSTEM VALUE`.

**C — interim deterministic tie-breaker** (`transitioned_at DESC, id DESC`). It makes all readers agree and needs no migration. **It recovers no chronology whatsoever** — `id` is `gen_random_uuid()`. It is therefore acceptable for **display** consumers (board, dashboard, history) and **not** acceptable as the basis of a terminality or deletion decision. It also makes a forked resolution stable, hence quieter. **Proposed only as a stop-gap for the display readers if implementation is deferred**, never as a substitute for B.

**D — separate ordering authority.** Rejected. A second table would need its own atomicity, its own tenant integrity and its own erasure story, and would violate I-10. No evidence supports it.

### 5.3 Proposed reader rule

```
ORDER BY seq DESC NULLS LAST, transitioned_at DESC
```

The `NULLS LAST` clause must be **explicit**: E-11 showed `DESC` defaults to `NULLS FIRST`, which inverts the intent.

E-11's counterexample — a `NULL`-seq corrective append dated in the future being ignored — **does not apply under this design, and the reason matters**: a `CHECK (seq IS NOT NULL) NOT VALID` makes every *new* row carry a value, so `seq IS NULL` becomes a reliable synonym for "written before the migration". Every sequenced row is then genuinely later than every legacy row, and `NULLS LAST` is correct by construction rather than by luck.

**The cost of that, stated plainly:** it also closes the only repair route that existed for a born-terminal row — an out-of-band corrective append. Under this design a repair must go through the authoritative operation, which validates transitions and would refuse to move out of `archived`. **See D-9.**

`NOT VALID` binding new rows while exempting legacy rows without a table scan is `INFERRED` from documented semantics and is listed for verification in §6.5.

---

## 6. Legacy-row semantics, migration and rollout

### 6.1 Which serialization primitive

| | **Advisory lock** (`pg_advisory_xact_lock(hash(org:opp))`) | **`SELECT … FOR UPDATE` on the parent row** ← proposed |
|---|---|---|
| Demonstrated | **Yes** (E-14) | **No** — proposal, `INFERRED` |
| Collision | 64-bit hash; collision theoretically possible | **None** — a real row |
| Tenant qualification | must be built into the key | **Intrinsic** to the `WHERE` |
| Missing parent | lock succeeds, then the FK fails later | **Fails closed immediately** |
| Repository precedent | none | **Yes** — S-2 uses `FOR UPDATE` in the one existing plpgsql write function |
| Side effects | none | takes a row lock on `opportunity_feed_items`; its only writer inserts rather than updates, and parent deletion is already refused (E-13) |

**Proposed: `FOR UPDATE` on the tenant-qualified parent row**, with the advisory lock as the fallback if verification finds contention. The PoC demonstrated the advisory variant, so **the row-lock variant is a proposal requiring verification**, not a demonstrated property.

### 6.2 Legacy rows

**They are never given a value.** `seq IS NULL` means "pre-migration, order unknown". For an opportunity whose history is entirely legacy *and* contains tied timestamps, the true order is **unrecoverable** — `transitioned_at` ties, `id` is random, `ctid` is physical, and the `previous_state` chain cannot be linearised because the graph permits state repetition.

What a reader should then do **splits by role**, which is I-8's point:

| Consumer role | Proposed behaviour | Status |
|---|---|---|
| Display (history, board, dashboard) | return the deterministic pick and, where the surface allows, mark it uncertain | proposal |
| Transition validation | proceed — the authoritative operation will record a correct predecessor from here on | proposal |
| **Terminality / deletion eligibility** | **fail closed** for a legacy-only opportunity with unresolved ties, consistent with the approved direction that unknown state is non-terminal | **OWNER DECISION REQUIRED** (D-8) |

### 6.3 Phased plan — conceptual only, no migration written

| Phase | Content | Evidence status |
|---|---|---|
| **P0 Pre-migration conditions** | Confirm current grants on the table and on `nextval`; confirm no other writer exists; take a count of rows with a false predecessor (detection only, no repair) | **UNVERIFIED** — grants were never inspected |
| **P1 Schema change** | **Two statements, never one:** `ADD COLUMN seq bigint;` then create the sequence. **No column DEFAULT at all** (the function assigns). Then `ADD CONSTRAINT … CHECK (seq IS NOT NULL) NOT VALID`, `UNIQUE (seq)`, and an index `(organization_id, opportunity_feed_item_id, seq DESC NULLS LAST, transitioned_at DESC)` matching the reader predicate. Create the transition function | `EXECUTED` that the two-statement form neither rewrites nor backfills nor fires the trigger; `INFERRED` for `NOT VALID` |
| **P2 Transition-writer change** | `transitionLifecycle` delegates to the function via `ownedDbRpc`; it stops reading-then-inserting | proposal |
| **P3 Reader change** | All current-state readers adopt the §5.3 rule **in one release**; the duplicate dead reader is removed or left untouched per D-4 | proposal |
| **P4 Verification** | §8 matrix, on a disposable database | proposal |
| **P5 Rollout** | **P1 → P3 → P2.** Readers must reach 100 % of instances *before* the writer depends on the new ordering | proposal |
| **P6 Rollback / forward recovery** | Code rollback is safe. `DROP COLUMN` is destructive and should be the last resort | proposal |

**Why the rollout order is P1 → P3 → P2 and not P1 → P2 → P3.** Because `transitionLifecycle` persists its read (S-3), a window in which two code versions order differently lets each write a different predecessor for the same prior state — and E-6 makes that permanent. Readers must therefore converge *before* any writer relies on the new order. **A feature gate is not sufficient** if it can be flipped per-instance; the safe shapes are a single-release reader rollout or moving the ordering rule database-side (a view or the function's own return value) so skew is impossible.

### 6.4 The intermediate state is a real hazard, not a formality

E-8 showed an insert arriving **between** the two statements receives `NULL`. Under this design that row would then be indistinguishable from a legacy row **and** would violate the `NOT VALID` check once added. Mitigations, in preference order: run P1's statements in **one transaction** (both are catalog-only, no rewrite — `INFERRED`); or add the `CHECK` only after the writer is live; or accept a brief writer pause. **The plan must not claim the two-statement form is automatically safe merely because it avoids the rewrite.**

### 6.5 Items requiring verification before implementation

1. `CHECK … NOT VALID` binds new rows, exempts legacy rows, and takes no table scan — `INFERRED`.
2. `ADD COLUMN` + `ADD CONSTRAINT … NOT VALID` + `CREATE UNIQUE INDEX` in **one transaction** cause no rewrite — `INFERRED`.
3. `UNIQUE (seq)` tolerates many `NULL`s — `INFERRED` (standard, and consistent with the E2 observation that a unique index built over NULL-bearing data without complaint).
4. `SELECT … FOR UPDATE` on the parent gives the same serialization the advisory lock demonstrated — **not demonstrated**.
5. Current table grants, and whether revoking direct INSERT from the application role is feasible — **UNVERIFIED**.
6. Lock-wait behaviour under realistic concurrency and statement timeouts — **UNVERIFIED**.

---

## 7. Eleven-consumer reconciliation

Grounded in the source references carried by evidence 2 and 3. **I verified the call sites and error-handling shape read-only in this task; I did not re-execute anything.** The count is **11 query sites across 8 functions** — the categories in the brief overlap (transition validation *is* reader A1), which is why category arithmetic gives a different total.

| ID | Location | Function / query | Status | Reads/writes evidence | Current rule | Required under the proposal | Legacy ties | Error handling today | Regression test | Implementation still required |
|---|---|---|---|---|---|---|---|---|---|---|
| **A1** | `opportunityLifecycleService.ts:98` | `readCurrentLifecycleState` | production (internal) | **reads; its value is written at `:281`** | `transitioned_at DESC LIMIT 1` | adopt §5.3; this is also step 3 of the authoritative operation | fail closed for terminality | handled → `unreadable` | T3, T8, T12 | **Yes** |
| **A2** | `:207` | `getCurrentLifecycleState` | **dead — zero callers** | reads | same | remove, or leave untouched per D-4. **Not changed by this proposal** | n/a | throws | — | D-4 |
| **A3** | `:305` | `getLifecycleBoardCounts` | production | reads | `transitioned_at DESC`, **no `LIMIT`**, org-wide, app reducer | adopt §5.3; reducer must use the same rule | deterministic pick, may mark uncertain | handled | T12, T15 | **Yes** |
| **A4** | `strategicDashboardsService.ts:153` | dashboard tile | production | reads | own reducer | adopt §5.3 | as A3 | **`error` DISCARDED** → silently reports 0 | T15, T18 | **Yes** |
| **B1** | `opportunityLifecycleService.ts:222` | `listLifecycleHistory` | production | reads | `transitioned_at ASC` | order by `seq ASC NULLS FIRST, transitioned_at ASC` | legacy segment order unknown | handled | T12 | **Yes** |
| **C1** | `:166` | `is_initial` probe | production | reads | `is_initial = true` | **unchanged by ordering**; must fail closed on read error instead of proceeding to INSERT | n/a | **`error` DISCARDED** → becomes "no initial row" | T13 | **Yes (I-8)** |
| **C2** | `:190` | same probe after `23505` | production | reads | same | same | n/a | **`error` DISCARDED** | T13 | **Yes (I-8)** |
| **C3** | `retentionService.ts:165` via `retention.ts:107` | `findProtectedIds` — **the live deletion gate** | production | reads | existence only, **no ordering** | **unchanged** — ordering must not alter deletion eligibility (I-9) | unaffected | fails closed | T14 (exists) | No |
| **D1** | `auditExportService.ts:81` via `:27` | audit export window | production | reads | `transitioned_at ASC`, `LIMIT 5000` | optionally order by `seq` for stable pagination | unaffected | handled | T17 | Optional |
| **D2** | `retentionService.ts:215` via `retention.ts:58` | retention scope count | production | reads | `< cutoff` | unchanged | unaffected | fails closed | T14 | No |
| **D3** | `retentionService.ts:234` | retention candidate ids | production | reads | `< cutoff`, `LIMIT 10000` | unchanged | unaffected | fails closed | T14 | No |

**Writers:** two — `initialiseLifecycleForOpportunity:174` and `transitionLifecycle:276`; neither supplies `transitioned_at`. Under the proposal the second delegates to the authoritative operation; the first also needs an ordering value for its initial row (**an easy omission — flagged**).

**`isResolvedForAccountDeletion` is not a live control.** Zero non-test callers and no account-deletion service (S-4). It is nonetheless the clearest statement of the terminality rule in code, and is the natural consumer of the fail-closed legacy behaviour in §6.2.

---

## 8. Regression test matrix

**Proposed only. No test was added or changed, and nothing here is marked passing.**

| ID | Preconditions | Action | Expected | Invariant | Evidence / proposed | Level | Runnable pre-implementation? | Policy decision needed? |
|---|---|---|---|---|---|---|---|---|
| T1 | one initial row | two transitions in one transaction | later transition is current | I-4 | **existing L3 — currently neutralised by its earlier-timestamp fixture** | real-PG | yes (fails today) | no |
| T2 | — | inspect columns/indexes/constraints | ordering column, unique, index, `NOT VALID` check all present | I-4 | **existing L3b — rewrite, do not weaken** | real-PG | no | no |
| T3 | tie | read via every reader | all agree | I-4 | proposed | real-PG | yes | no |
| T4 | repeated states | replay | order unambiguous | I-3 | proposed | real-PG | yes | no |
| T5 | one initial row | **two concurrent competing transitions** | **no predecessor claimed twice** | **I-1** | proposed | real-PG | yes (fails today) | no |
| T6 | one initial row | two concurrent transitions to the **same** destination | one succeeds, one refused | I-1 | **E-14 (PoC)** | real-PG | no | no |
| T7 | two opportunities | concurrent transitions | neither blocks the other | I-1 | **E-14 (PoC)** | real-PG | no | no |
| T8 | valid state | fail after validation | no row, no partial evidence | I-2 | **E-14 (PoC)** | real-PG | no | no |
| T9 | committed transition | retry with a lost response | defined, non-duplicating outcome | I-2 | proposed | real-PG | no | **yes (D-12)** |
| T10 | two tenants | wrong-tenant and nonexistent ids | **identical refusal** | I-6 | **E-14 (PoC)** | real-PG | no | no |
| T11 | evidence row | `UPDATE` and `DELETE` | `P0001`, unchanged | I-7 | **existing `pi_lifecycle_b21`** | real-PG | yes | no |
| T12 | mixed history | all 11 consumers | identical current state | I-4 | proposed | unit + real-PG | partly | no |
| T13 | read failure injected at `:166` / `:190` | initialise | fails closed, does **not** INSERT | I-8 | proposed | unit + real-PG | yes | partly |
| T14 | protected + eligible rows | retention, all three sites | unchanged by ordering | I-9 | **existing `ret_retention_pre_exclusion`** | real-PG | yes | no |
| T15 | mixed history | board and dashboard | agree with A1; A4 no longer discards `error` | I-4, I-8 | proposed | unit + real-PG | yes | no |
| T16 | column exists | caller supplies `seq` directly | refused, or no write path exists | I-10 | proposed | real-PG | no | **yes (D-10)** |
| T17 | legacy rows `NULL` | read | fallback consistent; sequenced rows outrank legacy | I-5 | proposed | real-PG | yes | **yes (D-8)** |
| T18 | migration stopped between statements | re-run | re-runnable; no row left ambiguous | I-5 | proposed | real-PG | no | no |
| T19 | concurrent insert during migration | insert in the window | gets a value, or is refused | I-5 | proposed | real-PG | no | no |
| T20 | two tenants | cross-tenant pair | **refused** (currently accepted) | I-6 | **E-12 pins today's behaviour** | real-PG | yes | **yes (D-11)** |
| T21 | lifecycle rows exist | delete parent, delete company | `P0001`, both survive | I-7, I-9 | **E-13** | real-PG | yes | no |
| T22 | non-superuser role under RLS | cross-tenant read/write | refused | I-6 | **NOT RUN — every experiment used a superuser** | real-PG | no | no |
| T23 | post-fix | scan for existing false predecessors | detection only, no repair | I-3 | proposed | real-PG | yes | **yes (D-13)** |

---

## 9. Option and trade-off matrix

| | **1. Atomic operation + ordering inside it** ← recommended | **2. Atomic operation, no ordering column** | **3. Interim tie-breaker only** |
|---|---|---|---|
| Prevents the transition race | **Yes** | **Yes** | **No** |
| `previous_state` integrity | **Yes** for new rows | **Yes** for new rows | **No** |
| Future determinism | **Yes** — per-opportunity serialized order | **Partial** — the chain is correct but a repeated state leaves replay ambiguous | **Yes**, but arbitrary |
| Historical truth | **No** (declared) | **No** (declared) | **No** (and easy to mistake for yes) |
| Legacy compatibility | `NULL` legacy rows, explicit rule | unchanged | unchanged |
| Tenant integrity | improved in the operation; schema key still **OWNER DECISION** | same | unchanged |
| Append-only | preserved | preserved | preserved |
| Retention / terminality safety | safe **if** D-8 is decided | safe | **unsafe as a terminality basis** |
| Migration complexity | column + index + constraint + function | function only | **none** |
| Deployment compatibility | reader-first, single release | writer-only, simpler | trivial |
| Test burden | T1–T21 | T1–T15 minus ordering tests | T3, T12 |
| Unverified | §6.5 items 1–6 | lock primitive, grants | nothing material |

### 9.1 Effort — proposal, not a commitment

Kept separate, as required, and **expressed in human engineer-days for implementation work**:

| Stream | Estimate | Assumptions / exclusions |
|---|---|---|
| Investigation | **spent** — three reports | not re-estimated |
| **Design** (this document) | **spent** — see §11 | — |
| **Implementation — Option 1** | **3.0–5.0** | function + column + index + constraint + 2 writers + 5 readers; excludes CI, review, and any Phase 2 work |
| **Implementation — Option 2** | 1.5–3.0 | function + 2 writers only |
| **Implementation — Option 3** | 0.25–0.5 | readers only |
| **Verification** | **1.0–2.0** | T1–T21 on a disposable database; **excludes T22**, which needs an authenticated-role harness that does not exist |
| **Rollout** | **0.5–1.0** | reader-first single release, plus the §6.4 intermediate-state handling |

**The earlier 3.5–6.5 engineer-day figure is not repeated as a commitment.** For the now-explicit Option 1 scope the comparable total is **4.5–8.0 engineer-days** across implementation, verification and rollout. **This is a proposal, not an approved baseline, and the programme baseline is unchanged** (§10).

---

## 10. Retention, terminality and Q3 boundaries

| Area | Effect of this proposal |
|---|---|
| Retention eligibility | **None.** The live gate (C3) is an ordering-independent existence probe; D2/D3 window by time. I-9 forbids any record becoming deletion-eligible because of an ordering artefact |
| Terminal-state interpretation | Unchanged: **`archived` remains the only terminal state** for ordinary account deletion. `dismissed` and `converted` are **not** redefined |
| `is_initial` | Unchanged mechanically; the two probes gain fail-closed error handling (I-8), and the initial row needs an ordering value (§7) |
| Account-deletion blocking | No gate exists today (S-4). The proposal makes the state such a gate would read trustworthy for post-migration history and **explicitly untrustworthy** for legacy ties (D-8) |
| Tenant deletion | Unchanged and still **refused** by the append-only cascade (E-13). This proposal neither fixes nor worsens it |
| Append-only evidence | Preserved (I-7); no trigger disabled, no backfill |
| Evidence relationships | Unchanged; no new reference is introduced |
| **Legal erasure / Q3** | **Out of scope and still blocked.** No retention period, surviving-record rule or erasure semantic is invented. The approved direction — that legal erasure proceeds through a governed path under approved policy and must not be permanently blocked by ordinary deletion restrictions — is **quoted, not extended**, and this proposal does not implement it |

**If ordering ambiguity is not resolved, retention remains safe** (it never reads current state), **but any future terminality gate would not be.** That is the honest boundary.

---

## 11. Limitations and unverified claims

- **Nothing here is verified against production.** Version, configuration, grants, role model and deployment topology are all `UNVERIFIED`, and no equivalence claim is made.
- **The proof of concept is not production readiness.** E-14 demonstrated the *shape* on a disposable database with a superuser and a purpose-built schema. Application integration, the real schema's constraints, the authentication model and the deployment process are all unverified.
- **The recommended lock primitive was not the one demonstrated.** `FOR UPDATE` on the parent row is a proposal (§6.1); the PoC used an advisory lock.
- **Six items need verification before implementation** (§6.5), two of which — `NOT VALID` semantics and single-transaction DDL — are load-bearing for the migration plan.
- **T22 (authenticated-role RLS isolation) is NOT RUN**, and nothing in the three evidence reports contains a successful authenticated-role test. Every experiment ran as a superuser, which bypasses RLS.
- **Experiments B and C reproduced query shapes and the transaction boundary, not the product TypeScript.**
- **This is not independent review.** The same agent authored the earlier investigation, commissioned the independent review, ran the experiments and wrote this proposal. The one structurally independent review in the chain was model-family-correlated, and earlier in this programme such a reviewer confirmed two findings that later proved wrong.
- **No detection pass has been run for existing false predecessors.** Their number is unknown (D-13).

---

## 12. Owner-decision register

**No decision below is approved, adopted or authorized.**

| ID | Question | Recommended candidate | Alternatives and consequences | Evidence | Unverified | Type | Can implementation proceed without it? |
|---|---|---|---|---|---|---|---|
| **D-1** *(replaces the original)* | Which design? | **Option 1** — atomic operation with the ordering value allocated inside it | Option 2 leaves replay ambiguous for repeated states; Option 3 fixes neither defect | E-4, E-14, §9 | §6.5 | technical | **No** |
| **D-2** | Any historical backfill? | **No** | A backfill either invents heap order (E-7) or requires suspending the append-only guard (E-8) | E-7, E-8 | — | technical | No — the plan depends on it |
| **D-3** | **What does the ordering field mean contractually?** | **Per-opportunity serialized transition order** — explicitly *not* global commit order or business-event order | Claiming commit order repeats the error E-2 disproved | E-2, E-14 | — | technical | **No — this is the critical question** |
| **D-4** | Remove the dead `getCurrentLifecycleState`? | **Remove** | Leaving it invites a future caller to reintroduce the unsafe read | S-4, §7 | — | technical | Yes |
| **D-5** | Concurrency remediation and timing | **Do it first, in this work package** | Deferring leaves a demonstrated defect writing permanent false evidence with every transition | E-4, E-6 | — | technical / schedule | No |
| **D-6** | Further verification needed after the executed run? | **Yes — the six items in §6.5**, chiefly `NOT VALID` and single-transaction DDL | Proceeding without them risks an intermediate state like E-8's | §6.5 | — | technical | No |
| **D-7** | Authorize implementation | **Not yet** — after D-1, D-3 and D-8 | — | — | — | schedule | — |
| **D-8** | **Legacy tied rows: what should a terminality read return?** | **Fail closed** (treat as unknown, hence non-terminal) | Picking deterministically would make a fabricated order drive deletion eligibility | E-7, I-5 | — | **product / policy** | **No** |
| **D-9** | Under the new design a born-terminal row has **no repair route**. Accept, or provide a governed correction path? | Accept for now; record the limitation | A governed path would be a new privileged write into append-only evidence | §5.3 | — | product | Yes, with the limitation recorded |
| **D-10** | Enforce "only the authoritative operation writes" by revoking direct INSERT? | **Yes, if grants permit** | Without it, I-10 rests on convention; any `ownedDbTable` caller can still insert | §4.2 | **grants UNVERIFIED** | technical | Yes, degraded |
| **D-11** | Add `UNIQUE (id, organization_id)` on `opportunity_feed_items` and a tenant-qualified FK? | **Yes** — additive, and it is the sibling ledger's pattern | Without it, tenant integrity at this boundary stays application-only (E-12) | E-12 | deletion-behaviour review | technical | Yes, degraded |
| **D-12** | Retry semantics for a lost response after commit | Define an explicit idempotency contract | A blind retry is safe but reports a confusing refusal | §4.2 | — | product | Yes |
| **D-13** | Run a detection pass for existing false predecessors, report-only? | **Yes** — detection only, never repair | Without it the size of the existing damage is unknown | E-4, E-5, I-3 | — | technical | Yes |
| **D-14** | The three discarded `error` values | Fix all three; fail closed per role | Leaving C1 means a read failure still leads to an INSERT | §7, I-8 | — | technical / product | Yes, degraded |
| **D-15** | Q3 legal-erasure dependency | **Unchanged — remains blocked** | Nothing here advances or requires it | §10 | policy absent | **legal / policy** | Yes — this proposal does not depend on it |

---

## 13. Schedule impact

**The frozen baseline is unchanged:** Milestone A′ **25 November 2026 / 28.5 human engineer-days**; WP-7 **17 November 2026 / 4.0**; C-1 **8–12**, zero float at the high end; **`OVERRUN RISK` remains raised**; next checkpoint **Friday 23 October 2026**.

**This proposal authorizes no work, extends no deadline and changes no estimate.**

The §9.1 figure of **4.5–8.0 engineer-days** for the full Option 1 scope is larger than the earlier 3.5–6.5 planning figure, because the scope is now explicit: a tenant-qualified parent key, a `NOT VALID` constraint, an index matching the reader predicate, five reader changes, two writer changes, the reader-first rollout, and the §6.5 verification. **Against a C-1 estimate with zero float at its high end this is an overrun at that end** — consistent with the risk already raised, and reported rather than resolved. **Documented here, not applied: the baseline is untouched and no revised estimate is adopted.**

### 13.1 Effort accounting for this task

| | |
|---|---|
| **Estimate recorded at task start** | **2.5 human engineer-hours** — assumes the three evidence reports are authoritative and no experiment is re-run; excludes implementation, migration authoring and any execution |
| Start / end | **2026-10-19T11:48:10+05:30** (UTC `06:18:10Z`) → **12:01 +05:30** |
| **Wall-clock elapsed** | **≈ 13 min** |
| **Active effort** | **≈ 12 min** of agent work — **well under 25 % of the estimate**, so **no `75% ESTIMATE CONSUMED` warning and no `OVERRUN RISK` for this task** |
| Waiting | **none** |
| Machine time | negligible — read-only source inspection; **no database, no container**. **Machine time is not converted into engineer-hours** |

---

## 14. Final authorization boundary

**No design is adopted. No owner decision is inferred, approved or ratified.** No product code, schema, migration, test or configuration was changed. No database operation and no container operation occurred. Phase 2 remains unauthorized; Q3 remains blocked unless verified policy evidence closes it; addendum v0.3 remains unratified; the schedule baseline is unchanged.

**The owner decides D-1 through D-15. Implementation remains unauthorized until they do.**
