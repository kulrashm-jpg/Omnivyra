# Orchestrator finding — α's tolerance depends on label spread, not only on disagreement count

Computed by the orchestrator against the **frozen** implementation
(`C:/tmp/dt002/research/cpg-u1/tooling/lib/analysis.mjs`, `alphaNominal` + the `alphaBelow` integer comparison),
imported read-only. Scripts preserved beside this file (`orch_alpha.mjs`, `orch_alpha_grid.mjs`). Nothing was modified.

## The implementation

```
alphaNominal: n = 2·units;  den = n² − Σ n_c²;  num = (n − 1)·2·disagreements;  α = 1 − num/den
alphaBelow  : 1000·(den − num) < 667·den          // α < 0.667 exactly, in integers
```

## Result 1 — unanimity on a single label makes α UNDEFINED, and that is INCONCLUSIVE

With every observation rated the same label by both raters, Σn_c² = n², so `den = 0` and α is `null`
(`defined: false`). `analyze()` condition 3 reads
`(alphaUndefined ? D['AD-2'] === 'INCONCLUSIVE' : alphaBelow(alpha)) || sheet1.rated_by === sheet2.rated_by || …`,
and **AD-1..AD-9 are recorded with AD-2 = `INCONCLUSIVE`**. So a perfectly unanimous rating set forces INCONCLUSIVE.

Verified: `units=60, d=0 → defined=false, α=null, expected_den=0`.

## Result 2 — with a concentrated distribution, a SINGLE disagreement gives α = 0

`units=60`, all agreements on one label, exactly one disagreement:
`disagreements=1, num=238, den=238, α = 0`. Not 0.98 — **zero**. This is the standard skewed-marginal pathology of
Krippendorff's α: when one category holds almost all the mass, expected disagreement is tiny, so a single observed
disagreement consumes the whole budget.

## Result 3 — the real α ceiling, as a joint function of spread and disagreement

Maximum tolerable disagreement count for α ≥ 0.667, by the share of agreements falling on the majority label:

| majority share | obs=60 | obs=93 | obs=153 | obs=300 |
|---|---|---|---|---|
| 50% | 10 (16.7%) | 15 (16.1%) | 25 (16.3%) | 50 (16.7%) |
| 60% | 9 (15.0%) | 15 (16.1%) | 24 (15.7%) | 48 (16.0%) |
| 70% | 8 (13.3%) | 13 (14.0%) | 22 (14.4%) | 44 (14.7%) |
| 80% | 7 (11.7%) | 11 (11.8%) | 18 (11.8%) | 36 (12.0%) |
| 90% | 4 (6.7%) | 7 (7.5%) | 11 (7.2%) | 22 (7.3%) |
| 95% | 2 (3.3%) | 3 (3.2%) | 6 (3.9%) | 12 (4.0%) |
| 100% | **NONE** | **NONE** | **NONE** | **NONE** |

So α's tolerance is not a fixed ~16.7%; it collapses toward zero as the label distribution concentrates.

## Why the design's own stratification protects α

The held-out quotas are stratified by class, and the classes predict different labels: `fill-expected` companies are
expected to produce fills (SUPPORTED-FILL and its error labels), `abstention-expected` companies to produce
CORRECT-ABSTENTION. At the floor configuration that is 12 fill-expected (36 observations), 5 abstention-expected
(15) and 3 identity-hazard (9) — a natural majority share near 60%, which sits in the tolerant band (≈15%).

**This is a load-bearing and previously unstated dependency:** the class quotas are what keep α usable. It is not a
consequence of the two-human question, but it bears on it, because a two-human design has no spare α headroom.

## Consequence for the two-human design — the decisive comparison

| Handling of a rater disagreement | Budget it spends | Ceiling |
|---|---|---|
| **Excluded** (requires a new §15.1 disposition, which does not exist) | the §15.5(2) 90%-VALID budget, ≈10% **shared with INVALID / REFERENCE-CONFLICT / REFERENCE-AMBIGUOUS / REFERENCE-STALE** | 6 observations of 60 at the floor |
| **Resolved by a pre-registered deterministic rule** (observation stays VALID) | none | α only: ≈11–16% at realistic spread |

The resolution-rule route is therefore **strictly better on both counts** — it needs no new disposition and it spends
no part of the exclusion budget. This is the main engineering conclusion bearing on the rating adjudicator's removal.

## Also enforced in code, not merely documented

`analyze()` condition 3 includes `sheet1.rated_by === sheet2.rated_by`. One person rating both sheets is
machine-detected and forces INCONCLUSIVE. **Two raters is an enforced floor.** Any design proposing a single human
rater is refused by the frozen instrument, not merely discouraged by the text.

## §15.5(2) boundary, settled

`analyze()` computes condition 2 as `10 * valid.length < 9 * total`. Exactly 90% therefore **passes**. Maximum
excluded counts: 6 of 60, 6 of 69, 9 of 93, 15 of 153, 30 of 300.
