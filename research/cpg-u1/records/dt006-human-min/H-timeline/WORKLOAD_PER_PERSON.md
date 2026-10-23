# WORKLOAD_PER_PERSON — work units and per-person load

**AGENT H of DEEPTECH-HUMAN-MIN-001. ENGINEERING ARTIFACT.** Derived by `h_timeline.mjs`; real
output in `RUN_OUTPUT.txt` / `RUN_OUTPUT.json`. Observation counts are FIXED INPUTS and are never
reduced.

---

## 1. Work units, derived mechanically

From `lib/schema.mjs`, `lib/sizing.mjs` and `lib/frame.mjs` at the frozen instrument, plus §4, §5.6,
§5.7.2, §9.1, §12.1:

| Quantity | Value | Where from |
|---|---|---|
| Fields per company | 3 (`founded_year`, `employee_count`, `revenue_range`) | §4, `FIELDS` |
| Development quota | 6 / 2 / 2 = **10 companies, 30 observations** | §5.6 NORMATIVE, `DEVELOPMENT_QUOTA` |
| Held-out floors | 12 / 5 / 3 = 20 companies | §5.6, `HELD_OUT_BASE` |
| Held-out Qmax over all 4096 pilots | 60 / 25 / 15 = **100 companies** | §5.7.2 proof, `MAX_HELD_OUT_QUOTAS` |
| Frame minimum | 126 / 52 / 32 = **210 admissible, held-out-eligible rows** | §5.7.2, `FRAME_MINIMUM` |
| Pilot space | 4096 outcomes, 1 HALT, 0 refusals | `enumeratePilotOutcomes()` |
| **Distinct permitted held-out configurations** | **13** | image of the §5.6 rule, computed |

### Every permitted configuration

`N_fill = min(60, max(12, ceil(180/T)))` for integer pilot total fills `T ∈ 1..18`;
`N_abst = max(5, ceil(5·N_fill/12))`; `N_hazard = max(3, ceil(3·N_fill/12))`.

| quotas f/a/h | companies | held-out obs | **reference obs per recorder (BOTH stages)** | rating obs per rater | pilot T |
|---|---|---|---|---|---|
| 12/5/3 | 20 | 60 | **90** | 60 | 15–18 |
| 13/6/4 | 23 | 69 | 99 | 69 | 14 |
| 14/6/4 | 24 | 72 | 102 | 72 | 13 |
| 15/7/4 | 26 | 78 | 108 | 78 | 12 |
| 17/8/5 | 30 | 90 | 120 | 90 | 11 |
| 18/8/5 | 31 | 93 | 123 | 93 | 10 |
| 20/9/5 | 34 | 102 | 132 | 102 | 9 |
| 23/10/6 | 39 | 117 | 147 | 117 | 8 |
| 26/11/7 | 44 | 132 | 162 | 132 | 7 |
| 30/13/8 | 51 | 153 | 183 | 153 | 6 |
| 36/15/9 | 60 | 180 | 210 | 180 | 5 |
| 45/19/12 | 76 | 228 | 258 | 228 | 4 |
| **60/25/15** | **100** | **300** | **330** | **300** | 1–3 |

### Two corrections to figures in circulation

1. **"49 permitted configurations" → 13.** `fill-expected` ranges over the interval [12, 60], but the
   sizing rule's *image* over integer `T ∈ 1..18` is only {12, 13, 14, 15, 17, 18, 20, 23, 26, 30,
   36, 45, 60}. 49 is the size of the interval, not of the attainable set.
2. **Reference work is NOT `2 × held-out observations`.** It covers **both stages**:
   - §9.1: the Author "constructs a blind record for **every drawn company × field**";
   - §5.5 step 12: "blind reference construction **for BOTH stages**";
   - §12.1: the reference adjudicator's list is "the disagreeing items of **both stages**";
   - `lib/reconcile.mjs` takes `drawnEntries` documented as "manifest entries for BOTH stages" and
     iterates `for (const [id] of drawn) for (const field of FIELDS)`.

   So reference records total **180 at the floor and 660 at the cap**, not 120 and 600. The
   dt004 `workload_scheduler.mjs` computes `observations = held_out_companies × fields` and applies
   it to reference as well as rating; it therefore **understates the reference workload by 30 records
   per recorder** — 50% at the floor, 10% at the cap. Rating is held-out only (§12.1), so the
   scheduler is correct there.

