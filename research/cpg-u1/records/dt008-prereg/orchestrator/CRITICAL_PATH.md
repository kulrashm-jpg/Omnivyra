# DEEPTECH-PARALLEL-008 — orchestrator's independent critical-path recomputation

I did not reuse the earlier "+1.65 … +2.44 weeks". This is a fresh model with different structure, built from
work units re-derived from the frozen code. Script `critical_path.mjs`, output `CRITICAL_PATH_RUN.txt`, both preserved.

**Nothing here is evidence. Every time-per-unit figure is an ASSUMPTION with a stated basis, and every one is swept.**

## Work units, derived from the frozen code (not assumed)

| | floor (fe=12) | cap (fe=60) |
|---|---|---|
| held-out companies | 20 | 100 |
| held-out observations (× 3 fields) | 60 | 300 |
| **reference records per recorder** (both stages: 10 development companies + held-out, × 3) | **90** | **330** |
| rating rows per rater (held-out only) | 60 | 300 |
| enumeration ask (at 0.60 yield, +30% buffer) | **455** | **455** — size-independent |

`FRAME_MINIMUM` = 126/52/32 = 210 = `2 × Qmax + DEVELOPMENT_QUOTA`, so the enumeration requirement is fixed before
any pilot exists. That is why the ask is identical at both ends.

## Which phases respond to headcount — the structural core

Only **one** does. `lib/personnel.mjs:26` permits `n > 1` for `enumerator` **and only** for `enumerator`; `reconcile()`
requires an Author *and* a Confirmer record for every drawn company × field with different `recorded_by`; and
`ratings.mjs:97`/`analyze`'s condition 3 require two distinct raters. So:

- **Enumeration** — responds to headcount. The only lever.
- **Reference truth** — two recorders each do **100%** of rows by design, so it is headcount-invariant. Confirmed in
  the sweep: varying `ref_min_per_record` from 15 to 40 changes the *saving* by **0.00 weeks**.
- **Rating, both adjudications** — same, headcount-invariant.
- **Serial chain** (commitments, randomness, draws, seal publication, the single run) — headcount-invariant.

## Phase elapsed weeks, central assumptions

| config | design | enum | ref | refAdj | rate | rateAdj | serial | chain | recruit | TOTAL |
|---|---|---|---|---|---|---|---|---|---|---|
| 20 co | 7p / 1 enum | 5.52 | 1.36 | 0.07 | 0.16 | 0.04 | 2.24 | 9.38 | 4.00 | **13.38** |
| 20 co | 8p / 2 enum | 3.65 | 1.36 | 0.07 | 0.16 | 0.04 | 2.24 | 7.52 | 4.14 | **11.66** |
| 100 co | 7p / 1 enum | 5.52 | 5.00 | 0.24 | 0.80 | 0.22 | 2.24 | 14.01 | 4.00 | **18.01** |
| 100 co | 8p / 2 enum | 3.65 | 5.00 | 0.24 | 0.80 | 0.22 | 2.24 | 12.15 | 4.14 | **16.29** |

Registration is treated as overlapping recruitment, because the DAG establishes that recruitment (B3) and
registration (A3) are independent, and registration itself is hours-to-days. **Stated as a modelling choice**, not a
derivation.

## The saving

**Chain saving 1.86 weeks; recruitment cost 0.14 weeks; NET 1.72 weeks**, identical at floor and cap because
enumeration is size-independent. What differs is enumeration's *share* of the chain: **58.8% at the 20-company floor,
39.4% at the 100-company cap** — so the eighth person matters most when the pilot goes well and the held-out set is
small.

Full grid — 13 configurations × 4 values of minutes-per-candidate × 3 of productive-hours-per-day × 3 of imbalance:

| | weeks |
|---|---|
| cells | 468 |
| minimum | 0.50 |
| p10 | 0.93 |
| **median** | **1.72** |
| p90 | 4.05 |
| maximum | 5.12 |
| **negative cells** | **0 of 468** |

## Comparison with the figure I previously reported

The earlier "+1.65 … +2.44 weeks" has a median inside my distribution, so it was not wrong in central tendency — but
it was **too narrow**. My p10–p90 is **0.93 – 4.05**. A two-decimal range implies precision the inputs do not support;
the honest statement is **1–2 weeks typically, with a plausible spread of roughly 1 to 4**.

## What moves the answer, and what does not

| factor | effect on the saving |
|---|---|
| minutes per candidate (12 → 45) | **0.98 → 4.05** — the dominant driver |
| screening yield (0.40 → 0.80) | 2.66 → 1.26 — a *worse* yield makes the eighth person worth more |
| partition imbalance (0 → 0.40) | 2.20 → 0.93 — the only differential lever the design controls |
| straggler over-ask (0 → 0.25) | 2.20 → 1.41 — a genuine cost of parallelising |
| marginal recruitment cost (0 → 1.0 wk/person) | 1.86 → 1.46 |
| **productive hours per day (3 → 8)** | **1.72 → 1.72 — no effect**, it scales both designs equally |
| **reference minutes per record (15 → 40)** | **1.72 → 1.72 — no effect**, reference is headcount-invariant |

The last two are sanity checks on the model, and they behave as the structure predicts.

## Why zero cells are negative here, when a prior analysis found many

A prior wave found the net **negative in 252 of 648 cells** — but that was the *late-addition* case, where §4A.1 item 6
forces a second declaration round because a declaration signed before an eighth role-holder existed cannot cover them.
My model assumes the eighth person is in the **original roster**, which is the situation that actually obtains: only a
declaration template and an intake tool exist, no populated register, and recruitment has never started.

**So the sign is positive only while the register stays open.** That is the whole time-criticality, and it is a
precondition of this result rather than a conclusion from it.

## What I did not model

Registration latency as a distinct critical-path segment (treated as overlapping recruitment); the possibility that
enumeration must iterate more than once against the §5.7.2 gate (which lengthens **both** designs and so does not
change the saving); the §6.5 exposure that each extra iteration round adds; and any duration for the human decisions
this wave is surfacing. None of these favours the eighth person.
