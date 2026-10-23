# CALENDAR_SAVING_RECOMPUTED — the second enumerator, recomputed from scratch

**AGENT G of DEEPTECH-PARALLEL-007.**
**CLASSIFICATION: ENGINEERING ARTIFACT.** A resourcing/scheduling derivation on explicitly stated
assumptions. **Not U1 evidence. Not a protocol artefact. Not a decision.** It changes no frozen byte.

Produced 2026-09-24 in worktree `C:/tmp/dt4-exec` at base
`af2fb6e99ce461894bf16f18c2251f75088eba18`. Script: `g_calendar.mjs`. Real output:
`RUN_OUTPUT.txt` (608 lines), `RUN_OUTPUT.json`.

**Observation counts, the §5.7.2 frame minimum and the §5.7 pool minimum are FIXED INPUTS.
Nothing in this document reduces any of them.** Where this analysis departs from the prior one on a
workload figure, it departs *upward*.

---

## 1. Verdict in one table

| | |
|---|---|
| **Claim under test** | Adding an eighth person as a second enumerator removes ≈ **2.63–2.92 weeks** post-recruitment, at zero independence cost. |
| **Disposition** | **CORRECTED, not confirmed.** |
| **What is wrong with it** | It assumes enumeration is **100 % parallelisable** and divides the hours by two. A second enumerator removes **22–39 %** of the enumeration phase, not 50 %. |
| **Corrected gross saving** | **0.98 – 4.53 weeks** (joint-grid p10–p90), **median 2.23 weeks** |
| **Corrected net, second enumerator in the ORIGINAL roster** | **+0.13 – +4.45 weeks saved** |
| **Corrected net, second enumerator ADDED LATE** | **−4.45 – +3.88 weeks.** Negative in **252 of 648** grid cells at the central late-addition recruitment cost. |
| **"At zero independence cost"** | **Wrong as stated.** No *structural* separation is lost; the frame's *exposure* to a false enumerator declaration doubles (§4A.1, §20.18). |
| **Is the prior number impossible?** | No. 2.92 wk sits inside my plausible range. But it is reached there by a **different and larger one-enumerator baseline**, not by the 50 % mechanism the prior analysis used. **The derivation is wrong even where the number is survivable.** |

---

## 2. Baseline — verified independently, nothing accepted

Real output, pasted:

```
protocol sha256        : c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
  expected             : c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719   MATCH
instrument files       : 593  MATCH (593)
instrument aggregate   : f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
  expected             : f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd   MATCH
  (recipe re-implemented from §19.1/§24: sha256 of the UTF-8 text of one line
   "<sha256>  <path>" per file, sorted by path, LF-terminated, vendored deps included)
```

