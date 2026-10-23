# PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001 — nondeterministic lifecycle ordering

**INVESTIGATION ONLY. NO IMPLEMENTATION WAS PERFORMED.** No product-code change, no test change, no schema change, no migration, no database created or written, no production access, no provider call, no commit, push, merge or deployment.

> ## Summary
>
> The defect is **confirmed against the current repository**, and it is **wider than reported**: not two readers but **four** derive "current state" from `ORDER BY transitioned_at DESC` with no tiebreaker, and because each is a separate query they **can disagree with one another** under a tie. One of them decides **account-deletion terminality**.
>
> The repository has **already settled this question for its sibling ledger**, and written down why. `prospectLifecycle/lifecycleReader.ts:92-97` states: *"Ordered by `seq`, never by `transitioned_at`… `seq` is a table-wide identity column and the chain trigger holds a per-prospect advisory lock across each insert, so sequence order is commit order. 'Latest' is a fact, not a tie-break."*
>
> **That sentence also defeats the naive fix.** An identity column alone gives *assignment* order, not *commit* order; the PI ledger makes them coincide only because its trigger serialises writers. The Community ledger has no such trigger.
>
> **Recommended: Option A-minimal** — a *nullable* sequence column, **no historical backfill**, and a fallback ordering contract, because the data genuinely cannot establish historical chronology and a backfill would require suspending the append-only trigger. **Estimated 1.0–2.0 human engineer-days. It lands on a C-1 estimate with zero float.**
>
> **Implementation authorization remains NONE.** Everything below is analysis and recommendation; several points need a reviewer who did not author the implementation.

---

## 1. Baseline and source hashes

Measured **2026-10-18T17:38:12+05:30 (IST)**.

| | Value |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree, start | **160 entries (72 M / 88 ??)** |
| Working tree, end | **161 entries** — the one addition is this report |

**Hash gate:** `PI-C1-PHASE-1-LIFECYCLE-B21-PG-VERIFICATION-001.md` = `b765b6a0efcffffcfc90f890decedd87c75a90f49247ca2cc38831d40ac8439e` — **MATCH**, and byte-identical at the end.

| Source / migration | SHA-256 (16) |
|---|---|
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/types/opportunityLifecycle.ts` | `90650ccb11deec8f` |
| `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` | `51bab399a0831cde` |
| `supabase/migrations/20261028000000_pi_prospect_lifecycle_state.sql` | `368e6f6125597cae` |
| `backend/tests/realschema/pi_lifecycle_b21.test.ts` | `fa767658ebbea3f5` |

Nothing was reset, cleaned, stashed or reformatted.

---

## 2. The defect, verified against the current repository

Each reported finding was re-checked rather than assumed. **Evidence class is marked throughout:** `[PG]` = already demonstrated against real PostgreSQL in the verification run; `[SRC]` = source inspection performed in this task.

| Reported finding | Verification | Class |
|---|---|---|
| `readCurrentLifecycleState` orders by `transitioned_at DESC LIMIT 1` | **CONFIRMED** — `opportunityLifecycleService.ts:98-106` | `[SRC]` |
| `transitioned_at` is the only ordering column | **CONFIRMED** — the table has 10 columns and no sequence or identity among them | `[PG]` + `[SRC]` |
| The primary key is a random uuid | **CONFIRMED** — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` | `[SRC]` |
| Two inserts in one transaction share `now()` | **CONFIRMED** — measured 1 distinct value for 2 rows; `clock_timestamp()` gave 2 | `[PG]` |
| The PI sibling has a monotonic `seq` | **CONFIRMED** — `20261028000000:105`, `seq bigint GENERATED ALWAYS AS IDENTITY` | `[SRC]` |
| `getLifecycleBoardCounts` shares the weakness | **CONFIRMED** — `:305-308`, and **two further readers also share it** (§3) | `[SRC]` |
| L3's fixture was changed to seed an earlier timestamp | **CONFIRMED** — `pi_lifecycle_b21.test.ts`, `seedInitialEarlier()` | `[SRC]` |
| L3b records the structural gap | **CONFIRMED** — three assertions, which will **fail once the gap is closed**, by design | `[SRC]` |

