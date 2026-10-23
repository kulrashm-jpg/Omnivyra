# TIMELINE_COMPARISON — two-human vs seven-human CPG-U1

**AGENT H of DEEPTECH-HUMAN-MIN-001.**
**CLASSIFICATION: ENGINEERING ARTIFACT.** A resourcing/scheduling derivation on explicitly stated
assumptions. Not U1 evidence, not a protocol artefact, not a decision. It changes no frozen byte.

Produced 2026-09-24 in worktree `C:/tmp/dt4-uncert` at base
`af2fb6e99ce461894bf16f18c2251f75088eba18`. Script: `h_timeline.mjs`; real output:
`RUN_OUTPUT.txt`, `RUN_OUTPUT.json`.

Sources read (read-only): `research/cpg-u1/CPG_U1_PROTOCOL_004.md`
(`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`) §4A, §5, §6, §6.5, §9, §10,
§12, §13, §15, §19.3; the frozen instrument at `C:/tmp/dt002/research/cpg-u1/tooling/lib`
(`sizing.mjs`, `frame.mjs`, `schema.mjs`, `sampling.mjs`, `drand.mjs`, `packets.mjs`,
`raterOrder.mjs`, `reconcile.mjs`, `ratings.mjs`, `personnel.mjs`);
`C:/tmp/dt005-orchestration/DAG.md`; `C:/tmp/dt004-operations/people/tools/workload_scheduler.mjs`
(re-derived, not trusted).

**Observation counts are FIXED INPUTS.** Nothing here reduces a required observation, a field, a
rater or a recorder to shorten a timeline.

---

## 1. Headline

| Question | Answer |
|---|---|
| Does any phase **lengthen** with two people instead of seven? | **No. Not one.** |
| Does the two-human design finish sooner? | **It never finishes.** Two phases acquire zero eligible workers and the frozen tooling refuses them. |
| If a future protocol version permitted self-adjudication, would it finish sooner? | Yes, by **0.29–3.43 weeks**, all of it recruitment search — and **0.00 weeks** of it is a headcount effect once the 7-person design is allowed its second enumerator. |
| Cheapest legitimate acceleration found | **Add** an eighth person as a second enumerator. §4A.3 already permits several enumerators. Saves **2.63–2.92 weeks** post-recruitment with no independence cost. |

## 2. The two designs as schedules (worst permitted configuration, 60/25/15 = 100 companies)

Elapsed figures are working weeks at 4 productive h/day, 5 days/week (both ASSUMPTIONS, §3 of
`WORKLOAD_PER_PERSON.md`). Chain and publication phases are calendar time converted at 7 days/week.

| Phase | 7-human | 8-human (2 enum) | 2-human | Parallel or serial, and why | Lengthens at 2? |
|---|---|---|---|---|---|
| P0 recruitment | 2–6 wk (DAG B3) | 2.07–6.86 wk | 0.57–4.93 wk | external search, not throughput | — |
| A3 OSF registration | 0.14 | 0.14 | 0.14 | SERIAL, headcount-independent: registry-issued timestamp | no |
| P1 frame enumeration | **5.83** | **2.92** | **2.92** | PARALLEL. `enumerator (≥ 1)` is the only role §4A.3 lets you multiply | **shorter** |
| C5 dev commitment→draw→pilot→sizing | 0.03 | 0.03 | 0.03 | SERIAL, chain depth + drand Δ | no |
| C6 held-out commitment→draw | 0.03 | 0.03 | 0.03 | SERIAL, chain | no |
| P2 reference truth, both stages | **6.88** | **6.88** | **6.88** | PARALLEL AND REQUIRED TO BE. §9.1 forbids communication before both submit; `reconcile()` refuses `author.recorded_by === confirmer.recorded_by`. One person cannot be both blind observers of a row. **Each of the two does 100% of the rows in every design** | no — identical |
| P3 reference adjudication | 0.83 | 0.83 | **BLOCKED** | SERIAL, one person, and that person may be neither the Author nor the Confirmer | **impossible** |
| P4 seal→publish→authorise→the one run | 0.15 | 0.15 | 0.15 | SERIAL | no |
| P5 blind rating | **1.11** | **1.11** | **1.11** | PARALLEL AND REQUIRED TO BE. `ratings.mjs` refuses two sheets with the same `rated_by`. Each rater does 100% of held-out rows in every design | no — identical |
| P6 rating adjudication | 0.40 | 0.40 | **BLOCKED** | SERIAL, and must be neither rater | **impossible** |
| O1 analysis | 0.01 | 0.01 | 0.01 | machine | no |
| **post-recruitment total** | **15.41 wk** | **12.50 wk** | 11.27 wk **but never completes** | | |

At the §5.6 floor configuration (12/5/3 = 20 companies): 7-human **8.60 wk**, 8-human **5.69 wk**,
2-human 5.38 wk (blocked).

### Why nothing lengthens — the structural reason

Protocol-004's human work is *already* organised as pairs of mutually blind workers, each doing
100% of the rows, in phases that the evidence chain forces to be strictly serial. The two blind
reference recorders are two people by definition; the two raters are two people by definition.
Going from seven people to two therefore removes **supervisors and adjudicators, not throughput**.
The only phase whose duration is a function of headcount is enumeration, and that one gets *faster*
with two people only because the 7-person minimum roster contains exactly one enumerator.

### Refutation of the "reference and rating must now serialise" argument

