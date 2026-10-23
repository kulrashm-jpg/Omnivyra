# DEEPTECH-PARALLEL-007 · AGENT B · WORKLOAD_ARITHMETIC

Script: `partition_workload.mjs` · full real output: `RUN_OUTPUT.txt`
Command: `node partition_workload.mjs`

The script **imports the frozen instrument read-only** from
`C:/tmp/dt002/research/cpg-u1/tooling/lib/{frame,schema,sizing}.mjs`. It writes nothing there, states no
company fact, and derives every protocol constant rather than restating it.

---

## 1. Derived from the code (not from memory)

```
pilot outcomes enumerated : 4096  halts 1  refused 0
SIZING                    : MIN_FILLS=20 SAFETY=1.5 CAP_FILL_EXPECTED=60
HELD_OUT_BASE (floors)    : {"fill-expected":12,"abstention-expected":5,"identity-hazard":3}
Qmax (MAX_HELD_OUT_QUOTAS): {"fill-expected":60,"abstention-expected":25,"identity-hazard":15}
POOL_MULTIPLIER (§5.7)    : 2
DEVELOPMENT_QUOTA (§5.8)  : {"fill-expected":6,"abstention-expected":2,"identity-hazard":2}
FRAME_MINIMUM = 2*Qmax + Dev = {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}
frame minimum total E     : 210 admissible held-out-ELIGIBLE rows (§5.7.2)
FRAME_COLUMNS             : 22 columns; attribution columns present: enumerated_by, enumerated_at, enumeration_source_url
  US-SEC      permitted schemes: CIK | LEI  (2 of them)
  FR-SIRENE   permitted schemes: SIREN | LEI  (2 of them)
  BR-CNPJ     permitted schemes: CNPJ | LEI  (2 of them)
  LEI-ONLY    permitted schemes: LEI  (1 of them)
```

`lib/frame.mjs` re-derives `Qmax` by running the frozen sizing rule on all 4096 permitted pilot outcomes
(exactly 1 HALT, 0 refusals), and `FRAME_MINIMUM = POOL_MULTIPLIER × Qmax + DEVELOPMENT_QUOTA`.

**The §5.7 pool multiplier and the §5.8 development consumption are already inside the 210.** They must
not be applied again. 210 is the count of **admissible AND held-out-eligible** rows; ineligible-but-
admissible rows are useful (§5.8 fills development from them first) but count toward nothing.

---

## 2. Assumptions (every human-time figure; none is protocol)

| ID | Value | Basis |
|---|---|---|
| **A-1/2/3** | minutes per fully worked row: **25** fill-expected, **40** abstention-expected, **55** identity-hazard | `FRAME_COLUMNS` = 22 cells. A3 needs a decisive identifier in a scheme permitted for the family (`identifiers.mjs` checksum); A4 needs an identifier↔domain tie with an https URL **and** a note, both enforced by `checkFrameRow`. §5.2's three definitions differ in logical form: `fill-expected` is a **disjunction** ("at least one of the three fields"); `abstention-expected` is a **conjunctive negative** over all three fields, and a negative claim requires an exhaustive search; `identity-hazard` additionally requires a **second real entity** to be found and named in `identity_hazard_note` (enforced non-empty) — two entities researched for one row. |
| **A-4** | P(admissible \| screened): **0.70 / 0.55 / 0.50** | Six tri-state criteria and `UNKNOWN` never passes (`checkFrameRow`). A4 and A6 bind; the abstention and hazard classes are by construction weakly documented, which pressures exactly those two. |
| **A-5** | P(eligible \| admissible) = **0.90** | 13-entry registry; C1(1) scan scope is narrow (TEST + six `CPG_IMPLEMENTATION` prefixes). But §5.3's "`unknown` is treated exactly like `yes`" means a row the enumerator cannot attest for is lost. |
| **A-6** | a dropped candidate costs **0.40 ×** a kept one | A1/A2 fail early, A6 fails late. |
| **A-7** | **5.5** productive screening hours per enumerator-day | Sustained detail work with citation capture. |
| **A-N** | untargeted class incidence **0.72 / 0.18 / 0.10** | Ordering argued from §5.2's logical form alone (disjunction > conjunctive negative > coincidence). Magnitudes are judgement. |
| **A-Q** | incidence under a **qualitative, quota-free** instruction **0.50 / 0.28 / 0.22** | The enumerator is told to seek all three kinds, with fill-expected commonest — no numbers. |
| **A-F** | family effort multiplier **US-SEC 1.00, FR-SIRENE 1.10, BR-CNPJ 1.15, LEI-ONLY 1.35** | **Basis is in the code, not world knowledge.** (i) `JURISDICTION_FAMILIES['LEI-ONLY'] = ['LEI']` — **one** permitted scheme, so a candidate whose LEI cannot be established is unrecoverable at A3, whereas the other three permit their national scheme **or** LEI (two chances). (ii) §5.1 makes `LEI-ONLY` the catch-all for every *inaccessible* jurisdiction, so its A4 tie has no national registry to anchor it. (iii) `isValidCik` is `/^[0-9]{1,10}$/ && >0` — **no checksum**, so a transcribed-wrong CIK passes A3 and the burden shifts to the human A4 step; SIREN is Luhn, CNPJ is a two-stage mod-11, LEI is ISO 7064 mod 97-10, all of which catch transcription mechanically. |
| **A-S** | serial operator hours: 3.0 partition rule (once), 0.5 id namespace (once), 1.0 commitment prep (once), and per round 2.0 merge/dedupe + 1.5 scan review + 0.5 sufficiency | All of it is **human review around machine steps** (`frame`, `scan`, `check-frame-sufficiency`, `commitment-payload`). |
| **A-R** | **2** integration rounds (initial ask + one top-up) | §5.7.2: "If unmet ... enumeration continues first." |