### 2.1 One correction and one addition to the reported picture

**Correction — the Community timestamp is NOT caller-supplied.** Neither `initialiseLifecycleForOpportunity` (`:174-186`) nor `transitionLifecycle` (`:276-292`) includes `transitioned_at` in its insert payload, so the column always takes its `DEFAULT NOW()`. `[SRC]`

That matters: on the **PI** ledger `transitioned_at` *is* caller-supplied (`lifecycleWriter.ts:306`, `transitioned_at: input.transitionedAt ?? input.now`), which is precisely why its reader refuses to order by it. The Community ledger is **less** exposed — its timestamps are database transaction time, so ties arise only (a) within a single transaction, or (b) across transactions committing in the same microsecond. **The defect is narrower than the PI rationale implies, but it is the same class of defect.**

**Addition — the transition graph permits a state to repeat.** `ALLOWED_LIFECYCLE_TRANSITIONS` includes `reviewing → triaged`, `dismissed → triaged`, `qualified → reviewing` and `monitoring → qualified` (`opportunityLifecycle.ts:36-45`). So one opportunity may hold several rows with the same `state`. This is decisive for §5: **historical order cannot generally be reconstructed from the `previous_state` chain.** `[SRC]`

---

## 3. Complete reader and writer inventory

Every reference to `opportunity_lifecycle_states` in non-test code was enumerated, then every query ordering by `transitioned_at` anywhere in the repository. **Four readers derive a "latest row", not two.**

### 3.1 Readers that derive current state

| # | Consumer | Query / ordering | Total order? | Ties possible? | How current state is derived | What it affects |
|---|---|---|---|---|---|---|
| **R1** | `opportunityLifecycleService.readCurrentLifecycleState` `:98-106` | `.order('transitioned_at', desc).limit(1).maybeSingle()` | **NO** | **YES** | the single returned row | **Terminality and deletion eligibility** via `isResolvedForAccountDeletion`; and the `from` state the transition allowlist validates against |
| **R2** | `opportunityLifecycleService.getCurrentLifecycleState` `:207-213` | identical ordering, `limit(1)` | **NO** | **YES** | the single returned row | **Nothing — it has no callers at all**, not even tests (§3.4) |
| **R3** | `opportunityLifecycleService.getLifecycleBoardCounts` `:305-308` | `.order('transitioned_at', desc)` over the **whole org**, then an application reducer keeping the **first row seen** per opportunity | **NO** | **YES** | first-seen wins after an arbitrary tie order | **Lifecycle board counts** returned by `GET /api/active-leads/lifecycle` |
| **R4** | `strategicDashboardsService` `:153-157` | `.in(...).order('transitioned_at', desc)`, then **its own** reducer keeping the first row seen | **NO** | **YES** | first-seen wins after an arbitrary tie order | **Dashboard tiles** — `qualified_or_better`, `converted`, `qualified_rate_pct` |
| **R5** | `opportunityLifecycleService.listLifecycleHistory` `:222-226` | `.order('transitioned_at', ascending)` — no limit | **NO** | **YES** | not a current-state read; returns full history | **Displayed history order** on the route |

### 3.2 Consumers that use the timestamp for windowing only

| Consumer | Use | Affected by ties? |
|---|---|---|
| `auditExportService:27` | `time_column: 'transitioned_at'` for export windowing | **No** — selects a range, not a latest row |
| `retention.ts:58` | retention `time_column` for the cutoff | **No** for ordering. (Hard delete of this target is refused anyway: it is in `APPEND_ONLY_TARGETS`, and the guard refuses the cascade) |
| `retention.ts:107` | protected-children map, `parent_column` only | **No** |

### 3.3 Writers

| Writer | Supplies `transitioned_at`? | Serialised? |
|---|---|---|
| `initialiseLifecycleForOpportunity` `:161-199` | **No** → `DEFAULT NOW()`. Guarded by the partial unique index `uq_opp_lifecycle_initial` and a `23505` re-read | one initial row per opportunity is enforced by the index |
| `transitionLifecycle` `:244-297` | **No** → `DEFAULT NOW()` | **NOT serialised** — see §3.5 |

