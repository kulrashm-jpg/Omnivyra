# ALPHA ANALYSIS - Krippendorff's alpha under exactly two raters

**Agent F of DEEPTECH-HUMAN-MIN-001.** Produced by `03_alpha.mjs`. `alphaNominal` is **imported**
from `lib/analysis.mjs`, not reimplemented. `alphaBelow` is not exported, so its expression is
transcribed byte-for-byte from `lib/analysis.mjs:94` and the transcription is asserted against the
algebraic identity it encodes over 160,400 `(num, den)` pairs before any result is computed.

## The three findings

1. **Alpha is a pure two-rater statistic already.** Adjudication cannot move it. Removing the rating
   adjudicator therefore degrades alpha by exactly nothing. Code evidence in s5a below.
2. **There is no single disagreement rate at which alpha fails.** It ranges from **28.33%** (labels
   uniform over all 7 categories) to **0%** (one label dominant), because Krippendorff's expected
   disagreement collapses when the marginals are extreme. At this study's realistic marginal it is
   **2.00% at T = 1 to 18.33% at T = 15-18**. Anyone quoting a single number for "the alpha-tolerable
   disagreement rate" is quoting an artefact of an assumed label distribution.
3. **The alpha threshold and the s15.5(2) VALID threshold are different constraints and neither
   dominates.** Alpha binds first at T = 1..5; s15.5(2) binds first at T = 6..18. Computed, not
   argued - the table is in s5e.

A fourth, structural: **AD-2 = `INCONCLUSIVE` makes perfect agreement fatal.** Alpha is undefined
when `expected_den == 0`, which happens exactly when both raters used one label for every unit.
Condition 3 then triggers and the run is INCONCLUSIVE. Two raters who agree perfectly on a
single-label dataset produce an INCONCLUSIVE study. This is a consequence of a RECORDED decision, not
a defect I am proposing to fix.

---

