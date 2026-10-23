# CPG-U1 — the arithmetic cost of an unresolved rater disagreement

**Classification: METHODOLOGY REVIEW. PROPOSAL, NOT REGISTERED.** No protocol byte changed. No
registration, no frame, no execution. DEEPTECH-HUMAN-MIN-001, Agent C.

Everything below is derived mechanically. The held-out sizes come from the **frozen** sizing rule
(`C:/tmp/dt002/research/cpg-u1/tooling/lib/sizing.mjs`, `lib/frame.mjs`, `lib/schema.mjs`), evaluated
by `prototype/costArithmetic.mjs` — the rule is not retyped here. The threshold algebra comes from
`lib/analysis.mjs`. Instrument aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`.

Notation: `r` = rater disagreement rate (disagreements ÷ observations), `N` = held-out
company × field observations, `D = r·N` = disagreement count, `F` = fills, `B` = agreed erroneous
fills, `E₀` = observations already excluded for other causes.

---

## 1. The four integer inequalities that decide everything

From `lib/analysis.mjs`, compared exactly, in integers:

```js
const G1 = { fills, threshold: 20, holds: fills >= 20 };
const P1 = { ...frac(bad, fills), threshold: 0.05, met: fills > 0 && 20 * bad <= fills };
const P2 = { ...frac(CA, CA + U), threshold: 0.9, met: arDefined ? 10 * CA >= 9 * (CA + U) : false, ... };
const P3 = { misattributed: M, threshold: 0, met: M === 0 };
...
'2_valid_below_90pct': { triggered: 10 * valid.length < 9 * total, ... }
'3_rating': { triggered: (alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha)) || sheet1.rated_by === sheet2.rated_by || 10 * completelyRated < 9 * total, ... }
```

Every endpoint is a **linear** inequality in the label counts, and `valid` is the only population any
of them reads. Three consequences, all used below:

1. **No endpoint formula changes** when `DISAGREEMENT` becomes a non-`VALID` disposition. The
   endpoints restrict themselves to agreed observations automatically.
2. **§15.5(2) is the exclusion budget.** Not triggered ⇔ `10·V ≥ 9·N` where `V = N − E`
   ⇔ `10N − 10E ≥ 9N` ⇔ `N ≥ 10E` ⇔ **`E ≤ ⌊N/10⌋`**.
3. **§15.5(3) is untouched by disagreement.** `completelyRated` counts rows where neither rater label
   is `pending`; a disagreeing row qualifies. `α` also stays intact — see §6.

## 2. α is unaffected by adjudication — confirmed in code

```js
const alpha = { population: D['AD-1'], ...alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label])), threshold: 0.667 };
```

`alphaNominal` receives `[r.rater_1_label, r.rater_2_label]` — the raters' own labels. No resolution,
in any design, enters this number. AD-1 is recorded `"value": "EXCLUDE_INVALID_CONFLICT_AND_STALE"`,
so the population is every completely-rated row whose disposition is not `INVALID`,
`REFERENCE-CONFLICT` or `REFERENCE-STALE`. **`DISAGREEMENT` must not be added to that list** or α
becomes 1.0 by construction (see `RATING_TWO_HUMAN_ANALYSIS.md` §2.3).

AD-2 is recorded `"value": "INCONCLUSIVE"`, so an **undefined** α (a single label used throughout, or
nothing pairable) triggers condition 3. Removing the adjudicator does not change this either way.

## 3. The permitted held-out sizes, derived from the frozen rule

`SIZING = {"MIN_FILLS":20,"SAFETY":1.5,"CAP_FILL_EXPECTED":60}`;
`HELD_OUT_BASE = {fill-expected: 12, abstention-expected: 5, identity-hazard: 3}`;
`FIELDS` = 3. The rule is `raw = ⌈(20 × 1.5) / y⌉` with `y = t/6` the pilot yield over the 6
development fill-expected companies, `fill = min(60, max(12, raw))`, and the other two quotas scaled
from the base and floored at it. `t = 0` **HALTs** (no held-out draw). Evaluated over every attainable
`t = 1..18`:

| pilot fills t | y=t/6 | fe | ae | ih | companies | N obs | exp. fills F | §15.5(2) budget ⌊N/10⌋ | budget share | G1 slack F−20 | D_max | break-even r* | G1-only r (proportional) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (capped) | 0.167 | 60 | 25 | 15 | 100 | 300 | 10.00 | 30 | 10.00% | 0 | 0 | 0.00% | n/a |
| 2 (capped) | 0.333 | 60 | 25 | 15 | 100 | 300 | 20.00 | 30 | 10.00% | 0 | 0 | 0.00% | 0.00% |
| 3 | 0.500 | 60 | 25 | 15 | 100 | 300 | 30.00 | 30 | 10.00% | 10 | 10 | 3.33% | 33.33% |
| 4 | 0.667 | 45 | 19 | 12 | 76 | 228 | 30.00 | 22 | 9.65% | 10 | 10 | 4.39% | 33.33% |
| 5 | 0.833 | 36 | 15 | 9 | 60 | 180 | 30.00 | 18 | 10.00% | 10 | 10 | 5.56% | 33.33% |
| 6 | 1.000 | 30 | 13 | 8 | 51 | 153 | 30.00 | 15 | 9.80% | 10 | 10 | 6.54% | 33.33% |
| 7 | 1.167 | 26 | 11 | 7 | 44 | 132 | 30.33 | 13 | 9.85% | 10 | 10 | 7.58% | 34.07% |
| 8 | 1.333 | 23 | 10 | 6 | 39 | 117 | 30.67 | 11 | 9.40% | 10 | 10 | 8.55% | 34.78% |
| 9 | 1.500 | 20 | 9 | 5 | 34 | 102 | 30.00 | 10 | 9.80% | 10 | 10 | 9.80% | 33.33% |
| 10 | 1.667 | 18 | 8 | 5 | 31 | 93 | 30.00 | 9 | 9.68% | 10 | 9 | 9.68% | 33.33% |
| 11 | 1.833 | 17 | 8 | 5 | 30 | 90 | 31.17 | 9 | 10.00% | 11 | 9 | 10.00% | 35.83% |
| 12 | 2.000 | 15 | 7 | 4 | 26 | 78 | 30.00 | 7 | 8.97% | 10 | 7 | 8.97% | 33.33% |
| 13 | 2.167 | 14 | 6 | 4 | 24 | 72 | 30.33 | 7 | 9.72% | 10 | 7 | 9.72% | 34.07% |
| 14 | 2.333 | 13 | 6 | 4 | 23 | 69 | 30.33 | 6 | 8.70% | 10 | 6 | 8.70% | 34.07% |
| 15 | 2.500 | 12 | 5 | 3 | 20 | 60 | 30.00 | 6 | 10.00% | 10 | 6 | 10.00% | 33.33% |
| 16 | 2.667 | 12 | 5 | 3 | 20 | 60 | 32.00 | 6 | 10.00% | 12 | 6 | 10.00% | 37.50% |
| 17 | 2.833 | 12 | 5 | 3 | 20 | 60 | 34.00 | 6 | 10.00% | 14 | 6 | 10.00% | 41.18% |
| 18 | 3.000 | 12 | 5 | 3 | 20 | 60 | 36.00 | 6 | 10.00% | 16 | 6 | 10.00% | 44.44% |

**Range: 20 companies / 60 observations to 100 companies / 300 observations.** The §15.5(2) budget
share ranges **8.70 % (N = 69) to 10.00 %** — I independently reproduce the coordinator's figures.
`FRAME_MINIMUM = {fill-expected: 126, abstention-expected: 52, identity-hazard: 32}` and
`MAX_HELD_OUT_QUOTAS = {60, 25, 15}` (4096 enumerated pilots, 1 HALT, 0 refused).

Note the design intent visible in the `exp. fills F` column: the sizing rule targets
`MIN_FILLS × SAFETY = 30` expected fills at every non-capped size, so **F ≈ 30 regardless of N.** That
single fact drives the rest of this document.

## 4. Design (a) — exclude disagreements: the cost as a function of r

Two constraints bind, and which one binds depends on N.

**§15.5(2).** `E = E₀ + D ≤ ⌊N/10⌋`, so

> **D ≤ ⌊N/10⌋ − E₀**, i.e. **r\* = (⌊N/10⌋ − E₀) / N**

At the modal size (t = 15, N = 60, budget 6), with `E₀ = 0`: **r\* = 6/60 = 10.00 %** exactly — six
disagreements, and the seventh makes the run INCONCLUSIVE. Every other exclusion cause competes for
the same six slots:

| prior exclusions E₀ | as share of N=60 | disagreement budget | break-even r* |
|---|---|---|---|
| 0 | 0.00 % | 6 | **10.00 %** |
| 1 | 1.67 % | 5 | 8.33 % |
| 2 | 3.33 % | 4 | 6.67 % |
| 3 | 5.00 % | 3 | 5.00 % |
| 4 | 6.67 % | 2 | 3.33 % |
| 5 | 8.33 % | 1 | 1.67 % |
| 6 | 10.00 % | 0 | **0.00 %** |

`INVALID`, `REFERENCE-CONFLICT`, `REFERENCE-STALE`, `REFERENCE-AMBIGUOUS` and `PENDING` all count in
`E₀`. At the smallest configuration the entire budget is **six observations across all causes**.

**G1.** `fills ≥ 20` with `F ≈ 30`. Worst-case allocation (every disagreement on a filled item):

> **d_F ≤ F − 20 = 10** at F = 30, i.e. **r ≤ 10/N**

Under a proportional allocation instead: `F(1−r) ≥ 20` ⇒ **r ≤ 1 − 20/F = 1/3 ≈ 33.33 %**.

**Which binds.** Comparing `⌊N/10⌋` with `F − 20 = 10`: the valid-share budget binds for
`N ≤ 102` and G1 binds for `N ≥ 117`. Mechanically, from `costArithmetic.mjs`:

```
t=1..8   (N=300..117): binding = G1 fills
t=9..18  (N=102..60):  binding = 15.5(2) valid share
```

So **for every held-out size the break-even r under design (a) is between 0 % and 10 %**, and never
approaches the 33 % that G1 alone would tolerate. The two capped configurations (t = 1, 2) cannot
tolerate a single disagreement on a fill, because their expected fills are 10 and 20 — G1 is already
at or below its floor before any rating happens.

**And design (a) is anti-conservative on P1.** Excluding a disagreement removes an item where two
qualified people split — i.e. a *hard* item, which is where erroneous fills live. Removing it removes
both a candidate bad fill and a candidate good fill, but the P1 test is `20·bad ≤ fills`, so removing
a contested fill reduces `fills` by 1 and `bad` by 0 (because the contested item was never counted as
bad). Worked, at F = 30, B = 0, `d` contested `{SUPPORTED-FILL, INCORRECT-FILL}` pairs:

| d contested | design (a): fills / bad / EFR / P1 met | design (c) unfavourable: fills / bad_max / EFR_max / P1 met |
|---|---|---|
| 0 | 30 / 0 / 0.0000 / **true** | 30 / 0 / 0.0000 / **true** |
| 1 | 29 / 0 / 0.0000 / **true** | 30 / 1 / 0.0333 / **true** |
| 2 | 28 / 0 / 0.0000 / **true** | 30 / 2 / 0.0667 / **false** |
| 3 | 27 / 0 / 0.0000 / **true** | 30 / 3 / 0.1000 / **false** |

Design (a) reports `EFR = 0` and a clean pass at every `d`. It is pinned as a live test
(`test_twoRaterRating.mjs` T12.3–T12.6: design (a) reports 28 fills, EFR 0, every endpoint met;
design (c) reports 30 fills, `20·bad − fills = 10`, P1 not met). **Design (a) passes exactly where
design (c) refuses to.** §15.2 says "No observation may be excluded because its result is
unfavourable"; design (a) does not do that, but it does select on a feature correlated with the
outcome — difficulty — and in the claim's favour.

## 5. Design (c) — sensitivity interval: the cost as a function of r

Under (c) nothing is excluded. Every contested observation is resolved, in the arithmetic, both ways.
So:

**§15.5(2) is essentially untouched.** `valid_min = agreed_valid + Σ min(valid contribution)`, and a
label's valid contribution is 0 only for `REFERENCE-AMBIGUOUS`. So a disagreement costs a valid
observation **only if one of its two labels is `REFERENCE-AMBIGUOUS`**.

**G1 is essentially untouched.** `fills_min = agreed_fills + Σ min(fill contribution)`, and both
labels of a disagreement are on the same side of the fill/abstention boundary, because
`lib/ratings.mjs` `checkRating` refuses the crossing:

```js
if (FILL_LABELS.includes(r.label) && item.cpg_value === null) errors.push(`${r.label} for an item where CPG returned no value (§10.1)`);
if (ABSTENTION_LABELS.includes(r.label) && item.cpg_value !== null) errors.push(`${r.label} for an item where CPG returned a value (§10.1)`);
```

`FILL_LABELS` are the four fill labels and `ABSTENTION_LABELS` are `CORRECT-ABSTENTION` /
`MISSED-FILL`; `REFERENCE-AMBIGUOUS` is in neither list, so it is the **only** label admissible on
both sides. Therefore, on a filled item the admissible labels are the four fill labels plus
`REFERENCE-AMBIGUOUS`; on an unfilled item they are `CORRECT-ABSTENTION`, `MISSED-FILL` plus
`REFERENCE-AMBIGUOUS`. A disagreement reduces `fills` **only** when it pairs a fill label against
`REFERENCE-AMBIGUOUS`.

**So under design (c) the disagreement rate r has no effect at all on the §15.5(2) budget or on G1,
except for disagreements that involve `REFERENCE-AMBIGUOUS`.** The cost of losing the adjudicator
under (c) is entirely a **widening of the reported endpoint intervals**.

**The binding constraint becomes P1's absolute bad-fill budget.** `20·bad ≤ fills`, so with `F` fills
the run tolerates `⌊F/20⌋` erroneous fills *in total*. With `F ≈ 30` that is **exactly one**. Under
(c) the unfavourable bound counts every contested fill whose option set contains a bad-fill label as
bad, so the constraint is

> **B + d_p ≤ ⌊F/20⌋**, where `d_p` = contested fills whose options include `UNSUPPORTED-FILL`,
> `INCORRECT-FILL` or `MISATTRIBUTED-FILL`

| pilot fills t | exp. fills F | bad budget ⌊F/20⌋ | max d_p at B=0 | d_p share of fills | d_p share of N | max d_p at B=1 |
|---|---|---|---|---|---|---|
| 1 | 10.00 | 0 | 0 | 0.00 % | 0.00 % | 0 |
| 2 | 20.00 | 1 | 1 | 5.00 % | 0.33 % | 0 |
| 3 | 30.00 | 1 | 1 | 3.33 % | 0.33 % | 0 |
| 5 | 30.00 | 1 | 1 | 3.33 % | 0.56 % | 0 |
| 9 | 30.00 | 1 | 1 | 3.33 % | 0.98 % | 0 |
| 12 | 30.00 | 1 | 1 | 3.33 % | 1.28 % | 0 |
| 15 | 30.00 | 1 | 1 | 3.33 % | **1.67 %** | 0 |
| 16 | 32.00 | 1 | 1 | 3.13 % | 1.67 % | 0 |
| 17 | 34.00 | 1 | 1 | 2.94 % | 1.67 % | 0 |
| 18 | 36.00 | 1 | 1 | 2.78 % | 1.67 % | 0 |

(Full 18-row table in the `costArithmetic.mjs` output; every non-capped configuration gives
⌊F/20⌋ = 1.)

**So the honest break-even under design (c) is one contested erroneous-fill candidate — about
1.7 %–3.3 % of observations, not 10 %.** Two contested fills that could be bad, and the unfavourable
P1 bound fails.

**But note carefully what that does and does not say about the adjudicator.** `⌊F/20⌋ = 1` is the
budget under *both* designs: the adjudicated run also fails P1 if the adjudicator calls two contested
fills erroneous. The adjudicator does not buy slack — it buys a **decision** on the one or two items
that determine the outcome. Design (c) declines to make that decision and says so. What (c) costs,
relative to adjudication, is exactly the cases where the adjudicator would have ruled the contested
fills *good*: those runs would have reported SUCCESS and under (c) report "SUCCESS not robust".

**P3 is the harshest.** `M === 0`, so a *single* contested item whose options include
`MISATTRIBUTED-FILL` makes `M_max = 1` and the unfavourable P3 bound fails. Break-even for P3 is
therefore **zero** such disagreements. The prototype reports this as `falsification_possible: true,
falsification_unavoidable: false` (T10.10, T10.11) rather than as FALSIFIED — which is the right
distinction, because FALSIFIED is "recorded and reported as evidence **against** the verified-only
claim" (§10.5) and must not be asserted on a resolution nobody made.

**P2.** `CA ≥ 9U`. A contested `{CORRECT-ABSTENTION, UNSUPPORTED-FILL}` pair costs the unfavourable
statistic 10 (−1 CA, +9U per contested item after the `×9`), so with `CA` correct abstentions the
budget is `⌊CA/10⌋` such items at `U = 0`. P2 also has an undefined branch: if the unfavourable
resolution can drive `CA + U` to 0 the bound is not met at all (AD-8 is recorded
`"value": "INCONCLUSIVE"`, so an undefined AR is a §15.5 condition, not a FAILURE).

## 6. Summary of break-even rates

| Design | Constraint | Break-even | At N = 60 / F = 30 |
|---|---|---|---|
| (a) exclude | §15.5(2) `E₀ + D ≤ ⌊N/10⌋` | `r* = (⌊N/10⌋ − E₀)/N` | **10.00 %** at E₀ = 0; 0 % at E₀ = 6 |
| (a) exclude | G1 worst-case allocation | `d_F ≤ F − 20 = 10` | 16.67 % of N — not binding at N ≤ 102 |
| (a) exclude | G1 proportional allocation | `r ≤ 1 − 20/F` | 33.33 % — never binding |
| (c) interval | §15.5(2) | only `REFERENCE-AMBIGUOUS`-involving disagreements count | ≈ unbounded in r |
| (c) interval | G1 | only fill-vs-`REFERENCE-AMBIGUOUS` disagreements count | ≈ unbounded in r |
| (c) interval | **P1 `B + d_p ≤ ⌊F/20⌋`** | **1 contested possible-bad fill at B = 0, 0 at B = 1** | **1.67 % of N** |
| (c) interval | **P3 `M_max = 0`** | **0 contested possible-misattribution** | **0 %** |
| both | §15.5(3) α ≥ 0.667 | independent of design; 2 coders, 7 labels | see §7 |
| both | §15.5(3) 90 % completely rated | disagreements **are** completely rated — no cost | — |

**The single number to quote: under exclusion, 8.70 %–10.00 % of observations, minus every other
exclusion. Under the sensitivity interval, the disagreement rate is almost irrelevant and the binding
quantity is the count of contested *fills that could be erroneous*, whose budget is one.**

## 7. What the α floor implies about the achievable r

α is not a free parameter: it is a function of the same disagreements. With two coders,
`α = 1 − (n−1)·2·d / (n² − Σ n_c²)` where `n = 2·units`. For 60 units and a disagreement rate r, α
falls below 0.667 well before r reaches 10 % *if the labels are concentrated*, and stays above it if
they are spread. Two anchors computed with the prototype:

- A worked 60-observation example — 54 agreed (24 `SUPPORTED-FILL`, 30 `CORRECT-ABSTENTION`) and 6
  disagreements `{SUPPORTED-FILL, INCORRECT-FILL}`, so r = 10 % — gives label counts
  `SUPPORTED-FILL = 54`, `CORRECT-ABSTENTION = 60`, `INCORRECT-FILL = 6` over `n = 120`, hence
  `den = 120² − (54² + 60² + 6²) = 14400 − 6552 = 7848`, `num = 119 × 2 × 6 = 1428`, and
  **α = 1 − 1428/7848 = 0.8180** — comfortably above the floor. Design (a) scores 24 fills and 54 of
  60 valid, exactly on the §15.5(2) line. (Test T9.1–T9.5.)
- `α` is **undefined** (and by AD-2 `INCONCLUSIVE`) whenever the raters between them used a single
  label, regardless of r — pinned at T11.8/T11.9.

So at the r values that matter (≤ 10 %) the α floor is not the binding constraint; §15.5(2) is, under
(a), and P1/P3 are, under (c). The α floor bites only in a run with few distinct labels, which is the
`AD-2` corner rather than a disagreement-rate corner.

## 8. Reproduction

```
node prototype/costArithmetic.mjs        # the tables in §3, §4, §5
node prototype/test_twoRaterRating.mjs   # 93 assertions, 8035 enumerated resolutions
node prototype/mutate.mjs                # 70 mutants, 70 killed
```

`costArithmetic.mjs` imports `lib/sizing.mjs` and `lib/frame.mjs` from `C:/tmp/dt002` **read-only**;
nothing under `C:/tmp/dt002` or `research/cpg-u1/**` is written.
