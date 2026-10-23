# DEEPTECH-HUMAN-MIN-001 — orchestrator's verified ground truth

Everything below was read or computed by the orchestrator directly, not relayed from a subagent.
Nothing here is registered, committed or pushed. No frozen byte was modified.

## Baseline identities (re-verified 2026-09-24)

| Item | Value |
|---|---|
| `origin/main` | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| `origin/main:research/cpg-u1` tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` (verified instrument still UNMERGED) |
| Protocol-004 sha256 | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Instrument aggregate (`C:/tmp/dt002`) | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` |

## 1. The headcount is stated, not implied — §4A.3

> "**Every independent role is held by a different person, and no independent role is held by the operator.**"
> "The seven independent roles are mutually exclusive: **minimum 7 independent persons**."
> "An enumerator may not be the reference adjudicator. The adjudicator decides contested reference values, and
> the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7)."

§4A is headed `[NORMATIVE; APPROVED CPG-043]`. Roles: operator (not independent), enumerator (>= 1), reference
Author, reference Confirmer, reference adjudicator, rater 1, rater 2, rating adjudicator.

Reinforcing exclusivity clauses: §4A.2(d) an enumerator must "hold no other §4A.3 role"; §12 rater Eligibility
"must not have implemented CPG, the protocol or the tooling; must hold no other §4A.3 role; must satisfy §4A.1";
§9.1 reference adjudicator must not "Hold any other §4A.3 role (including enumerator); introduce a new value".

**Consequence:** a two-human design is not an ambiguity to be interpreted. It contradicts frozen normative text and
requires a substantive amendment. Any claim that the protocol "permits" two humans is false.

## 2. Neither adjudicator can add information — §9.5

> "Same `value_kind` and same value (whitespace-collapsed, case-insensitive) -> `AGREED` — **an adjudication may not
> override it**" · "Different -> **Must** be adjudicated: `AUTHOR` -> `ADJUDICATED_AUTHOR`; `CONFIRMER` ->
> `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` -> `REFERENCE_CONFLICT` (excluded from every denominator, published)"
> "The adjudicator chooses between the two records or declares a conflict, and **cannot supply a third value**."

**CORRECTED — this is too strong, and both Agent A and I asserted it.** I wrote that an adjudicator is "a coverage
instrument, not a judgement instrument". Agent C showed that is wrong in two respects, and I verified both:

1. **The rating adjudicator's decision space is `{LABEL_A, LABEL_B, REFERENCE-AMBIGUOUS}`**
   (`packets.mjs:104-114`), and line 109 returns `REFERENCE-AMBIGUOUS` unconditionally — so they *can* assign a label
   **neither rater gave**. What they cannot introduce is a new *scoring* label.
2. **The choice itself is information that moves the result.** It is worth up to log₂3 ≈ 1.585 bits per disagreement,
   and it shifts counts between endpoint buckets. With expected fills of only ~30, and P1 tolerating
   `floor(F/20) = 1` erroneous fill, a single adjudicated choice can decide SUCCESS versus FAILURE.

So the correct statement is: **an adjudicator adds no new scoring vocabulary, but does make a directional judgement
that can determine the outcome.** Eliminating them costs both coverage *and* that judgement — a larger loss than I
first recorded.

Agent C's structural criticism is worth carrying forward: every item reaching an adjudicator is one on which two
qualified people split — the hardest items — and is then decided by **one** person, with no second reading and no
agreement statistic. The rating stage applies its strongest reliability machinery to the easy items and its weakest
to the hard ones.

Engineering constraint: §9.6 — "`seal` refuses any reference file that is not byte-identical to the reconciliation
of the blind records", and the reconciled file is produced **only** by `reconcile`. Any new resolution rule must
live inside `reconcile`, so it moves the tooling aggregate as well as the protocol sha.

## 3. An asymmetry between the two adjudicators — §15.1/§15.2