```
== 5. ALPHA UNDER TWO RATERS ==

5a. EVIDENCE THAT ALPHA IS COMPUTED ON THE RATERS OWN LABELS AND IS UNAFFECTED BY ADJUDICATION

  lib/analysis.mjs:179-181
    const alphaPop = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending'
      && (D['AD-1'] === 'ALL_COMPLETELY_RATED_ITEMS' || !['INVALID','REFERENCE-CONFLICT','REFERENCE-STALE'].includes(r.disposition)));
    const alpha = { population: D['AD-1'], ...alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label])), threshold: 0.667 };

  The pairs fed to alphaNominal are (r.rater_1_label, r.rater_2_label). Those fields are set at
  lib/analysis.mjs:157 from `f.r1.label` / `f.r2.label`, which lib/ratings.mjs:153 fills from the two
  RATER SHEETS (`s1.get(key)` / `s2.get(key)`), never from `resolution`. The adjudicated value lives in
  `f.final` and reaches only `r.label` / `r.sub_reason` / `r.adjudicated` (analysis.mjs:156).
  => adjudication CANNOT change alpha. Removing the adjudicator therefore removes nothing that
     alpha was ever measuring: alpha is already a pure two-rater statistic.
  Corollary: alpha is also the ONE endpoint-adjacent quantity a two-human design does not degrade.

  AD-1 = EXCLUDE_INVALID_CONFLICT_AND_STALE  -> the alpha population excludes INVALID / REFERENCE-CONFLICT / REFERENCE-STALE but RETAINS
  REFERENCE-AMBIGUOUS and any hypothetical DISAGREEMENT disposition.

  transcription self-check: alphaBelow  <=>  NOT(1000*num <= 333*den) over 160400 (num,den) pairs: OK

5b. LARGEST TOLERABLE DISAGREEMENT COUNT AT EACH PERMITTED n
n  = size of the alpha population = units = completely-rated, non-excluded observations.
    The upper bound on n for a configuration is its full observation count `obs`.
Dmax = largest D with alpha defined AND NOT alphaBelow (exact integer test).
Each D is realised by a concrete pairs array and scored with the imported alphaNominal.

  --- marginal shape: uniform7   (all 7 labels equally used - MOST tolerant) ---
     n   Dmax   Dmax/n   alpha at Dmax   alpha at Dmax+1   note
    300     85   28.33%         0.66999           0.66611   
    300     85   28.33%         0.66999           0.66611   
    300     85   28.33%         0.66999           0.66611   
    228     65   28.51%         0.66811           0.66300   
    180     51   28.33%         0.67034           0.66388   
    153     43   28.10%         0.67316           0.66556   
    132     37   28.03%         0.67419           0.66538   
    117     33   28.21%         0.67232           0.66239   
    102     29   28.43%         0.66984           0.65846   
     93     26   27.96%         0.67555           0.66307   
     90     25   27.78%         0.67766           0.66477   
     78     22   28.21%         0.67303           0.65816   
     72     20   27.78%         0.67811           0.66198   
     69     19   27.54%         0.68097           0.66426   
     60     17   28.33%         0.67196           0.65278   
     60     17   28.33%         0.67196           0.65278   
     60     17   28.33%         0.67196           0.65278   
     60     17   28.33%         0.67196           0.65278   

  --- marginal shape: balanced2  (two labels 50/50) ---
     n   Dmax   Dmax/n   alpha at Dmax   alpha at Dmax+1   note
    300     54   18.00%         0.66781           0.66156   
    300     54   18.00%         0.66781           0.66156   
    300     54   18.00%         0.66781           0.66156   
    228     41   17.98%         0.66761           0.66076   
    180     32   17.78%         0.67200           0.66158   
    153     27   17.65%         0.67359           0.66336   
    132     23   17.42%         0.67727           0.66539   
    117     21   17.95%         0.66847           0.65516   
    102     18   17.65%         0.67494           0.65658   
     93     16   17.20%         0.68295           0.66288   
     90     16   17.78%         0.67291           0.65211   
     78     14   17.95%         0.67026           0.64628   
     72     12   16.67%         0.69247           0.66643   
     69     12   17.39%         0.68040           0.65343   
     60     10   16.67%         0.69290           0.66167   
     60     10   16.67%         0.69290           0.66167   
     60     10   16.67%         0.69290           0.66167   
     60     10   16.67%         0.69290           0.66167   

  --- marginal shape: unanimous  (one label only - alpha UNDEFINED at D=0) ---
     n   Dmax   Dmax/n   alpha at Dmax   alpha at Dmax+1   note
    300     -1        -       undefined         undefined   NO D PASSES
    300     -1        -       undefined         undefined   NO D PASSES
    300     -1        -       undefined         undefined   NO D PASSES
    228     -1        -       undefined         undefined   NO D PASSES
    180     -1        -       undefined         undefined   NO D PASSES
    153     -1        -       undefined         undefined   NO D PASSES
    132     -1        -       undefined         undefined   NO D PASSES
    117     -1        -       undefined         undefined   NO D PASSES
    102     -1        -       undefined         undefined   NO D PASSES
     93     -1        -       undefined         undefined   NO D PASSES
     90     -1        -       undefined         undefined   NO D PASSES
     78     -1        -       undefined         undefined   NO D PASSES
     72     -1        -       undefined         undefined   NO D PASSES
     69     -1        -       undefined         undefined   NO D PASSES
     60     -1        -       undefined         undefined   NO D PASSES
     60     -1        -       undefined         undefined   NO D PASSES
     60     -1        -       undefined         undefined   NO D PASSES
     60     -1        -       undefined         undefined   NO D PASSES

5c. THE REALISTIC MARGINAL FOR THIS STUDY
A design that expects E[fills] fills out of `obs` observations, and that would only be run at all if
P1 <= 0.05 and P2 >= 0.90 were plausible, produces a label distribution dominated by SUPPORTED-FILL
and CORRECT-ABSTENTION. The fill / abstention split is NOT a free parameter: it is E[fills] : obs-E[fills],
and it is enforced mechanically, because lib/ratings.mjs:37-38 refuses a FILL label on an item with no
CPG value and an ABSTENTION label on an item with one. The two raters therefore CANNOT disagree across
the fill / abstention boundary at all; every disagreement is within one of the two blocks.

     T   obs  E[f]opt  shape SUPPORTED:CORRECT-ABSTENTION   Dmax   Dmax/n   alpha at Dmax   alpha at Dmax+1
     1   300       10                          10:290      6    2.00%         0.69240           0.64135
     2   300       20                          20:280     12    4.00%         0.68385           0.65773
     3   300       30                          30:270     18    6.00%         0.67481           0.65698
     4   228       30                          30:198     17    7.46%         0.68417           0.66593
     5   180       30                          30:150     17    9.44%         0.67418           0.65547
     6   153       30                          30:123     16   10.46%         0.68443           0.66529
     7   132       30                          30:102     16   12.12%         0.67491           0.65531
     8   117       31                           31:86     16   13.68%         0.67298           0.65343
     9   102       30                           30:72     15   14.71%         0.67311           0.65240
    10    93       30                           30:63     14   15.05%         0.68430           0.66302
    11    90       31                           31:59     14   15.56%         0.68628           0.66525
    12    78       30                           30:48     13   16.67%         0.68372           0.66115
    13    72       30                           30:42     13   18.06%         0.67103           0.64778
    14    69       30                           30:39     12   17.39%         0.68721           0.66339
    15    60       30                           30:30     11   18.33%         0.68374           0.65805
    16    60       32                           32:28     11   18.33%         0.68587           0.66065
    17    60       34                           34:26     11   18.33%         0.68556           0.66065
    18    60       36                           36:24     11   18.33%         0.68282           0.65805

5d. THE PREVALENCE TRAP (worst realistic case), computed not asserted
When one label dominates, alpha collapses. Concrete instances at n = 102 (T = 9):
  majority 102/102 (100.0%)  Dmax =  -1  ( 0.00%)   alpha at D=1 = 0.00000
  majority 101/102 ( 99.0%)  Dmax =   0  ( 0.00%)   alpha at D=1 = 0.66446
  majority 100/102 ( 98.0%)  Dmax =   1  ( 0.98%)   alpha at D=1 = 0.79680
  majority  95/102 ( 93.1%)  Dmax =   6  ( 5.88%)   alpha at D=1 = 0.92875
  majority  90/102 ( 88.2%)  Dmax =   9  ( 8.82%)   alpha at D=1 = 0.95488
  majority  80/102 ( 78.4%)  Dmax =  15  (14.71%)   alpha at D=1 = 0.97180
  majority  70/102 ( 68.6%)  Dmax =  18  (17.65%)   alpha at D=1 = 0.97769
  majority  60/102 ( 58.8%)  Dmax =  19  (18.63%)   alpha at D=1 = 0.98010
  majority  51/102 ( 50.0%)  Dmax =  19  (18.63%)   alpha at D=1 = 0.98068

5e. WHICH BINDS FIRST: the alpha threshold or the 15.5(2) VALID threshold
They are different constraints on different populations:
  15.5(2)  counts EXCLUDED observations  : budget = obs - ceil(0.9*obs) = 8.70%..10.00% of obs.
  15.5(3)  counts DISAGREEING observations among the ones that ARE rated: a disagreement is
           still VALID once adjudicated, so it spends none of the 15.5(2) budget in regime (ii).
  15.5(3)  also carries `< 90% completely rated`, which counts `pending`, not disagreement.

     T   obs  15.5(2) budget   as %   alpha Dmax (realistic)    as %   alpha Dmax (uniform7)    as %   binds first
     1   300              30  10.00%                       6    2.00%                      85   28.33%   ALPHA (15.5(3))
     2   300              30  10.00%                      12    4.00%                      85   28.33%   ALPHA (15.5(3))
     3   300              30  10.00%                      18    6.00%                      85   28.33%   ALPHA (15.5(3))
     4   228              22   9.65%                      17    7.46%                      65   28.51%   ALPHA (15.5(3))
     5   180              18  10.00%                      17    9.44%                      51   28.33%   ALPHA (15.5(3))
     6   153              15   9.80%                      16   10.46%                      43   28.10%   15.5(2) VALID
     7   132              13   9.85%                      16   12.12%                      37   28.03%   15.5(2) VALID
     8   117              11   9.40%                      16   13.68%                      33   28.21%   15.5(2) VALID
     9   102              10   9.80%                      15   14.71%                      29   28.43%   15.5(2) VALID
    10    93               9   9.68%                      14   15.05%                      26   27.96%   15.5(2) VALID
    11    90               9  10.00%                      14   15.56%                      25   27.78%   15.5(2) VALID
    12    78               7   8.97%                      13   16.67%                      22   28.21%   15.5(2) VALID
    13    72               7   9.72%                      13   18.06%                      20   27.78%   15.5(2) VALID
    14    69               6   8.70%                      12   17.39%                      19   27.54%   15.5(2) VALID
    15    60               6  10.00%                      11   18.33%                      17   28.33%   15.5(2) VALID
    16    60               6  10.00%                      11   18.33%                      17   28.33%   15.5(2) VALID
    17    60               6  10.00%                      11   18.33%                      17   28.33%   15.5(2) VALID
    18    60               6  10.00%                      11   18.33%                      17   28.33%   15.5(2) VALID

AD-2 = INCONCLUSIVE: an UNDEFINED alpha triggers condition 3. alpha is undefined exactly when den = 0, i.e. when both
raters used ONE label for every unit (analysis.mjs:89-91, `defined: den > 0`). So PERFECT agreement on a
single label is itself INCONCLUSIVE. Demonstrated:
  n =  60  D = 0  unanimous: den = 0, num = 0, defined = false, value = null -> condition 3 TRIGGERS
  n = 102  D = 0  unanimous: den = 0, num = 0, defined = false, value = null -> condition 3 TRIGGERS
  n = 300  D = 0  unanimous: den = 0, num = 0, defined = false, value = null -> condition 3 TRIGGERS
```

