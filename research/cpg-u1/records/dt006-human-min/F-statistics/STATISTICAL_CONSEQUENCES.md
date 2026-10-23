# STATISTICAL CONSEQUENCES OF A TWO-HUMAN DESIGN

**Agent F of DEEPTECH-HUMAN-MIN-001.** Base SHA `af2fb6e99ce461894bf16f18c2251f75088eba18`.
Every number below was computed by a script in this directory and the script's real output is pasted
in. Where a number cannot be derived from the frozen code, this document says so instead of
estimating. No protocol byte was changed; no threshold was weakened; no required observation count
was reduced.

---

## 0. The verbatim s15.5(2) check the assignment asked for

Protocol-004 s15.5, condition 2, verbatim from the frozen file:

> 2. Fewer than 90% of held-out company x field observations VALID [NORMATIVE]

The assignment's paraphrase - "fewer than 90 % of held-out company x field observations VALID ->
INCONCLUSIVE" - **is correct in substance**, with three corrections of detail that matter
arithmetically:

1. The protocol writes "90%", not "90 %". Cosmetic.
2. The consequence is not written into condition 2 itself. s15.5 is headed "Run-level INCONCLUSIVE
   conditions" and s10.5 says INCONCLUSIVE holds on "Any s15.5 condition". The implementation
   collects every triggered condition and sets `outcome = 'INCONCLUSIVE'` if any is non-empty
   (`analysis.mjs:208-211`). So the paraphrase is right, by s10.5 rather than by s15.5(2).
3. **The boundary is inclusive-passing.** `analysis.mjs:198` is
   `triggered: 10 * valid.length < 9 * total`. Exactly 90% VALID gives `10*valid == 9*total`,
   which is not `<`, so **exactly 90% PASSES**. The minimum passing VALID count is
   `ceil(9*obs/10)`, and the exclusion budget is `obs - ceil(9*obs/10)`, which is
   **8.70%-10.00% of observations depending on configuration, not a flat 10%**.

Two further corrections to the framing supplied to me:

- **s15.1 has no disposition for a rater disagreement.** The list is
  `VALID | INVALID | REFERENCE-CONFLICT | REFERENCE-AMBIGUOUS | REFERENCE-STALE` plus the
  `CONTAMINATION-DISCLOSED` flag, and INCONCLUSIVE is run-level only. `CONFLICT-UNRESOLVED` and
  `DISAGREEMENT` **do not exist**. Both are modelled below as hypotheticals and flagged as such.
- **There are not 49 permitted configurations; there are 13.** `N_fill` is not a free integer in
  12..60. It is `min(60, max(12, ceil(180/T)))` over `T` in 1..18, whose attainable values are
  `{12,13,14,15,17,18,20,23,26,30,36,45,60}`. The observation range 60..300 and the company range
  20..100 supplied to me are both **confirmed exactly**.

---

## 1. The observation budget

```
== FROZEN CONSTANTS READ FROM THE INSTRUMENT ==
SIZING                 = {"MIN_FILLS":20,"SAFETY":1.5,"CAP_FILL_EXPECTED":60}
FIELDS                 = ["founded_year","employee_count","revenue_range"] -> fields per company = 3
OUTCOME_CLASSES        = ["fill-expected","abstention-expected","identity-hazard"]
DEVELOPMENT_QUOTA      = {"fill-expected":6,"abstention-expected":2,"identity-hazard":2}
HELD_OUT_BASE          = {"fill-expected":12,"abstention-expected":5,"identity-hazard":3}
POOL_MULTIPLIER        = 2
MAX_HELD_OUT_QUOTAS    = {"fill-expected":60,"abstention-expected":25,"identity-hazard":15}
FRAME_MINIMUM (5.7.2)  = {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}
pilot enumeration      = {"outcomes":4096,"halts":1,"refused":0}
self-check A: all 4096 outcomes enumerated; quota is a function of T alone (mismatches = 0)
self-check B: the set of ATTAINABLE N_fill values is NOT the whole range 12..60 -> {12,13,14,15,17,18,20,23,26,30,36,45,60} (13 values)

== 1. OBSERVATION BUDGET: every permitted held-out configuration ==
T        = total pilot fills over the 6 development fill-expected companies (5.6, 11).
obs      = held-out company x field observations = companies x 3 (evaluation.mjs: exactly every held-out company x field).
feObs    = fill-expected observations only = N_fill x 3.
refObs   = reference records reconcile() demands = (held-out + 10 development companies) x 3.
E[f]opt  = N_fill x y (held-out yield = pilot yield). E[f]safe = that / SAFETY(1.5).
G1%fe    = 20 / feObs = fill rate over fill-expected observations needed to clear G1.
minVALID = ceil(9*obs/10); maxExcl = obs - minVALID = the WHOLE 15.5(2) exclusion budget.
maxRegD  = floor(companies/10) = companies allowed to lose their decisive registry path (15.5(4)).

  T      y  raw cap?  N_fl  N_ab  N_hz  comp  obs  feObs  refObs  E[f]opt  E[f]safe  G1mgOpt  G1mgSafe   G1%fe  G1%all  minVAL  maxExcl  maxExcl%  maxRegD
  0      -    -    -  HALT  <- HALT: CPG produced zero fills across every development fill-expected c
  1  0.167  180  YES    60    25    15   100  300    180     330    10.00      6.67   -10.00    -13.33   11.1%    6.7%     270       30    10.00%       10
  2  0.333   90  YES    60    25    15   100  300    180     330    20.00     13.33     0.00     -6.67   11.1%    6.7%     270       30    10.00%       10
  3  0.500   60   no    60    25    15   100  300    180     330    30.00     20.00    10.00      0.00   11.1%    6.7%     270       30    10.00%       10
  4  0.667   45   no    45    19    12    76  228    135     258    30.00     20.00    10.00      0.00   14.8%    8.8%     206       22     9.65%        7
  5  0.833   36   no    36    15     9    60  180    108     210    30.00     20.00    10.00      0.00   18.5%   11.1%     162       18    10.00%        6
  6  1.000   30   no    30    13     8    51  153     90     183    30.00     20.00    10.00      0.00   22.2%   13.1%     138       15     9.80%        5
  7  1.167   26   no    26    11     7    44  132     78     162    30.33     20.22    10.33      0.22   25.6%   15.2%     119       13     9.85%        4
  8  1.333   23   no    23    10     6    39  117     69     147    30.67     20.44    10.67      0.44   29.0%   17.1%     106       11     9.40%        3
  9  1.500   20   no    20     9     5    34  102     60     132    30.00     20.00    10.00      0.00   33.3%   19.6%      92       10     9.80%        3
 10  1.667   18   no    18     8     5    31   93     54     123    30.00     20.00    10.00      0.00   37.0%   21.5%      84        9     9.68%        3
 11  1.833   17   no    17     8     5    30   90     51     120    31.17     20.78    11.17      0.78   39.2%   22.2%      81        9    10.00%        3
 12  2.000   15   no    15     7     4    26   78     45     108    30.00     20.00    10.00      0.00   44.4%   25.6%      71        7     8.97%        2
 13  2.167   14   no    14     6     4    24   72     42     102    30.33     20.22    10.33      0.22   47.6%   27.8%      65        7     9.72%        2
 14  2.333   13   no    13     6     4    23   69     39      99    30.33     20.22    10.33      0.22   51.3%   29.0%      63        6     8.70%        2
 15  2.500   12   no    12     5     3    20   60     36      90    30.00     20.00    10.00      0.00   55.6%   33.3%      54        6    10.00%        2
 16  2.667   12   no    12     5     3    20   60     36      90    32.00     21.33    12.00      1.33   55.6%   33.3%      54        6    10.00%        2
 17  2.833   11   no    12     5     3    20   60     36      90    34.00     22.67    14.00      2.67   55.6%   33.3%      54        6    10.00%        2
 18  3.000   10   no    12     5     3    20   60     36      90    36.00     24.00    16.00      4.00   55.6%   33.3%      54        6    10.00%        2

distinct permitted quota vectors: 13  (NOT 49 -- N_fill is min(60,max(12,ceil(180/T))), not a free integer in 12..60)
  60/25/15   at T = 1,2,3
  45/19/12   at T = 4
  36/15/9    at T = 5
  30/13/8    at T = 6
  26/11/7    at T = 7
  23/10/6    at T = 8
  20/9/5     at T = 9
  18/8/5     at T = 10
  17/8/5     at T = 11
  15/7/4     at T = 12
  14/6/4     at T = 13
  13/6/4     at T = 14
  12/5/3     at T = 15,16,17,18

observation count range: 60 .. 300
companies range:         20 .. 100
15.5(2) budget range:    6..30 observations = 8.70%..10.00%
boundary: exactly 90% VALID PASSES (analysis.mjs:198 uses 10*valid < 9*total, strict <).
G1 threshold (MIN_FILLS) = 20.
  configs whose OPTIMISTIC E[fills] is already below it: T = 1
  configs whose SAFETY-corrected E[fills] is below it:   T = 1,2
  configs with ZERO optimistic G1 margin:                T = 2

wrote budget.json (consumed by 02_breakeven_grid.mjs and 04_sensitivity_bound.mjs)
```