The aggregate was **re-derived**, not read: `g_calendar.mjs` re-implements the §19.1/§24 recipe from
the prose (it does not call the instrument's own `aggregate.mjs`) and walks all 593 files.

### Every orchestrator-supplied fact, re-verified

```
distinct reachable held-out configurations: 13   MATCH (13 claimed)
image of min(60,max(12,ceil(180/T))) over T in 1..18 : {12,13,14,15,17,18,20,23,26,30,36,45,60}
  claimed                                            : {12,13,14,15,17,18,20,23,26,30,36,45,60}   MATCH
FRAME_MINIMUM (§5.7.2)          : {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}
  total                         : 210   MATCH (210 claimed)
range of held-out companies    : 20 .. 100   MATCH (20..100 claimed)
range of held-out observations : 60 .. 300   MATCH (60..300 claimed)
reference records per recorder : 90 .. 330   MATCH (90..330 claimed)
```

**Every one of the orchestrator's facts is confirmed.** `enumeratePilotOutcomes()` returns
`{"outcomes":4096,"halts":1,"refused":0,"maxQuotas":{"fill-expected":60,"abstention-expected":25,"identity-hazard":15}}`.

One clarification the numbers hide: **§5.7.2 is a PER-CLASS rule.** Reaching 210 rows in total is
not sufficient — `frameSufficiency()` returns a `shortfall[]` entry for each class independently, so
the binding constraint is the *worst* class. The prior analysis applied a single flat yield to a
single total.

### The size-independence claim — CONFIRMED, and it is load-bearing

Four independent checks (full text in `RUN_OUTPUT.txt` §1.3):

1. `FRAME_MINIMUM[c] = 2·MAX_HELD_OUT_QUOTAS[c] + DEVELOPMENT_QUOTA[c]`, and
   `MAX_HELD_OUT_QUOTAS` is the maximum over **all 4096** permitted pilot outcomes, not the realised
   one.
2. The enumerator could not act on the realised size even if it existed: §4A.2 bars pilot, sizing
   and quota information, **and** the ordering makes it moot — the complete frame must pass
   `check-frame-sufficiency` *before* the development commitment, and the pilot happens *after* the
   development draw. **The realised size does not exist yet when enumeration must finish.**
3. The worst case is not a corner: `Qmax` is attained at `T ∈ {1,2,3}`, i.e. when CPG performs
   **badly** in the pilot.
4. Getting it wrong is `STAGE_VOID_FRAME_INSUFFICIENT`: the outpoint slot is consumed, no retry,
   study VOID.

**A consequence the prior analysis did not draw.** Because enumeration is size-independent while
reference truth is not, the *value* of a second enumerator is **highest at the 20-company floor**
(where enumeration is 51.4 % of the whole study) and **lowest at the 100-company cap** (37.3 %). A
single point figure hides a real dependence on the pilot outcome — of the denominator, not the
numerator.

---

## 3. The one-enumerator workload

### 3.1 Where the requirement comes from (all fixed inputs)

| Source | Content |
|---|---|
| §5.7 pool minimum | `pool_c ≥ 2 × quota_c`, verified by `pool-check` without any randomness |
| §5.8 development consumption | the development draw removes exactly 6 / 2 / 2 rows per class |
| §5.7.2 sufficiency | `E_c ≥ 2·Qmax_c + Dev_c` = **126 / 52 / 32 = 210** admissible, held-out-eligible rows |
| dt004 `JURISDICTION_PARTITIONS.md` | operational target **136 / 60 / 40 = 236** (+12.4 %), because a frame that merely *reaches* the floor is one attestation correction from insufficiency and corrections after the commitment are forbidden |

**Screening-yield ASSUMPTION: 0.60.** Basis: compound survival of six tri-state §5.1 criteria where
`unknown` never passes; the A4 rule that a "yes" without **both** an https URL and a note is an
outright failure; `OUTCOME_CLASS_NOT_ESTABLISHED`; §5.7 uniqueness refusal on duplicate identifier
or canonical domain; and C1(1)–C1(6), where an `unknown` contamination attestation is treated
exactly as `yes`. The C1(1) component is, by construction, **unpredictable to the enumerator** —
dt004: "the enumerator cannot predict C1(1) scanner hits at all". **NOT MEASURED.**

### 3.2 Do I reproduce 350 candidates / 116.7 h? Yes — exactly.

```
--- (a) EXACT REPRODUCTION OF THE PRIOR ANALYSIS'S RECIPE -------------------------------------
  target = FLOOR 210, yield 0.6, 20 min flat, failed rows at full cost:
  candidates = 210 / 0.6 = 350      prior analysis claimed 350   REPRODUCED
  hours      = 350 x 20 min = 116.7 h  prior analysis claimed 116.7 h  REPRODUCED
  => The prior analysis's ARITHMETIC IS CORRECT GIVEN ITS INPUTS. Its inputs are the problem.
```

### 3.3 Three corrections to its inputs — all of them *upward*

- **C-1** It targets the **bare §5.7.2 floor (210)**. dt004's independently prepared plan targets
  **236** and says explicitly to "expect to enumerate materially more than 236 raw candidates".
  Using the bare floor schedules the study with **zero margin against an unrecoverable VOID**.
- **C-2** It costs all three classes identically. §5.2 plus `schema.mjs` make `identity-hazard`
  strictly more expensive — a *different* real entity sharing the name or a confusable domain must
  be found **and** named in a mandatory `identity_hazard_note` — and `abstention-expected` requires
  a **negative** existence claim over the whole §9.4 authority table. dt004, independently:
  "identity-hazard is the hardest class to source".
- **C-3** It applies a flat yield to a **per-class** rule.

### 3.4 My central one-enumerator figure

```
  | class | required eligible-admissible | candidates screened | hours |
  | fill-expected | 136 | 226.7 | 71.02 |
  | abstention-expected | 60 | 100 | 37.6 |
  | identity-hazard | 40 | 66.7 | 33.42 |
  | **total** | **236** | **393.3** | **142** |

  same assumptions against the bare §5.7.2 FLOOR (210): 350 candidates, 125.1 h

  ELAPSED, work only, one enumerator at 4 h/day x 5 d/wk:
    PLAN  : 142 h = 35.5 working days = 7.1 weeks
    FLOOR : 125.1 h = 31.3 working days = 6.26 weeks
    prior analysis's figure                          = 5.83 weeks (it reported 5.83)
```

**I do not reproduce 116.7 h as the right figure — only as the right arithmetic on the wrong
inputs.** My central baseline is **393 candidates / 142 h**, 22 % higher.

### 3.5 An unresolved discrepancy I will not paper over

dt005 `DAG.md` task **C4** bands enumeration at **2–4 weeks** for one enumerator. My 7.1 weeks and
the prior analysis's 5.83 weeks **both exceed that band**. The three estimates reconcile only at the
optimistic end of two assumptions at once (12 min/candidate, yield 0.8, bare floor → 2.91 wk, inside
the band). **This is an owner question, not a result.** One of the three figures is wrong and none of
them is measured.

---

## 4. The two-enumerator workload

### 4.1 The total work does not fall. It rises.

```
TOTAL HUMAN WORK (the thing that does NOT fall):
  one enumerator : 142 h screening + 10 h serial = 152 h
  two enumerators: 142 h screening + 20.1 h serial = 162.2 h
  => total work RISES by 10.1 h (+6.7%).
```

Two independent people who must not coordinate on *which* companies they choose beyond the partition
rule create work a single enumerator never does: a second briefing, a merge, and cross-partition
uniqueness reconciliation. **Only elapsed time can fall, and only for the per-candidate screening
part.**

### 4.2 Elapsed, balanced and unbalanced

```
| scenario | heaviest partition h | parallel days | serial days | gate latency days | total days | WEEKS |
| 1 enumerator | 142 | 35.5 | 2.5 | 2 | 40 | **8** |
| 2 enumerators, PERFECTLY balanced | 71 | 17.8 | 5 | 2 | 24.8 | **4.96** |
| 2 enumerators, imbalance 0.15 | 81.7 | 20.4 | 5 | 2 | 27.5 | **5.49** |
| 2 enumerators, imbalance 0.40 | 99.4 | 24.9 | 5 | 2 | 31.9 | **6.38** |

SAVING, 2 enumerators vs 1, PLAN target, central assumptions:
  perfectly balanced : 3.04 weeks
  imbalance 0.15      : 2.51 weeks   <-- CENTRAL
  imbalance 0.40     : 1.62 weeks
```

**Why `max()` and not `mean()`.** A parallel phase ends when the **last** partition ends; §5.7.2 is
checked on the **union**, so the frame is insufficient until both partitions are in. And the
imbalance is not hypothetical: the dt004 plan is 4 jurisdiction families × 3 classes = 12 cells,
unequal in target size (34/15/10 per family) **and** in per-row search cost. A whole-family split is
balanced by planned **row count** (59 per family) and not by **effort**, because per-family yields
differ and are unknown before the fact. The prior analysis assumed a perfect 50/50 split.

---

## 5. The recomputed figure, and the one line that matters

```
--- JOINT GRID: the full cross product of plausible values, no corner-picking -------------------
  cells evaluated                            : 648
  one-enumerator elapsed        p10/p50/p90  : 4.2 / 7.37 / 12.65 weeks
  GROSS SAVING (weeks)          p10/p50/p90  : 0.98 / 2.23 / 4.53
  GROSS SAVING (weeks)          min..max     : 0.43 .. 9.02
  SAVING AS A FRACTION of the 1-enum phase   : p10 0.224 / p50 0.299 / p90 0.391  (min 0.153, max 0.434)

  THE MOST STABLE STATEMENT IN THIS WHOLE ANALYSIS, and the one I would defend:
  a second enumerator removes 22.4%-39.1% of the enumeration phase (median 29.9%).
  IT NEVER REMOVES 50%. The prior analysis assumed exactly 50%. That is the error, in one line.
```

The grid is the full cross product of screening yield {0.5, 0.6, 0.8} × min/candidate {12, 20, 30} ×
productive h/day {3, 4, 5} × partition imbalance {0, 0.15, 0.25} × target {FLOOR, PLAN} × four
class-cost profiles = 648 cells. **No corner-picking.**

Note what is stable and what is not. The saving **in weeks** ranges over an order of magnitude,
because it is proportional to a one-enumerator baseline that is itself unmeasured. The saving **as a
fraction of the phase** is stable at 15–43 %. That fraction is the finding; the weeks are a
projection.

### 5.1 The comparison, stated fairly

| | prior analysis | this analysis |
|---|---|---|
| one-enumerator screening hours | 116.7 h (350 cand.) | 142 h (393 cand.) |
| one-enumerator elapsed | 5.83 wk | 8.00 wk (incl. serial + gates) |
| two-enumerator elapsed | 2.92 wk | 5.49 wk |
| parallel efficiency implied | **100 %** | **29.9 %** (median) |
| gross saving | 2.92 wk | 2.51 wk central, 0.98–4.53 wk grid |
| recruitment cost of the 8th person | +0.29 wk (one model cell) | +0.07…+0.86 up front; +0.64…+5.43 added late |
| net end-to-end | 2.63 wk | +0.13…+4.45 up front; **−4.45…+3.88 added late** |

**2.92 weeks is not far from my median of 2.23.** Two errors of opposite sign nearly cancel: the
prior analysis understated the baseline *and* overstated the parallel efficiency. **A figure that is
right by cancellation is not a verified figure** — and the two errors do not cancel once recruitment
is priced honestly, which is where the conclusion actually changes.

---

## 6. Deliverable cross-references

- **`AMDAHL_CEILING.md`** — what cannot be parallelised, the parallelisable fraction, the ceiling,
  and the marginal return on a third and fourth enumerator.
- **`RECRUITMENT_NET.md`** — the §4A.1 item-6 coupling, three recruitment models, and the sign
  reversal.
- **`CRITICAL_PATH.md`** — the chain, where enumeration sits, and the end-to-end totals.

---

## 7. Assumptions used here (each one an ASSUMPTION, none measured)

The full list with bases is §0 of `g_calendar.mjs` and the `assumptions` key of `RUN_OUTPUT.json`.
The load-bearing ones: **20 min per candidate screened**; **0.60 screening yield**; **class cost
multipliers 1.0 / 1.2 / 1.6**; **failed-row cost factor 0.85**; **4 productive h per person-day**;
**partition imbalance 0.15**; **cross-partition collision rate 0.02**; **2 sufficiency iterations at
1 working day of gate latency each**; **3 h briefing per enumerator**; **6 h whole-frame serial
work**; **4 h merge**. The reference (25 min/record) and rating (4.4 min/observation) figures are
taken at the prior analysis's own values **deliberately**: they are common to both designs and so
cannot affect the difference, only the denominator.

**None of these is a protocol quantity. None has been measured. None may be cited as U1 evidence.**