---

# Part 2 - marginal distributions, reproduction and the class-quota mix

Produced by `06_alpha_marginals.mjs`. Part 1 above uses a simple two-label "realistic" shape;
Part 2 replaces it with the mix the **class quotas** imply and is the one to rely on.

## 2A. Reproduction of the orchestrator's grid, and why two correct calculations differ

```
== 6A. REPRODUCTION OF THE ORCHESTRATOR GRID (two labels, majority share) ==
Construction: `share` of the UNITS agree on label L1, the rest agree on L2; then D units are
turned into disagreements. Scored with the imported alphaNominal and the exact integer test.

  Reported to me for obs=60: 50%->10, 60%->9, 70%->8, 80%->7, 90%->4, 95%->2, 100%->NONE

  --- construction: CLOSED (disagreeing rater picks the OTHER label already in use) -- conservative ---
share             n=60            n=93           n=153           n=300
  50%        9 (15.0%)      15 (16.1%)      24 (15.7%)      48 (16.0%)
  60%       10 (16.7%)      15 (16.1%)      25 (16.3%)      49 (16.3%)
  70%        9 (15.0%)      14 (15.1%)      24 (15.7%)      47 (15.7%)
  80%        7 (11.7%)      12 (12.9%)      20 (13.1%)      38 (12.7%)
  90%         4 (6.7%)        7 (7.5%)       12 (7.8%)       24 (8.0%)
  95%         2 (3.3%)        4 (4.3%)        7 (4.6%)       13 (4.3%)
 100%             NONE            NONE            NONE            NONE

  --- construction: OPEN (disagreeing rater picks a fresh label on the s12 scale) -- optimistic ---
share             n=60            n=93           n=153           n=300
  50%       11 (18.3%)      18 (19.4%)      29 (19.0%)      57 (19.0%)
  60%       11 (18.3%)      17 (18.3%)      29 (19.0%)      57 (19.0%)
  70%       10 (16.7%)      16 (17.2%)      27 (17.6%)      52 (17.3%)
  80%        8 (13.3%)      13 (14.0%)      21 (13.7%)      42 (14.0%)
  90%         5 (8.3%)        7 (7.5%)       12 (7.8%)       25 (8.3%)
  95%         2 (3.3%)        4 (4.3%)        7 (4.6%)       13 (4.3%)
 100%             NONE            NONE            NONE            NONE

VERDICT vs the reported n=60 column, closed construction: differs at 50% (mine 9, reported 10); 60% (mine 10, reported 9); 70% (mine 9, reported 8)
VERDICT vs the reported n=60 column, open construction: differs at 50% (mine 11, reported 10); 60% (mine 11, reported 9); 70% (mine 10, reported 8); 80% (mine 8, reported 7); 90% (mine 5, reported 4)

=> The reported grid is the CLOSED construction. It is correct, and it is the conservative one.
   The +1/+2 difference in the OPEN construction is not an error in either calculation: it is a
   real property of nominal alpha. Whether a disagreeing rater reaches for a label nobody else
   used changes the EXPECTED disagreement and so changes the threshold. Design against CLOSED.

== 6B. THE UNANIMITY / SINGLE-DISAGREEMENT INSTANCE, CHECKED EXACTLY ==
  units= 60  D=0: den=    0 num=   0 defined=false value=null  -> AD-2=INCONCLUSIVE triggers condition 3
  units= 60  D=1: den=  238 num= 238 defined=true value=0
  units= 93  D=0: den=    0 num=   0 defined=false value=null  -> AD-2=INCONCLUSIVE triggers condition 3
  units= 93  D=1: den=  370 num= 370 defined=true value=0
  units=153  D=0: den=    0 num=   0 defined=false value=null  -> AD-2=INCONCLUSIVE triggers condition 3
  units=153  D=1: den=  610 num= 610 defined=true value=0
  units=300  D=0: den=    0 num=   0 defined=false value=null  -> AD-2=INCONCLUSIVE triggers condition 3
  units=300  D=1: den= 1198 num=1198 defined=true value=0
  (the reported "units=60, one disagreement: num=238, den=238, alpha=0" is CONFIRMED above.)
```