**What this establishes.**

- Fields per company is **3**, read from `schema.mjs` `FIELDS`; `evaluation.mjs` builds items as
  "exactly every held-out company x field", so observations = companies x 3 with no exceptions and
  no per-class variation.
- Held-out observations run **60 to 300**; the reference workload `reconcile()` demands is larger,
  **90 to 330**, because `reconcile` covers development **and** held-out (`cpg_u1_data.mjs:534`).
  This matters: the reference-side break-even is over 330 records at the cap, not 300.
- The s15.5(2) exclusion budget is **6 to 30 observations**, i.e. **8.70% to 10.00%**. It is a
  *single shared* budget: INVALID, REFERENCE-CONFLICT, REFERENCE-STALE, PENDING and
  REFERENCE-AMBIGUOUS all draw on it, and any new exclusion a two-human design invents draws on the
  same one. **No new exclusion gets a budget of its own.**
- The design's own expected fill count is **E[f]opt = N_fill x y = 30** at almost every
  configuration, by construction: `raw = ceil(MIN_FILLS x SAFETY / y)` back-solves for
  `N_fill x y ~ 30`. The G1 threshold is 20, so the **nominal G1 margin is 10 fills**.
- **That margin is already spent.** SAFETY = 1.5 exists precisely because held-out yield is expected
  to be *lower* than pilot yield (contamination bias, s5.6, s20.11). If held-out yield is
  `y / 1.5`, expected fills are exactly **20** - the threshold, with **zero** margin. Columns
  `E[f]safe` and `G1mgSafe` show this: the safety-corrected margin is **0.00** at
  T in {3,4,5,6,9,10,12,15} and **negative** at T in {1,2}.
- **Two permitted configurations fail G1 before any exclusion at all.** T = 1 gives
  E[f]opt = 10 < 20; T = 2 gives exactly 20, zero margin. Both are the `capped` configurations
  (raw > 60), which s5.6 already declares as carrying "elevated risk of an INCONCLUSIVE result".
  This analysis makes that risk numeric: at T = 1 the run is INCONCLUSIVE on arrival.
- The fill rate G1 demands over fill-expected observations alone ranges from **11.1%** at the cap to
  **55.6%** at the floor (column `G1%fe`). The framing supplied to me was right on both ends.

---

## 2. The exclusion cascade

