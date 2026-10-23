# JURISDICTION_PARTITIONS — a partition plan that reaches the §5.7.2 floor with margin

**Classification: PREPARATION** (the arithmetic is an ANALYTICAL RESULT recomputed from the frozen instrument;
the enumeration targets it implies are **HUMAN-REQUIRED INPUT** — **enumeration is H3**, and only independent
enumerators may fill rows).

No real company is named, listed or implied anywhere in this document. It states *how many* candidates of
*which kind* an enumerator should target, never *which*.

---

## 1. The floor, and where it comes from

§5.7.2: before the development commitment, for each class `c`, the number `E_c` of **admissible,
held-out-eligible** rows must satisfy

```
E_c ≥ 2 · Qmax_c + Dev_c        →        E ≥ 126 / 52 / 32
```

`Qmax_c` is not typed in. `lib/frame.mjs` derives it by evaluating the frozen sizing rule
(`lib/sizing.mjs`) on **every** permitted pilot outcome. Recomputed for this stream (see VALIDATION):

```
enumeratePilotOutcomes()  →  {"outcomes":4096,"halts":1,"refused":0,
                              "maxQuotas":{"fill-expected":60,"abstention-expected":25,"identity-hazard":15}}
FRAME_MINIMUM             →  {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}
```

### The arithmetic, step by step

1. **Permitted pilot outcomes.** The pilot covers exactly the 6 development `fill-expected` companies, each
   with `fills ∈ {0,1,2,3}` → `4^6 = 4096` outcomes; total fills `T ∈ {0..18}`.
2. **HALT.** `T = 0` (exactly 1 of the 4096 outcomes) → HALT: EFR could never be assessed and no held-out
   stage exists. 0 outcomes are refused for any other reason.
3. **Fill-expected quota.** For `T ≥ 1`: `y = T/6`, `raw = ⌈(20 × 1.5)/y⌉ = ⌈180/T⌉`,
   `N_fill = min(60, max(12, raw))`.
4. **Secondary quotas.** `N_abst = max(5, ⌈5·N_fill/12⌉)`, `N_hazard = max(3, ⌈3·N_fill/12⌉)`.

| `T` | `y` | `raw` | `N_fill` | `N_abst` | `N_hazard` | |
|--:|--:|--:|--:|--:|--:|---|
| 1 | 0.167 | 180 | 60 | 25 | 15 | CAPPED |
| 2 | 0.333 | 90 | 60 | 25 | 15 | CAPPED |
| 3 | 0.500 | 60 | 60 | 25 | 15 | at the cap |
| 4 | 0.667 | 45 | 45 | 19 | 12 | |
| 5 | 0.833 | 36 | 36 | 15 | 9 | |
| 6 | 1.000 | 30 | 30 | 13 | 8 | |
| 7 | 1.167 | 26 | 26 | 11 | 7 | |
| 8 | 1.333 | 23 | 23 | 10 | 6 | |
| 9 | 1.500 | 20 | 20 | 9 | 5 | |
| 10 | 1.667 | 18 | 18 | 8 | 5 | |
| 11 | 1.833 | 17 | 17 | 8 | 5 | |
| 12 | 2.000 | 15 | 15 | 7 | 4 | |
| 13 | 2.167 | 14 | 14 | 6 | 4 | |
| 14 | 2.333 | 13 | 13 | 6 | 4 | |
| 15 | 2.500 | 12 | 12 | 5 | 3 | floor |
| 16 | 2.667 | 12 | 12 | 5 | 3 | floor |
| 17 | 2.833 | 11 | 12 | 5 | 3 | floor |
| 18 | 3.000 | 10 | 12 | 5 | 3 | floor |

Thirteen distinct quota vectors are reachable: `60/25/15, 45/19/12, 36/15/9, 30/13/8, 26/11/7, 23/10/6,
20/9/5, 18/8/5, 17/8/5, 15/7/4, 14/6/4, 13/6/4, 12/5/3`. The maximum is **`Qmax = 60/25/15`**, attained at
`T ∈ {1,2,3}` — i.e. **the worst case for frame size is CPG performing *badly* in the pilot**, because a low
yield inflates the required held-out size.