**Reading.** The reported grid is the **closed** construction and is reproduced exactly at the 80%,
90%, 95% and 100% rows. At 50%, 60% and 70% my closed values differ by exactly 1 (9 vs 10, 10 vs 9,
9 vs 8). That residual is which *units* are converted to disagreements - I convert from the majority
label first - and it moves `Dmax` by one at n = 60. **Neither calculation is wrong and the
conclusion is unaffected**: both put the 50%-70% band at 15%-19% and both find NONE at 100%. The
100% row (unanimity forcing INCONCLUSIVE through AD-2) and the `num = den = 238, alpha = 0`
instance are confirmed independently at n = 60, 93, 153 and 300.

**The methodological point worth carrying forward:** the closed/open gap of 1-2 observations means
that a quoted alpha-tolerable rate is conditional on an assumed disagreement *pattern*, not only on
an assumed marginal. Design against the closed construction.

## 2B. Seven-label spreads over the s12 scale

```
== 6C. SEVEN-LABEL DISTRIBUTIONS (s12 scale) ==
The s12 scale has 7 categories: SUPPORTED-FILL, UNSUPPORTED-FILL, INCORRECT-FILL, MISATTRIBUTED-FILL, CORRECT-ABSTENTION, MISSED-FILL, REFERENCE-AMBIGUOUS
Dmax for a few spreads over the full scale, at each distinct observation count:
Cells are Dmax under the CLOSED construction (conservative) / OPEN construction (optimistic).
spread                          n=60        n=69        n=72        n=78        n=90        n=93       n=102       n=117       n=132       n=153       n=180       n=228       n=300
flat over all 7                17/17       19/19       20/20       22/22       25/25       26/26       29/29       33/33       37/37       43/43       51/51       64/64       85/85
flat over 4                    14/14       16/16       17/17       18/18       21/21       22/22       24/24       28/28       31/31       36/36       43/43       54/54       72/72
flat over 3                    12/12       14/14       15/15       16/16       19/19       20/20       21/21       25/25       28/28       32/32       38/38       48/48       64/64
dominant 60% + 6 tails         12/12       15/15       15/15       18/18       20/20       20/20       23/23       26/26       30/30       35/35       41/41       53/53       70/70
dominant 80% + 6 tails           7/7         8/8         8/8         9/9       11/11       11/11       15/15       15/15       18/18       21/21       26/26       33/33       45/45
dominant 95% + 6 tails           X/X         X/X         X/X         X/X         X/X         X/X         4/4         4/4         4/4         4/4         4/4         9/9       13/13
(X = no disagreement count passes at all.)
```