```
== 2. THE EXCLUSION CASCADE ==
analysis.mjs:146-152 assigns exactly one disposition per observation, in this order.
Only rows with disposition VALID enter `valid` (:164), and every label count S/U/I/M/CA/MF
is taken from `valid` (:165-167). So every endpoint numerator AND denominator is built from
VALID rows alone. Anything that is not VALID is removed from ALL of G1, P1, P2, P3, R1 at once.

  INVALID              :146   IDENTITY_INADMISSIBLE_AFTER_DRAW (declarations.identity_inadmissible)
                              affects: G1,P1,P2,P3,R1 + alpha pop (AD-1=EXCLUDE_...)
                              status : lawful today (15.2)
  INVALID              :147   o.machine_state === INVALID (no response / harness error)
                              affects: G1,P1,P2,P3,R1 + alpha pop
                              status : lawful today (15.2)
  REFERENCE-CONFLICT   :148   ref.resolution === REFERENCE_CONFLICT (sealed; only an ADJUDICATOR can declare it)
                              affects: G1,P1,P2,P3,R1 + alpha pop
                              status : lawful today (9.5, 15.2)
  REFERENCE-STALE      :149   employee_count/revenue_range with as_of_date < cutoff (AD-5=CALENDAR_MONTHS, AD-6=STATED_ONLY)
                              affects: G1,P1,P2,P3,R1 + alpha pop
                              status : lawful today (10.2)
  PENDING              :150   f.final === null: either rater left the item `pending`
                              affects: G1,P1,P2,P3,R1 (NOT excluded from alpha pop by AD-1; but alphaPop drops pending labels at :179)
                              status : lawful today (12)
  REFERENCE-AMBIGUOUS  :151   final label REFERENCE-AMBIGUOUS (rater, or adjudicator decision)
                              affects: G1,P1,P2,P3,R1; RETAINED in the alpha population
                              status : lawful today (10.1)
  CONFLICT-UNRESOLVED  n/a    PROPOSED: author/confirmer disagree with no reference adjudicator
                              affects: would be G1,P1,P2,P3,R1
                              status : DOES NOT EXIST: reconcile() returns an error and cmdReconcile exits 1 / cmdSeal fails
  DISAGREEMENT         n/a    PROPOSED: the two raters differ with no rating adjudicator
                              affects: would be G1,P1,P2,P3,R1
                              status : DOES NOT EXIST in 15.1; finalRatings() THROWS RATING_ADJUDICATION_MISSING

SECOND-ORDER: exclusions also move two RATIO conditions whose denominator is `valid`:
  15.5(5) SOURCE-COINCIDENT: cond5 = 10*sc > 6*valid. Removing one VALID row lowers the
          tolerated sc by exactly 0.6 observations, so exclusions can TRIGGER 15.5(5)
          without any change in the SOURCE-COINCIDENT count itself.
  10.5 FALSIFIED: 10*bad > fills. Removing SUPPORTED fills raises the EFR ratio.
  15.5(4) registry-unavailable is over COMPANIES, not observations -> untouched by d and r.
  15.5(3) `completely rated` counts non-pending rater labels, so a DISAGREEMENT is still
          "completely rated": regime (i) exclusions do NOT relieve condition 3.

== 2b. THE ONLY MINIMUM COUNTS IN THE CODE ==
  G1 : fills >= 20                       -> the ONLY count floor in the protocol (analysis.mjs:171)
  P1 : fills > 0                         -> no count floor; undefined only at fills = 0
  P2 : CA + U > 0                        -> no count floor; undefined -> AD-8 = INCONCLUSIVE
  P3 : no denominator at all (M === 0)   -> no count floor
  R1 : S + MF + I > 0 for a value        -> no count floor and NO threshold (10.3)
So "the maximum loss before P1/P2/P3/R1 lose their minimum denominator" is the loss of the
ENTIRE denominator, never a protocol-set floor. Only G1 has a real floor, and it is 20.
Corollary at fills = 20 exactly: P1 passes iff 20*bad <= 20, i.e. bad <= 1 -- the design
tolerates exactly ONE erroneous fill at the G1 floor (this is the 1/theta_EFR derivation).
```

**The load-bearing point.** `analysis.mjs:164-167` takes every label count from `valid` alone.
There is no per-endpoint exclusion list. An observation that loses `VALID` is removed from
**G1, P1, P2, P3 and R1 simultaneously**, and it also shrinks the denominators of the two *ratio*
conditions s15.5(5) (SOURCE-COINCIDENT > 60% of scored) and the s10.5 FALSIFIED test
(`10*bad > fills`). The s15.5(5) interaction is worth stating on its own: **each excluded VALID
observation lowers the tolerated SOURCE-COINCIDENT count by exactly 0.6 observations**, so
exclusions can trigger s15.5(5) with no change whatever in the number of source-coincident
observations. s15.5(4) is over *companies*, so it is untouched by either disagreement rate.

**And the point that decides the whole question.** The two proposed dispositions do not exist, and
the frozen code does not fall through to them - it **refuses**:

- `lib/reconcile.mjs:58`: an author/confirmer disagreement with no adjudication row pushes
  `author and confirmer disagree (...) - independent adjudication required`.
  `cpg_u1_data.mjs:574` then does `process.exit(1)`, and `cmdSeal` does
  `fail('reference truth has N error(s) - a dataset is never sealed with errors')`.
  **One reference disagreement with no reference adjudicator means there is no seal.** Note also
  that `REFERENCE_CONFLICT` is not the fall-through: it is reachable *only* when an adjudicator
  actively decides `REFERENCE-CONFLICT` (`reconcile.mjs:65`). Removing the adjudicator removes
  the ability to *declare* a conflict, not just to resolve one.
- `lib/ratings.mjs:136`: `throw new Error('RATING_ADJUDICATION_MISSING: N disagreement(s) need the
  rating adjudicator's resolution')`. **One rater disagreement with no rating adjudicator means
  there is no analysis.**

---

## 3. Break-even rates

