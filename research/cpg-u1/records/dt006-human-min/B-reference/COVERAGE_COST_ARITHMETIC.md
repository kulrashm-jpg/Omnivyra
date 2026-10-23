# COVERAGE_COST_ARITHMETIC — what removing the reference adjudicator costs

**Classification: METHODOLOGY REVIEW / PROPOSAL. NOT REGISTERED. NO PROTOCOL CHANGE.**
DEEPTECH-HUMAN-MIN-001 · AGENT B (reference truth) · 2026-09-24

- Protocol: `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **unmodified**.
- Instrument: tooling v6, aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`
  (recomputed here with `lib/aggregate.mjs`; matches).
- Every quota number below is **derived mechanically** by `coverage_arithmetic.mjs`, which evaluates the
  frozen sizing rule (`lib/sizing.mjs`) on all 4096 permitted pilot outcomes via `lib/frame.mjs`.
  Nothing is hard-coded. Raw output: `coverage_arithmetic.json`.

---

## 1. The exclusion budget is fixed by §15.5(2), and it is small

§15.5(2): *"Fewer than 90% of held-out company × field observations VALID"* → INCONCLUSIVE.

The instrument implements this as exact integer arithmetic (`lib/analysis.mjs:198`):

```js
'2_valid_below_90pct': { triggered: 10 * valid.length < 9 * total, ... }
```

**Boundary resolved.** The test is `10·VALID < 9·T`, strictly. So **exactly 90 % VALID passes**; the
run is INCONCLUSIVE only when VALID falls *below* 90 %. The minimum conclusive VALID count is
therefore `ceil(9T/10)`, and the maximum number of excluded observations is

```
  k_max(T) = T − ceil(9·T/10) = floor(T/10)
```

`total` in `analysis.mjs` is `evaluation.items.length`, which `checkEvaluation` forces to be *every*
held-out company × field — all three outcome classes, all three fields. So `T = 3·N`.

This budget is **shared by every exclusion cause**: `INVALID` (identity inadmissible after the draw, no
response, harness error), `REFERENCE-CONFLICT`, `REFERENCE-STALE` and `REFERENCE-AMBIGUOUS` all land in
the same non-VALID bucket (`analysis.mjs:146-152`). There is no separate per-cause allowance.

## 2. Permitted held-out sizes — derived, not assumed

`heldOutQuotas` (`lib/sizing.mjs`) is a total function of the pilot's fill total `t` over the 6
development fill-expected companies, `y = t/6`:

```
  raw  = ceil(MIN_FILLS · SAFETY / y) = ceil(30/y) = ceil(180/t)
  fe   = min(CAP_FILL_EXPECTED, max(HELD_OUT_BASE.fe, raw)) = min(60, max(12, ceil(180/t)))
  ae   = max(5, ceil(fe·5/12))          ih = max(3, ceil(fe·3/12))
```

`t = 0` returns `{halt: true}` — the pilot HALTS and held-out is never drawn (1 of 4096 outcomes).
So `t ∈ 1..18`, and the **reachable** `fe` values are exactly

```
  t :  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
  fe: 60 60 60 45 36 30 26 23 20 18 17 15 14 13 12 12 12 12
```

**There are 13 distinct permitted quota vectors, not 49.** `fe` ranges over 12..60 but only takes the
13 values above; `fe = 16, 19, 21, 22, 24, 25, …` are unreachable because `ceil(180/t)` cannot produce
them. (Correction to the orchestrator's derivation: the *range* is 12..60, the *reachable set* has 13
members. The N and T extremes, 20..100 companies and 60..300 observations, are as the orchestrator
stated.)

| pilot `t` | fe | ae | ih | N | T = 3N | VALID floor `ceil(9T/10)` | **k_max** | d_max (cond 2) | d break-even |
|---|---|---|---|---|---|---|---|---|---|
| 15–18 | 12 | 5 | 3 | 20 | 60 | 54 | **6** | 10.00 % | 11.67 % |
| 14 | 13 | 6 | 4 | 23 | 69 | 63 | **6** | 8.70 % | 10.14 % |
| 13 | 14 | 6 | 4 | 24 | 72 | 65 | **7** | 9.72 % | 11.11 % |
| 12 | 15 | 7 | 4 | 26 | 78 | 71 | **7** | 8.97 % | 10.26 % |
| 11 | 17 | 8 | 5 | 30 | 90 | 81 | **9** | 10.00 % | 11.11 % |
| 10 | 18 | 8 | 5 | 31 | 93 | 84 | **9** | 9.68 % | 10.75 % |
| 9 | 20 | 9 | 5 | 34 | 102 | 92 | **10** | 9.80 % | 10.78 % |
| 8 | 23 | 10 | 6 | 39 | 117 | 106 | **11** | 9.40 % | 10.26 % |
| 7 | 26 | 11 | 7 | 44 | 132 | 119 | **13** | 9.85 % | 10.61 % |
| 6 | 30 | 13 | 8 | 51 | 153 | 138 | **15** | 9.80 % | 10.46 % |
| 5 | 36 | 15 | 9 | 60 | 180 | 162 | **18** | 10.00 % | 10.56 % |
| 4 | 45 | 19 | 12 | 76 | 228 | 206 | **22** | 9.65 % | 10.09 % |
| 1–3 | 60 | 25 | 15 | 100 | 300 | 270 | **30** | 10.00 % | 10.33 % |