The closed and open constructions coincide here, because these mixes already use the labels the
disagreements move into. The band runs from **28.3%** (flat over all seven s12 categories) down to
**no passing disagreement count at all** at a 95% dominant label on the smaller configurations
(n = 60..93). The prevalence trap is not hypothetical: it is reached at a dominant share between 80%
and 95%.

## 2C. The label mix the class quotas imply - and where the run will actually sit

```
== 6D. THE LABEL MIX THE CLASS QUOTAS IMPLY ==
DERIVED, from the class quotas and the s10.1 decision procedure:
  fill-expected companies  -> reference HOLDS an authoritative value (s5.2 prediction).
     CPG fills   -> SUPPORTED-FILL (the run would not be attempted if P1<=0.05 were implausible)
     CPG abstains-> MISSED-FILL       (s10.1: no value + reference has one)
     so of 3*N_fill observations, E[fills] are SUPPORTED-FILL and the REST are MISSED-FILL.
  abstention-expected      -> reference holds NO authoritative value.
     CPG abstains-> CORRECT-ABSTENTION ; CPG fills -> UNSUPPORTED-FILL.
     P2>=0.90 means CORRECT-ABSTENTION dominates, so 3*N_abst -> CORRECT-ABSTENTION.
  identity-hazard          -> NOT DERIVABLE. s5.2 predicts an identity hazard, not a label.
     Reported below under both extremes: hazard obs -> CORRECT-ABSTENTION, and -> MISSED-FILL.

NOTE the consequence that is easy to miss: E[fills] is ~30 at every configuration, but
3*N_fill ranges 36..180. So at the CAP the dominant label is MISSED-FILL, not SUPPORTED-FILL,
and the quota structure spreads the marginal FOR you. This is a derived result, not a hope.

Dmax columns are the CONSERVATIVE (closed) construction. "binds first" compares it to the
15.5(2) budget, i.e. asks which of alpha or the VALID floor is reached by fewer observations.
  T  obs  feObs  E[f]  SUPP  MISS  CORR-ABST  hazObs  maj share  Dmax hz->CA       %  Dmax hz->MF       %  15.5(2)       %  binds first
  1  300    180    10    10   170        120      45      56.7%           51   17.0%           44   14.7%       30  10.00%      15.5(2)
  2  300    180    20    20   160        120      45      53.3%           53   17.7%           45   15.0%       30  10.00%      15.5(2)
  3  300    180    30    30   150        120      45      50.0%           54   18.0%           46   15.3%       30  10.00%      15.5(2)
  4  228    135    30    30   105         93      36      46.1%           42   18.4%           36   15.8%       22   9.65%      15.5(2)
  5  180    108    30    30    78         72      27      43.3%           34   18.9%           29   16.1%       18  10.00%      15.5(2)
  6  153     90    30    30    60         63      24      41.2%           29   19.0%           26   17.0%       15   9.80%      15.5(2)
  7  132     78    30    30    48         54      21      40.9%           26   19.7%           23   17.4%       13   9.85%      15.5(2)
  8  117     69    31    31    38         48      18      41.0%           24   20.5%           22   18.8%       11   9.40%      15.5(2)
  9  102     60    30    30    30         42      15      41.2%           21   20.6%           20   19.6%       10   9.80%      15.5(2)
 10   93     54    30    30    24         39      15      41.9%           20   21.5%           19   20.4%        9   9.68%      15.5(2)
 11   90     51    31    31    20         39      15      43.3%           19   21.1%           18   20.0%        9  10.00%      15.5(2)
 12   78     45    30    30    15         33      12      42.3%           17   21.8%           16   20.5%        7   8.97%      15.5(2)
 13   72     42    30    30    12         30      12      41.7%           15   20.8%           15   20.8%        7   9.72%      15.5(2)
 14   69     39    30    30     9         30      12      43.5%           14   20.3%           15   21.7%        6   8.70%      15.5(2)
 15   60     36    30    30     6         24       9      50.0%           12   20.0%           13   21.7%        6  10.00%      15.5(2)
 16   60     36    32    32     4         24       9      53.3%           12   20.0%           13   21.7%        6  10.00%      15.5(2)
 17   60     36    34    34     2         24       9      56.7%           12   20.0%           12   20.0%        6  10.00%      15.5(2)
 18   60     36    36    36     0         24       9      60.0%           10   16.7%           12   20.0%        6  10.00%      15.5(2)

WHERE THE ACTUAL RUN IS LIKELY TO SIT: at the derived mix, the majority share is
  40.9% .. 60.0% (hazard -> CORRECT-ABSTENTION)
which sits in the TOLERANT band of the 6A grid, NOT near the prevalence trap. Alpha Dmax at the
derived mix is 10..54 observations = 16.7%..21.8% of observations (closed construction).
15.5(2) budget is 6..30 observations = 8.70%..10.00%.
=> AT THE DERIVED MIX, 15.5(2) BINDS FIRST AT EVERY PERMITTED CONFIGURATION.

== 6E. THE DEPENDENCY THIS EXPOSES ==
The class quotas (s5.2 / s5.6) are what keep the label marginal spread across three labels.
Verified by removing the stratification: if ALL held-out companies behaved like
fill-expected companies with the same E[fills], the mix would be F : obs-F on two labels:
  T= 1 obs=300  stratified Dmax =  51 (17.0%)   unstratified 2-label Dmax =   4 ( 1.3%)   delta =  47   15.5(2) budget = 30
  T= 2 obs=300  stratified Dmax =  53 (17.7%)   unstratified 2-label Dmax =   9 ( 3.0%)   delta =  44   15.5(2) budget = 30
  T= 3 obs=300  stratified Dmax =  54 (18.0%)   unstratified 2-label Dmax =  14 ( 4.7%)   delta =  40   15.5(2) budget = 30
  T= 4 obs=228  stratified Dmax =  42 (18.4%)   unstratified 2-label Dmax =  13 ( 5.7%)   delta =  29   15.5(2) budget = 22
  T= 5 obs=180  stratified Dmax =  34 (18.9%)   unstratified 2-label Dmax =  13 ( 7.2%)   delta =  21   15.5(2) budget = 18
  T= 6 obs=153  stratified Dmax =  29 (19.0%)   unstratified 2-label Dmax =  13 ( 8.5%)   delta =  16   15.5(2) budget = 15
  T= 7 obs=132  stratified Dmax =  26 (19.7%)   unstratified 2-label Dmax =  12 ( 9.1%)   delta =  14   15.5(2) budget = 13
  T= 8 obs=117  stratified Dmax =  24 (20.5%)   unstratified 2-label Dmax =  12 (10.3%)   delta =  12   15.5(2) budget = 11
  T= 9 obs=102  stratified Dmax =  21 (20.6%)   unstratified 2-label Dmax =  12 (11.8%)   delta =   9   15.5(2) budget = 10
  T=10 obs= 93  stratified Dmax =  20 (21.5%)   unstratified 2-label Dmax =  11 (11.8%)   delta =   9   15.5(2) budget =  9
  T=11 obs= 90  stratified Dmax =  19 (21.1%)   unstratified 2-label Dmax =  12 (13.3%)   delta =   7   15.5(2) budget =  9
  T=12 obs= 78  stratified Dmax =  17 (21.8%)   unstratified 2-label Dmax =  11 (14.1%)   delta =   6   15.5(2) budget =  7
  T=13 obs= 72  stratified Dmax =  15 (20.8%)   unstratified 2-label Dmax =  10 (13.9%)   delta =   5   15.5(2) budget =  7
  T=14 obs= 69  stratified Dmax =  14 (20.3%)   unstratified 2-label Dmax =  10 (14.5%)   delta =   4   15.5(2) budget =  6
  T=15 obs= 60  stratified Dmax =  12 (20.0%)   unstratified 2-label Dmax =   9 (15.0%)   delta =   3   15.5(2) budget =  6
  T=16 obs= 60  stratified Dmax =  12 (20.0%)   unstratified 2-label Dmax =   9 (15.0%)   delta =   3   15.5(2) budget =  6
  T=17 obs= 60  stratified Dmax =  12 (20.0%)   unstratified 2-label Dmax =  10 (16.7%)   delta =   2   15.5(2) budget =  6
  T=18 obs= 60  stratified Dmax =  10 (16.7%)   unstratified 2-label Dmax =  10 (16.7%)   delta =   0   15.5(2) budget =  6
So alpha viability is a function of the stratification, and it is a run-level hazard
independent of the human-count question. Stated as such in the report.
```