```
== 3. BREAK-EVEN RATES ==
(a) VALID share as a function of d and r
    The cascade is ORDERED, so the two losses compose multiplicatively, not additively:
      regime (i)  rater disagreements excluded : VALID/obs = (1-d)(1-r)
      regime (ii) rater disagreements resolved by rule : VALID/obs = (1-d)
    (both on top of the INVALID / STALE / AMBIGUOUS / PENDING losses the protocol already
     charges to the SAME 15.5(2) budget -- d and r do not get a budget of their own).

(b) maximum combined loss before 15.5(2) forces INCONCLUSIVE, and (c)/(d) the G1 / denominator limits
  T  obs  refObs  maxExcl  maxExcl%  brk(1-d)(1-r)  E[f]opt  maxFillLoss_opt  %ofFills  E[f]safe  maxFillLoss_safe  d*: 1st ref disagr  r*: 1st rater disagr
  1  300     330       30    10.00%       >=0.9000     10.0                0      0.0%       6.7                 0              0.303%                0.333%
  2  300     330       30    10.00%       >=0.9000     20.0                0      0.0%      13.3                 0              0.303%                0.333%
  3  300     330       30    10.00%       >=0.9000     30.0               10     33.3%      20.0                 0              0.303%                0.333%
  4  228     258       22     9.65%       >=0.9035     30.0               10     33.3%      20.0                 0              0.388%                0.439%
  5  180     210       18    10.00%       >=0.9000     30.0               10     33.3%      20.0                 0              0.476%                0.556%
  6  153     183       15     9.80%       >=0.9020     30.0               10     33.3%      20.0                 0              0.546%                0.654%
  7  132     162       13     9.85%       >=0.9015     30.3               10     33.3%      20.2                 0              0.617%                0.758%
  8  117     147       11     9.40%       >=0.9060     30.7               11     35.5%      20.4                 0              0.680%                0.855%
  9  102     132       10     9.80%       >=0.9020     30.0               10     33.3%      20.0                 0              0.758%                0.980%
 10   93     123        9     9.68%       >=0.9032     30.0               10     33.3%      20.0                 0              0.813%                1.075%
 11   90     120        9    10.00%       >=0.9000     31.2               11     35.5%      20.8                 1              0.833%                1.111%
 12   78     108        7     8.97%       >=0.9103     30.0               10     33.3%      20.0                 0              0.926%                1.282%
 13   72     102        7     9.72%       >=0.9028     30.3               10     33.3%      20.2                 0              0.980%                1.389%
 14   69      99        6     8.70%       >=0.9130     30.3               10     33.3%      20.2                 0              1.010%                1.449%
 15   60      90        6    10.00%       >=0.9000     30.0               10     33.3%      20.0                 0              1.111%                1.667%
 16   60      90        6    10.00%       >=0.9000     32.0               12     37.5%      21.3                 1              1.111%                1.667%
 17   60      90        6    10.00%       >=0.9000     34.0               14     41.2%      22.7                 3              1.111%                1.667%
 18   60      90        6    10.00%       >=0.9000     36.0               16     44.4%      24.0                 4              1.111%                1.667%
```

The four grids are in `BREAKEVEN_GRID.md`. Summary of what they show:

- In **regime (i)** (rater disagreements excluded via a hypothetical new disposition) the VALID share
  is `(1-d)(1-r)` - multiplicative, not additive, because the cascade at `analysis.mjs:146-152`
  is ordered and a reference-conflicted observation never reaches rating. With a shared budget of
  ~10%, `d = r = 5%` already lands at 90.25% and `d = r = 10%` at 81% - **INCONCLUSIVE**.
- In **regime (ii)** (rater disagreements resolved by a rule rather than excluded) only `d` spends
  the budget, and the design survives `r = 20%` at every configuration. **This difference is the
  headline: rater disagreement costs nothing to s15.5(2) if it is resolved by rule, and costs the
  whole budget if it is excluded.**
- s15.5(2) binds **before** G1 in every configuration except T = 1 and T = 2, because the budget is
  ~10% of observations while the nominal G1 margin is ~33% of fills. **G1 becomes the binding
  constraint exactly in the capped configurations** (T <= 2), where it is already violated at
  `d = r = 0`.

---

## 4. Sizing to absorb exclusions

```
== 4. SIZING TO ABSORB EXCLUSIONS ==
To preserve the same number of SCORED observations under an exclusion rate p, the held-out set
must grow by 1/(1-p). The question is whether the frozen rule can produce that growth.
The frozen rule (sizing.mjs:40-41) is N_fill = min(60, max(12, ceil(180/T))) -- a function of the
PILOT ALONE. It contains no exclusion term, so the answer is arithmetically NO: for a given pilot
there is exactly one permitted N_fill and no larger value is reachable without changing the rule
(which 19.1 closes at registration). The only latent headroom is the distance to CAP 60.

  T  N_fill  obs  CAP headroom 60/N_fill  p absorbable by CAP alone  N_fill needed at p=5%   p=10%   p=15%   p=20%  any of these reachable?
  1      60  300                  1.000x                       0.0%                     64      67      71      75 NO (rule is pilot-only) + >CAP
  2      60  300                  1.000x                       0.0%                     64      67      71      75 NO (rule is pilot-only) + >CAP
  3      60  300                  1.000x                       0.0%                     64      67      71      75 NO (rule is pilot-only) + >CAP
  4      45  228                  1.333x                      25.0%                     48      50      53      57  NO (rule is pilot-only)
  5      36  180                  1.667x                      40.0%                     38      40      43      45  NO (rule is pilot-only)
  6      30  153                  2.000x                      50.0%                     32      34      36      38  NO (rule is pilot-only)
  7      26  132                  2.308x                      56.7%                     28      29      31      33  NO (rule is pilot-only)
  8      23  117                  2.609x                      61.7%                     25      26      28      29  NO (rule is pilot-only)
  9      20  102                  3.000x                      66.7%                     22      23      24      25  NO (rule is pilot-only)
 10      18   93                  3.333x                      70.0%                     19      20      22      23  NO (rule is pilot-only)
 11      17   90                  3.529x                      71.7%                     18      19      20      22  NO (rule is pilot-only)
 12      15   78                  4.000x                      75.0%                     16      17      18      19  NO (rule is pilot-only)
 13      14   72                  4.286x                      76.7%                     15      16      17      18  NO (rule is pilot-only)
 14      13   69                  4.615x                      78.3%                     14      15      16      17  NO (rule is pilot-only)
 15      12   60                  5.000x                      80.0%                     13      14      15      15  NO (rule is pilot-only)
 16      12   60                  5.000x                      80.0%                     13      14      15      15  NO (rule is pilot-only)
 17      12   60                  5.000x                      80.0%                     13      14      15      15  NO (rule is pilot-only)
 18      12   60                  5.000x                      80.0%                     13      14      15      15  NO (rule is pilot-only)

Note the direction of the arithmetic: the configurations with the SMALLEST observation counts
(largest CAP headroom) are exactly those the rule reaches when the pilot yield is HIGH, i.e. when
N_fill is small. The configurations with NO headroom (N_fill = 60, T <= 3) are the ones already
flagged `capped` and already carrying the declared elevated INCONCLUSIVE risk (5.6).
No reduction of any required observation count is proposed anywhere in this analysis.
```

**Answer to the question as asked.** To preserve the same number of scored observations at exclusion
rate `p`, the held-out set must grow by `1/(1-p)`. **The frozen sizing rule cannot produce that
growth.** `sizing.mjs:40-41` is a function of the pilot alone; it contains no exclusion term, so
for a given pilot exactly one `N_fill` is permitted and no larger value is reachable without
editing a rule that s19.1 closes at registration ("sizing incl. CAP 60 - **closed**"). The CAP-60
headroom in the table is latent, not available: it describes what the CAP would allow *if* the rule
were changed, and it is **0% precisely at the three configurations (T <= 3) where the margin is
already gone**. I am not proposing to change the rule and I am not proposing to reduce any required
observation count.