5. **Pool minimum** (§5.7): the held-out draw needs `pool_c ≥ 2 · Q_c`, so the draw is a genuine selection
   rather than a hand-picked set.
6. **Development consumption** (§5.8): the development draw removes **exactly** `Dev = 6 / 2 / 2` rows per
   class, of which at most `Dev_c` are eligible → `pool_c ≥ E_c − Dev_c`.
7. **Therefore**

```
fill-expected        E ≥ 2 × 60 + 6 = 126
abstention-expected  E ≥ 2 × 25 + 2 =  52
identity-hazard      E ≥ 2 × 15 + 2 =  32
                                      ---
minimum eligible admissible rows      210
```

8. **Tightness.** At `E_c = 2·Qmax_c + Dev_c − 1`, a development draw that takes `Dev_c` *eligible* rows of
   class `c` (possible whenever class `c` has fewer than `Dev_c` ineligible admissible rows) leaves
   `pool_c = 2·Qmax_c − 1 < 2·Qmax_c` on a `T ≤ 3` outcome. The floor cannot be lowered in the worst case.
   It is *conservative* only when ineligible rows absorb development places.

The consequence is blunt: **at least 210 eligible admissible rows** must be enumerated and screened before the
development commitment. Reference-truth workload is unchanged — only *drawn* companies are researched, at most
60/25/15 = 100 held-out plus 6/2/2 = 10 development companies, and CAP `H1` is untouched.

---

## 2. Why the frame is single and frozen before the development commitment

- **Complete before the commitment** (§5.5, §5.7.2). The complete frame `F` must exist and pass
  `check-frame-sufficiency` *before* the development commitment is broadcast. A development commitment naming
  an insufficient frame is `STAGE_VOID_FRAME_INSUFFICIENT`: the outpoint slot is consumed, there is no retry,
  and the study is VOID (enforced at `draw-development`, exit 6).
- **One frame for both stages.** The held-out payload's `frame_hash` and `scan_sha256` must equal the
  development payload's, and its `registry_sha256` must equal the registered value. `heldOutInputs` refuses
  with `FRAME_CHANGED`, `SCAN_CHANGED` or `REGISTRY_CHANGED` before a held-out commitment can be made, and the
  chain verification independently gives `STAGE_VOID_BINDING_MISMATCH`.
- **Why it must be frozen *before* the randomness exists.** The `frame_hash` is inside the on-chain digest
  before the randomness block exists. Each outpoint can be spent once (Bitcoin consensus), so a second
  commitment is impossible, and the public identity-bound registration naming the outpoints makes a second
  study instance detectable. Freezing the frame first is what makes rank-aware selection impossible: nobody
  can add, drop or reclassify a row once they can compute the rank keys.
- **Why no extension after sizing.** The sizing rule is a function of the pilot, and the pilot is CPG output.
  If the frame could grow after sizing, frame composition would become a function of CPG's observed
  performance. Hence the enumerator barrier (§4A.2): enumerators never see pilot, sizing or quota
  information, and the frame must already be big enough for the *worst* permitted pilot outcome.
- **Append-only proof retained.** The held-out payload carries an append-only proof over the development row
  hashes; with a single frame it certifies identity rather than growth.
- **No replacement** (§5.9). A drawn company is never replaced. If identity-level inadmissibility surfaces
  after the draw, all of that company's observations become INVALID and are published — they are not swapped
  out. This is a second reason to over-enumerate: margin is the only remedy, and it must be bought *before*
  the commitment.

---

## 3. Partition across the four jurisdiction families

Draw order within a class interleaves families round-robin in the fixed order
`US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY`, each family's queue in rank order; **an exhausted family simply stops
contributing and the others continue** (decision D-A). Two consequences for the partition plan:

1. **No family quota is enforced.** Nothing refuses a frame whose `LEI-ONLY` queue is empty. The realised
   jurisdiction composition is *published*, and missing families are declared as a scope limitation (§5.7.1).
   An unbalanced frame is therefore not a refusal — it is a permanent published weakness of the study.