Closed disposition list: `VALID` · `INVALID` · `REFERENCE-CONFLICT` · `REFERENCE-AMBIGUOUS` · `REFERENCE-STALE`,
plus the flag `CONTAMINATION-DISCLOSED`. `INCONCLUSIVE` is run-level only.

- **Reference adjudicator:** removable without a new disposition — `REFERENCE-CONFLICT` already exists and is
  already excluded-and-published. Still needs §9.1/§9.5 amended, because §9.5 says a difference *must* be
  adjudicated; conflict is a declared outcome, not a fall-through.
- **Rating adjudicator:** there is **no disposition for "the raters disagreed"**. Removing it requires either a new
  exclusion disposition (which then spends the §15.5(2) budget) or a pre-registered deterministic resolution rule
  that keeps the observation VALID and scored. The rule route is structurally cleaner.

## 4. The binding constraint is the exclusion budget — §15.5(2)

§15.5 run-level INCONCLUSIVE conditions, verbatim:

1. G1: all fills < 20 [DERIVED]
2. Fewer than 90% of held-out company × field observations VALID [NORMATIVE]
3. Nominal alpha < 0.667, fewer than 2 independent raters, or < 90% of observations completely rated [NORMATIVE]
4. More than 10% of held-out companies had their decisive registry path unavailable during the run [NORMATIVE]
5. SOURCE-COINCIDENT > 60% of scored observations [NORMATIVE]
6. Published seal hash mismatch, or execution began before the seal was published
7. A protocol violation discovered mid-run (also halts — §18)
8. Any §5.10 VOID or ABANDONED state — **VOID, not INCONCLUSIVE**; no endpoint may be reported

Observation budget, computed by the orchestrator from `lib/sizing.mjs` + `lib/schema.mjs`
(`HELD_OUT_BASE` = {fill-expected 12, abstention-expected 5, identity-hazard 3}; `SIZING` = {MIN_FILLS 20,
SAFETY 1.5, CAP_FILL_EXPECTED 60}; `FIELDS` = 3; abstention = max(5, ceil(fe*5/12)); identity-hazard =
max(3, ceil(fe*3/12))):

**CORRECTED — there are 13 reachable configurations, not 49.** My first pass swept `fe` over the interval 12..60.
Agents B, F and H independently pointed out that `fe` is the *image* of the sizing rule, not an interval:
`fe = min(60, max(12, ceil(180/T)))` over integer pilot totals `T ∈ 1..18` (`T = 0` HALTs). I verified this with
`orch_reachable.mjs`: the attainable set is exactly **{12, 13, 14, 15, 17, 18, 20, 23, 26, 30, 36, 45, 60}**, and 36
of the 49 values in the interval are unreachable.

| fill-expected | pilot total T | companies | observations | min VALID | max excluded | excluded share |
|---|---|---|---|---|---|---|
| 12 (floor) | 15–18 | 20 | 60 | 54 | **6** | 10.00% |
| 13 | 14 | 23 | 69 | 63 | **6** | **8.70% — tightest** |
| 14 | 13 | 24 | 72 | 65 | 7 | 9.72% |
| 18 | 10 | 31 | 93 | 84 | 9 | 9.68% |
| 30 | 6 | 51 | 153 | 138 | 15 | 9.80% |
| 45 | 4 | 76 | 228 | 206 | 22 | 9.65% |
| 60 (cap) | 1–3 | 100 | 300 | 270 | **30** | 10.00% |

**At the floor the entire exclusion budget is six observations**, shared across INVALID, REFERENCE-CONFLICT,
REFERENCE-AMBIGUOUS, REFERENCE-STALE and the undocumented PENDING. The tightest configuration is `fe = 13`
(6 of 69 = 8.70%). Any design that converts human judgement into exclusions is spending that budget.

G1 pressure: fill-expected observations = fe * 3, so >= 20 fills demands a 55.6% fill rate at the floor (36
observations), 33.3% at fe=20, 11.1% at the cap (180).

Script: `orch_budget.mjs` (preserved beside this file). Boundary question left to Agent F: whether exactly 90% passes.