## 2. Per-unit time: ASSUMPTIONS with stated basis

**Every figure in this section is an ASSUMPTION. None is a protocol quantity. None has been
measured. None may be cited as evidence.** Full basis text is in `h_timeline.mjs` §0 and in
`RUN_OUTPUT.json` under `assumptions`.

| Unit | ASSUMPTION | Basis |
|---|---|---|
| One blind reference record | **25 min** | §9.3 record from scratch: locate the §9.4 authority-tier source, read the value, write `value_kind`, `expected_value` in the §9.3 format, source name and class, URL, `publication_date`, `as_of_date`, `search_note`, and apply the §9.3 forbidden-kind rule. Independently re-derived; it happens to match the dt004 default of 25 — agreement is not confirmation. |
| One reference adjudication | **12 min** | §9.2.1 packet for one disagreeing row: two unlabelled records with sources and search notes, plus the §9.4 table. §9.5 forbids a third value, so no fresh lookup. |
| One rating, **abstention row** (CPG returned nothing) | **2.5 min** | §10.1 then asks one question — "reference holds an authoritative value?" — which the sealed record already answers. MISSED-FILL or CORRECT-ABSTENTION by inspection. No URL opened, no arithmetic. |
| One rating, **fill row** (CPG returned a value) | **8 min** | §10.2 is arithmetic and cheap (four-digit equality; \|CPG − ref\| ≤ 10%; currency marker + K/M/B parse + 10%; the 24-month `as_of_date` window). The cost is the one node §10.2 cannot answer: "value attributable to the **EXPECTED** entity?", which requires opening the §12.3 cited-URL union, and which carries the P3 = 0 threshold via MISATTRIBUTED-FILL. |
| Fill fraction | **0.35** | PURE ASSUMPTION, and it is a **study outcome**, so it cannot be known in advance. Only G1 (≥ 20 fills) constrains it. Swept 0.07 / 0.2 / 0.35 / 0.6 / 1.0. |
| ⇒ effective rating minutes/row | **4.4 min** | `0.35 × 8 + 0.65 × 2.5`. Replaces the dt004 single figure of 6 min. |
| One rating adjudication | **8 min** | §12.2 packet plus Label A / Label B plus a rationale. |
| One frame row | **20 min** | registry identity, canonical domain, jurisdiction family, checksum-valid decisive identifier, the A4 independent tie with URL and note, six tri-state §5.1 answers, §5.2 class prediction. Public sources only. |
| Frame admissible yield | **0.6** | §5.7.2 needs 210 *admissible, eligible* rows; failures still cost time and still occupy a §15.3 screening row. ⇒ **350 candidates screened**. Swept 0.4 / 0.6 / 0.8 / 1.0. |
| Reference disagreement rate | **0.25** | PURE ASSUMPTION, unknowable in advance. Swept 0 / 0.05 / 0.10 / 0.25 / 0.50 / 1.00. |
| Rating disagreement rate | **0.20** | PURE ASSUMPTION, unknowable in advance. Swept 0 / 0.05 / 0.10 / 0.20 / 0.50 / 1.00. |
| Productive hours per person-day | **4** | Sustained careful blinded single-task work. **The single most load-bearing assumption here**: elapsed days scale as 1/this. |
| Working days per week | **5** | Calendar conversion only. |

## 3. Per-role hours, seven-human design

