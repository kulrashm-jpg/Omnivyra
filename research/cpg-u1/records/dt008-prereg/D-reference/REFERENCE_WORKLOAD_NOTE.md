# REFERENCE_WORKLOAD_NOTE — the honest reference workload figure

**Classification: PREPARATION.** No person has been recruited; no window has been committed; no date
appears here. This note states **record counts**, which are derivable from the instrument, and
separates them cleanly from **time per record**, which is not derivable from anything and is marked as
an assumption throughout.

Baseline: protocol `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument
aggregate `<NEW_AGG>` over <NEW_N> files at
`C:/tmp/dt002/research/cpg-u1/tooling`. Both recomputed.

---

## 1. The claim, and the verification

**CONFIRMED. Each recorder produces 90–330 blind records, not 60–300.** The brief's reasoning is
correct and its arithmetic checks out. Verified as follows.

### 1.1 Reference truth covers **both** stages

`cmdReconcile` (`cpg_u1_data.mjs:566-568`) reads **both** manifests:

```
const dev = readJson(need(o, 'dev-manifest'));
const ho  = readJson(need(o, 'held-out-manifest'));
```

and `reconcileFrom` (`cpg_u1_data.mjs:530-535`, line 534) concatenates them before handing them to `reconcile`:

```
reconcile([...devManifest.development, ...hoManifest.held_out], author, confirmer, adjudication)
```

`reconcile`'s own JSDoc (`lib/reconcile.mjs:23-26`) says so explicitly:

> `@param drawnEntries manifest entries [{candidate_id, stratum}] for BOTH stages`

`reconcile` then iterates **every drawn id × every field** and refuses a gap by name:
`missing author record` / `missing confirmer record` (`lib/reconcile.mjs:50-51`). `cmdSeal` calls the
same `reconcileFrom` and refuses to seal with any error. So there is no configuration in which a
recorder covers held-out only.

### 1.2 Development: 10 companies, 30 observations — a fixed count

`DEVELOPMENT_QUOTA` (`lib/schema.mjs:55`), described in the source as **"EXACT counts (decision D-B)"**:

| Class | Count |
|---|---|
| `fill-expected` | 6 |
| `abstention-expected` | 2 |
| `identity-hazard` | 2 |
| **Total** | **10 companies** |

`FIELDS` has 3 members (`founded_year`, `employee_count`, `revenue_range`, `lib/schema.mjs:175`), so
**10 × 3 = 30 observations**, and 30 blind records **per recorder**. This is not a range: it is fixed
before the study runs.

### 1.3 Held-out: 20–100 companies, 60–300 observations

Held-out counts come from the §5.6 sizing rule (`lib/sizing.mjs`), a deterministic function of the
development pilot's fill yield, bounded on both sides:

- **floor** — `HELD_OUT_BASE` (`lib/schema.mjs:57`): `fill-expected` 12, `abstention-expected` 5,
  `identity-hazard` 3;
- **ceiling** — `SIZING.CAP_FILL_EXPECTED = 60` on `fill-expected`, with the other two classes scaled
  in proportion to the 12 : 5 : 3 base.

Computed by running `heldOutQuotas` from the verified instrument (no values invented):

| Pilot fills across the 6 development fill-expected companies | Yield/company | Quotas | Companies | Observations |
|---|---|---|---|---|
| 3,3,3,3,3,3 (best case, 18 fills) | 3.00 | 12 / 5 / 3 | **20** | **60** |
| 2,1,1,0,0,0 (4 fills) | 0.67 | 45 / 19 / 12 | 76 | 228 |
| 1,1,1,1,1,1 (6 fills) | 1.00 | 30 / 13 / 8 | 51 | 153 |
| 1,0,0,0,0,0 (1 fill — hits the cap) | 0.17 | 60 / 25 / 15 | **100** | **300** |
| 0,0,0,0,0,0 | 0 | — | `HALT` | run does not proceed |

So permitted held-out sizes run **20 companies / 60 observations** to **100 companies / 300
observations**, exactly as the brief states. (The zero-fill case is a **HALT**, not a small study:
*"CPG produced zero fills across every development fill-expected company — EFR could never be
assessed; held-out must not be drawn."*)

Note the direction, which is counter-intuitive and worth stating to whoever sizes the window: **the
worse CPG performs in the pilot, the more held-out companies are drawn**, because the sizing rule is
chasing 20 assessable fills (`MIN_FILLS = 20`, inflated by `SAFETY = 1.5`). The reference team's
workload is largest precisely in the runs where the instrument fills least.

### 1.4 The total, per recorder

| | Companies | Observations = blind records **per recorder** |
|---|---|---|
| Development (fixed) | 10 | 30 |
| Held-out (minimum) | 20 | 60 |
| Held-out (maximum) | 100 | 300 |
| **Total, minimum** | **30** | **90** |
| **Total, maximum** | **110** | **330** |

**Each of the Author and the Confirmer produces 90–330 blind records. Together, 180–660.** The 2×
duplication is the measurement, not overhead: §9.1 requires two independent constructions, and
`lib/reconcile.mjs:52` refuses a set in which they are the same person.

---

## 2. The earlier tool understates this by 30 records per recorder — confirmed

`C:/tmp/dt004-operations/people/tools/workload_scheduler.mjs` computes, at lines 179–180:

```
const companies    = OUTCOME_CLASSES.reduce((s, c) => s + quotas[c], 0);
const observations = companies * fields;
```

where `quotas` is the **held-out** quota set alone. It then charges the recorders
`observations * reference_record_minutes` (lines 188–189) and prints
`"<observations> blind records EACH (every drawn company x field)"` (line 220).

**That is the held-out figure only: 60–300.** The development stage's 30 observations per recorder are
missing. The understatement is therefore **exactly 30 records per recorder, 60 records across the two
recorders**, at every point in the range — a **+50%** error at the bottom of the range (60 → 90) and
**+10%** at the top (300 → 330).

The adjudicator's load in that tool is understated in the same proportion, because it is derived as
`disagreement_rate × observations`.

**This note does not edit that tool** (it lives outside this worktree's write scope, and the brief
limits writes to this directory). Anyone sizing a window from it must add 30 records per recorder
first, or use §1.4 above.

*The scheduler's other content — the concurrency model, its refusal to propose a single reference
constructor, and the observation that §9.1 makes the two recorders genuinely concurrent — is correct
and is not disputed here.*

---

## 3. Time per record: an ASSUMPTION, not a finding

**Nothing in the protocol or the instrument states how long a blind record takes.** There is no
timing datum anywhere in the <NEW_N>-file instrument, and no pilot of the recording task has been run. The
figures below are therefore **assumptions**, each with its stated basis, and each is wrong by an
unknown amount.

| Figure | Value | Status | Basis |
|---|---|---|---|
| Minutes per blind record | **25 min** | **ASSUMPTION** | Inherited from `workload_scheduler.mjs:43`, whose own comment gives the basis: *"One blind reference record = one company × one field, constructed from scratch by one person: locate the authoritative source..."*. It is a reasoned estimate by a prior wave, **not a measurement**. |
| Minutes per adjudication item | **12 min** | **ASSUMPTION** | `workload_scheduler.mjs:46`: read the §9.2.1 packet for one disagreeing company × field and decide `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT`. Cheaper than a record because nothing is looked up. **Not a measurement.** |
| Disagreement rate | **0.25** | **ASSUMPTION** | `workload_scheduler.mjs:63`. It is one of the quantities the study is partly measuring, so assuming it is circular; it is used only to size a window, never to interpret a result. |

**Why 25 minutes is uncertain in both directions.** It may be optimistic: a `NOT_AVAILABLE_FROM_SOURCE`
record requires the searcher to satisfy themselves that **no** authoritative source states the value
and to write a `search_note` describing the search — an exhaustive negative is often slower than a
positive hit. Jurisdiction matters too: `US-SEC` `revenue_range` from a filing is not comparable work
to `BR-CNPJ` or `LEI-ONLY`. It may equally be pessimistic: three fields for the **same** company share
one entity-resolution effort and often one document, so the second and third field of a company should
be cheaper than the first — a per-**observation** rate ignores that entirely. A per-company plus
per-field model would be better and there is no data to fit one.

### 3.1 Derived hours — all of them inherit the assumption

Treat every number in this table as "25-minute-assumption hours", not as hours.

| Scenario | Records per recorder | Per recorder (at 25 min, ASSUMED) | Both recorders | Adjudicator items at d=0.25 (ASSUMED) | Adjudicator hours (at 12 min, ASSUMED) |
|---|---|---|---|---|---|
| Minimum (held-out 20 companies) | 90 | 37.5 h | 75 h | 23 | 4.6 h |
| Mid (held-out 51 companies) | 183 | 76.3 h | 152.5 h | 46 | 9.2 h |
| Maximum (held-out 100 companies) | 330 | 137.5 h | 275 h | 83 | 16.6 h |

Adjudicator sensitivity to the assumed disagreement rate, at the 330-record maximum:

| Disagreement rate | Items | Hours (12 min, ASSUMED) |
|---|---|---|
| 0.00 | 0 | 0 h |
| 0.10 | 33 | 6.6 h |
| 0.25 | 83 | 16.6 h |
| 1.00 | 330 | 66 h |

**The adjudicator's window cannot be fixed in advance.** The item count is the disagreement count,
which is unknown until both record sets exist. Every difference **must** be adjudicated
(`lib/reconcile.mjs:58`; `cmdReconcile` exits 1), so "adjudicate a subset" is not an available
contingency — see `REFERENCE_ADJUDICATION_NOTE.md`.

### 3.2 What the scheduler's understatement costs in assumed hours

At the assumed 25 min: **+12.5 h per recorder, +25 h across the two**, at every point in the range.
At the bottom of the range that is the difference between a 25-hour and a 37.5-hour task.

---

## 4. Sequencing, so the window is not sized against the wrong phase

The 30 development records are **not** an earlier, separate task that can be done and forgotten. They
are due at the **same** reconcile, and `reconcile` refuses to run without them.

The order the instrument imposes: development manifest drawn → **development pilot runs CPG on the
development companies** → §5.6 sizing → held-out manifest drawn (`seal` refuses a held-out manifest not
drawn after this development manifest) → both recorders produce records for **both** stages →
adjudication of every difference → `reconcile` → `seal` → seal hash published → held-out execution.

Two consequences for sizing:

1. The recorders' single window must cover **30 + held-out** records. The operator **may** release the
   development sheet earlier than the held-out sheet; that shifts when the 30 records are done but does
   **not** reduce the total, and it introduces a second release that must pass
   `REFERENCE_MATERIAL_RELEASE_GATE.md` again.
2. The pilot runs CPG on the **development** companies — the same companies the recorders are
   researching. The recorders must be walled from pilot results absolutely (§9.2: *"never receive CPG
   output"*; §4A.2(b)). Overlapping the pilot with development recording is permitted by the
   instrument and is a **contamination hazard the operator must manage**, not a scheduling win.

---

## 5. What remains blocked on the operator

| Blocked | Why |
|---|---|
| The actual record count | It is `30 + 3 × (held-out companies)`, and the held-out quotas come from the §5.6 sizing rule applied to the **real** pilot, which has not run. Until then the honest statement is the **range**: 90–330. |
| Any minutes-per-record figure that is not an assumption | Would require timing a real recorder on real records. No such datum exists. |
| The recorders' window `W_ref` | A resourcing commitment. It must be derived from 90–330, not from 60–300. |
| The adjudicator's window `W_adj` and its overflow contingency | The item count is not knowable in advance, and a subset is not adjudicable. |
| Whether the cap is accepted | `SIZING.CAP_FILL_EXPECTED = 60` carries the instrument's own note: *"REQUIRES HUMAN APPROVAL as a resourcing commitment."* At the cap, the reference team's load is 330 records each. |
| A per-company + per-field cost model | Better than the per-observation rate used above, and there is no data to fit one. |

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