### 3.4 Can consumers disagree about the current state? **Yes — and that is the sharpest consequence**

R1, R3 and R4 are **three separate queries**, each with a non-total ordering. Under a tie, PostgreSQL may return the tied rows in any order, and **nothing requires two queries to choose the same one**. So in a single tie the system can simultaneously hold:

- R1 saying an opportunity is `converted` → **not** terminal → account deletion refused;
- R3 counting it as `triaged` on the board;
- R4 excluding it from `qualified_or_better` on the dashboard.

There is no single authoritative current-state definition shared by the readers — each re-implements it, and **two of the three re-implement the reducer independently** (R3 and R4 have separate, similar-but-not-shared loops). `[SRC]`

**R2 is dead code**: a repository-wide search found **no caller** of `getCurrentLifecycleState` in product code or tests. It is an exported duplicate of R1 with the same weakness — a latent trap for a future caller.

### 3.5 A second, independent defect found while tracing this one

`transitionLifecycle` is a **read-modify-write with no lock and no atomicity**: it reads the current state (R1), validates the allowlist in application code, then inserts. Two concurrent transitions on the same opportunity can both read the same `from` state and both insert, producing two successors to one state. Nothing in the schema prevents it — there is no chain trigger and no per-opportunity lock on this table, unlike the PI ledger. `[SRC]`

**This is not the ordering defect and is not fixed by any option below.** It is recorded here because it shares a root cause — the Community ledger lacks the serialisation its sibling has — and because a reviewer assessing "is sequence order the intended chronology" needs to know the writes are not serialised (§9).

---

## 4. Ordering semantics and failure modes

| Failure mode | Mechanism | Reachability |
|---|---|---|
| **Same-transaction tie** | `now()` is the transaction timestamp, so any two rows written in one transaction share it | **Demonstrated** `[PG]`. In production each `ownedDbTable` call is its own PostgREST request, so this needs a future code path that transitions twice in one transaction, or a plpgsql function. **Latent today** |
| **Same-microsecond tie across transactions** | `timestamptz` has microsecond resolution | **Not measured.** Possible in principle; probability unquantified. **UNVERIFIED** |
| **Reader disagreement** | three independent non-total orderings (§3.4) | Whenever any tie occurs |
| **Wrong `from` state in allowlist validation** | R1 returns an arbitrary tied row | Whenever a tie occurs on a transitioning opportunity |
| **Wrong terminality** | `isResolvedForAccountDeletion(R1)` | Whenever a tie occurs; could both **wrongly permit** deletion (if it reads `archived`) and **wrongly refuse** it |
| **Clock movement** | not applicable to ties, but relevant to any timestamp-ordered contract: `now()` is not guaranteed monotonic across NTP adjustment | **UNVERIFIED** — no evidence gathered on host clock discipline |

**What is NOT a failure mode:** retention and audit export, which window by time rather than selecting a latest row (§3.2).

---

## 5. Remediation options

### Option A — a monotonic sequence column

Add a database-generated increasing value; order all readers by it.

| Dimension | Assessment |
|---|---|
| Correctness | **Strong for new rows**, with the caveat below. Matches the sibling ledger's settled design |
| **Concurrency — the decisive caveat** | An identity/sequence value is assigned **when the row is inserted**, not when its transaction **commits**. Two concurrent transactions can therefore commit in the opposite order to their sequence values. The repository says so itself: the PI ledger's ordering is commit order **only because its chain trigger holds a per-prospect advisory lock across each insert** (`20261028000000:103`, `lifecycleReader.ts:92-97`). **The Community ledger has no such trigger**, so a bare sequence gives a *total and stable* order that is not guaranteed to be *commit* order |
| Readers affected | R1, R2, R3, R4, R5 — all five |
| Schema complexity | Low: one column, one index mirroring `idx_opp_lifecycle_org_opp_transitioned` with the new column |
| **Backfill** | **This is the hard part** — see §6. There is **no precedent**: PI's `seq` was created with its table, never backfilled `[SRC]` |
| Tenant isolation / append-only | Unaffected as an additive column; the **backfill** is what interacts with the append-only trigger (§6) |
| Testability | Strong — ties become constructible and assertable |
| Effort | **1.0–2.0 engineer-days** including readers and tests |