**A correction to a constraint I was given.** The freeze point is the **development commitment**, not the
sufficiency check. §5.7.2 explicitly contemplates pre-commitment top-up ("enumeration continues first"),
and §5.5.3's "No changes after the development commitment" bites only *after* the commitment. So an
under-delivered partition is **recoverable by another round** — it costs calendar time, not the study.
The unrecoverable case is a commitment to an insufficient frame, which is
`STAGE_VOID_FRAME_INSUFFICIENT` with no retry (§5.7.2, §5.10) and is prevented by running
`check-frame-sufficiency` before `commitment-payload` (both enforce it). The buffer in §7 is therefore
justified by **round count and barrier latency**, and by the tail risk of a mis-ordered commitment — not
by an unrepairable frame.

---

## 3. Total candidates that must be SCREENED — and the price of the barrier

`p_eff(c) = incidence(c) × P(admissible|c) × P(eligible)`. Because the enumerator **cannot be told class
quotas**, they cannot stop a class early: the volume is set by the class with the largest
`target_c / p_eff(c)`, and every other class overshoots.

**Scenario N — no class instruction at all (strictest barrier reading).**

| class | target | p_eff | candidates needed | yield at n=712 | overshoot |
|---|---|---|---|---|---|
| fill-expected | 126 | 0.4500 | 278 | 323 | **+197 wasted rows** |
| abstention-expected | 52 | 0.0900 | 584 | 63.4 | +11.4 |
| **identity-hazard** | 32 | 0.0500 | **712 ← binding** | 32.0 | 0 |

→ **712 candidates, 269.5 h.**

**Scenario Q — qualitative, quota-free class instruction (RECOMMENDED).**

| class | target | p_eff | candidates needed | yield at n=400 | overshoot |
|---|---|---|---|---|---|
| **fill-expected** | 126 | 0.3200* | **400 ← binding** | 126 | 0 |
| abstention-expected | 52 | 0.1400 | 376 | 55.4 | +3.4 |
| identity-hazard | 32 | 0.1000 | 324 | 39.6 | +7.6 |

\* displayed rounded; the computation uses `0.50 × 0.70 × 0.90 = 0.315`.

→ **400 candidates, 170.9 h.**

Expected cost per screened candidate: fill-expected 19.45 min, abstention-expected 27.88 min,
identity-hazard 36.85 min → **25.64 min** weighted at A-Q incidence (22.71 min at A-N).

**Scenario T — quotas disclosed (NOT PERMITTED; lower bound only): 378 candidates, 158.3 h.**