---

## 5. Alpha under two raters

Full derivation in `ALPHA_ANALYSIS.md`. Headlines:

- **Alpha is computed on the raters' own labels and adjudication cannot change it.** Proven from the
  code, not asserted: the pairs are `(r.rater_1_label, r.rater_2_label)` (`analysis.mjs:181`),
  those fields come from `f.r1.label` / `f.r2.label` (`analysis.mjs:157`), and
  `ratings.mjs:153` fills `r1`/`r2` from the two sheets, never from `resolution`. The
  adjudicated label reaches only `f.final`. **So alpha is already a pure two-rater statistic and a
  two-human rating design degrades it not at all** - it is the one quantity the adjudicator was never
  protecting.
- The disagreement rate that drives alpha below 0.667 is **not a single number**: it depends entirely
  on the marginal label distribution, by 28.33% (uniform over all 7 labels) down to **0%** (one label
  dominant). At the realistic marginal for this study it is **2.00% to 18.33%**.
- **AD-2 = INCONCLUSIVE makes perfect agreement fatal.** Alpha is undefined when `den == 0`, i.e.
  when both raters used one label for every unit, and condition 3 then triggers. Demonstrated with
  the real function at n = 60, 102, 300.
- **At the label mix the class quotas actually imply, s15.5(2) binds first at every configuration.**
  The derived mix puts the majority label at 40.9%-60.0% of observations, which is the *tolerant*
  band; alpha then tolerates **10 to 54 disagreements (16.7%-21.8%)** against an s15.5(2) budget of
  **6 to 30 (8.70%-10.00%)**. Alpha binds first only under a two-label collapse that the
  stratification prevents. This corrects the simpler two-label reading in s5e of
  `ALPHA_ANALYSIS.md`, which is retained there as the unstratified comparison.
- **Two distinct raters are mechanically enforced, in two places.** `analysis.mjs:199` triggers
  condition 3 on `sheet1.rated_by === sheet2.rated_by`, and `ratings.mjs:97` refuses the sheets
  outright. **And `ratings.mjs:98` refuses a rating adjudicator who is either rater.** So "two
  humans" cannot mean "two raters, one of whom adjudicates": that exact configuration is what
  `ratings.mjs:98` exists to reject. A two-human rating stage is necessarily an *unadjudicated*
  one.

---

## 5A. The recommendation, checked rather than adopted

I was asked to check whether "resolve by rule" (regime ii) is strictly better than "exclude"
(regime i) on both counts. **It is, on the two counts named, and the margin is larger than the one
put to me.**

| | regime (i) exclude | regime (ii) resolve by rule |
|---|---|---|
| spends the s15.5(2) budget | yes, the whole shared 6-30 observations | **no** |
| needs a disposition s15.1 does not contain | yes | no |
| bounded by | s15.5(2) at 8.70%-10.00% | alpha alone, at **16.7%-21.8%** at the derived mix (not 11-16%) |
| survives `r = 20%` in the grid | no, at any configuration | **yes, at every configuration** |

Three qualifications that stop this being a clean recommendation:

1. **It does not touch the reference side.** `reconcile.mjs:58` still refuses, so regime (ii) buys
   nothing for the author/confirmer disagreement. A resolution rule there would also make
   `REFERENCE_CONFLICT` unreachable (`reconcile.mjs:65` is the only producer), silently deleting a
   validity safeguard that s10.3 and s15.2 both rely on.
2. **A rule is still a protocol and tooling change.** s12 assigns resolution to the rating
   adjudicator and s4A.3 makes the role mutually exclusive; the tooling aggregate is a registration
   field (s19.1). So regime (ii) is a re-registration, not a procedural tweak.
3. **The rule must survive s15.2 and s12.3.** s15.2: "No observation may be excluded because its
   result is unfavourable." s12.3: "Post-hoc favourable selection is prohibited." A pre-registered,
   outcome-independent rule is arguably compliant; a rule chosen after any held-out result is seen is
   not, and s15.2 adds "Exclusion rules may not change after any held-out result is seen."

**I am not in a position to recommend it, and I do not.** What I can say from the arithmetic is that
regime (ii) dominates regime (i) on both counts asked about, and that neither regime removes the
reference-side hard stop.

---

## 6. The price of the sensitivity bound

