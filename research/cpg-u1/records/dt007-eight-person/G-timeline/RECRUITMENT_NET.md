# RECRUITMENT_NET — the risk that reverses the decision

**AGENT G of DEEPTECH-PARALLEL-007. ENGINEERING ARTIFACT.** Derived by `g_calendar.mjs`; real output
in `RUN_OUTPUT.txt` §5 / `RUN_OUTPUT.json`. Changes no frozen byte. Not U1 evidence.

---

## 0. The finding, stated plainly and not buried

**Adding the eighth person saves calendar time if and only if that person is in the ORIGINAL
roster.**

Added after the personnel register has closed and `check-personnel` has passed — which is the
realistic case, because "add a second enumerator" is an optimisation *discovered by analysis*, not a
founding design choice — the §4A.1 item-6 re-declaration round plus a cold single-person search can
**consume the entire enumeration saving and reverse it**. Under the central late-addition
recruitment cost of +1.86 weeks, the net effect is **negative in 252 of 648** grid cells. At the
worst late-addition cost it is negative in **617 of 648**.

```
NETTING IT OUT — enumeration saving MINUS recruitment cost:
  gross enumeration saving (central)      : 2.51 weeks
  R1 up-front recruitment cost            : 0.07 .. 0.86 weeks
  => NET, DECIDED UP FRONT                : +1.65 .. +2.44 weeks SAVED
  R2 late-addition recruitment cost       : 0.64 .. 5.43 weeks
  => NET, ADDED LATE                      : -2.92 .. +1.87 weeks

  *** SIGN REVERSAL ***  In the pessimistic corner of the LATE-ADDITION model the eighth
  person DELAYS the study end-to-end by up to 2.92 weeks.
```

Over the joint grid rather than the central cell:

```
QUOTABLE RANGE OF THE GROSS ENUMERATION SAVING (joint-grid p10..p90): 0.98 .. 4.53 weeks, median 2.23.
NET OF UP-FRONT RECRUITMENT (+0.07..+0.86):      0.13 .. 4.45 weeks SAVED.
NET OF LATE-ADDITION RECRUITMENT (+0.64..+5.43): -4.45 .. 3.88 weeks.
  => under LATE ADDITION the net effect is NEGATIVE in 617 of 648 grid cells at the worst
     recruitment cost, and negative in 252 cells at the CENTRAL late-addition cost of +1.86 wk.
```

---

## 1. What the eighth person mechanically requires

An eighth person as a second enumerator **is** permitted: §4A.3 lists "enumerator (**≥ 1**)" and
"Several enumerators are permitted; each holds no other role", and `checkPersonnelRegister()` rejects
`n > 1` for **every** role except `enumerator`. Confirmed by reading `personnel.mjs`.

What that person costs, mechanically, from `personnel.mjs` (one per assignment, no exceptions):

1. **One more signed §4A.1 declaration.** All seven `DECLARATION_KEYS` must read exactly `"no"`.
2. **One more `organisation_confirmation_sha256`** — the developing organisation's **written**
   confirmation that its records show no item 1–4 relationship. **REQUIRED, 64 hex, `null` is not
   accepted.**
3. **One more `study_fee_agreement_sha256`** (or an explicit `null`), agreed **in writing before any
   role material is released** and **not contingent** on any result (§4A.1 item 5).
4. **One more §4A.2 packet release**, and one more person under the barrier who must never receive
   pilot, sizing, quota or any CPG output.

## 2. The item-6 coupling — the part the prior analysis missed entirely

§4A.1 item 6 disqualifies a person who

> is the spouse or partner, a family member or a household member of, or has a current or former
> direct reporting relationship with, any person who developed CPG, the operator (key custodian), **or
> any holder of another §4A.3 role**.

This is **relational and roster-dependent**, and §4A.1 adds: **"An unknown answer is not 'no'."**

A person who has not been told that an eighth role-holder exists **cannot truthfully answer item 6
about them**. Their existing declaration therefore does not cover the new person.

```
Pairwise relational checks: C(7,2) = 21 pairs at 7 role-holders; C(8,2) = 28 at 8.
=> +7 pairs (+33.3%), plus 1 more person-vs-operator and 1 more person-vs-developers check,
   plus 1 more organisation confirmation and 1 more fee agreement.
```

**And the tooling cannot see the problem.** `checkPersonnelRegister()` only checks that each
declaration key is the string `"no"`. A **stale** declaration — signed before the eighth person
existed — passes. The staleness is a methodological defect that `check-personnel` will happily exit 0
on. Nothing mechanical protects it, which is precisely why a scheduling analysis omits it.

## 3. Three models

### R1 — decided up front (the eighth person is in the roster before recruitment closes)

One batched declaration round covers all eight and no re-declaration occurs.
`T(n) = ff·T7 + (1−ff)·T7·n/7`.

```
| T(7) wk | fixed_fraction | T(7) | T(8) | recruitment COST |
| 2 | 0    | 2 | 2.29 | **+0.29** |
| 2 | 0.5  | 2 | 2.14 | **+0.14** |
| 2 | 0.75 | 2 | 2.07 | **+0.07** |
| 4 | 0    | 4 | 4.57 | **+0.57** |
| 4 | 0.5  | 4 | 4.29 | **+0.29** |
| 4 | 0.75 | 4 | 4.14 | **+0.14** |
| 6 | 0    | 6 | 6.86 | **+0.86** |
| 6 | 0.5  | 6 | 6.43 | **+0.43** |
| 6 | 0.75 | 6 | 6.21 | **+0.21** |
  RANGE OF THE UP-FRONT RECRUITMENT COST: +0.07 .. +0.86 weeks.
  (The prior analysis used exactly one cell of this table: T7=4, ff=0.5 -> +0.29 wk.)
```