| Role | Units at floor (12/5/3) | Hours | Units at cap (60/25/15) | Hours |
|---|---|---|---|---|
| enumerator (1 person) | 350 candidates | **116.7** | 350 candidates | **116.7** |
| reference Author | 90 records | 37.5 | 330 records | **137.5** |
| reference Confirmer | 90 records | 37.5 | 330 records | **137.5** |
| reference adjudicator | 23 items @ d=0.25 | 4.6 | 83 items @ d=0.25 | 16.6 |
| rater 1 | 60 obs | 4.4 | 300 obs | 22.1 |
| rater 2 | 60 obs | 4.4 | 300 obs | 22.1 |
| rating adjudicator | 12 items @ d=0.20 | 1.6 | 60 items @ d=0.20 | 8.0 |

The enumerator's load is **independent of the sample size** — §5.7.2 sizes the frame for the *worst
permitted pilot outcome*, so 350 candidates must be screened even if the pilot later yields the
20-company floor. At the floor configuration the single enumerator is the **largest single load in
the study** (116.7 h against the Author's 37.5 h).

## 4. Per-person load, all four rosters, cap configuration (100 companies)

| Design | Person | Roles held | Hours | Working days | Working weeks |
|---|---|---|---|---|---|
| **7-human** | P-1 | enumerator | 116.7 | 29.2 | 5.83 |
| | P-2 | reference-author | 137.5 | 34.4 | 6.88 |
| | P-3 | reference-confirmer | 137.5 | 34.4 | 6.88 |
| | P-4 | reference-adjudicator | 16.6 | 4.2 | 0.83 |
| | P-5 | rater-1 | 22.1 | 5.5 | 1.11 |
| | P-6 | rater-2 | 22.1 | 5.5 | 1.11 |
| | P-7 | rating-adjudicator | 8.0 | 2.0 | 0.40 |
| **8-human** | P-1, P-8 | enumerator ×2 | 58.3 each | 14.6 | 2.92 |
| | (others as above) | | | | |
| **3-human** | P-1 | enumerator + reference-author + rater-1 | **218.0** | 54.5 | 10.90 |
| | P-2 | enumerator + reference-confirmer + rater-2 | **218.0** | 54.5 | 10.90 |
| | P-3 | reference-adjudicator + rating-adjudicator | 24.6 | 6.2 | 1.23 |
| **2-human** | P-1 | enumerator + reference-author + reference-adjudicator + rater-1 | **234.6** | 58.6 | 11.73 |
| | P-2 | enumerator + reference-confirmer + rater-2 + rating-adjudicator | **226.0** | 56.5 | 11.30 |

At the floor configuration: 3-human = 100.3 / 100.3 / 6.2 h; 2-human = 104.9 / 101.9 h.

**Load multiple.** The heaviest person in the two-human design carries **1.71×** the heaviest
person in the seven-human design (234.6 h vs 137.5 h) and holds **4 roles instead of 1**. Total
human hours are close to identical across designs — the work does not shrink — so the entire effect
of reducing headcount is concentration of load and collapse of separation, not reduction of effort.

## 5. Where the two people must serialise, and where they must not

| Constraint | Can two people parallelise? | Enforced by |
|---|---|---|
| Two blind reference records of the **same row** | **Never by one person.** Two people, both doing 100% of rows, is the *required* structure | §9.1 ("never see each other's records", "never communicate before both submit"); `reconcile()` refuses `author.recorded_by === confirmer.recorded_by` |
| Two independent ratings of the same row | **Never by one person** | §12 ("≥ 2 independent"); `ratings.mjs`: "the two sheets were rated by the same person — ≥ 2 independent raters are required" |
| Reference adjudication | **Requires a third person.** No parallelism substitutes | §9.5 ("the adjudicator must differ from both"); `reconcile()` refuses it row by row |
| Rating adjudication | **Requires a third person** | §12.2; `ratings.mjs`: "the rating adjudicator must be neither rater (§4A.3)" |
| Enumeration | **Yes, arbitrarily.** The only multipliable role | §4A.3 "enumerator (≥ 1)"; `checkPersonnelRegister` permits `n > 1` for `enumerator` only |
| Reference phase vs rating phase | **No, in any design.** Forced serial by the chain | §12 rater packet carries "the sealed reference record"; §9.6 seal published before execution; §6.5 window opens at the published seal record's timestamp |