```
== 6. SENSITIVITY-BOUND DESIGN: THE PRICE OF REMOVING THE ADJUDICATOR ==

Design under test: each disagreement is NOT adjudicated. Instead both readings are carried, a
FAVOURABLE and an UNFAVOURABLE bound are reported, and the run is only accepted if the
UNFAVOURABLE bound passes. This preserves every threshold (nothing is weakened) and replaces the
adjudicator with arithmetic. The question is how much stricter it is.

STRUCTURAL FACT THAT SHAPES THE WHOLE ANSWER (lib/ratings.mjs:37-38):
    if (FILL_LABELS.includes(r.label) && item.cpg_value === null) errors.push(...)
    if (ABSTENTION_LABELS.includes(r.label) && item.cpg_value !== null) errors.push(...)
The fill / abstention branch of 10.1 is MECHANICAL, so a rater sheet is REFUSED if it puts a fill
label on an empty item or an abstention label on a filled one. Consequences:
  - a disagreement on a FILLED item is confined to {SUPPORTED, UNSUPPORTED, INCORRECT,
    MISATTRIBUTED, REFERENCE-AMBIGUOUS};
  - a disagreement on an EMPTY item is confined to {CORRECT-ABSTENTION, MISSED-FILL,
    REFERENCE-AMBIGUOUS};
  - therefore G1 (the fill COUNT) can only move via REFERENCE-AMBIGUOUS, never via a
    fill-label-vs-abstention-label disagreement.

--- 6a. Per endpoint: the largest disagreement count the UNFAVOURABLE bound tolerates ---
F = E[fills] (optimistic baseline, from 01). CA0 = obs - F = the most generous CORRECT-ABSTENTION
baseline (every abstention correct, MISSED-FILL = 0). b = point-estimate erroneous fills.

  T  obs   F  CA0  G1: Dmax_amb     %F  P1 Dmax (b=0)  P1 Dmax (b=1)  %F(b=0)  P2 Dmax_U    %CA0  P3 Dmax_M  R1 width per D
  1  300  10  290            -1   0.0%              0             -1     0.0%         32  11.03%          0        10.00%/D
  2  300  20  280             0   0.0%              1              0     5.0%         31  11.07%          0         5.00%/D
  3  300  30  270            10  33.3%              1              0     3.3%         30  11.11%          0         3.33%/D
  4  228  30  198            10  33.3%              1              0     3.3%         22  11.11%          0         3.33%/D
  5  180  30  150            10  33.3%              1              0     3.3%         16  10.67%          0         3.33%/D
  6  153  30  123            10  33.3%              1              0     3.3%         13  10.57%          0         3.33%/D
  7  132  30  102            10  33.3%              1              0     3.3%         11  10.78%          0         3.33%/D
  8  117  31   86            11  35.5%              1              0     3.2%          9  10.47%          0         3.23%/D
  9  102  30   72            10  33.3%              1              0     3.3%          8  11.11%          0         3.33%/D
 10   93  30   63            10  33.3%              1              0     3.3%          7  11.11%          0         3.33%/D
 11   90  31   59            11  35.5%              1              0     3.2%          6  10.17%          0         3.23%/D
 12   78  30   48            10  33.3%              1              0     3.3%          5  10.42%          0         3.33%/D
 13   72  30   42            10  33.3%              1              0     3.3%          4   9.52%          0         3.33%/D
 14   69  30   39            10  33.3%              1              0     3.3%          4  10.26%          0         3.33%/D
 15   60  30   30            10  33.3%              1              0     3.3%          3  10.00%          0         3.33%/D
 16   60  32   28            12  37.5%              1              0     3.1%          3  10.71%          0         3.13%/D
 17   60  34   26            14  41.2%              1              0     2.9%          2   7.69%          0         2.94%/D
 18   60  36   24            16  44.4%              1              0     2.8%          2   8.33%          0         2.78%/D

--- 6b. "Unfavourable bound FAILS while the point estimate PASSES": the exact crossover ---
The point estimate passes whenever the adjudicator would have chosen the favourable label. So the
crossover disagreement COUNT is exactly (Dmax + 1) above, and the crossover RATE is that count
divided by the population the disagreements are drawn from.

  T  obs   F  G1 crossover  r* over F  r* over obs  P1 crossover(b=0)  r* over F  r* over obs  P3 crossover  r* over obs
  1  300  10             0      0.00%       0.000%                  1     10.00%       0.333%             1       0.333%
  2  300  20             1      5.00%       0.333%                  2     10.00%       0.667%             1       0.333%
  3  300  30            11     36.67%       3.667%                  2      6.67%       0.667%             1       0.333%
  4  228  30            11     36.67%       4.825%                  2      6.67%       0.877%             1       0.439%
  5  180  30            11     36.67%       6.111%                  2      6.67%       1.111%             1       0.556%
  6  153  30            11     36.67%       7.190%                  2      6.67%       1.307%             1       0.654%
  7  132  30            11     36.67%       8.333%                  2      6.67%       1.515%             1       0.758%
  8  117  31            12     38.71%      10.256%                  2      6.45%       1.709%             1       0.855%
  9  102  30            11     36.67%      10.784%                  2      6.67%       1.961%             1       0.980%
 10   93  30            11     36.67%      11.828%                  2      6.67%       2.151%             1       1.075%
 11   90  31            12     38.71%      13.333%                  2      6.45%       2.222%             1       1.111%
 12   78  30            11     36.67%      14.103%                  2      6.67%       2.564%             1       1.282%
 13   72  30            11     36.67%      15.278%                  2      6.67%       2.778%             1       1.389%
 14   69  30            11     36.67%      15.942%                  2      6.67%       2.899%             1       1.449%
 15   60  30            11     36.67%      18.333%                  2      6.67%       3.333%             1       1.667%
 16   60  32            13     40.63%      21.667%                  2      6.25%       3.333%             1       1.667%
 17   60  34            15     44.12%      25.000%                  2      5.88%       3.333%             1       1.667%
 18   60  36            17     47.22%      28.333%                  2      5.56%       3.333%             1       1.667%

Reading of the P3 column: the crossover count is 1 at EVERY permitted configuration. One
observation on which one rater wrote MISATTRIBUTED-FILL and the other did not makes the
unfavourable bound M >= 1, which fails P3 (analysis.mjs:175) AND meets the FALSIFIED condition
M > 0 (analysis.mjs:212). Demonstration with the real tests:
  P3met(0) = true   P3met(1) = false   FALSIFIED(1, 0, 30) = true

Reading of the P1 column: floor(F/20) is the total erroneous-fill allowance. Computed for every
permitted configuration:
  T= 1  F=10  floor(F/20) = 0  -> unfavourable bound tolerates 0 fill-block disagreement(s) at b=0 and -1 at b=1
  T= 2  F=20  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 3  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 4  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 5  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 6  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 7  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 8  F=31  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T= 9  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=10  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=11  F=31  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=12  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=13  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=14  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=15  F=30  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=16  F=32  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=17  F=34  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1
  T=18  F=36  floor(F/20) = 1  -> unfavourable bound tolerates 1 fill-block disagreement(s) at b=0 and 0 at b=1

So across ALL 18 permitted pilot totals the unfavourable P1 bound tolerates AT MOST ONE
fill-block disagreement, and none at all once a single genuine erroneous fill exists.

--- 6c. Comparison: adjudicated design vs sensitivity-bound design ---
Quantity tolerated                       adjudicated        sensitivity bound     ratio
  fill-block disagreements (P1, b=0)       unlimited*          1                    n/a
  fill-block disagreements (P1, b=1)       unlimited*          0                    n/a
  MISATTRIBUTED disagreements (P3)         unlimited*          0                    n/a
  REFERENCE-AMBIGUOUS on fills (G1)        10 (= F-20)        10 (same)             1.00
  * "unlimited" means: bounded only by 15.5(2) and 15.5(3), not by the endpoint, because the
    adjudicator converts each disagreement into a single scored label.

The price is therefore not a percentage. For P1 and P3 the sensitivity bound converts an
endpoint that tolerated disagreement at the 15.5(2)/alpha rate into one that tolerates a COUNT of
1 or 0. That is the price of removing the adjudicator.
```