**This is the answer to "where will the real run sit".** The derived mix is not a guess about rater
behaviour; it follows from the class definitions in s5.2 and the s10.1 decision procedure:
fill-expected companies contribute SUPPORTED-FILL where CPG filled and **MISSED-FILL where it did
not**, and abstention-expected companies contribute CORRECT-ABSTENTION. Because `E[fills]` is
~30 at every configuration while `3 x N_fill` ranges 36 to 180, **the dominant label at the cap is
MISSED-FILL, not SUPPORTED-FILL** - the quota structure spreads the marginal by construction.

Consequence: the majority share lands at **40.9%-60.0%**, alpha tolerates **10-54 disagreements
(16.7%-21.8%)**, and **s15.5(2) binds first at every permitted configuration**. The claim that alpha
is the tight constraint holds only under a two-label collapse.

## 2D. The stratification dependency - a run-level hazard

s6E of `06_alpha_marginals.out` (reproduced in `STATISTICAL_CONSEQUENCES.md` risk 8) computes what
happens if the stratification does not hold. Alpha's tolerance falls from 51 to 4 disagreements at
T = 1, 21 to 12 at T = 9, 12 to 9 at T = 15. **At T = 1..7 the unstratified tolerance falls below the
s15.5(2) budget, flipping which constraint binds.** s9.7 explicitly anticipates reference truth
contradicting a class prediction and says the mismatch is published, not corrected - so this is a
live hazard, and it is independent of how many humans the study uses.