> **Price of the §4A.2 / §5.5.3 barrier:**
> **111.2 h** if the enumerator gets no class instruction at all (N vs T);
> **12.6 h** with the qualitative instruction (Q vs T).
>
> One quota-free English sentence — "rows must cover all three outcome classes of §5.2; fill-expected
> will be the commonest; deliberately seek the other two as well" — is worth **98.6 hours** and
> discloses no number. This is the largest single lever in this whole analysis, and it is larger than
> everything parallelisation buys.

---

## 4. Family-weighted total effort (scenario Q, equal counts per family)

| family | candidates | min/cand | multiplier | effort |
|---|---|---|---|---|
| US-SEC | 100 | 25.64 | 1.00 | **42.7 h** |
| FR-SIRENE | 100 | 25.64 | 1.10 | **47.0 h** |
| BR-CNPJ | 100 | 25.64 | 1.15 | **49.1 h** |
| LEI-ONLY | 100 | 25.64 | 1.35 | **57.7 h** |
| **total (one enumerator)** | **400** | | | **196.6 h = 35.7 enumerator-days** |

**The four families are not interchangeable, and the schema says so.** `LEI-ONLY` permits exactly one
identifier scheme against the other three families' two, and §5.1 makes it the catch-all for every
inaccessible jurisdiction. A **50/50 count split is therefore not a 50/50 effort split** — the spread is
`LEI-ONLY / US-SEC = 1.35×` on the multiplier alone.

---

## 5. Balanced vs unbalanced — parallel effort only

| split | A | B | makespan | idle | speedup | efficiency |
|---|---|---|---|---|---|---|
| one enumerator | 196.6 h | — | 196.6 h | — | 1.00 | — |
| **(a) effort-balanced 2+2 `{US-SEC, LEI-ONLY}` vs `{FR-SIRENE, BR-CNPJ}`** | **100.4 h** | **96.1 h** | **100.4 h** | **4.3 h** | **1.96** | **97.9%** |
| (a) count-balanced 2+2 `{US-SEC, FR-SIRENE}` vs `{BR-CNPJ, LEI-ONLY}` | 89.7 h | 106.8 h | 106.8 h | 17.1 h | 1.84 | 92.0% |
| (a) 1+3, `{LEI-ONLY}` alone | 57.7 h | 138.9 h | 138.9 h | 81.2 h | 1.42 | 70.8% |
| (d) hash split, family-blind *(unavailable — fails T1)* | 98.3 h | 98.3 h | 98.3 h | 0.0 h | 2.00 | 100% |
| (e) both enumerate everything | 196.6 h | 196.6 h | 196.6 h | — | **1.00 at 2× the effort** | 50% |
| **worst permitted imbalance** | 196.6 h | 0 h | 196.6 h | 196.6 h | **1.00** | 50% |

**Expected candidates per enumerator under a balanced split: 200 each** (400 total, scenario Q).

**The worst permitted imbalance is 100 / 0.** The protocol sets **no floor** on an enumerator's share:
§4A.3 says only "several enumerators are permitted; each holds no other role", and every row carries its
own `enumerated_by`. Nothing in §5.7's rank key
(`sha256("<seed>|<scheme>:<identifier>")`, `lib/select.mjs:16`) or in D-A's family round-robin refers to
`enumerated_by`, so **imbalance cannot bias the draw**. Imbalance is purely an efficiency and
availability question — with the one exception that a 100/0 split makes the second enumerator's §4A.1
vetting pointless while still counting them as a role-holder.