### Option A-minimal — a nullable sequence, **no backfill**, fallback ordering — **RECOMMENDED**

As A, but the column is **nullable** with a `DEFAULT nextval(...)` from an explicit sequence, historical rows keep `NULL`, and readers order by `seq DESC NULLS LAST, transitioned_at DESC`.

| Dimension | Assessment |
|---|---|
| Correctness | **New rows become totally ordered.** Historical rows retain today's timestamp ordering, ties included — stated honestly rather than papered over |
| Why nullable | `GENERATED ALWAYS/BY DEFAULT AS IDENTITY` is implicitly `NOT NULL`, which forces every existing row to receive a value, which forces the backfill problem in §6. An explicit sequence with a nullable column **avoids inventing a chronology the data cannot support** |
| Append-only interaction | **None.** `ADD COLUMN` with no value for existing rows requires no `UPDATE`, so the `BEFORE UPDATE` guard is never provoked and never needs suspending |
| Backfill | **None, by design** (§6.3 explains why this is the defensible choice) |
| Concurrency | Same caveat as A; see §9 |
| Effort | **1.0–2.0 engineer-days** |

### Option B — an explicit transition-order mechanism

Use an existing authoritative ordering mechanism rather than adding one.

**Evidence search result: no such mechanism exists.** The only candidate is `previous_state`, which forms a chain. It is **insufficient**:

- the transition graph permits a state to **repeat** for one opportunity (§2.1), so a chain like `detected → triaged → reviewing → triaged` cannot be linearised from `previous_state` alone — two rows with `previous_state='reviewing'`… or in general two rows with the same `state` make the successor ambiguous;
- `is_initial` + `uq_opp_lifecycle_initial` give a unique **anchor**, but an anchor is not an order;
- no version, revision, or predecessor-row-id column exists.

Building a separate ordering table or a derived "current state" table would introduce exactly the **competing source of truth** the sibling ledger's design notes reject (*"no second authority can drift from it"*, `20261028000000:7-9`).

**Verdict: rejected on evidence.** `[SRC]`

### Option C — keep timestamp ordering, add a deterministic tie-breaker

Order by `transitioned_at DESC, id DESC` (or `ASC`), using the existing uuid primary key.

| Dimension | Assessment |
|---|---|
| What it buys | **Inter-reader consistency.** All readers would agree, because a total order exists. That is a real improvement over §3.4 |
| What it does **not** buy | **Any claim to chronology.** `id` is `gen_random_uuid()` — random, with no temporal component. A tie resolved by uuid is a coin flip that is merely *stable*. **A deterministic sort is not proof of correct transition chronology, and must not be presented as one** |
| Schema / migration | **None at all** — reader-only change |
| Backfill | None |
| Effort | **0.25–0.5 engineer-days** |
| Verdict | **Viable interim only.** Recommended *only* as a stopgap if a migration cannot be scheduled, and only if documented as consistency-not-chronology |

### Option D — change the column default to `clock_timestamp()`

Considered because the Community timestamp is database-generated (§2.1), so the default is ours to choose. Measured: `clock_timestamp()` produced 2 distinct values where `now()` produced 1 `[PG]`.

**Not recommended as the fix.** It removes the *demonstrated* tie but leaves a timestamp-ordered contract: same-microsecond ties remain possible, clock movement can invert order, and historical rows are unaffected. It also changes the meaning of an existing column, which is a semantic change dressed as a default change. **Recorded as considered and rejected.**

### Recommendation

**Option A-minimal**, for four reasons:

1. It makes the ordering **total for every future row**, which is what R1's terminality decision needs.
2. It **does not invent a historical chronology** the data cannot establish (§2.1, §6.3).
3. It **never touches the append-only guard** — no `UPDATE`, so no trigger suspension and no owner decision about weakening evidence integrity.
4. It follows the **shape the repository already chose** for the sibling ledger, so it introduces no new pattern and no competing authority.