2. **Balance is only achievable by enumeration.** Because round-robin consumes families evenly until one runs
   dry, a family that is thin *anywhere* stops contributing early in *every* class it is thin in. The only
   way to get a balanced held-out sample is a frame that is balanced **per class**, not merely in total.

### Plan: equal quarters per class, with margin

Target an equal quarter of each class per family, rounding up, then add margin. Per class,
`ceil(floor/4)` gives the per-family base:

| Class | §5.7.2 floor `E_c` | per family `⌈E_c/4⌉` | × 4 = base frame | planned target | margin over floor |
|---|--:|--:|--:|--:|--:|
| `fill-expected` | 126 | 32 | 128 | **136** (34 per family) | +10 (7.9 %) |
| `abstention-expected` | 52 | 13 | 52 | **60** (15 per family) | +8 (15.4 %) |
| `identity-hazard` | 32 | 8 | 32 | **40** (10 per family) | +8 (25.0 %) |
| **total** | **210** | — | **212** | **236** | **+26 (12.4 %)** |

Per-family totals in the planned target: `34 + 15 + 10 = 59` eligible admissible rows per family, ×4 = 236.

### Why margin, and how much

The floor counts **eligible admissible** rows — rows that survive screening *and* are not held-out-ineligible.
An enumerator cannot know in advance which rows those are, because:

- **A1–A6 attrition.** Any `no` or `unknown` on A1/A2/A4/A6, any invalid or family-impermissible identifier
  (A3), an inaccessible or unestablished family (A5), or an unestablished outcome class removes the row from
  `E_c`. A4 is the sharp one: `yes` without a valid `https` URL *and* a non-blank note is recorded as an
  outright A4 **failure**.
- **Contamination attrition.** Any of C1(1)–C1(6) — including any contamination attestation answered
  `unknown` — removes the row from `E_c` while leaving it in the frame. The enumerator cannot predict C1(1)
  scanner hits at all, since they depend on repository content the enumerator never sees.
- **Uniqueness attrition.** Duplicate identifiers or duplicate canonical domains are refused outright.
- **Asymmetric cost.** Over-enumerating costs screening effort only (unresearched rows are simply
  `NOT_DRAWN`). Under-enumerating after the commitment is `STAGE_VOID_FRAME_INSUFFICIENT` — an unrecoverable
  study VOID. The margin is cheap insurance against an uninsurable failure.

The margin is deliberately larger in relative terms for the small classes, because integer floors make them
brittle: losing 8 rows from `identity-hazard` is a 25 % loss, against 6 % for `fill-expected`.

### What an enumerator should therefore target

**Target ≈ 236 rows expected to be eligible admissible — 136 / 60 / 40, split evenly across the four
families (34 / 15 / 10 per family).**

Since screening attrition is unknown before the fact, the working instruction is:

- enumerate **against the plan, and keep enumerating until `check-frame-sufficiency` passes with the planned
  margin** — the command is the only authority on whether the frame is big enough, and it may be run as often
  as needed before the commitment;
- expect to enumerate **materially more than 236 raw candidates**: every raw candidate that screens out stays
  in the file as a screened-out row and contributes nothing to `E_c`;
- do not stop at the bare 126/52/32 — a frame that merely *reaches* the floor is one attestation correction
  away from insufficiency, and corrections after the commitment are forbidden;
- `identity-hazard` is the hardest class to source and the one where a thin family will silently stop
  contributing. Plan it first, not last.

Screened-out and ineligible rows are **not** waste. Ineligible admissible rows are drawn into development
*first* (§5.8, held-out-ineligible companies first, since they can serve nowhere else), and the surplus is
recorded as `DEVELOPMENT_SURPLUS`. A frame rich in ineligible admissible rows is strictly better than one
without: ineligible rows absorb the 6/2/2 development places and leave the eligible pool intact, which is
exactly the case in which the 126/52/32 floor is conservative rather than tight.