**If one family yields far fewer admissible rows than another,** the effect is asymmetric and not
self-correcting under scheme (a): the enumerator holding the weak family simply cannot reach their
volume, and the *other* enumerator cannot substitute, because a substitute row would be in the wrong
family and — critically — the shortfall is invisible to both of them until the operator's barrier. The
protocol absorbs a missing family gracefully at the **draw** ("An exhausted family stops contributing
and the others continue ... missing families are declared as a scope limitation", §5.7) but **not at
sufficiency**: §5.7.2 is a per-class count over the whole frame, family-blind. So a weak family
degrades the realised jurisdiction composition (a declared §20.3 limitation) rather than breaking
sufficiency — **provided** total volume is met. The remedy is total volume, which is what §7's buffer
buys.

---

## 6. Amdahl

```
parallelisable human effort (per-candidate screening) : 196.6 h
serial human effort (whole-frame, operator)           : 12.5 h   (2 rounds)
parallelisable fraction p                             : 94.02%
Amdahl speedup at N=2                                 : 1.89   (ideal 2.00; loss 5.6%)
Amdahl speedup at N=4 / N=8 / N->inf                  : 3.39 / 5.64 / 16.7
realised, best 2+2 jurisdiction split                 : 1.85
realised, worst 2+2 jurisdiction split                : 1.75
realised, 1+3 jurisdiction split                      : 1.38
realised, hash split (unavailable)                    : 1.89
```

See `PARALLELISABLE_FRACTION.md` for why the whole-frame steps do **not** dominate.

---

## 7. Buffer sizing (binding class `fill-expected`, target 126, `p_eff` = 0.315000)

Normal approximation with continuity correction, on the real `p_eff` (not the rounded display value).

| buffer | ask | P(class met) | P(class met if the **true** yield is 0.85 × assumed) |
|---|---|---|---|
| +0% | 400 | 52.1% | 1.9% |
| +5% | 420 | 76.2% | 7.5% |
| +10% | 441 | 91.5% | 21.2% |
| +15% | 460 | 97.4% | 40.3% |
| +20% | 480 | 99.4% | 62.2% |
| **+30%** | **520** | **~100%** | **91.3%** |

Sampling noise alone is cheap to cover (+10% ⇒ 91.5%). **Yield mis-estimation dominates**: if A-4/A-5 are
15% optimistic, even a +20% buffer fails 38% of the time. **Recommended base buffer: +30% ⇒ ask 520
candidates (255.5 h).** This buffer is required with **one** enumerator too — it is not a cost of
parallelisation.

### 7b. The parallelisation buffer specifically — and it is a real tax

One enumerator watches their own running total and simply keeps going. Two enumerators on a disjoint
partition **cannot see each other**, and the operator learns the combined count only at a barrier. To
avoid an extra round, each half must absorb the credible single-enumerator underdelivery.

| straggler allowance per half | one enumerator | two-enumerator makespan | speedup | tax |
|---|---|---|---|---|
| +10% | 255.5 h | 140.5 h | 1.75 | 10% |
| **+15%** | **255.5 h** | **146.9 h** | **1.68** | **15%** |
| +20% | 255.5 h | 153.3 h | 1.62 | 20% |
| +25% | 255.5 h | 159.7 h | 1.56 | 25% |

> **Explicitly: the straggler buffer is a cost of parallelisation.** It takes the two-enumerator speedup
> from **1.89** (Amdahl ceiling) / **1.85** (best real split) down to **1.68**. The recommended +15%
> costs **38.4 extra human hours** that a single enumerator would never spend.

---

## 8. Calendar, at 5.5 productive hours/day

| | effort each | enumerator-days each | operator | elapsed |
|---|---|---|---|---|
| one enumerator (+30% buffer) | 255.5 h | 46.5 | 5.5 h, 1 round | **47.5 days** |
| two enumerators (+30% base, +15% straggler) | 146.9 h | 26.7 | 12.5 h, 2 rounds | **29.0 days** |

**Elapsed saving 47.5 → 29.0 days = 1.64×, i.e. 39% less calendar time, bought with +15% more total
human hours (255.5 h → 293.9 h).**

**Theoretical maximum saving** for two enumerators is **2.00×** (perfect balance, zero serial work, no
buffer). The realistic ceiling chain is:

```
2.00  theoretical
1.89  after the 6.0% serial fraction (Amdahl, N=2)
1.85  after the best achievable 2+2 jurisdiction imbalance
1.68  after the +15% straggler buffer that the partition itself makes necessary
1.64  after 2 barrier rounds of operator latency
```

**A second enumerator buys 39% of calendar time. A single quota-free class-coverage sentence buys 98.6
hours (36%) on its own, applies with one enumerator, costs nothing, and should be adopted whether or not
the second enumerator is.**