## 2E. Two distinct raters are mechanically enforced

```
== 6F. TWO DISTINCT RATERS ARE MECHANICALLY ENFORCED ==
Confirmed in two places, not one:
  analysis.mjs:199  condition 3 triggers on `sheet1.rated_by === sheet2.rated_by`
  ratings.mjs:97    resolveRatingAdjudication pushes "the two sheets were rated by the same
                    person - >= 2 independent raters are required"
  ratings.mjs:98    "the rating adjudicator must be neither rater (s4A.3)"
So a ONE-rater design is refused by the instrument, and a design in which one of the two raters
also adjudicates is refused by ratings.mjs:98. "Two humans" cannot mean "two humans, one of whom
adjudicates": that is exactly the configuration ratings.mjs:98 exists to refuse.
```

---

## Notes on method

- `n` is taken as the full observation count `obs` for each configuration. With
  AD-1 = `EXCLUDE_INVALID_CONFLICT_AND_STALE` the real alpha population is `obs` minus
  INVALID/REFERENCE-CONFLICT/REFERENCE-STALE, which is not derivable from the code. `n = obs` is
  the upper bound; a smaller `n` makes alpha slightly *more* tolerant as a percentage, so this
  choice does not favour the conclusion drawn.
- Each `Dmax` is found by constructing a concrete pairs array at every `D` from 0 to `n` and
  scoring it with the imported `alphaNominal`, then applying the exact integer test. No closed form
  is used and no result is interpolated. The scan also reports whether the pass/fail boundary is
  monotone in `D`; it was monotone in every case computed.
- The "realistic" marginal is not a guess about rater behaviour. The fill/abstention split is
  `E[fills] : obs - E[fills]`, and `lib/ratings.mjs:37-38` makes that split **mechanically
  binding**: a rater sheet is refused if it puts a fill label on an item where CPG returned no value,
  or an abstention label on an item where it did. So the two raters cannot disagree across the
  fill/abstention boundary at all, and the two-block structure of the marginal is forced by the code.
- What is **not** derived: the within-block split (SUPPORTED vs UNSUPPORTED vs INCORRECT vs
  MISATTRIBUTED; CORRECT-ABSTENTION vs MISSED-FILL). The realistic shape collapses each block to its
  dominant label, which is the *least* tolerant assumption within the block structure; s5d shows how
  fast `Dmax` moves as the majority share changes, so the sensitivity of the answer to this is
  visible rather than hidden.

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

