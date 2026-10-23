# DT_U8_PROTOCOL_DRAFT — do deterministic quality scores track human judgment?

**Artefact class: PREPARATION.**
This is a protocol *draft*. It registers nothing, rates nothing, recruits nobody and reports no
result. No scorer, instrument or harness is implemented by it. No model, API or network call was
made in producing it.

**Stream:** DEEPTECH-PARALLEL-004, Stream U (uncertainties H/I/J).
**Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18` (disposable worktree `C:/tmp/dt4-uncert`).
**Baseline of record:** `DEEPTECH_BASELINE_001.md`.

---

## 0. NAMING DISCIPLINE

**DT-U8 is not CPG-U8.**

| Identifier | Register | Question | Where defined |
|---|---|---|---|
| **DT-U8** | DEEPTECH baseline §9 | Do the **12-dimension deterministic content quality scores** track human judgment? | `DEEPTECH_BASELINE_001.md:647`; capability C-04 at `:185-204` |
| CPG-U8 | CPG-U1 Protocol-004 §16.2 | Could a *company-profile grounding* quality score be validated, and what would that require? | `research/cpg-u1/CPG_U1_PROTOCOL_004.md:880-889` |

This draft concerns **DT-U8 only**. Protocol-004 §16.2 is used **only** as a methodological
pattern — specifically its correct sequencing rule: *formula registered before it sees any label;
calibration labels separate from a held-out set that is never used for calibration*. That
sequencing principle is adopted here and applied to a completely different scorer, with its own
content, its own raters and its own instrument. **No CPG-U1 artefact, dataset, label, seed,
registry or tool is read, written or reused.** Nothing here touches `research/cpg-u1/**`.

**Evidence position:** DT-U8 stands at **Rung 1** with **no definition existing before this
draft** (`DEEPTECH_BASELINE_001.md:647` — "Never posed before DT-SPEC-001"; hypothesis, baseline,
intervention and metric columns are all empty). Nothing in this document constitutes evidence.

---

## 1. The deterministic scorer — exactly what it is and where it lives

All citations read at `af2fb6e9` in this worktree.

### 1.1 The scorer

| Item | Location |
|---|---|
| **Engine** | `backend/services/content/qualityEngine.ts` — 547 lines |
| **Entry point** | `evaluate(input: QualityEngineInput): QualityScorecard` — `qualityEngine.ts:494-547` |
| **Input contract** | `QualityEngineInput` — `qualityEngine.ts:31-46`: `contentType`, `text`, optional `platform`, `objective`, `audience`, `brandContext`, `originalityScore`, `companyId`, `evaluatedAt` |
| **Weights** | `DIMENSION_WEIGHTS` — `qualityEngine.ts:52-65`; sums to exactly 1.0 |
| **Dimension list** | `QUALITY_DIMENSIONS` — `lib/content/quality/types.ts:33-46` |
| **Dimension union type** | `QualityDimension` — `lib/content/quality/types.ts:18-31` |
| **Band type** | `QualityLabel = 'poor' \| 'fair' \| 'good' \| 'excellent'` — `lib/content/quality/types.ts:49` |
| **Per-dimension verdict** | `DimensionScore { score: 0..100, label, signals: string[] }` — `lib/content/quality/types.ts:56-64` |
| **Output contract** | `QualityScorecard { overall, dimensions, evaluatedAt? }` — `lib/content/quality/types.ts:69-79` |
| **Aggregation** | Weighted mean, `qualityEngine.ts:533-537`; clamped 0..100 (`clamp`, `:105`) |
| **Failure floor** | `floorScorecard` — `qualityEngine.ts:482`; used for empty text (`:500`) and on any engine error (`:545`) |
| **Per-dimension guard** | `guarded()` — `qualityEngine.ts:509-517`; a throwing dimension degrades to score 20 with signal `'dimension unscorable — heuristic error'` |
| **Section-block model** | `splitIntoBlocks` — `lib/content/quality/sectionBlocks.ts`, imported at `qualityEngine.ts:22` |
| **Platform profile** | `getPlatformProfile` — `lib/content/platformAdaptationProfiles.ts`, imported at `qualityEngine.ts:21` |
| **Platform ceilings** | `PLATFORM_CHAR_LIMITS` — `qualityEngine.ts:70-80` (deliberately duplicated, not imported; header note `:67-70`) |

### 1.2 The twelve dimensions and their weights

Read from `qualityEngine.ts:52-65`; the per-dimension scorers are wired at `:519-532`.

| Dimension | Weight | Scorer | Inputs it actually consumes |
|---|---|---|---|
| `objectiveAlignment` | 0.12 | `scoreObjectiveAlignment` | term set × `input.objective` |
| `originality` | 0.10 | `scoreOriginality` | `input.originalityScore` only — **imported from the originality cascade, not computed here** |
| `platformFit` | 0.10 | `scorePlatformFit` | text × `input.platform` |
| `readability` | 0.10 | `scoreReadability` | text |
| `brandVoice` | 0.08 | `scoreBrandVoice` | term set, lowercased text × `input.brandContext` |
| `hook` | 0.08 | `scoreHook` | text |
| `seo` | 0.08 | `scoreSeo` | term set, text × `input.objective` |
| `cta` | 0.07 | `scoreCta` | text, `blockHasCta`, `input.platform` |
| `trust` | 0.07 | `scoreTrust` | text |
| `clarity` | 0.07 | `scoreClarity` | text |
| `structure` | 0.07 | `scoreStructure` | raw text, `contentType`, `platform` |
| `grammar` | 0.06 | `scoreGrammar` | text |

**Three properties that are genuinely provable and must be preserved by the study design:**

1. **Determinism.** Header `qualityEngine.ts:1-19`: no AI calls, no database, no `Math.random`,
   no `Date.now` in scoring; the same input yields a byte-identical scorecard. The only non-pure
   value, `evaluatedAt`, is accepted from the caller and never generated internally
   (`:41-45`, `:540`).
2. **Fail-safe.** Bad input never throws (`:16-19`, `:495-546`).
3. **Deterministic explanation.** Every dimension carries `signals: string[]` — human-readable
   observations (`lib/content/quality/types.ts:60-63`).

**The exact hazard DT-U8 exists to detect**, in the baseline's own words
(`DEEPTECH_BASELINE_001.md:203`): "a deterministic scorer that does not track human judgment is
*precise and wrong*, and that failure mode is invisible to every one of the 9 test files."
`:197` records the limitation: "**Never validated against human judgment.** Determinism is
proven; *validity* is entirely unestablished."

### 1.3 Where the scorer runs today — it is not dark

| Caller | Citation | Nature |
|---|---|---|
| Post generation | `lib/post/runPostGeneration.ts:44` (import), `:581` (`qualityEngine.evaluate({...})`) | Additive + fail-open after generation |
| Thread generation | `lib/thread/runThreadGeneration.ts:45` | Same shape |
| Canonical API route | `pages/api/content/[id]/quality.ts:7`; `POST` evaluates then persists via `qualityService.persistScorecard` (route docstring `:11-25`) | Live, tenant-scoped, role-gated (`:38`) |
| Prediction engine | `backend/services/content/predictionEngine.ts:31` — `import { evaluate as evaluateQuality }` | Quality feeds predicted performance |
| Cert scripts | `scripts/cert/concurrency-cert.ts:12`; `scripts/cert/e2e-runtime-cert.ts:13` | Certification harnesses |
| Unit test | `backend/tests/unit/qualityEngine.test.ts:4` | Determinism/behaviour, not validity |

**This is materially different from DT-U4.** The quality engine is a **live, called scorer** that
writes persisted scorecards (`pages/api/content/[id]/quality.ts`) and feeds a downstream
prediction (`predictionEngine.ts:31`). The baseline classifies C-04 production state as
**PARTIAL** (`DEEPTECH_BASELINE_001.md:191`). So an invalid score is not a dormant risk: it is
already shown to users and already propagating into predictions. **DT-U8 is therefore the
highest-consequence of the three uncertainties in this stream, not the smallest.**

### 1.4 What the scorer does NOT do — pre-empting a scope error

- It does not score factual correctness or grounding. That is DT-U1's territory
  (`DEEPTECH_BASELINE_001.md:640`) and is not in DT-U8's construct.
- It does not compute originality; it *receives* `originalityScore`
  (`qualityEngine.ts:38`, `:521`). A DT-U8 run must record what value was supplied, or the
  0.10-weighted dimension is an uncontrolled input.
- Its weights are engineering defaults. The baseline records 0 of 27 thresholds calibrated
  (`DEEPTECH_BASELINE_001.md:898`, BG-06). **DT-U8 as designed here measures agreement; it does
  not calibrate weights** (§9).

---

## 2. Research question and hypotheses

**Question.** Do the deterministic quality scores produced by `qualityEngine.evaluate` agree
with the judgment of independent human raters applying a published rubric, on content the engine
has never been tuned against?

- **H0 (null).** Agreement between the engine's scores and adjudicated human ratings is no
  better than chance.
- **H1 (alternative).** Agreement reaches or exceeds a pre-registered floor, at both the overall
  and per-dimension level.
- **H2 (the "precise and wrong" hypothesis — explicitly co-registered).** The engine is
  internally consistent (deterministic, stable) **and** fails to track human judgment. H2 is a
  *named, expected-possible outcome*, not a fallback narrative. §10 defines how it is detected
  and what must be published if it holds.

---

## 3. Unit of analysis and the content sample

**Unit = one piece of content**, scored once by the engine and rated independently by ≥ 2 humans.

### 3.1 Content sample construction

The sample must be **stratified by the things the engine conditions on**, because otherwise
agreement could be an artifact of a single content shape:

| Stratum axis | Basis | Why |
|---|---|---|
| `contentType` | `QualityEngineInput.contentType` — `qualityEngine.ts:33`; drives `splitIntoBlocks` and `scoreStructure` | Structure scoring is content-type dependent |
| `platform` | `PLATFORM_CHAR_LIMITS` — `qualityEngine.ts:70-80` (linkedin, instagram, twitter/x, facebook, youtube, tiktok, …) | `platformFit` and `cta` are platform-conditioned |
| **True quality spread** | Sample must span genuinely poor → genuinely excellent | An all-good sample produces range restriction, which **deflates correlation** and would make a valid scorer look invalid; an all-mediocre sample does the same |

**Range restriction is the single biggest threat to this study and must be designed against, not
noted afterwards.** A sample drawn only from shipped, already-accepted content is
range-restricted by construction.

> **DECISION REQUIRED — D-U8-1: content provenance.**
> - **(a) Historical content already in the system.** Cheapest; no generation cost; but
>   range-restricted (it survived existing gates) and each item may be tenant data, raising a
>   confidentiality question before any external rater sees it.
> - **(b) Content generated specifically for the study**, spanning a deliberate quality range.
>   Controls range; costs generation; **and a deliberately-bad item must be genuinely bad, not a
>   caricature** — a caricature is trivially separable and inflates agreement.
> - **(c) Mixed: (a) for the middle of the range, (b) for the tails.** Best coverage; most
>   sourcing work; the strata must be declared so the mixture cannot be tuned after the fact.
>
> **Consequence:** under (a) alone, a low correlation is uninterpretable — it may be the scorer
> or it may be the restricted range. Under (b) alone, agreement may not transfer to real content.
> **Whatever is chosen, the observed score range must be published**, so a reader can judge
> restriction for themselves.

> **DECISION REQUIRED — D-U8-2: tenant-data exposure.** If (a) or (c) is chosen, real customer
> content would be shown to external raters. Options: (i) use only content from the developing
> organisation's own tenant — but that content is produced by the people building the scorer, a
> contamination analogous to F2; (ii) obtain explicit consent per tenant; (iii) use synthetic or
> public-domain content only, which is option (b). **Consequence:** choosing (i) silently
> reintroduces exactly the self-authored-data problem F2 identifies
> (`DEEPTECH_BASELINE_001.md:481`). This decision is not the study designer's to make alone.

### 3.2 Held-out discipline

Two disjoint sets, following the sequencing pattern of `CPG_U1_PROTOCOL_004.md:880-889`:

- **CALIBRATION set** — may be used to debug the instrument, train raters and check the rubric.
  **Never** used for any reported agreement statistic.
- **HELD-OUT set** — drawn and sealed before any rating, used **once**, for the reported
  endpoints only. Never used to adjust the rubric, the weights, or a dimension scorer.

**Registration before labels (mandatory, from §16.2's item 1):** the engine's formula — the
twelve dimension scorers and `DIMENSION_WEIGHTS` — is already fixed in code at a SHA, so the SHA
itself is the registration of the formula. **The SHA is recorded before any rating begins and no
change to `qualityEngine.ts` or `lib/content/quality/**` is permitted between registration and
the reported result.** Any change voids the run.

---

## 4. The human rating instrument

### 4.1 Construct alignment — the decision that determines whether the study means anything

The engine produces (a) twelve per-dimension 0..100 scores with bands, and (b) one weighted
`overall`. A human instrument can target either.

> **DECISION REQUIRED — D-U8-3: what humans rate.**
> - **(a) Overall quality only.** One judgment per item. Cheapest; highest rater agreement;
>   but a dimension-level failure is invisible, and a high overall agreement could be carried
>   entirely by two dimensions while ten are noise.
> - **(b) All twelve dimensions, one rating each.** Directly parallel to the scorecard; detects
>   per-dimension failure; **but several dimensions are of doubtful human ratability in
>   isolation** — `seo` and `platformFit` are arguably expertise judgments, `grammar` is nearly
>   mechanical, and `originality` is not computed by the engine at all (§1.4), so asking a human
>   to rate it measures a different thing than the dimension does. Twelve ratings per item also
>   multiplies cost and induces rater fatigue, which lowers agreement.
> - **(c) Overall + a declared subset of dimensions** (e.g. `objectiveAlignment`, `readability`,
>   `hook`, `cta`, `clarity`, `structure` — the six most plainly human-judgeable), with the
>   remaining six reported as **NOT HUMAN-VALIDATED** and excluded from any validity claim.
>
> **Consequence:** under (a) the product may claim "validated quality scoring" on a single
> aggregate while individual dimensions shown in the UI are unvalidated. Under (b) low agreement
> on an unratable dimension will be misread as scorer failure. **Recommended: (c)**, with the
> excluded dimensions named explicitly in every subsequent claim. This is the owner's call.

### 4.2 Rating scale

> **DECISION REQUIRED — D-U8-4: scale form.**
> - **(a) The engine's own 4-band ordinal** (`poor`/`fair`/`good`/`excellent`,
>   `lib/content/quality/types.ts:49`). Direct comparability to the engine's bands; supports a
>   weighted-κ analysis; coarse, so a real but small mismatch is invisible.
> - **(b) 0–100 numeric**, matching `DimensionScore.score`. Supports rank correlation; humans
>   are poor at absolute 0–100 judgments, producing scale-use differences between raters that
>   look like disagreement.
> - **(c) 5- or 7-point Likert per dimension**, mapped to bands for agreement and used as ranks
>   for correlation. Best psychometric behaviour; requires an explicit, registered mapping from
>   Likert points to the engine's bands, and that mapping is itself a judgment.
> - **(d) Forced-choice pairwise comparison** (which of these two items is better?). Highest
>   human reliability by a wide margin and immune to scale-use differences; but it validates
>   **ranking**, not the absolute score or its bands, and the product surfaces absolute scores.
>
> **Consequence:** (a) risks a coarse "agreement" that hides real error; (b) risks measuring
> rater scale idiosyncrasy; (d) validates a different claim than the one the product makes.
> A defensible combination is **(a) for the agreement endpoint + (d) on a subset for a
> ranking-validity check**, but the cost doubles.

### 4.3 The rubric — mandatory properties

Whatever D-U8-3/D-U8-4 resolve to, the rubric must:

1. be **written and published before any rating**, and never edited mid-run;
2. define each rated construct in **outcome terms a non-engineer can apply**, with anchored
   examples at each scale point, drawn from the CALIBRATION set only;
3. be **derived from the engine's dimension definitions, not from its heuristics**. If the rubric
   tells a human to count sentence length because that is what `scoreReadability` does, the study
   measures whether a human can emulate the code — a tautology, and the single most likely way
   to accidentally manufacture a positive result. **The rubric describes the construct; it never
   describes the algorithm.**
4. include an explicit **`CANNOT-RATE`** option (§7);
5. never show, mention or imply any engine output, score, band or signal string.

---

## 5. Blinding

| What is blinded | From whom | How |
|---|---|---|
| Every engine score, band and `signals` string | All raters and the adjudicator | The engine is run **only after** all rating sheets are sealed, or run beforehand by the operator and held; raters never receive scorecards |
| Item ordering | Raters | Presentation order derived mechanically from a value published before rating; each rater gets an independently derived order so position effects do not correlate across raters |
| Other raters' ratings and any running tally | Each rater | Separate sheets; no shared workspace |
| Rater identity and which rater gave which rating | Adjudicator | Ratings presented as "Rating A" / "Rating B", assignment derived mechanically |
| CALIBRATION-set items and any pilot output | Held-out raters | Held by the operator |
| Stratum membership, provenance, and any "intended quality" label | Raters | Not in the packet |
| Whether an item was generated for the study or drawn from history (D-U8-1) | Raters | Items presented in a uniform format so provenance is not inferable from formatting |

**Order of operations:** register SHA + rubric → draw and seal HELD-OUT set → rate → seal
ratings (hash published) → run engine → compute endpoints. **Engine scores are computed after
ratings are sealed.** If the engine must be run first for operational reasons, its outputs are
sealed by the operator and demonstrably not opened until ratings are in — and that is weaker;
prefer the stated order.

**What cannot be blinded:** the content itself is necessarily visible to a rater. DT-U8 is blind
to *engine output*, not to *item identity*. Stated as a known limitation.

---

## 6. Raters: count, independence, eligibility

### 6.1 Counts

| Role | Count | Constraint |
|---|---|---|
| Operator (custodian; **not independent**) | 1 | Holds no rating or adjudication role; runs the engine; holds the seals |
| **Rater** | **≥ 2 independent per item** | Every scored item carries ≥ 2 independent ratings; mutually blind |
| **Rating adjudicator** | 1, independent | Resolves rater disagreement on the blinded packet of §8 |

Minimum **3 independent persons**. Roles are mutually exclusive. The person-to-role assignment is
fingerprinted and published **before** the held-out draw.

> **DECISION REQUIRED — D-U8-5: rater count.**
> - **(a) 2 raters + 1 adjudicator.** The minimum that supports an agreement statistic and
>   resolves ties. Fragile: one idiosyncratic rater dominates half the signal, and κ/α from two
>   raters is a noisy estimate.
> - **(b) 3 raters, majority for the human reference, adjudicator for 3-way splits.** Markedly
>   more stable human reference; ~50 % more rating cost; the majority rule must be registered in
>   advance.
> - **(c) 5+ raters.** Stable; appropriate if D-U8-3(b) (all twelve dimensions) is chosen,
>   because per-dimension agreement estimates are noisier than overall; cost scales linearly.
>
> **Consequence:** at (a) a marginal result is indistinguishable from rater noise, and the study
> may be INCONCLUSIVE after paying for it. **Recommended: (b).**

### 6.2 Independence criteria

A rater is **not independent** if, at any time between the developing organisation's first
product commit and publication of the DT-U8 result, the person:

1. was employed by or engaged (paid or unpaid) by the developing organisation, other than the
   study engagement in item 4;
2. received any payment or benefit from it other than the item-4 fee;
3. holds equity, options or any other interest in it;
4. — *permitted exception:* a fixed study fee, agreed in writing before any material is
   released, **not contingent on any result**, whose agreement hash is recorded;
5. implemented `qualityEngine.ts`, `lib/content/quality/**`, the rubric, this protocol or any
   DT-U8 tooling, **or has read the engine's source**;
6. is a household member, partner or family member of, or in a reporting relationship with, any
   person in item 5 or with the operator.

**Item 5's source-reading clause is specific to DT-U8 and is essential.** A rater who has read
`scoreReadability` will, consciously or not, rate the way the code scores. That single leak would
manufacture agreement and invalidate the study's entire purpose.

"Unknown" is not "no". These are **procedural records, not proof**.

### 6.3 If independent raters are unavailable

Execution may occur, but every endpoint is labelled **UNADJUDICATED**, the evidence rung
**cannot exceed Rung 2**, and **no claim of validation against human judgment may be made**. The
protocol is not weakened to accommodate unavailability. (Pattern after
`CPG_U1_PROTOCOL_004.md:734`.)

---

## 7. Abstention on the rating side

The rubric carries an explicit **`CANNOT-RATE`** option, used when the item is unratable for the
construct (e.g. `cta` on content with no call-to-action surface, `seo` on a platform where it
does not apply). A `CANNOT-RATE` item-dimension is:

- **excluded from that dimension's agreement denominator**;
- **counted and published**;
- **never** converted to a mid-scale rating by anyone, including the adjudicator — mid-scale
  imputation is the quiet way a null result becomes a positive one;
- **never imputed**; a missing rating stays `pending` and is not scored.

**Pre-declared guard:** if `CANNOT-RATE` exceeds **20 %** of item-dimension cells for any
dimension, that dimension's agreement statistic is reported as **UNASSESSABLE** rather than as a
number, and that dimension is excluded from any validity claim.

**Note the asymmetry to record explicitly:** the engine never abstains. `floorScorecard`
(`qualityEngine.ts:482`) emits a *low score*, not an abstention, and a `guarded()` failure emits
**20** (`:515`), also a score. So where a human says "cannot rate", the engine has already said
"bad". **That asymmetry is itself a finding and must be reported**, not smoothed over: every
item where the engine returned a floor or a guarded-20 is flagged and reported separately from
the main agreement statistic.

---

## 8. Adjudication of disagreement

**When.** After all raters submit complete sheets, and only for item-dimension cells where
raters disagree beyond the registered tolerance.

> **DECISION REQUIRED — D-U8-6: the disagreement trigger.** On an ordinal band scale
> (D-U8-4(a)), is adjacent-band disagreement (`good` vs `excellent`) a disagreement requiring
> adjudication, or tolerated and handled by weighted κ? (a) **Adjudicate every non-identical
> pair** — maximum consistency, large adjudication load. (b) **Adjudicate only non-adjacent
> disagreement** — much cheaper, and defensible if the primary statistic is weighted.
> **Consequence:** (b) leaves adjacent disagreement in the reference, which is appropriate for a
> weighted statistic and wrong for an unweighted one. This decision is coupled to D-U8-4 and
> must be resolved with it.

**The adjudicator's packet contains, per disagreeing cell and nothing more:**

- the item, in the same uniform presentation the raters saw;
- the rubric and the scale definition;
- the two (or three) ratings, shown **unlabelled** as "Rating A" / "Rating B" (/ "Rating C"),
  with the label-to-rater assignment derived mechanically from a value published before rating.

**The adjudicator never receives:** any engine score, band or signal; rater identities; other
cells' ratings; tallies, aggregates or provisional endpoint values; the number of disagreements;
stratum or provenance; CALIBRATION-set output.

**Decisions** are `RATING_A`, `RATING_B` (`RATING_C`) or `CANNOT-RATE`, mapped mechanically to
the adjudicated value. Adjudicated cells are **flagged** in the published data, and the endpoint
is reported both with and without them, so a reader can see how much the result rests on
adjudication.

---

## 9. Endpoints, statistics and floors

Computed on the **HELD-OUT set only**, from sealed ratings against engine scores.

| ID | Endpoint | Definition |
|---|---|---|
| **G-U8** | **Assessability gate** | ≥ 2 independent ratings on ≥ 90 % of scored cells; item count ≥ the §10 minimum; inter-rater agreement at or above the §9.2 floor. Fails → **INCONCLUSIVE**, checked first |
| **P-U8-1** | **Rank agreement, overall score (PRIMARY)** | **Spearman ρ** between engine `overall` and the adjudicated human overall, across held-out items |
| **P-U8-2** | **Band agreement (PRIMARY, co-equal)** | **Quadratic-weighted Cohen's κ** between the engine's `QualityLabel` band and the adjudicated human band |
| **P-U8-3** | **Per-dimension rank agreement** | Spearman ρ per rated dimension (subset per D-U8-3) |
| **S-U8-1** | Direction-of-error profile | Signed engine − human difference; detects systematic optimism/pessimism that a correlation hides |
| **S-U8-2** | Range check | Observed min/max/spread of engine scores and human ratings — the restriction diagnostic (§3.1) |
| **S-U8-3** | Floor/guard incidence | Count of items where the engine returned `floorScorecard` or a guarded-20, reported separately (§7) |
| **S-U8-4** | Weight-sensitivity diagnostic | Does the human overall correlate better with an **unweighted** dimension mean than with the engine's weighted `overall`? A yes indicates the *weights* are wrong even if the dimensions are informative — a specific, actionable finding |

**The baseline names Spearman** as the intended statistic (`DEEPTECH_BASELINE_001.md:199`,
"Spearman correlation vs. blind human ratings"), so P-U8-1 is consistent with the register.
**P-U8-2 is added deliberately:** a high ρ with a poorly-located band boundary means the product's
user-visible `poor/fair/good/excellent` label is wrong even though the ranking is right. Only
P-U8-2 detects that, and the band is what the UI shows.

### 9.1 Floors

> **DECISION REQUIRED — D-U8-7: the agreement floors.**
> - **P-U8-1 (Spearman ρ).** (a) **ρ ≥ 0.70** — a strong relationship; the defensible floor for a
>   claim that the score "tracks human judgment". (b) **ρ ≥ 0.50** — a moderate relationship;
>   honest as "partially tracks", and **must not** be reported as validation. (c) **ρ > 0,
>   p < 0.05** — reject; statistical significance on a weak correlation is exactly how "precise
>   and wrong" gets published as success.
> - **P-U8-2 (quadratic-weighted κ).** (a) **κ ≥ 0.60** — substantial agreement. (b) **κ ≥ 0.40**
>   — moderate; not a validation claim.
>
> **Consequence:** under (b)/(c) the product could claim validation on a scorer that explains
> under a quarter of the variance in human judgment. **Recommended: ρ ≥ 0.70 and κ ≥ 0.60, both
> required.** Fixing these before any data exists is the whole point; choosing them afterwards
> is unfalsifiable.

### 9.2 Inter-rater agreement — the instrument's own validity

Before the engine may be judged, the human reference must be shown to be a shared construct.
Report **Krippendorff's α** (ordinal, for a band or Likert scale) across raters, per rated
dimension and overall, with a floor of **≥ 0.667** — the conventional floor for tentative
conclusions.

**Below the floor → INCONCLUSIVE, and the finding is that the rubric does not define a shared
construct.** That is a real and publishable result about the instrument, and it is not a result
about the engine. It must never be reported as evidence for or against the engine.

### 9.3 Explicitly out of scope

DT-U8 as designed **measures agreement only**. It does not calibrate `DIMENSION_WEIGHTS`
(`qualityEngine.ts:52-65`), does not move band boundaries, and does not modify any dimension
scorer. Using held-out ratings to retune weights would destroy the holdout and reproduce F2
(`DEEPTECH_BASELINE_001.md:468-490`) inside DT-U8. A retune requires a **new** held-out set and
a **new** registration. S-U8-4 may *indicate* that weights are wrong; it may not be used to fix
them.

---

## 10. Sample size for the claimed precision

The endpoint is a correlation, so the required item count follows from the precision claimed for
ρ, not from a rule of thumb.

**The honest framing:** the standard error of a correlation shrinks roughly as 1/√n, and the
confidence interval around ρ is wide at small n. A study that reports "ρ = 0.72" from 20 items
is reporting a number whose interval plausibly spans from weak to near-perfect — it cannot
distinguish a scorer that tracks human judgment from one that barely does.

| Regime | Items (held-out) | What it can support |
|---|---|---|
| **Too small** | < 30 | Nothing. The interval on ρ is too wide to separate "tracks" from "does not". Do not run. |
| **Minimum defensible** | **≈ 60** | A single overall claim at the ρ ≥ 0.70 floor, if the floor is cleared with margin. **No per-dimension claim** — twelve (or six) dimension-level ρ values at n=60 are individually imprecise and collectively a multiple-comparisons problem. |
| **Per-dimension capable** | **≈ 120–150** | Per-dimension ρ with usable precision, and the stratified sub-analyses (content type, platform) the engine's conditioning demands. |
| **Stratum-level claims** | 200+ | Claims within a content type or platform. |

**Independent of the regime, the study needs:**

- **≥ 10 items per stratum cell** it intends to report on. With, say, 3 content types × 3
  platforms, "60 items total" is 6–7 per cell — enough for the pooled endpoint, not enough for
  any per-cell statement.
- **A deliberate quality spread** (§3.1). Correlation is attenuated by range restriction, so an
  under-spread n=120 can be worse than a well-spread n=60.
- **Multiplicity control** if per-dimension endpoints are reported: the number of dimension
  tests is registered in advance and the correction (or the decision to report per-dimension
  values as *diagnostics only*) is registered with it.

> **DECISION REQUIRED — D-U8-8: item count vs claim scope.**
> - **(a) ~60 items, overall claim only.** Meets a defensible minimum; per-dimension values
>   reported as diagnostics that carry no claim. Cheapest path to a real Rung-2/4 result.
> - **(b) ~150 items, per-dimension claims.** Supports the claim the product actually makes
>   (the UI shows per-dimension scores), at roughly 2.5× the rating cost — and 2.5× again if
>   D-U8-3(b) is chosen, since each item then needs twelve ratings from each of 2–3 raters.
> - **(c) Two-phase: ~60 now for the overall endpoint, ~90 more later for dimensions.** Delivers
>   a result sooner; **the second phase needs its own registration and its own held-out draw**,
>   and the first phase's items may never re-enter.
>
> **Consequence of (a) reported carelessly:** per-dimension scores stay unvalidated while the
> product cites "validated quality scoring". If (a) is chosen, every unvalidated dimension must
> be named in the claim language.

---

## 11. Pre-declared failure condition — "precise and wrong" must be detectable

This is the section the protocol exists for. The failure mode is stated in advance so that it
cannot be re-described afterwards as a partial success.

### 11.1 The condition, stated as a test

**DT-U8 FAILS — and the specific finding is "PRECISE AND WRONG" — when both hold:**

1. **Precision is confirmed.** The engine is byte-identical across repeated evaluation of the
   same input (re-running `evaluate` on each held-out item reproduces the scorecard exactly),
   consistent with `qualityEngine.ts:1-19`; **and**
2. **Validity is absent.** P-U8-1 `ρ < 0.70` **or** P-U8-2 `κ < 0.60` (per D-U8-7), on a sample
   that cleared G-U8 and whose inter-rater α cleared §9.2 and whose range check (S-U8-2) shows
   no material restriction.

Condition 2's qualifiers are load-bearing. A low ρ with **failing α** is an instrument failure,
not an engine failure. A low ρ with **restricted range** is uninterpretable. Only a low ρ on a
well-behaved, well-spread, well-agreed sample is evidence against the engine — and then it *is*
evidence, and must be published as such.

### 11.2 Why this is detectable only by this design

The nine existing test files cannot detect it (`DEEPTECH_BASELINE_001.md:203`). They assert
determinism, monotonicity and fail-safety — properties of the code. **No property of the code can
reveal that its rubric measures the wrong thing.** Only an external human reference can, and only
if that reference was produced without seeing the code (§6.2 item 5) or its output (§5).

### 11.3 Mandatory consequences of a PRECISE-AND-WRONG finding

Pre-committed now, so they are not negotiated later:

1. Every external claim that the quality engine *measures quality* is withdrawn. The surviving
   claim is exactly the determinism claim (`DEEPTECH_BASELINE_001.md:194`: "A 12-dimension
   quality engine scores content with byte-identical determinism — no AI calls, no DB, no
   wall-clock"), **with the explicit addition that its agreement with human judgment was measured
   and did not meet the pre-registered floor.**
2. C-04's differentiation classification is reviewed. "PROPRIETARY COMPOSITION"
   (`DEEPTECH_BASELINE_001.md:196`) may survive as a statement about *construction*; it may not
   be presented as efficacy.
3. The downstream dependency is flagged: `predictionEngine.ts:31` consumes the quality score, so
   an invalid quality score propagates into predicted performance. That propagation is named in
   the published finding.
4. The user-visible surface is flagged: `pages/api/content/[id]/quality.ts` persists and returns
   scorecards, so the finding has a product consequence, not only a documentation one.
5. **The result is published as a finding, not buried as a null.** A measured non-agreement is
   genuine Rung-4 evidence about the system and is more valuable than no measurement at all.

### 11.4 The inverse trap, also pre-declared

If agreement is **suspiciously high** (ρ ≥ 0.95), treat it as a **leakage alarm**, not a
triumph. Check, before publishing: did any rater read the engine's source or see its signals
(§6.2 item 5, §5); did the rubric describe the algorithm rather than the construct (§4.3 item 3);
were items separable by provenance or formatting (§5); did the adjudicator see any engine output.
An unexplained ρ ≥ 0.95 is reported as **SUSPECT — LEAKAGE NOT EXCLUDED** until each of those is
ruled out in writing.

---

## 12. Validity, dispositions and INCONCLUSIVE conditions

**Per-cell dispositions:** `SCORED`, `CANNOT-RATE` (§7), `RATING-CONFLICT-UNRESOLVED` (excluded,
published), `VOID` (item found ineligible after the draw; excluded, published, not replaced),
`ENGINE-FLOOR` (engine returned `floorScorecard` or a guarded-20; scored **and** flagged per
S-U8-3).

**The run is INCONCLUSIVE if any of:**

- G-U8 fails;
- inter-rater α below the §9.2 floor;
- `CANNOT-RATE` > 20 % of cells for the overall endpoint;
- `qualityEngine.ts` or `lib/content/quality/**` changed between registration and execution (SHA
  mismatch) — the formula was not registered before it saw labels;
- S-U8-2 shows severe range restriction (registered in advance as a stated spread minimum);
- any rater is found to have seen engine output or source (§5, §6.2 item 5).

---

## 13. Outcome vocabulary — exactly one word per run

| Outcome | Condition |
|---|---|
| **INCONCLUSIVE** | Any §12 condition. Checked **first** |
| **FALSIFIED** | Conclusive, and `ρ ≤ 0.30` **or** `κ ≤ 0.20` — the score does not meaningfully track human judgment. Published as **PRECISE AND WRONG** (§11) and as evidence **against** the validity claim |
| **FAILURE** | Conclusive, not falsified, and either floor missed — **including a near miss.** Also reported under §11 |
| **SUCCESS** | G-U8 holds, α clears §9.2, S-U8-2 shows no material restriction, and **both** P-U8-1 and P-U8-2 meet their floors |
| **SUSPECT — LEAKAGE NOT EXCLUDED** | §11.4 triggered and not yet ruled out. **Not a success**, and not reportable as one |

**What a SUCCESS licenses:** "On *n* held-out items spanning *[declared strata]*, scored by the
deterministic quality engine at SHA *X* and independently rated by *k* raters blind to the engine
and its source, the engine's overall score agreed with adjudicated human judgment at ρ = … and
weighted κ = …, meeting pre-registered floors of 0.70 and 0.60."

**What a SUCCESS does NOT license:** validity for dimensions not rated (D-U8-3); any claim that
`DIMENSION_WEIGHTS` are calibrated (§9.3); any claim for content types or platforms not sampled;
any claim about factual correctness or grounding (§1.4); any claim about the `originality`
dimension, whose value is supplied from outside the engine (`qualityEngine.ts:38`).

---

## 14. DECISION REQUIRED — consolidated

| ID | Decision | Alternatives | If chosen silently |
|---|---|---|---|
| **D-U8-1** | Content provenance | (a) historical (b) generated for study (c) mixed | Range restriction makes a low ρ uninterpretable |
| **D-U8-2** | Tenant-data exposure to external raters | (i) own tenant only (ii) per-tenant consent (iii) synthetic/public only | Either a confidentiality exposure, or a self-authored-data confound of the F2 kind |
| **D-U8-3** | What humans rate | (a) overall only (b) all 12 (c) overall + declared subset | Unvalidated dimensions get cited as validated |
| **D-U8-4** | Scale form | (a) 4 bands (b) 0–100 (c) Likert (d) pairwise | Measures rater scale idiosyncrasy, or validates ranking while the product shows absolutes |
| **D-U8-5** | Rater count | (a) 2+adj (b) 3+majority (c) 5+ | A marginal result is indistinguishable from rater noise |
| **D-U8-6** | Disagreement trigger | (a) any non-identical (b) non-adjacent only | Reference mixes tolerance levels with an unweighted statistic |
| **D-U8-7** | Agreement floors | ρ: 0.70 / 0.50 / significance-only; κ: 0.60 / 0.40 | A weak scorer is published as validated |
| **D-U8-8** | Item count vs claim scope | (a) ~60 overall (b) ~150 per-dimension (c) two-phase | Per-dimension claims made from a pooled-only sample |

---

## 15. Status

| Item | State |
|---|---|
| Deterministic scorer exists and is located | **VERIFIED** — `backend/services/content/qualityEngine.ts:494-547`; 12 dimensions at `lib/content/quality/types.ts:33-46` |
| Determinism claim is supported by the code's construction | **VERIFIED** — `qualityEngine.ts:1-19`; no `Math.random`/`Date.now` in scoring; `evaluatedAt` caller-supplied |
| Scorer is live and user-visible | **VERIFIED** — `pages/api/content/[id]/quality.ts`; `lib/post/runPostGeneration.ts:581`; consumed by `predictionEngine.ts:31` |
| Human rating instrument | **DOES NOT EXIST** — no rubric, no rater packet, no scale anywhere in the repository |
| Any human rating of quality output | **NONE** |
| DT-U8 hypothesis/baseline/metric before this draft | **NONE** — `DEEPTECH_BASELINE_001.md:647` |
| Any DT-U8 evidence | **NONE.** Rung 1. No held-out result exists. |
| This protocol registered or executed | **NOT RUN** |