`d_max` = `k_max/T` = the largest disagreement rate that still leaves the run conclusive when
disagreement is the *only* exclusion cause. `d break-even` = `(k_max+1)/T` = the first rate that
triggers INCONCLUSIVE.

## 3. The headline break-even rate

**With no adjudicator and no resolution rule, every Author/Confirmer disagreement is excluded, so
the excluded share equals `d` exactly.** Therefore:

> **§15.5(2) fires as soon as `d > floor(T/10)/T`. Across all 13 permitted sizes that boundary is
> `d_max ∈ [8.70 %, 10.00 %]`, and the first failing rate is `d ∈ [10.09 %, 11.67 %]`. In one line:
> the design survives a disagreement rate of at most 10 % and fails at anything above it —
> and 8.70 % at the tightest permitted size (fe = 13, T = 69).**

The arithmetic at the floor configuration, written out:

```
  N = 20 companies × 3 fields          = 60 observations
  VALID floor = ceil(0.9 × 60)         = 54 observations
  exclusion budget                     = 60 − 54 = 6 observations
  one disagreement                     = 1/60 = 1.667 % of observations
  6 disagreements  = 10.00 % → 10·54 = 540 ≥ 9·60 = 540 → CONCLUSIVE (exactly 90 %)
  7 disagreements  = 11.67 % → 10·53 = 530 <  540      → INCONCLUSIVE
```

At the floor **the entire exclusion budget is six observations.** The granularity is coarse: `d` is
not a continuous dial but an integer count out of 60, and the seventh disagreement in the whole study
ends it.

## 4. The honest number: `d_max` minus the other causes

The 10 % figure assumes nothing else is ever excluded. That assumption is false by construction, and
the protocol says so:

- **REFERENCE-STALE** (§10.2 temporal rule, `analysis.mjs:150`) applies to `employee_count` and
  `revenue_range` — **two of the three fields, i.e. 66.7 % of all observations are stale-eligible** —
  whenever the sealed `as_of_date` is more than 24 months before the run `asOf`. Under the
  undecided AD-6 = `ALL_REFERENCE_RECORDS` it applies to `NOT_AVAILABLE_FROM_SOURCE` rows too, which
  *widens* the exposure.
- **REFERENCE-AMBIGUOUS** is a rater-time exclusion (§10.1) with no upper bound.
- **INVALID** covers post-draw identity inadmissibility (**all three** of that company's
  observations at once — at the floor, one such company consumes half the budget) and any harness
  error.

Shared budget at the floor configuration (T = 60, k_max = 6):

| other exclusions (obs) | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| conflicts still affordable | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| **tolerable d** | 10.00 % | 8.33 % | 6.67 % | 5.00 % | 3.33 % | 1.67 % | **0 %** |

> **The honest break-even is `d_max = 10 % − e`, where `e` is the share of observations excluded for
> every other reason. At the floor configuration, a single inadmissible company (3 INVALID
> observations) halves the affordable disagreement rate to 5 %; six non-conflict exclusions leave
> zero. There is no configuration in which the conflict budget is generous, and the tightest
> permitted size (T = 69) starts at 8.70 % before any other cause is counted.**

At the cap (T = 300, k_max = 30) the budget is proportionally the same but the *granularity* is
finer — `d_max` falls from 10.00 % to 8.00 % as other exclusions rise from 0 to 6 — so large held-out
sizes are more forgiving of a handful of unrelated exclusions and no more forgiving of `d` itself.

## 5. G1 (≥ 20 fills) — the second constraint, and when it binds first

`G1 = {fills, threshold: 20, holds: fills >= 20}` where `fills = S + U + I + M` counted over **VALID
rows only** (`analysis.mjs:164-171`). Every excluded observation that would have been a fill is a
fill lost.

The sizing rule targets `MIN_FILLS × SAFETY = 30` fills: `fe = ceil(30/y)`, so the pilot-estimated
held-out fill count is `fe · y ≈ 30` for every uncapped vector. Two bounds follow.