## 5. Rating labour is narrow; reference labour is not — §10.1/§10.2/§12.3

§10.1's decision procedure is mechanical given CPG's value, the sealed reference record and §10.2: four-digit year
equality; |CPG − reference| <= 10% for `employee_count`; a currency-marker check plus ±10% parsed amount for
`revenue_range`; a 24-month `as_of_date` window. §12.3 Rule A's URL set is derived mechanically and byte-verified
by `verify-rater-packet`. The genuinely judgemental nodes are only two: *is the value attributable to the EXPECTED
entity?* and *is the reference insufficient to decide (REFERENCE-AMBIGUOUS)?*

**Consequence:** raters make a narrow judgement per row; reference observers do open-ended source work. Per-row
time assumptions must differ between the two roles.

## 6. Raters already see the reference value — §12 rater packet

> "Field; CPG's value or null; the source URLs CPG cited for that value (§12.3); **the sealed reference record**"

So a reference observer who later rates gains **no information they would not already have**. The objection to
overlapping those roles is therefore *not* information leakage; it is self-consistency bias, whose direction must
be established rather than assumed.

## 7. The Rung-2 clause — §12

> "**If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled
> **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent validation may be
> made.** The protocol is not weakened to accommodate unavailability."

Whether removing the rating *adjudicator* (as distinct from the raters) triggers this ceiling is the single
question that decides whether a two-human design silently caps the evidence rung.

## 8. Temporal ordering may make overlap safe — §4A.2(b)

An enumerator must "not have run CPG or seen any CPG output (including the development pilot and instrument check)
**before completing the frame**". The bar is temporal. The evidence chain runs enumeration -> draw -> reference truth
-> seal -> execution -> rating, so a person who enumerates first and rates later satisfies (b). Only §4A.2(d), a
role-exclusivity rule rather than an information rule, blocks that overlap.

## 9. A separate INCONCLUSIVE route that couples to reference sourcing — §9.8

> "Every sealed row is `independence_class = PENDING_RUN`. After execution, each observation is classified
> `INDEPENDENT` or `SOURCE-COINCIDENT` (reference and CPG cite the same document). **If SOURCE-COINCIDENT exceeds
> 60% of scored observations, the run is INCONCLUSIVE**."

This bears on any proposal to machine-extract reference truth from the same registries CPG resolves against: it
would raise source coincidence, independently of the circularity objection.

## 10a. THE DECISIVE CONSTRAINT — the first disagreement halts the pipeline

Found by Agent F, verified by me in the code. Without an adjudicator, the binding constraint is not a *rate* at all:

- **`reconcile.mjs:58`** — on any Author/Confirmer difference with no adjudication row:
  `author and confirmer disagree (… vs …) — independent adjudication required`, and `cmdReconcile` exits 1. So
  **no reference file is produced and nothing can be sealed.**
- **`ratings.mjs`** — `finalRatings` throws `RATING_ADJUDICATION_MISSING` when two sheets disagree with no
  resolution. So **no analysis runs.**

`REFERENCE_CONFLICT` is reachable **only** when an adjudicator actively decides it (`reconcile.mjs:65`). Removing the
reference adjudicator therefore removes the ability to *declare* a conflict, not merely to resolve one — the lawful
§15.1 disposition disappears with the role.

**Consequence:** a two-human design with the adjudicators simply deleted requires **perfect agreement** across
90–330 reference records and 60–300 rating items. Not a 10% tolerance — zero. The exclusion budget and the α ceiling
only become the operative constraints *after* a pre-registered resolution rule is substituted for each adjudicator.

## 10b. Reference truth covers BOTH stages — my own work-unit figure was wrong

`cmdReconcile` (`cpg_u1_data.mjs:566-575`) reads **both** `--dev-manifest` and `--held-out-manifest`, and
`reconcile()`'s signature documents `drawnEntries … for BOTH stages`. §9.1 says the Author records "every drawn
company × field". Development is 10 companies = 30 observations.