**Why the alternatives are weaker:** B does not exist in the data and would require a second authority. C cannot claim chronology and so cannot justify a terminality decision, though it is the right stopgap. D is a semantic change with a narrower benefit. Full A (non-nullable, backfilled) is strictly worse than A-minimal because its only additional benefit — ordered history — is exactly the part the data cannot justify.

**Owner decisions this requires:** §8, items D-1 to D-4.

---

## 6. Migration, backfill, deployment and rollback

**No database was created, replayed or written in this task.** Everything below is from source and documented PostgreSQL semantics; the items marked **UNVERIFIED** need the narrow follow-up in §6.5.

### 6.1 How existing rows would receive sequence values

| Approach | Mechanism | Verdict |
|---|---|---|
| `ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY` | Forces a value for every existing row during a table rewrite; values are assigned in **physical (rewrite) order**, which bears no relation to chronology | **Semantically indefensible** — it would manufacture an order and make it look authoritative. **UNVERIFIED** that the rewrite also bypasses the row trigger (it should, being a rewrite rather than per-row `UPDATE`) |
| `ADD COLUMN seq bigint` nullable, then `UPDATE … ROW_NUMBER() OVER (ORDER BY transitioned_at, id)` | Chronological **where timestamps differ**; arbitrary where they tie | **Blocked by the append-only guard** — `opp_lifecycle_block_update` raises `P0001` on any `UPDATE`. Would require `ALTER TABLE … DISABLE TRIGGER`, i.e. **temporarily suspending the append-only guarantee** = owner decision |
| **`ADD COLUMN seq bigint` nullable with `DEFAULT nextval(...)`, no backfill** | Existing rows stay `NULL`; new rows get values | **RECOMMENDED** — no `UPDATE`, no trigger interaction, no invented history |

### 6.2 Would the chosen order for historical rows be defensible?

**No, for any backfill.** Chronology is recoverable only where `transitioned_at` already differs — in which case a backfill adds nothing that ordering by `transitioned_at` does not already give. Where it ties, there is nothing to recover from.

### 6.3 Can historical ties be resolved from existing evidence?

**Not in general.** The `previous_state` chain is the only candidate, and §2.1 shows the transition graph permits a state to repeat for one opportunity, so the chain is not uniquely linearisable. The uuid primary key carries no time. `metadata` is free-form `jsonb` with no ordering contract, and `reasoning` is prose.

**So the honest position is: historical ties are unresolvable, and the design should say so rather than hide it behind a generated number.** That is the core argument for A-minimal.

### 6.4 Append-only trigger compatibility

| Operation | Expected trigger behaviour | Class |
|---|---|---|
| `ADD COLUMN` (nullable, no default fill) | Not fired — DDL, not a row `UPDATE` | documented semantics, **UNVERIFIED by execution** |
| `ADD COLUMN` with a default forcing a rewrite | Not fired — a rewrite is not a per-row `UPDATE` | documented semantics, **UNVERIFIED** |
| `UPDATE … SET seq = …` | **Raises `P0001`** | **DEMONSTRATED** `[PG]` (L4) |
| `CREATE INDEX` | Not fired | documented semantics |

### 6.5 The limitation, and the narrow follow-up it needs

The §6.4 rows marked UNVERIFIED cannot be settled from source. **Proposed separately scoped investigation:** in a newly created disposable database with the migrations replayed, insert a handful of reserved-prefix lifecycle rows, then execute each candidate `ALTER TABLE` form and record whether the guard fires, what order existing rows receive, and how long the rewrite takes on a representative row count. That requires authorization for **migration replay, fixture inserts and DDL on a disposable database**, exactly as `PI-C1-PHASE-1-PG-VERIFY-002` was authorized. It is **not** attempted here.

### 6.6 Deployment ordering

The column is additive and ignorable, so **migration first, readers second**:

1. Apply the migration. Old readers continue to order by `transitioned_at` and ignore `seq`. Behaviour is unchanged — no window in which old readers misinterpret new data, because the new column changes nothing they read.
2. Deploy the reader change (`seq DESC NULLS LAST, transitioned_at DESC`). Both planes must ship together where both read lifecycle state — note **R4 lives in `strategicDashboardsService`**, so this is not a single-file change.
3. Mixed-version window: an old reader and a new reader can disagree on a tied pair, which is **no worse than today**, where two old readers can already disagree (§3.4).

**Reverse order would be wrong:** readers ordering by a column that does not exist would error.

### 6.7 Rollback

Dropping the column is safe **provided readers are rolled back first**, since nothing else references it and no data depends on it. Lifecycle correctness is preserved on rollback because historical rows never had a `seq` and new rows revert to timestamp ordering — i.e. back to today's defect, not to a worse state. **No data is destroyed by the rollback**, which is the property that matters for an append-only evidence table.

---

## 7. Test matrix and acceptance criteria

For the recommended option. **Nothing below was implemented or run.**

| # | Case | Required assertion |
|---|---|---|
| T1 | **Two transitions with identical timestamps in one transaction** | the later row is current; this is the case that **fails today** |
| T2 | Current-state read after consecutive transitions | equals the last transition, with no fixture needing a hand-seeded earlier timestamp |
| T3 | `getLifecycleBoardCounts` agrees with R1 | for every opportunity, the board's state equals `readCurrentLifecycleState` |
| T4 | **All four readers agree** | R1, R3, R4 (and R5's last element) report the same current state over the same history, including a tie |
| T5 | Concurrent writers | two sessions transitioning the same opportunity produce a deterministic total order; the losing writer is refused or ordered, never silently interleaved (**see §3.5 — this may expose the separate write race**) |
| T6 | Historical rows with `NULL seq` | ordering falls back to `transitioned_at` and never returns `NULL seq` ahead of a sequenced row |
| T7 | Mixed historical and new rows | a new transition on an opportunity whose history predates the migration is correctly current |
| T8 | Unknown / malformed state | still **fail-closed** `unreadable`, unchanged by the ordering change |
| T9 | Append-only guard | `UPDATE`/`DELETE` still refused with `P0001` + marker after the migration |
| T10 | Tenant isolation | ordering change does not widen any read; cross-tenant reads still `missing` |
| T11 | Retention and terminality | `isResolvedForAccountDeletion` still only `archived`; retention pre-exclusion unaffected |
| T12 | No fabricated history | the migration creates **no** lifecycle rows; row counts before and after are equal |

**The regression assertion:** T1 must **fail on the current code** — two same-transaction transitions, then assert the read returns the second — and pass only once the approved ordering contract exists. This is the exact assertion the original L3 made before its fixture was adjusted.

### 7.1 How L3 and L3b should coexist after remediation

**L3b must not be weakened to make the suite green.** It currently asserts three structural facts (zero identity columns on the Community ledger; `now()` ties within a transaction; a tie leaves `ORDER BY transitioned_at DESC` ambiguous). After remediation the first **will fail**, which is its designed signal.

Proposal:

| Test | After remediation |
|---|---|
| **L3** | Keep the semantic test, and **remove the `seedInitialEarlier` fixture** so it exercises two transitions in one transaction — i.e. L3 absorbs T1 and becomes the semantic regression test |
| **L3b** | **Rewritten, not deleted or weakened**: assert the *new* contract — that an ordering column exists, that `(organization_id, opportunity_feed_item_id, seq DESC)` is indexed, that the order is total over a timestamp tie, and that `NULL seq` historical rows sort last. The structural-gap assertions are replaced by structural-guarantee assertions, so the file keeps its role: proving the *shape* holds, while L3 proves the *behaviour* |
| Both | Retained. Semantic correctness and structural guarantee stay independently tested, which is why L3's earlier failure was informative in the first place |

---

## 8. Owner decisions and authorization still required

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| **D-1** | Adopt an ordering column at all, and if so which option? | A-minimal / A (backfilled) / C interim / none | **A-minimal** |
| **D-2** | **Is any historical backfill wanted, knowing it cannot be chronologically justified and would require suspending the append-only trigger?** | no backfill / backfill with trigger suspension | **No backfill** |
| **D-3** | Is "sequence assignment order" accepted as the ordering semantics, given it is not guaranteed to be commit order without serialisation? | accept / require a serialising mechanism like the PI chain trigger | **Needs the reviewer in §9 before deciding** |
| **D-4** | Should `getCurrentLifecycleState` (R2, dead code) be removed rather than migrated? | remove / migrate / leave | **Remove** — a duplicate current-state reader is how §3.4 arises |
| **D-5** | Is the separate write race (§3.5) in scope for this remediation or a distinct package? | fold in / separate | **Separate** — it is an atomicity defect, not an ordering one |
| **D-6** | Authorize the narrow disposable-database investigation for §6.5? | yes / no | **Yes** — it is the only way to settle the migration mechanics |
| **D-7** | Authorize implementation of the chosen option | — | **Implementation authorization is currently NONE** |

---

## 9. Questions for a reviewer who did not author this implementation

**This investigation is not independent review.** The same agent implemented Phase 1, wrote the tests that found this defect, and wrote this report. No JEV/GT verdict exists and none is fabricated — JEV/GT remains unavailable for the reasons recorded in `PI-C1-JEV-ARCHITECTURE-DECISION-002` §2.

The specific claims needing outside scrutiny:

1. **Does sequence order represent the intended business chronology?** A sequence records *insert* order. The product's intent is presumably *decision* order. These coincide only if every transition is inserted when it is decided — plausible for an operator-driven route, unexamined for any future batch or import path.
2. **Can concurrent transactions violate that interpretation?** Yes in principle (§5, Option A caveat): sequence assignment precedes commit. The PI ledger closes this with a per-prospect advisory lock; the Community ledger has none. A reviewer should decide whether A-minimal is acceptable without adding serialisation, or whether D-3 must require it. **This is the single most consequential open question.**
3. **Does the no-backfill choice create an unjustified ordering?** I argue it is the *only* choice that avoids one (§6.2–6.3), but the consequence is a permanently two-regime history — sequenced and unsequenced — which a reviewer should accept explicitly.
4. **Do all readers share one authoritative state definition?** Today, demonstrably **no** (§3.4): three independent derivations, two independent reducers. A reviewer should decide whether remediation must also **consolidate** them behind one function, which I believe it should, since otherwise the next reader re-creates the divergence.
5. **Is the §3.5 write race genuinely out of scope?** I have scoped it out as a distinct defect, which a reviewer may disagree with, since a reader fix that leaves two successors to one state possible is only a partial guarantee.

---

## 10. Effort and schedule impact

**The frozen baseline is unchanged and no estimate is revised:** Milestone A′ **2026-11-25 / 28.5 human engineer-days**; WP-7 **2026-11-17 / 4.0**; C-1 **8–12**; **OVERRUN RISK remains raised**; next checkpoint **Friday 2026-10-23**. **No float is claimed recovered and no recovery or de-scope plan is applied.**

| Scenario | Incremental human engineer-days | Notes |
|---|---|---|
| **A-minimal** (recommended) | **1.0–2.0** | migration + 5 readers incl. `strategicDashboardsService` + T1–T12 + L3/L3b rework |
| A with backfill | **2.0–3.5** | adds the trigger-suspension design and its own verification |
| C interim only | **0.25–0.5** | reader-only; buys consistency, not chronology |
| §6.5 disposable investigation | **0.25–0.5** | settles the migration mechanics |
| §3.5 write race (if folded in) | **+1.0–2.0** | likely needs a chain trigger or advisory lock, i.e. another migration |

**Schedule consequence, flagged not revised.** C-1 already carries **zero float at its high estimate**, so **1.0–2.0 additional engineer-days is an overrun at that end** — consistent with the overrun risk already raised, not a new baseline. This work is **not** on the critical path for Phase 1, which is complete and verified; it is a prerequisite for relying on lifecycle state in any **Phase 2** terminality or deletion gate. Deferring it leaves a latent defect in a decision that governs account deletion.

---

## 11. Checks performed, checks not run, residual uncertainty

### 11.1 Performed

Hash gate on the verification report; baseline inventory; hashes of five source and migration files; enumeration of **every** non-test reference to `opportunity_lifecycle_states`; enumeration of **every** `transitioned_at` reference repository-wide; read of all five readers and both writers; confirmation that neither writer supplies `transitioned_at`; caller search for all five exported lifecycle functions (finding R2 dead); read of the PI reader's ordering rationale and the PI writer's caller-supplied timestamp; confirmation that PI `seq` was created with its table and never backfilled; enumeration of the Community table's three indexes; read of the transition graph to establish that states can repeat; and reuse of the prior run's PostgreSQL measurements, marked `[PG]`.

### 11.2 Not run

| Item | Reason |
|---|---|
| **Any database creation, migration replay, fixture insert, DDL or write** | **Not authorized by this task** — investigation only |
| Trigger behaviour under each `ALTER TABLE` form (§6.4) | Needs DDL on a disposable database; proposed in §6.5 |
| Rewrite duration / lock profile at realistic row counts | Needs a populated disposable database |
| Same-microsecond cross-transaction tie probability | Not measured; would need a timing experiment |
| Host clock monotonicity / NTP behaviour | No evidence gathered |
| Any implementation, test or migration | **Not authorized** |
| Independent or human review | **Not available** |

### 11.3 Residual uncertainty

The §6.4 trigger-compatibility rows rest on **documented PostgreSQL semantics, not execution** — the recommended path's central safety claim ("`ADD COLUMN` does not provoke the append-only guard") is therefore **UNVERIFIED by execution**, which is why §6.5 exists. The production reachability of the tie is a judgement, not a measurement (§4). Effort figures are judgement. And the §3.4 reader-disagreement consequence is **inferred from three non-total orderings** — that each query *may* order ties differently is standard PostgreSQL behaviour, but a case of two readers actually disagreeing was **not demonstrated**.

---

## 12. Final verification

| Check | Result |
|---|---|
| `PI-C1-PHASE-1-LIFECYCLE-B21-PG-VERIFICATION-001.md` | **byte-identical** (`b765b6a0…439e`) |
| Product code, existing tests, migrations | **unchanged** — the five hashed files in §1 are identical, and the ` M` entries in the working tree were all present at task start |
| HEAD | **`29fea38a…` unchanged** |
| Working tree | **160 → 161**; the only new entry is this report; **no pre-existing entry lost** |
| Commits / deployments | **none** |

### 12.1 Time ledger

| | |
|---|---|
| Start / end | **2026-10-18T17:38:12** → **17:44:05 +05:30 (IST)** |
| **Wall-clock** | **≈ 5 min 53 s** |
| **Machine time** | **≈ 25 s** — source searches and hashing only; **no database and no test run** |
| **Active engineering** | **≈ 5 min 30 s** |
| External waiting | **none** |
| Human engineer-days | not consumed by agent wall-clock; no substitution made |

---

## 13. Status

| Item | Status |
|---|---|
| The reported defect | **VERIFIED** against the current repository, and **wider than reported** — four readers, not two |
| Reader/writer inventory | **VERIFIED BY SOURCE INSPECTION** |
| Same-transaction tie; append-only `UPDATE` refusal; absence of an identity column | **VERIFIED AGAINST POSTGRESQL** (prior run, marked `[PG]`) |
| Reader disagreement under a tie | **INFERRED** from three non-total orderings — not demonstrated |
| Write race (§3.5) | **VERIFIED BY SOURCE INSPECTION** — separate defect, newly recorded |
| Option B (existing ordering mechanism) | **REJECTED ON EVIDENCE** — none exists |
| Migration trigger compatibility | **UNVERIFIED** — needs the §6.5 investigation |
| Recommendation | **Option A-minimal** — a recommendation, not a decision |
| Independent review | **NOT RUN** — §9 lists what needs outside scrutiny |
| **Implementation** | **NOT PERFORMED. Authorization remains NONE** |

**No implementation was performed. Implementation authorization remains NONE. Phase 2 remains unauthorized. Q3 remains blocked unless verified policy evidence closes it. v0.3 remains unratified. The frozen schedule baseline and overrun status are unchanged.**