---

## 7. Which constraint binds first

```
== 7. WHICH CONSTRAINT BINDS FIRST, OVERALL ==
Ranked by the number of observations that breaks the design, smallest first.

  1 reference disagreement                   reconcile() returns an error; cmdReconcile exits 1; cmdSeal fails -> NO SEAL d >= 1/refObs = 0.303%..1.111% (refObs 90..330)
  1 rater disagreement                       finalRatings() throws RATING_ADJUDICATION_MISSING -> NO ANALYSIS         r >= 1/obs = 0.333%..1.667% (obs 60..300)
  1 MISATTRIBUTED disagreement               sensitivity bound: M >= 1 -> P3 fails AND FALSIFIED                      any r > 0
  1-2 fill-block disagreements               sensitivity bound: 20*(b+D) > F -> P1 unfavourable fails                 floor(F/20) = 1 for every permitted F
  6-30 excluded observations                 15.5(2) -> INCONCLUSIVE                                                  8.70%..10.00% of obs
  6-18 disagreements (realistic marginal)    15.5(3) alpha < 0.667 -> INCONCLUSIVE                                    2.00%..18.33% of obs
  0-16 lost fills                            15.5(1) G1 < 20 -> INCONCLUSIVE                                          0%..44% of E[fills]

TIGHTEST CONSTRAINT: ONE. Not a rate -- a count of one observation.
  Under the frozen instrument a two-human design is stopped by the FIRST reference disagreement
  (no seal) and by the FIRST rater disagreement (no analysis). Under the sensitivity-bound
  workaround it is stopped by the FIRST MISATTRIBUTED-FILL disagreement (P3 = 0 and FALSIFIED).
  Expressed as a rate, the binding number is d < 1/330 = 0.303% at the cap configuration and
  d < 1/90 = 1.111% at the floor configuration -- i.e. the design requires PERFECT agreement,
  not a low disagreement rate.
```

**Stated once, plainly.** The single tightest constraint on a two-human design is **one observation**
- a count, not a rate. The frozen instrument refuses at the first reference disagreement (no seal)
and at the first rater disagreement (no analysis); the sensitivity-bound workaround, which is the
only way to proceed without weakening a threshold, is broken by the first MISATTRIBUTED-FILL
disagreement, which makes `M >= 1` and so both fails P3 and satisfies the FALSIFIED condition. A
two-human design therefore does not need a *low* disagreement rate. It needs **perfect agreement
across 90 to 330 reference records and 60 to 300 rating items**, which is
`d < 1/330 = 0.303%` at the cap and `d < 1/90 = 1.111%` at the floor.

---

## 8. What could not be derived from the code

Stated explicitly rather than estimated.

1. **The actual fill count.** G1, P1 and R1 all key off the realised number of fills, which is CPG's
   behaviour, not a protocol constant. I used the design's **own** projection,
   `E[fills] = N_fill x y`, which is arithmetically forced by `raw = ceil(MIN_FILLS x SAFETY / y)`,
   and reported it at both the optimistic (`= y`) and safety-corrected (`= y/1.5`) held-out
   yields. Everything G1- and P1-related is conditional on that projection and is labelled as such.
2. **The CORRECT-ABSTENTION / MISSED-FILL split**, hence P2's actual denominator `CA + U`. The code
   fixes no expectation. I computed P2 at the most generous baseline `CA0 = obs - E[fills]` (every
   abstention correct) and reported the tolerance as `floor(CA0/9)`, a formula, not an estimate.
3. **The baseline erroneous-fill count `b`.** Reported parametrically at `b = 0` and `b = 1`.
4. **The SOURCE-COINCIDENT count.** Not derivable. I report only the exact *mechanical* interaction
   (0.6 observations of headroom lost per exclusion).
5. **Plausible values of `d` and `r` themselves.** Nothing in the protocol or the tooling
   estimates inter-rater or author/confirmer disagreement rates for this task. The grid is therefore
   over the rates the assignment specified, and no rate is claimed as likely.
6. **The apportionment of exclusions onto fills.** The grid assumes exclusions hit fills in
   proportion to the fill share of all observations. The code implies no distribution. This
   assumption is stated in the grid header and affects only the G1 column.
7. **Whether `n` for alpha equals `obs`.** With AD-1 = `EXCLUDE_INVALID_CONFLICT_AND_STALE` the
   alpha population is `obs` minus INVALID/CONFLICT/STALE, which is not derivable. I used
   `n = obs` as the upper bound and say so; a smaller `n` makes alpha *slightly* more tolerant in
   percentage terms (see the `Dmax/n` columns), so this choice is not favourable to my conclusion.
8. **The tooling aggregate hash was not recomputed.** I took `f7699f05...` from the assignment and
   verified the four named files individually by sha256.

---

## 9. Risks

1. **A "two-human design" is not one change but two**, and they have different legal status.
   Removing the *reference* adjudicator breaks `reconcile`/`seal` and also destroys the only path
   to the lawful `REFERENCE-CONFLICT` disposition. Removing the *rating* adjudicator breaks
   `finalRatings`. Either alone is a tooling change; the tooling aggregate is a registration field
   (s19.1), so either is a re-registration.
2. **Inventing a `DISAGREEMENT` disposition spends the s15.5(2) budget twice.** That budget already
   carries INVALID, STALE, AMBIGUOUS and PENDING. A design that also charges rater disagreement to it
   has, at 10% total, no room for the exclusions the protocol already anticipates.
3. **The sensitivity bound is not a softer option; it is much harder.** It converts P1 and P3 from
   "tolerant at the ~10% exclusion rate" to "tolerant at a count of 1 or 0".
4. **s15.5(5) is a silent amplifier.** Nothing in the design discussion I was given accounts for it:
   exclusions shrink `valid`, and the SOURCE-COINCIDENT ceiling shrinks with it at 0.6 per
   observation.
5. **The capped configurations are already failing.** At T = 1 the design is INCONCLUSIVE with zero
   human error. Any human-minimisation analysis that reports an average over configurations will hide
   this.
6. **s12's own escape hatch is the honest alternative and it is expensive.** "If independent raters
   are unavailable: execution may occur, but every primary endpoint is labelled **UNADJUDICATED**,
   the evidence rung cannot exceed Rung 2, and no claim of independent validation may be made."
   That is already in the frozen protocol. It costs the claim, not the arithmetic.