So reference records per recorder are **90 at the floor** (30 development + 60 held-out) rising to **330 at the cap**,
i.e. 180–660 records in total. I had briefed agents with "2 × observations = 120 at the floor", which understates the
reference load by 30 records per recorder — 50% at the floor. Agents F and H caught this independently.

Note also that the `dt004-operations/people/tools/workload_scheduler.mjs` carries the same understatement (it uses
`held_out_companies × 3` for reference as well as rating). Rating **is** held-out only, so the scheduler is correct
there. Recorded as a finding; not fixed.

## 10c. A claim of mine that was REFUTED

I told Agent H that "the two-human design must serialise reference truth and rating, so they cannot overlap as they
can with seven people". **That is wrong.** They can never overlap at any headcount: the §12 rater packet contains the
sealed reference record, §9.6 publishes the seal before execution, and §6.5 opens the execution window at the
published seal record's timestamp. `reference → seal → execute → rate` is chain-forced. The seven-person design has
no overlap to lose, so nothing is given up here.

## 10d. My "conservative resolution" recommendation was unsound — the sensitivity interval replaces it

I recommended that rater disagreements be settled by a pre-registered rule taking "the label less favourable to the
claim", defined as a total order over the seven labels. **Agent C refuted that with a counterexample I accept.**

The admissible pair `{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}` has no conservative direction:

- `UNSUPPORTED-FILL` counts in P1's numerator **and** its denominator, and in P2's denominator;
- `REFERENCE-AMBIGUOUS` is excluded from every denominator (§10.3), so it removes the observation entirely.

Choosing RA removes an erroneous fill (helping P1) but reduces the fill count (hurting G1 and §15.5(2)). Choosing UF
adds a fill (helping G1) but adds an erroneous fill (hurting P1). **No single ordering is conservative for every
endpoint simultaneously**, so a total order can inflate SUCCESS in either orientation.

C's constructive result: because every §10.3 threshold is an **integer linear inequality**, the exact extremum over
all 2^D resolutions is reached by extremising each disagreement independently, per endpoint — no ordering needed. A
per-endpoint conservative rule therefore *collapses into* the sensitivity-interval design:

- compute every endpoint twice, once with all disagreements resolved favourably and once unfavourably;
- require the **unfavourable** bound to meet the threshold.

Guarantee C proved and tested (98/98 assertions, 250 cases, 8 035 enumerated resolutions; I re-ran the suite and it
passes, exit 0): if the unfavourable bound passes, **all** 2^D resolutions pass; if the favourable bound fails, **no**
resolution passes. It excludes nothing, so it spends neither the §15.5(2) budget nor G1, and it makes no choice — so
it cannot be steered. It needs a §10.5 **reporting** amendment (what a straddling interval means), not a new
disposition.

**Revised recommendation, therefore: the sensitivity interval, not a conservative ordering.** And the price is
severe rather than mild — for P1 the unfavourable bound tolerates at most **one** contested possible-bad fill (zero if
an agreed bad fill exists), and for P3 **zero** contested possible-misattributions.

### An implementation trap that must be pinned by a test

Agent C's risk 1, which I judge the single most dangerous detail in the whole wave: adding `'DISAGREEMENT'` to AD-1's
exclusion list `['INVALID','REFERENCE-CONFLICT','REFERENCE-STALE']` would set **α = 1.0 by construction**, because the
remaining α population would be exactly the agreements. The only reliability measure in the study would become a
tautology while still reading green. Any implementation must pin this with a test.

## 11. Blind-record independence is itself a two-person structure — §9.1

Author: "constructs a blind record for every drawn company × field", must not "communicate with the Confirmer
before both have submitted". Confirmer: "constructs a **separate blind** record", must not "see the Author's record
before submitting". Two people is exactly what double-entry needs — so reference truth does not push the headcount
above two. The pressure above two comes from adjudication and from role exclusivity, not from double-entry.