They serialise in **every** design at **every** headcount. §12's rater packet contains "the sealed
reference record"; §9.6 publishes the seal hash *before* held-out execution; §6.5 opens the
execution window only at the published seal record's registry timestamp. The order
`reference → seal → execute → rate` is forced by the evidence chain. The seven-human design has no
reference/rating overlap to lose, so two people lose nothing there.

## 3. Netting it out honestly

At the cap configuration, central recruitment calibration (`T(7)=4` wk, `fixed_fraction=0.50`):

| Design | Recruitment | Work | End-to-end | Result? |
|---|---|---|---|---|
| 7-human | 4.00 wk | 15.41 wk | **19.41 wk** | adjudicated result |
| 8-human (2 enumerators) | 4.29 wk | 12.50 wk | **16.78 wk** | adjudicated result |
| 3-human | 2.86 wk | 12.50 wk | **15.36 wk** | result, but every person holds 2–3 roles |
| 2-human | 2.57 wk | 11.27 wk | *13.84 wk on paper* | **NO RESULT — blocked at P3 and P6** |

- **Saving side of fewer people:** recruitment only. Over the swept calibrations
  (`T(7)` ∈ {2,6} wk × `fixed_fraction` ∈ {0, 0.5, 0.75}), going from 7 to 3 saves
  **0.29–3.43 weeks** of recruitment.
- **Cost side:** zero weeks of extra work — and then the run stops. `check-personnel` refuses the
  2-person register with 5 role collisions; `reconcile()` refuses every disagreeing observation;
  `ratings.mjs` refuses a rater-as-adjudicator.
- **The 2.92 weeks that look like a small-team advantage are not one.** They are the second
  enumerator. Give the seven-person design an eighth person as a second enumerator and the
  post-recruitment gap between an 8-person roster and a 3-person roster is **0.00 weeks**.

**Verdict.** The two-human design is not faster and not slower. It does not terminate. Measured
against the only comparison that matters — *earliest adjudicated result* — it is infinitely slower,
and the three-human design's residual advantage over an eight-person design is recruitment search
time alone: **0.36–4.29 weeks**, purchased by collapsing every independence separation the study
exists to demonstrate.

## 4. Earliest defensible result date, counting from 2026-09-24

Assumptions: the recruitment band from DAG.md B3; the per-unit and productivity assumptions in
`WORKLOAD_PER_PERSON.md` §3; `registry_publication_days = 1`; `mean_block_minutes = 10`. Every date
below is an ASSUMPTION-CONDITIONAL PROJECTION, not a commitment.

| Configuration | Design | Scenario | Recruit | Work | Total | Earliest date |
|---|---|---|---|---|---|---|
| 12/5/3 (20 co.) | 7-human | optimistic | 2.00 | 8.60 | 10.60 wk | **2026-12-07** |
| 12/5/3 | 7-human | central | 4.00 | 8.60 | 12.60 wk | 2026-12-21 |
| 12/5/3 | 7-human | pessimistic | 6.00 | 8.60 | 14.60 wk | 2027-01-04 |
| 12/5/3 | 8-human | central | 4.14 | 5.69 | 9.83 wk | **2026-12-01** |
| 12/5/3 | 3-human | central | 2.86 | 5.69 | 8.54 wk | 2026-11-23 |
| 12/5/3 | 2-human | any | — | — | — | **NO DATE (blocked P3, P6)** |
| 60/25/15 (100 co.) | 7-human | optimistic | 2.00 | 15.41 | 17.41 wk | **2027-01-24** |
| 60/25/15 | 7-human | central | 4.00 | 15.41 | 19.41 wk | 2027-02-07 |
| 60/25/15 | 7-human | pessimistic | 6.00 | 15.41 | 21.41 wk | 2027-02-21 |
| 60/25/15 | 8-human | central | 4.29 | 12.50 | 16.78 wk | 2027-01-19 |
| 60/25/15 | 3-human | central | 2.86 | 12.50 | 15.36 wk | 2027-01-09 |
| 60/25/15 | 2-human | any | — | — | — | **NO DATE** |

**Nothing in this table has started.** Registration is not filed, personnel are not recruited, the
frame does not exist. These are dates *from a decision*, and the decision has not been taken.

### The prior ≈ 9–13 week figure: partly confirmed, partly corrected

The prior computed figure is "≈ 9–13 weeks after registration with personnel in place".

- **Confirmed in range**, but it corresponds only to the **small half** of the permitted
  configuration space. This derivation gives post-recruitment elapsed of **8.60 weeks at the §5.6
  floor** (20 companies) and **15.41 weeks at the cap** (100 companies) for the seven-human design
  at baseline assumptions.
- **Correction:** 9–13 weeks understates the cap case by **2.4–6.4 weeks**. The sample size is not
  known until the pilot runs, so a single band cannot be quoted without naming the configuration.
  The honest statement is **8.6–15.4 weeks post-recruitment, depending on a pilot outcome that does
  not yet exist**, and 15.4 is the figure to plan against because `capped` (raw ≥ 60, i.e. pilot
  total fills T ≤ 3) is exactly the *pessimistic* CPG outcome.
- **Second correction:** the band is highly sensitive to one assumption. Sweeping
  `productive_hours_per_day` over 2 / 3 / 4 / 6 / 8 gives **30.5 / 20.4 / 15.4 / 10.4 / 7.9 weeks**
  at the cap. No band narrower than that is defensible until someone commits to a per-person
  working pattern.

## 5. What is not in scope here

This document does not recommend a roster. It does not authorise a protocol change. It contains no
company name, no execution, no network call and no identity. The two-human design analysed here is
a **counterfactual**, and per §6.2 any change to it would require a new protocol version as a new
file, not an edit.