**(a) Uniform conflicts** — disagreement independent of whether CPG filled. Fills surviving
`= fe·y·(1−d)`; G1 needs `≥ 20`:

```
  d ≤ 1 − 20/(fe·y) ≈ 1 − 20/30 = 33.3 %
```

Computed per vector: 32.61 %–35.29 %. **Not binding — §15.5(2) fires far earlier.**

**(b) Adversarially concentrated conflicts** — every disagreement lands on an observation CPG filled
(the realistic worst case, because disagreement concentrates on companies whose facts are hard to
establish, which are also the companies where a grounded resolver is most likely to emit something).
Then fills lost `= d·T`, and G1 needs `d·T ≤ fe·y − 20`:

| fe | 12 | 13 | 14 | 15 | 17 | 18 | 20 | 23 | 26 | 30 | 36 | 45 | 60 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d_max from G1 (concentrated) | 16.67 % | 14.49 % | 13.89 % | 12.82 % | 12.22 % | 10.75 % | 9.80 % | **8.55 %** | **7.58 %** | **6.54 %** | **5.56 %** | **4.39 %** | n/a |
| d_max from §15.5(2) | 10.00 % | 8.70 % | 9.72 % | 8.97 % | 10.00 % | 9.68 % | 9.80 % | 9.40 % | 9.85 % | 9.80 % | 10.00 % | 9.65 % | 10.00 % |

**From `fe = 20` onward the two bounds cross, and from `fe = 23` onward G1 is the tighter
constraint — down to 4.39 % at `fe = 45`.** Low pilot yield therefore hurts twice: it enlarges the
held-out sample (more reference-truth work, more chances to disagree) *and* it tightens the
disagreement rate the design can survive.

**The capped vector cannot pass G1 at all.** At `fe = 60` with pilot total `t = 1` (`y = 1/6`), the
estimated held-out fills are `60 × 1/6 = 10 < 20`: G1 fails at `d = 0`. That is §20.11 and the
`CAP_FILL_EXPECTED` comment made arithmetic — the cap is a resourcing ceiling, not a guarantee.

## 6. What a recovering rule would have to achieve

If a deterministic rule resolves a share `r` of disagreements (§9.5-legal only after amendment; see
`RESOLUTION_RULE_ASSESSMENT.md`), unresolved conflicts are `d·T·(1−r)` and the requirement becomes
`d·T·(1−r) ≤ k_max − e·T`. Required recovery at the floor configuration (T = 60, k_max = 6):

| d | disagreements | r_min (e = 0) | r_min (e = 2 obs) | r_min (e = 4 obs) |
|---|---|---|---|---|
| 5 % | 3 | 0 % | 0 % | 33.3 % |
| 10 % | 6 | 0 % | 33.3 % | 66.7 % |
| 15 % | 9 | 33.3 % | 55.6 % | 77.8 % |
| 20 % | 12 | 50.0 % | 66.7 % | 83.3 % |
| 30 % | 18 | 66.7 % | 77.8 % | 88.9 % |

So a rule set must recover **one disagreement in three at d = 15 %, one in two at d = 20 %**, before
any other exclusion cause is allowed for. That is the bar options (b) and (c) have to clear.

## 7. What `d` actually is, and why nobody knows it

`d` is the rate at which two independent, CPG-blind people, each following §9.3/§9.4, record a
different `(value_kind, normalised value)` pair for the same company × field. Nothing in the protocol,
the instrument or the prior operations artefacts estimates it. It is the single most important unknown
in this whole assessment and **it is measurable before any held-out commitment**, at zero risk to the
study:

- the 10 development companies (6 fill-expected + 2 + 2 = 30 observations) are already outside
  held-out; a double-entry pass over them yields a direct `d̂` with a ±1-observation resolution of
  3.3 %;
- the disagreement *census* (how the disagreements distribute over kind-pairs, tier-pairs and fields)
  is exactly what decides whether options (b) and (c) can recover 33–50 % of them.

**Recommendation (owner decision):** run a development-stage double-entry census and publish `d̂` and
the census **before** deciding whether the reference adjudicator can be removed. The decision is a
function of a number that costs 30 observations of human work to obtain, and guessing it is not
necessary.

## 8. Reproduction

```sh
export CPG_U1_INSTRUMENT=/path/to/dt002/research/cpg-u1/tooling   # aggregate f7699f05…5eb04e5cc5dd
node coverage_arithmetic.mjs > coverage_arithmetic.json
```

The script refuses to run against any tree whose aggregate is not the verified instrument, and writes
only to stdout.