**Recruiting 8 instead of 7 lengthens the recruitment phase by 0.07–0.86 weeks under a parallel
search model.** Small, and the prior analysis's +0.29 wk is a legitimate central cell of it — but it
is one cell quoted as the answer, with no range.

### R2 — added late (after the register has closed)

Cost = a marginal search for **one** person alone against a cold pipeline, **plus** a second batched
declaration round so that all eight can answer item 6 about the new roster, plus one organisation
confirmation (overlappable with the declaration round).

A readable slice of the 54-cell sweep (full table in `RUN_OUTPUT.txt` §5):

```
| T(7) wk | ff | cold factor | decl round wk | marginal search | re-declaration | recruitment COST |
| 2 | 0.5 | 2 | 0.5 | 0.29 | 0.5 | **+0.79** |
| 4 | 0.5 | 2 | 1   | 0.57 | 1   | **+1.57** |
| 4 | 0   | 2 | 1   | 1.14 | 1   | **+2.14** |
| 6 | 0   | 2 | 2   | 1.71 | 2   | **+3.71** |
| 6 | 0   | 4 | 1   | 3.43 | 1   | **+4.43** |
  RANGE OF THE LATE-ADDITION RECRUITMENT COST: +0.64 .. +5.43 weeks (full sweep, 54 cells).
```

Two structural reasons the late-addition cost is **not** just the marginal search:

- **the declaration round is roughly headcount-independent but not repeat-free.** It costs the same
  whether the roster is 7 or 8 — but it must be **run again** if the roster changes after it closes,
  and it is the *second* run that is the cost;
- **a single-person search cannot be amortised.** Recruiting 7 people runs one pipeline and takes the
  first 7 who qualify. Recruiting the 8th alone means reopening the channel with no pool of parallel
  candidates to draw a winner from.

### R3 — staggered arrival (additional to R1/R2, not instead of)

If enumerator #2 arrives Δ weeks after #1 has **started**, #1 works alone for Δ weeks and only the
remainder is halved. **Every week of lag destroys half a week of saving**, and the break-even lag
equals the whole one-enumerator elapsed time.

```
| Delta (wk) | elapsed 2-enum (wk) | saving vs 1 enum (wk) |
| 0   | 5.49 | 2.51 |
| 0.5 | 5.7  | 2.3  |
| 1   | 5.92 | 2.09 |
| 2   | 6.34 | 1.66 |
| 3   | 6.77 | 1.24 |
| 4   | 7.19 | 0.81 |
```

This is the one piece of *good* news in the document: **the saving degrades gracefully rather than
vanishing.** A second enumerator who arrives late still helps, as long as they arrive before the
first would have finished. But at Δ = 4 weeks the gross saving is already down to 0.81 weeks — less
than the late-addition recruitment cost in almost every cell of R2.

## 4. A second enumerator's other costs

### Quantified

```
  briefing              : +3 h (ASSUMPTION; per-person, does not halve)
  merge + dedup         : +7.15 h beyond the extra briefing (ASSUMPTION)
  coordination          : +1 operator h per enumerator per elapsed week
                          = +5.49 h over the 2-enumerator phase (ASSUMPTION).
                          Falls on the OPERATOR, who is not independent and not on the
                          enumeration critical path, so it is a cost in effort but usually not
                          in schedule.
  total extra human work: +10.1 h (6.7%)
```

### Cannot be quantified here, and I will not pretend otherwise

- the elapsed time of obtaining the **organisation confirmation** for one more person: an external
  records check by the developing organisation, with nothing in the repository bounding it;
- the elapsed time of the **fee-agreement** negotiation;
- the **real per-family screening yields**, which decide the true partition imbalance;
- the **real cross-partition collision rate**.

## 5. "At zero independence cost" — corrected

The prior analysis concluded the saving comes "with no independence cost". That is wrong as stated,
and the mechanism is in §4A.1 itself:

> **enumerator work:** the frame is not independent (§20.18)

The frame is a **single joint artefact with one `frame_hash`**. With two enumerators, a false
declaration by **either one** taints the **whole** frame, including the partition the other one
built. The study's exposure to enumerator-declaration failure therefore **doubles**.

The correct statement: **no structural independence separation is collapsed** — every §4A.3 mutual
exclusion is preserved, each enumerator holds no other role, no enumerator is the reference
adjudicator, and `checkPersonnelRegister()` passes — **but the probability-weighted independence risk
carried by the frame rises with the number of enumerators.** "Zero independence cost" overstates the
case. It is a *small* cost, correctly described, not an absent one.

## 6. Recommendation implied by the arithmetic (an option, not a decision)

1. **If the personnel register is still open: put the second enumerator in it now.** Net +0.13 to
   +4.45 weeks, and the item-6 coupling costs nothing because one declaration round covers the final
   roster.
2. **If the register has closed: the arithmetic no longer clearly favours it.** Decide on Δ (how soon
   the person could actually start) and on whether a second declaration round is required. If Δ > 3
   weeks, the gross saving is under ~1.2 weeks and almost certainly below the recruitment cost.
3. **Either way, prioritise the partition split over the headcount.** Getting the split balanced is
   worth ~1.4 weeks (3.04 vs 1.62) and costs no recruitment at all.

**Every duration figure in this document is an ASSUMPTION with a stated basis in §0 of
`g_calendar.mjs`. None is a measurement. The recruitment band 2–6 weeks is taken from dt005
`DAG.md` task B3 and is itself an unmeasured estimate. None of this may be cited as U1 evidence.**