7. **s19.3 requires seven mutually exclusive independent persons.** Two is not a trim of that
   requirement; it is a different study.
8. **Alpha's viability depends on the class stratification, and this is a run-level hazard
   independent of the human-count question.** Computed in s6E of `06_alpha_marginals.out`: the
   three-way quota structure is what keeps the label marginal spread across SUPPORTED-FILL,
   MISSED-FILL and CORRECT-ABSTENTION. Collapse the same expected fill count onto a two-label
   distribution - which is what happens if the stratification does not hold, e.g. if abstention-expected
   companies turn out to hold authoritative values after all (s9.7 explicitly anticipates this and
   says the mismatch is published, not corrected) - and alpha's tolerance falls from 51 to **4**
   disagreements at T = 1, from 21 to 12 at T = 9, and from 12 to 9 at T = 15. **At T = 1..7 the
   unstratified tolerance drops below the s15.5(2) budget, so a class-prediction failure flips which
   constraint binds.** Nothing in the design controls this: s5.2 predictions are the enumerator's,
   and s9.7 confirms reference truth may contradict them.
9. **The alpha answer is construction-sensitive and this is not a rounding artefact.** Whether a
   disagreeing rater reaches for a label nobody else used changes `expected_den` and so changes
   `Dmax` by 1-2 at n = 60 (s6A). Any single quoted "alpha-tolerable disagreement rate" is
   conditional on an assumed disagreement *pattern*, not just an assumed marginal.

---

## 10. Open owner questions

1. Is the intended two-human design **2 people total** across all of s4A.3, or 2 *raters* with the
   reference roles unchanged? The arithmetic differs completely: the reference side breaks the *seal*
   at one disagreement, the rating side breaks the *analysis*.
2. If a `DISAGREEMENT` disposition is created, does it draw on the s15.5(2) 90% budget (regime i) or
   is it resolved by rule and stay VALID (regime ii)? This is the single largest lever in the whole
   analysis.
3. If resolved by rule, **what rule**, and does it survive s15.2's "No observation may be excluded
   because its result is unfavourable" and s12.3's prohibition on post-hoc favourable selection?
4. Is the owner willing to accept the s12 UNADJUDICATED / Rung-2 ceiling instead of changing any
   threshold or disposition?
5. Does AD-2 = INCONCLUSIVE stand, given that it makes perfect two-rater agreement on a single label
   an INCONCLUSIVE run?
6. At T <= 2 the design is INCONCLUSIVE or at zero margin before any human question arises. Should
   the sizing CAP question (H1) be reopened *separately* from the human-minimisation question?
7. s12's UNADJUDICATED / Rung-2 ceiling is written for the absence of **raters**. Does it also apply
   to the absence of an **adjudicator** with two raters present? The protocol does not say, and the
   answer decides whether a two-human rating stage can make any independent-validation claim at all.
8. Given owner question 7, is the s9.7 class-prediction mismatch risk (which drives the alpha
   stratification hazard, risk 8) something the owner wants reported as a pre-registered analysis
   sensitivity, rather than discovered after the run?

---

## Provenance

| Source | Identity | Read |
|---|---|---|
| Protocol-004 | `research/cpg-u1/CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | ss5.6, 5.7.2, 9.5, 9.6, 9.8, 10.1-10.5, 12, 12.1-12.3, 15.1-15.5, 16, 17, 18, 19.1-19.3, 20 |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (as stated in the assignment; not recomputed here) | `C:/tmp/dt002/research/cpg-u1/tooling` |
| `lib/sizing.mjs` | `b6d9b358cb1b709df7fd77d9b02514480253febc29198459aeec3bf70330eeea` | imported live |
| `lib/frame.mjs` | `1e2f5d58820d74d223a5aff73ae6778813de529bc987351f1844e0662a65cddd` | imported live |
| `lib/analysis.mjs` | `50b3db8aa2f41580e59f9e66ad414e7fc4eefe7bc0f75096682a3f05bf3b841c` | imported live (`alphaNominal`); `analyze` read line by line |
| `rules/analysis_decisions.json` | `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be` | AD-1..AD-9 all RECORDED (no `UNDECIDED`) |
| `lib/ratings.mjs`, `lib/reconcile.mjs`, `lib/packets.mjs`, `lib/schema.mjs`, `lib/evaluation.mjs`, `cpg_u1_data.mjs` | read for the cascade and the refusal paths | |

Nothing under `C:/tmp/dt002` or `research/cpg-u1/**` was written. The instrument was imported
read-only by `file:///C:/tmp/dt002/...` URL.

**Recorded decision values used throughout:** AD-1 `EXCLUDE_INVALID_CONFLICT_AND_STALE`,
AD-2 `INCONCLUSIVE`, AD-3 `URL_WITHOUT_FRAGMENT`, AD-4 `ENTRY_FOR_DECISIVE_IDENTIFIER`,
AD-5 `CALENDAR_MONTHS`, AD-6 `STATED_REFERENCE_VALUES_ONLY`, AD-7 `VOID`, AD-8 `INCONCLUSIVE`,
AD-9 `ANY_UNAVAILABLE_ENTRY`.


## Scripts (all preserved in this directory, all re-runnable)

| Script | Output | What it computes |
|---|---|---|
| `01_observation_budget.mjs` | `01_observation_budget.out`, `budget.json` | the permitted configurations and the observation budget, by importing `heldOutQuotas` and enumerating all 4096 pilot outcomes |
| `02_breakeven_grid.mjs` | `02_breakeven_grid.out`, `grid.json` | the exclusion cascade, the break-even rates, the four grids, the sizing headroom |
| `03_alpha.mjs` | `03_alpha.out`, `alpha.json` | alpha under two raters, using the imported `alphaNominal` and the transcribed `alphaBelow` |
| `04_sensitivity_bound.mjs` | `04_sensitivity_bound.out`, `sensitivity.json` | the price of the favourable/unfavourable bound, and the binding-constraint ranking |
| `06_alpha_marginals.mjs` | `06_alpha_marginals.out`, `marginals.json` | reproduction of the orchestrator's alpha grid; seven-label spreads; the label mix the class quotas imply |
| `05_assemble_docs.mjs` | the three `.md` deliverables | injects the `.out` files verbatim so no number is hand-transcribed |

