# DT_U4_HELD_OUT_DESIGN — held-out generalisation design for DT-U4

**Artefact class: PREPARATION.**
This document designs a study. It registers nothing, executes nothing, labels nothing and
reports no result. No scorer, arm or harness is implemented by it. No model, API or network
call was made in producing it.

**Stream:** DEEPTECH-PARALLEL-004, Stream U (uncertainties H/I/J).
**Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18` (disposable worktree `C:/tmp/dt4-uncert`).
**Baseline of record:** `DEEPTECH_BASELINE_001.md` (untracked in the primary working tree).

---

## 0. NAMING DISCIPLINE — read before anything else

**DT-U4 is not CPG-U4.** They are different questions in different registers:

| Identifier | Register | Question | Where defined |
|---|---|---|---|
| **DT-U4** | DEEPTECH baseline §9 | Does *competitor qualification* generalise to unseen **industries**? | `DEEPTECH_BASELINE_001.md:643` |
| CPG-U4 | CPG-U1 Protocol-004 §16.1 | Does *company-profile grounding* generalise to independent held-out **companies**? | `research/cpg-u1/CPG_U1_PROTOCOL_004.md:874-880` |

This document concerns **DT-U4 only**. It borrows Protocol-004's *method* (preregistration,
sealed held-out split, blinding, independent adjudication, exact thresholds, a single outcome
word, abstention handling) as a **pattern to imitate**. It reuses **none** of CPG-U1's
registered artefacts: no frame, no registry, no seeds, no commitment records, no tooling, no
identifiers, no dataset, no reference truth. Nothing in this design reads or writes anything
under `research/cpg-u1/**`. **DT-U4 has no dependency on CPG-U1 finishing** (see
`DT_U4_U8_U9_DEPENDENCY_MAP.md` §5).

**Evidence position, stated once and not softened:** DT-U4 stands at **Rung 1 (engineering
proof)** and nothing else. There is no held-out result, no out-of-sample measurement and no
independent evaluation. `DEEPTECH_BASELINE_001.md:656-676` places all of U1–U9 at Rung 1;
line 665 records that U4 *actively violates* Rung 6.

---

## 1. What the comparison arm really is — established from code, not from the baseline

All citations below were read at `af2fb6e9` in this worktree.

### 1.1 The multi-signal arm (intervention)

- `backend/services/competitor/qualification/competitorQualificationModel.ts`, 188 lines.
- `MULTISIGNAL_WEIGHT_PROFILE_V1` (`:51-71`) — seven weights summing to 1.0, plus
  `qualifyThreshold: 55` and `borderlineThreshold: 40`.
- `MULTISIGNAL_WEIGHT_PROFILE_V2` (`:73-105`) — the **active** profile (`multisignal-v2`),
  derived by `deriveOptimizedProfile`.
- **Abstention-aware renormalisation** is real and is the genuine design insight (`:55-58`):
  "the model renormalizes over the signals that have coverage on each candidate, so an
  abstaining signal (e.g. out-of-coverage taxonomy, geography-less market) never silently
  drags the score toward zero."
- The module's own header now states the confound in its own words (`:87-91`):
  "IN-SAMPLE, NOT VALIDATED: those figures are measured on the same 44-case set the weights
  were derived from ... Out-of-sample performance on independently labelled unseen-industry
  cases is UNMEASURED."
- `:93` — "this is a shadow-model calibration only — the shadow is NOT promoted and NOT
  deployed."

### 1.2 The taxonomy-only arm (baseline) — it exists, and it is genuinely a comparison arm

- `competitorQualificationCalibration.ts:4-9` (header) — the harness "scores every case with
  the multi-signal model AND with a taxonomy-only baseline that mirrors the live category
  gate", against two stated goals: unseen industries qualify correctly on evidence (taxonomy
  abstains), and no increase in false positives versus the live gate.
- `taxonomyBaselineDecision` — `competitorQualificationCalibration.ts:330-345`. It normalises
  the company category and the candidate category through `normalizeCompetitorCategory` and
  returns `true` iff `categoryAffinity` is `'same'` or `'functional'`. Its own docstring
  (`:324-329`) states it mirrors the live `hasStrictCategoryFit` gate and is "what collapses
  every unseen industry into one bucket".
- **VERIFIED:** a taxonomy-only comparison arm is implemented today. DT-U4 does not need a
  control arm built from nothing. This is the one structural advantage DT-U4 has over DT-U8
  and DT-U9 (`DEEPTECH_BASELINE_001.md:650-652`).

### 1.3 The runner, and two facts the baseline does not record

`runCalibration` — `competitorQualificationCalibration.ts:366-408`. It scores both arms per
case, tallies five confusion matrices (`multiSignal`, `multiSignalSeen`, `multiSignalUnseen`,
`taxonomyBaseline`, `taxonomyBaselineUnseen`) and is pure.

Two defaults matter for any future design and are **not** stated in the baseline:

1. **Default profile is V1, not the active V2** — `:367-368`:
   `profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1`.
2. **Default case set is the 11-case in-file array only**, not the combined dataset — `:367`:
   `cases: CalibrationCase[] = CALIBRATION_CASES`.

So `runCalibration()` called with no arguments evaluates **neither the active profile nor the
full dataset**. Any DT-U4 execution harness must pass both explicitly. Recorded so it is not
rediscovered later as a silent defect.

Decision mapping in the intervention arm (`:381-383`): a case counts as "predicts competitor"
only when `q.decision === 'qualified'`; `borderline` is **not** counted as a positive. That is
an abstention-like treatment of the middle band and it must be preserved and pre-declared in
DT-U4 (§11).

### 1.4 Production state — the arm is dark

- Shadow observer flag `COMPETITOR_MULTISIGNAL_SHADOW`, default OFF —
  `competitorQualificationShadow.ts:26-34`; the observer returns early when disabled (`:127`).
- Promotion router default is the legacy engine — `competitorQualificationRouter.ts:29-32`:
  anything other than the literal `multisignal` resolves to `live_taxonomy`. Borderline policy
  defaults to `observe` (`competitorQualificationRouter.ts:38-41`).
- **Consequence for DT-U4:** the multi-signal arm is not in production, so DT-U4 can only ever
  support a claim about the *model*, never about production behaviour, until the router is
  flipped. Any DT-U4 result must carry that qualifier verbatim.

---

## 2. The F2 confound, stated precisely

**Claim under correction:** that `MULTISIGNAL_WEIGHT_PROFILE_V2` has measured
precision/recall/F1 = 1.0 with 0 FP and 0 FN.

**Mechanism of the confound**, from `backend/tests/unit/competitorCalibrationAnalysis.test.ts`:

| Step | Line | Code |
|---|---|---|
| Define the single set | `:26` | `const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES];` |
| **Fit** the weights on it | `:42` | `const derived = deriveOptimizedProfile(ALL);` — asserted equal to V2's weights |
| **Evaluate** on the same set | `:99-100` | `evaluateProfile(ALL, V1)` / `evaluateProfile(ALL, V2)` |
| Assert perfection | `:104-110` | `precision === 1`, `recall === 1`, `f1 === 1`, `falsePositive === 0`, `falseNegative === 0` |
| Sensitivity, also in-sample | `:120,128` | `sensitivitySweep(ALL, MULTISIGNAL_WEIGHT_PROFILE)`; accuracy asserted `=== 1` at every perturbation point |

The fitting set and the evaluation set are the **same object**, `ALL`. The weights are a
function of the labels they are then scored against. F1 = 1.0 therefore holds **by
construction** and carries exactly zero information about generalisation. The ±10 %/±20 %
stability result is in-sample for the same reason: perturbing weights fitted to a set and
re-scoring that set measures the optimiser's local flatness, not robustness on new data.

**Holdout constructs repo-wide:** none. A case-insensitive search over `backend/`, `lib/`,
`pages/` and `scripts/` for `holdout|heldOut|hold_out|crossValidat|kFold|trainSet|testSet`
returned only `lib/creator-templates/campaignDesignSystem.ts:164,167` (`latestSet`,
unrelated). **VERIFIED — the baseline's zero-holdout finding (`DEEPTECH_BASELINE_001.md:894`)
reproduces.**

### 2.1 CORRECTION TO THE BASELINE — dataset size

`DEEPTECH_BASELINE_001.md:476` states `CALIBRATION_CASES` = **14** cases and a total of **47**,
and `:490` concludes "the stated dataset size (44) does not match the actual size (47)."

**Counted at `af2fb6e9`:**

| Array | File and array bounds | Cases | seen / unseen | positive / negative |
|---|---|---|---|---|
| `CALIBRATION_CASES` | `competitorQualificationCalibration.ts:104-275` | **11** | 5 / 6 | 4 / 7 |
| `EXTENDED_CALIBRATION_CASES` | `competitorCalibrationDataset.ts:172-256` | **33** | 13 / 20 | 16 / 17 |
| **Combined (`ALL`)** | — | **44** | 18 / 26 | 20 / 24 |

Method: the eleven element ids in `CALIBRATION_CASES` are `wellness-true`,
`wellness-companion-fp`, `wellness-crm-fp`, `marketing-true`, `marketing-wellness-fp`,
`logistics-true`, `logistics-marketing-fp`, `legaltech-true`, `legaltech-wellness-fp`,
`agritech-true`, `agritech-crm-fp` (at file lines 107, 122, 137, 153, 168, 184, 199, 215, 230,
246, 261); the array closes at `:275`. Each element carries exactly one `coverage` and one
`expectedCompetitor` field, and both tallies independently give 11.

**Therefore:** the actual combined size is **44**, which *matches* the code comment's
"44-case" claim (`competitorQualificationModel.ts:75,87`). The baseline's 14/47 figures and its
"stated 44 ≠ actual 47" conclusion are **incorrect** and should be corrected to 11/33/44. The
test's own guard is consistent with 44, not 47: `:30` asserts `ALL.length >= 40` and `:32-34`
assert ≥ 18 positives and ≥ 18 negatives — satisfied by 20/24.

**This correction does not weaken F2 in any way.** F2 is about *fitting on the evaluation set*,
which is verified independently of size. It matters only because a reviewer who checks the size
will find the baseline wrong, and a wrong number in a corrections section damages the
credibility of the corrections.

### 2.2 A second confound the baseline does not name: "unseen" is self-asserted

`coverage: 'seen' | 'unseen'` is a **hand-written literal on each fixture**
(`CalibrationCase.coverage`, `competitorQualificationCalibration.ts:24-32`). Nothing verifies
that an `'unseen'` industry is genuinely outside the taxonomy's vocabulary. The same party
authored the model, the labels **and** the coverage flags (`DEEPTECH_BASELINE_001.md:481`
records no external labelling provenance).

The dataset's industry strings are also assigned by author fiat rather than derived from
`competitorTaxonomy.ts`: `agritech`, `legaltech` and `logistics` carry `coverage: 'unseen'` in
both arrays, while `marketing_seo`, `mental_wellness` and `meditation` carry `'seen'` — with no
mechanical check behind either assignment.

**Design consequence (binding on §5):** DT-U4 must define "unseen industry" **mechanically,
against the taxonomy vocabulary at a frozen SHA**, and must never accept a coverage flag
authored by the same party as the model.

---

## 3. Hypotheses

- **H0 (null).** On independently labelled cases drawn from industries outside the taxonomy
  vocabulary, the multi-signal arm's decision quality is not better than the taxonomy-only
  arm's.
- **H1 (alternative, directional and pre-committed).** On those cases the multi-signal arm
  attains materially higher recall of genuine competitors **without** a higher false-positive
  rate than the taxonomy-only arm.

H1 is deliberately two-sided in its *safety* component: a recall gain purchased with extra
false positives is **not** a confirmation. This mirrors the harness's own two stated goals
(`competitorQualificationCalibration.ts:7-9`).

---

## 4. Unit of analysis

**One unit = one (company-context, candidate) pair**, labelled `competitor` /
`not-competitor` by independent labellers.

This is the unit both arms already consume (`CalibrationCase`,
`competitorQualificationCalibration.ts:24-32`), so no re-engineering of the arms is required.

**Clustering must be handled, not ignored.** Pairs are nested within company contexts and
within industries. A design that draws many candidates per company and then treats pairs as
independent will understate its own uncertainty.

> **DECISION REQUIRED — D-U4-1: candidates per company context.**
> - **(a) One candidate per company context.** Pairs are independent; simplest analysis; needs
>   ~60 distinct company contexts, the most expensive option to source.
> - **(b) Fixed small block, e.g. 1 positive + 1 negative per context** — the shape the
>   existing dataset already uses (`competitorCalibrationDataset.ts:5-8` states each industry
>   contributes at least one genuine competitor and one realistic cross-category near-miss).
>   Halves sourcing cost; requires the primary endpoint to be computed with a
>   clustered/stratified estimator, or reported per-context and pooled with clustering
>   acknowledged.
> - **(c) Variable blocks.** Cheapest to source, worst for analysis; unequal cluster sizes
>   silently weight some contexts more heavily.
>
> **Consequence of choosing silently:** any pooled confidence statement is wrong by an unknown
> factor. Recommended: **(b)**, with the clustering declared in the preregistration and the
> estimator fixed there.

---

## 5. Sampling and stratification across unseen industries

### 5.1 "Unseen" defined mechanically

Before any case is sourced, freeze:

1. the repository SHA whose `backend/services/competitorTaxonomy.ts` defines the vocabulary;
2. the enumerated set of category labels `normalizeCompetitorCategory` can return at that SHA;
3. a procedure: an industry is **UNSEEN** iff, for a specified public description of a company
   in it, `normalizeCompetitorCategory` returns no in-vocabulary category, **or**
   `categoryAffinity` against every in-vocabulary category is neither `same` nor `functional`.

The procedure is run by the operator and its output is published **before** labelling, so the
coverage flag is a derived fact rather than an assertion. This is a mechanical, offline call on
pure functions — no model, no network.

### 5.2 Ineligibility (contamination) rules — DT-U4's own, not CPG-U1's

A candidate case is **held-out-ineligible** if any of the following holds:

- **X1.** Its company or its candidate appears anywhere in `CALIBRATION_CASES` or
  `EXTENDED_CALIBRATION_CASES` at any SHA (the 44 existing cases are development data,
  permanently).
- **X2.** Its industry string equals any of the 16 industry labels present in those arrays
  (`agritech`, `ai_platform`, `coaching`, `crm`, `cybersecurity`, `devtools`,
  `fintech_lending`, `healthtech_ehr`, `hr_ats`, `insurtech`, `legaltech`, `logistics`,
  `marketing_seo`, `meditation`, `mental_wellness`, `proptech`).
- **X3.** Its company or candidate name appears anywhere in the repository at the frozen SHA.
- **X4.** Its industry was named, in writing, by anyone who developed the model, the weights,
  the dataset or this protocol, in the course of scoping DT-U4.
- **X5.** It is the developing organisation, an affiliate, a customer, or a named competitor of
  the developing organisation. (The baseline's treatment of its own organisation as permanently
  contaminated is the right instinct; DT-U4 adopts the *principle* independently and inherits
  no external registry.)

X2 is stricter than "not in the dataset". Without it, a "new" case in `insurtech` would reuse
an industry the weights were already fitted through.

### 5.3 Stratification

Three strata, fixed before the draw:

| Stratum | Content | Purpose |
|---|---|---|
| **S-POS** | Genuine competitors in UNSEEN industries | Recall — can evidence signals qualify without taxonomy support? |
| **S-NEG** | Plausibly retrievable cross-category near-misses in UNSEEN industries | False-positive control — the arm must not buy recall with noise |
| **S-SEEN** | Cases in SEEN industries | Non-inferiority guard — the multi-signal arm must not regress where taxonomy already works |

Negatives must be *near-misses*, not trivially unrelated entities. The existing dataset already
articulates this standard (`competitorCalibrationDataset.ts:6-8`) and DT-U4 should hold to it,
because a stratum of obviously-unrelated negatives makes both arms look good and measures
nothing.

> **DECISION REQUIRED — D-U4-2: S-SEEN size, and whether it is an acceptance basis.**
> - **(a) S-SEEN is diagnostic only** (reported, never a pass/fail gate). Keeps the primary
>   endpoint focused on generalisation; a regression on seen industries would be visible but
>   not blocking.
> - **(b) S-SEEN carries a non-inferiority gate.** Stronger and more honest, but it raises the
>   total labelled count above 60 and adds a second way to fail.
>
> **Consequence:** under (a) a result can be reported as a DT-U4 success while quietly
> regressing the industries the product actually serves.

### 5.4 Draw procedure

1. Independent enumerators build a **pool** of admissible cases from public sources, applying
   §5.1 and §5.2, and record yes/no/**unknown** per criterion. **UNKNOWN never satisfies a
   criterion** (tri-state pattern borrowed from `CPG_U1_PROTOCOL_004.md:198-216` as method
   only; no CPG artefact is used).
2. The pool's manifest is hashed and published **before** the draw.
3. Cases are drawn per stratum by a **publicly verifiable, post-commitment random source**. Any
   scheme is acceptable provided the randomness cannot be known at commitment time and an
   outsider can recompute the draw from published values.
4. **No replacement.** An abandoned or void case is published as void; it is never swapped for
   a more convenient one.

> **DECISION REQUIRED — D-U4-3: randomness source.**
> - **(a) Public-beacon commitment** (the *class* of scheme Protocol-004 uses for CPG-U1, built
>   independently here). Strongest against selection; needs its own tooling, which is
>   engineering work DT-U4 does not yet have.
> - **(b) Operator-held seed, fingerprint published before the draw.** Cheap; verifiable only
>   to the extent the operator's seal is trusted — and the operator is *not* independent.
>
> **Consequence:** under (b) a reviewer may treat the selection as operator-influenced, which is
> the precise criticism F2 already attracted.

---

## 6. Minimum labelled case count

The baseline names the target: **"Seal ≥ 60 independently-labeled new cases"**
(`DEEPTECH_BASELINE_001.md:643`), restated as "Sealed, independently-labeled held-out set"
(`:219`) and as the fix being "new data, not new code" (`:546`).

**Why ≥ 60 and not fewer — the reasoning, kept honest about what it does and does not buy:**

1. **Resolution of the false-positive endpoint.** The safety half of H1 is a statement about the
   false-positive rate. With `n` negatives, the finest non-zero FP rate observable is `1/n`. The
   existing dataset has 24 negatives, so a single false positive is already a 4.2 % rate. A
   stratum of ~30 negatives makes one error ≈ 3 %, which is the coarsest granularity at which a
   "no increase in false positives" claim is worth stating at all.
2. **Both strata must carry their own endpoint.** A pooled 60 that is 55 positives and 5
   negatives cannot support the safety half. 60 is only meaningful as *stratum floors*, which is
   why §6.1 exists.
3. **It exceeds the development set.** At 44 development cases, a held-out set materially
   smaller than the development set invites the objection that the holdout is an afterthought.
4. **What 60 does NOT buy.** It does not deliver a tight confidence interval, and it does not
   support a claim about a *small* difference between arms. A 60-case study can support "the
   multi-signal arm recovers a large fraction of competitors the taxonomy arm misses, without
   adding false positives" and nothing subtler. **Any DT-U4 report must state this limit
   explicitly rather than letting a point estimate imply precision.**

### 6.1 Stratum floors

| Stratum | Floor | Basis |
|---|---|---|
| S-POS | **≥ 30** | Recall denominator; makes one miss ≈ 3 % |
| S-NEG | **≥ 30** | FP denominator; makes one FP ≈ 3 % |
| S-SEEN | ≥ 10 | Regression guard only, subject to D-U4-2 |
| **Total, UNSEEN strata** | **≥ 60** | The baseline's figure, honoured as a floor and not as a target |

> **DECISION REQUIRED — D-U4-4: the size/precision trade-off.**
> - **(a) 60 UNSEEN (30/30).** Meets the baseline. Supports a large-effect claim only.
> - **(b) 100 UNSEEN (50/50).** Roughly halves the width of the interval on each rate and makes
>   a ~5 % FP difference discussable. Costs ~67 % more independent labelling.
> - **(c) 150+ UNSEEN.** Needed before any *threshold* (`qualifyThreshold: 55`,
>   `borderlineThreshold: 40` — `competitorQualificationModel.ts:69-70,103-104`) could be
>   calibrated on held-out data. **DT-U4 at 60 cannot calibrate a threshold**, and the protocol
>   must forbid touching one.
>
> **Consequence of choosing (a) silently:** a later reader will read the point estimates as
> precise. Whichever is chosen, the preregistration states the claim ceiling the size permits.

### 6.2 A hard prohibition, pre-declared

The held-out set **may change no weight, no threshold, no label definition and no line of
code**. If the held-out result is poor, the outcome is recorded as a failure of the current
profile — **not** an occasion to refit. A refit on held-out data destroys the holdout and
recreates F2 one level up. Any refit produces a *new* profile requiring a *new* held-out set.

---

## 7. Who labels — independent humans (H3)

**Label authorship is the whole point of DT-U4.** The existing 44 labels were hand-authored
in-repo by the same party that built the model (`DEEPTECH_BASELINE_001.md:481`). Repeating that
on new data produces a larger confounded dataset, not evidence.

### 7.1 Independence criteria

A labeller is **not independent** if, at any time between the developing organisation's first
product commit and publication of the DT-U4 result, the person:

1. was employed by or engaged (paid or unpaid) by the developing organisation, other than the
   study engagement in item 4;
2. received any payment or benefit from it other than the item-4 fee;
3. holds equity, options or any other interest in it;
4. — *permitted exception:* a fixed study fee, agreed in writing before any material is
   released, **not contingent on any result**, whose agreement hash is recorded;
5. contributed to the model, the weight profiles, the 44-case dataset, this protocol or any
   DT-U4 tooling;
6. is a household member, partner or family member of, or in a reporting relationship with, any
   person in item 5 or with the operator.

"Unknown" is not "no". These are **procedural records, not proof**; if a declaration is later
found false, that labeller's work is non-independent and the finding is published.

### 7.2 Roles and counts

| Role | Count | Constraint |
|---|---|---|
| Operator (custodian; **not independent**) | 1 | Holds no labelling or adjudication role |
| Enumerator | ≥ 1 | Builds the pool; must not have seen either arm's output |
| Labeller | **≥ 2, independent, mutually blind** | Every case labelled by ≥ 2 |
| Label adjudicator | 1, independent | Resolves disagreements; sees neither labeller's identity |

Minimum **4 independent persons**, mutually exclusive roles. Assignment of persons to role
labels is fingerprinted and published **before** the held-out draw, so it cannot be arranged
around the data.

**If independent labellers cannot be obtained:** execution may still occur, but every endpoint
is labelled **UNADJUDICATED**, the evidence rung **cannot exceed Rung 2**, and **no claim of
independent validation may be made**. The design is not weakened to accommodate unavailability.
(Pattern after `CPG_U1_PROTOCOL_004.md:734`; applied independently here.)

---

## 8. Blinding

| What is blinded | From whom | How |
|---|---|---|
| Both arms' predictions | Labellers | Labellers see the (company-context, candidate) pair and public evidence only. Neither arm is run until labels are sealed. |
| The other labeller's label | Each labeller | Separate sheets; no shared tallies |
| Running aggregates and provisional endpoint values | Labellers and adjudicator | Held by the operator |
| Stratum membership (`seen`/`unseen`) and any "expected" label | Labellers | Not in the labelling packet — it is the thing being tested |
| Labeller identity and which labeller gave which label | Adjudicator | Presented as "Label A"/"Label B", assignment derived mechanically from a published value |
| The 44 development cases and every in-sample figure | Labellers and adjudicator | Never in any packet |

**Order of operations is the real blind, and it is non-negotiable:**
**pool → publish manifest → draw → label → seal labels (hash published) → only then run both
arms.** Scoring before sealing makes every downstream blind cosmetic.

**What cannot be hidden:** the candidate's public identity is necessarily visible to a human
labeller. DT-U4 is not blind to *case identity*; it is blind to *model output*. State this, as
a known limitation, rather than implying full blinding.

---

## 9. Preregistration requirements

Registered, hashed and published **before the draw**:

1. This document's final text, with every `DECISION REQUIRED` resolved and the chosen option
   recorded with its rationale.
2. The frozen repository SHA; the exact files and symbols constituting each arm
   (`evaluateMultiSignalQualification` + the named profile id; `taxonomyBaselineDecision`); and
   the **explicit** arguments to be passed to `runCalibration` — recording that its defaults
   (V1, 11 cases; §1.3) are *not* used.
3. The weight profile under test, by id and by value (`multisignal-v2`, the seven weights, both
   thresholds), so no post-hoc substitution is possible.
4. The UNSEEN determination procedure (§5.1) and the taxonomy SHA.
5. The ineligibility rules X1–X5, verbatim.
6. Stratum definitions and floors; D-U4-4's chosen size.
7. The randomness scheme (D-U4-3) and its commitment.
8. The primary endpoint, its threshold, and the outcome vocabulary — all before any label
   exists.
9. The abstention rule (§11) and the decision mapping (`qualified` only counts as positive;
   `borderline` does not — §1.3).
10. The personnel register fingerprint (§7.2) and the independence declarations.
11. The no-refit prohibition (§6.2).
12. **A pre-declared "we were wrong" statement**: the exact sentence to be published if the
    result falsifies the claim (§14). Writing it in advance removes the temptation to
    re-narrate afterwards.

Nothing in items 1–12 may be edited after the draw. An amendment before the draw is permitted,
published as an amendment with its own hash, and states why.

---

## 10. Primary endpoint and threshold

Computed over the **UNSEEN strata only** (S-POS ∪ S-NEG), per arm, from the sealed labels.

| ID | Metric | Definition |
|---|---|---|
| **G-U4** | **Assessability gate** | S-POS ≥ 30 labelled and adjudicated **and** S-NEG ≥ 30, and ≥ 90 % of drawn cases fully labelled. Below → **INCONCLUSIVE**, checked first. |
| **P-U4-1** | **Recall gain (PRIMARY)** | `recall(multi-signal) − recall(taxonomy-only)` on S-POS, where `recall = TP / (TP + FN)` and `TP` requires `decision === 'qualified'` |
| **P-U4-2** | **False-positive non-inferiority (PRIMARY, co-equal)** | `FPR(multi-signal) ≤ FPR(taxonomy-only) + δ` on S-NEG, `FPR = FP / (FP + TN)` |
| **S-U4-1** | Precision, per arm | Diagnostic; always reported beside P-U4-1 |
| **S-U4-2** | Borderline rate | Fraction of S-POS ∪ S-NEG scored `borderline`; the abstention band's size |
| **S-U4-3** | Per-industry breakdown | Diagnostic; **never** an acceptance basis (per-industry n is far too small) |
| **S-U4-4** | S-SEEN confusion matrices, both arms | Regression guard; acceptance role subject to D-U4-2 |

**Both P-U4-1 and P-U4-2 must be met.** Either alone is meaningless: recall without FP control
is just a looser gate, and FP control without recall is just the taxonomy arm.

> **DECISION REQUIRED — D-U4-5: the two thresholds.**
> - **Recall-gain minimum.** (a) **+0.20** — a clearly large effect, credible at n=30 per
>   stratum, and the honest ceiling of what 60 cases can show. (b) **+0.10** — a more modest
>   claim, but at n=30 a +0.10 difference sits within sampling noise and would not survive a
>   reviewer; not recommended at (a)-size. (c) **> 0, any gain** — unsupportable; reject.
> - **FP tolerance δ.** (a) **δ = 0** — the multi-signal arm may not add a single false positive.
>   Strictest; matches the harness's stated goal of "no increase in false positives"
>   (`competitorQualificationCalibration.ts:8`); one unlucky near-miss fails the run.
>   (b) **δ = 0.05** — one additional FP in 30 negatives tolerated; softer but defensible as the
>   FPR resolution floor at n=30. (c) **δ = 0.10** — too loose; two extra FPs pass.
>
> **Consequence:** under a liberal pair the design can "succeed" while the arm is merely a
> looser gate. Under δ = 0 one atypical negative can produce a FAILURE that is real but
> fragile. **Recommended: recall gain ≥ +0.20 with δ = 0.05**, with S-U4-1 precision reported
> beside it — but this is the owner's call and must be fixed before the draw.

---

## 11. Abstention rule for missing evidence

Three distinct things must not be conflated:

1. **Model-internal abstention.** The model already renormalises over signals with coverage
   (`competitorQualificationModel.ts:55-58`). This is *arm behaviour* and stays untouched.
2. **The borderline band.** `borderlineThreshold: 40` to `qualifyThreshold: 55`
   (`:69-70,103-104`). `runCalibration` already treats `borderline` as **not** a positive
   prediction (`competitorQualificationCalibration.ts:381-383`). DT-U4 **preserves** that
   mapping and registers it. A borderline case on a true competitor is a **FALSE NEGATIVE**, not
   an excluded case — otherwise the arm could buy precision by abstaining on everything hard.
   S-U4-2 reports the band's size so a high-abstention "success" is visible.
3. **Labeller-side insufficiency.** Where public evidence is insufficient for an independent
   labeller to decide, the label is **`EVIDENCE-INSUFFICIENT`**. Such a case is:
   - **excluded from every endpoint denominator**;
   - **counted and published** — the count is part of the result, never a silent drop;
   - **never converted** into a positive or negative by anyone, including the adjudicator;
   - **never replaced** by a fresh draw (§5.4/4).

**Guard against exclusion abuse — pre-declared:** if `EVIDENCE-INSUFFICIENT` exceeds **20 %** of
drawn UNSEEN cases, the run is **INCONCLUSIVE**, because at that rate the surviving cases are a
convenience sample. Recorded as a §12 condition.

---

## 12. Validity, dispositions and run-level INCONCLUSIVE

**Per-case dispositions:** `SCORED`, `EVIDENCE-INSUFFICIENT` (§11.3),
`LABEL-CONFLICT-UNRESOLVED` (adjudicator could not decide; excluded, published), `VOID`
(ineligibility discovered after the draw; excluded, published, not replaced).

**The run is INCONCLUSIVE if any of:**

- G-U4 fails (stratum floors or the 90 % labelling completeness);
- `EVIDENCE-INSUFFICIENT` > 20 % of drawn UNSEEN cases;
- fewer than 2 independent labels on ≥ 10 % of scored cases;
- inter-labeller agreement below the §12.1 floor;
- any arm's code, weights or thresholds changed between registration and execution (SHA
  mismatch);
- the draw cannot be recomputed from the published randomness commitment.

### 12.1 Inter-labeller agreement

Labels are binary-nominal (`competitor` / `not-competitor`) plus the non-scored
`EVIDENCE-INSUFFICIENT`. Report **Krippendorff's α (nominal)** over the scored labels with a
floor of **≥ 0.667** — the conventional floor for tentative conclusions — and report per-class
agreement beside it. Below the floor → INCONCLUSIVE, because the "ground truth" is not a shared
construct and neither arm can be scored against it.

> **DECISION REQUIRED — D-U4-6: α floor.** (a) **0.667** (tentative-conclusion floor;
> recommended). (b) **0.80** (strong agreement; a real risk of an INCONCLUSIVE run on a
> genuinely hard task — "is this firm a competitor?" is legitimately contestable at the margin).
> **Consequence:** too low a floor lets noisy labels masquerade as truth; too high a floor may
> render DT-U4 unexecutable at acceptable cost.

---

## 13. Outcome vocabulary — exactly one word per run

Evaluated in this order:

| Outcome | Condition |
|---|---|
| **INCONCLUSIVE** | Any §12 condition. Checked **first**, before any endpoint is looked at. |
| **FALSIFIED** | Conclusive, and `FPR(multi-signal) > FPR(taxonomy-only) + 2δ`, **or** recall gain ≤ 0 (the multi-signal arm is no better, or worse, at recall). Published as evidence **against** the generalisation claim. |
| **FAILURE** | Conclusive, not falsified, and either primary endpoint missed — **explicitly including a near miss.** A near miss is a failure. |
| **SUCCESS** | G-U4 holds and **both** P-U4-1 and P-U4-2 are met. |

**What a SUCCESS licenses, and nothing more:** "On 60+ independently labelled cases from
industries outside the taxonomy vocabulary at SHA *X*, drawn by a published random procedure and
labelled by independent labellers blind to both arms, the multi-signal profile `multisignal-v2`
recovered materially more genuine competitors than the taxonomy-only gate without increasing the
false-positive rate."

**What a SUCCESS does NOT license:** any claim about production behaviour (the arm is flag-dark
— §1.4); any claim that a threshold is calibrated (§6.2, D-U4-4(c)); any claim about industries
not sampled; any precise effect size (§6/4); any retrospective rehabilitation of the in-sample
F1 = 1.0 figure, which remains in-sample forever.

---

## 14. What would falsify the claim — named explicitly

The claim under test is: *the multi-signal qualification model generalises to unseen industries
better than the taxonomy-only gate.* It is **falsified** by any of:

1. **F-1 — No recall gain.** Recall gain ≤ 0 on S-POS. The evidence signals do not recover
   competitors the taxonomy gate misses, and the design's central premise
   (`competitorQualificationCalibration.ts:7-8`, "unseen industries qualify correctly on
   evidence (taxonomy abstains)") is wrong.
2. **F-2 — Recall bought with false positives.** FPR(multi-signal) > FPR(taxonomy-only) + 2δ.
   The arm is a looser gate, not a better one. This directly contradicts the second stated goal
   (`:9`, "no increase in false positives vs the live taxonomy gate").
3. **F-3 — In-sample perfection does not survive.** Any material out-of-sample error rate
   falsifies the *implied* reading of F1 = 1.0. Concretely: a held-out F1 materially below 1.0
   is *expected* and is not itself a failure of DT-U4 — but it permanently retires the 1.0
   figure from every external document. **Pre-commit to that retirement in the registration.**
4. **F-4 — Seen-industry regression.** S-SEEN shows the multi-signal arm worse than the taxonomy
   arm. Even a passing UNSEEN result would then be a net loss for the product (acceptance weight
   per D-U4-2).
5. **F-5 — Non-generalisable structure.** Recall gain concentrated in one or two sampled
   industries with no gain elsewhere. **S-U4-3 makes this visible but cannot adjudicate it at
   n≈4 per industry** — so it is a *declared interpretive limit*, not a pass/fail rule, and the
   report must show the per-industry table rather than only the pooled number.
6. **F-6 — Label instability.** α below floor (D-U4-6). Not a falsification of the model, but a
   falsification of the *study*: the run is INCONCLUSIVE and no claim may be made.

**Pre-declared sentence to publish on falsification** (registration item 12 — draft; the owner
finalises the wording):

> "On independently labelled held-out cases from industries outside the taxonomy vocabulary, the
> multi-signal competitor qualification profile did **not** generalise better than the
> taxonomy-only gate. The previously reported in-sample precision/recall/F1 = 1.0 figures are
> in-sample by construction and are withdrawn from all external use. No calibration claim is made
> for this model."

---

## 15. DECISION REQUIRED — consolidated

| ID | Decision | Alternatives | If chosen silently |
|---|---|---|---|
| **D-U4-1** | Candidates per company context | (a) 1 per context (b) 1+1 block (c) variable | Pooled uncertainty wrong by an unknown factor |
| **D-U4-2** | S-SEEN size and whether it gates | (a) diagnostic (b) non-inferiority gate | A "success" can hide a regression on served industries |
| **D-U4-3** | Randomness source for the draw | (a) public beacon commitment (b) operator seed + published fingerprint | Selection is reviewable as operator-influenced |
| **D-U4-4** | Held-out size vs precision | (a) 60 (b) 100 (c) 150+ | Point estimates read as precise; threshold calibration attempted illegitimately |
| **D-U4-5** | Recall-gain minimum and FP tolerance δ | gain: +0.20 / +0.10 / any; δ: 0 / 0.05 / 0.10 | A looser gate passes as a better one |
| **D-U4-6** | Krippendorff α floor | (a) 0.667 (b) 0.80 | Noisy labels pass as truth, or the study becomes unexecutable |

---

## 16. Status

| Item | State |
|---|---|
| Comparison arm exists in code | **VERIFIED** — `competitorQualificationCalibration.ts:330-345` |
| F2 confound reproduces | **VERIFIED** — `competitorCalibrationAnalysis.test.ts:26,42,99-100` |
| Zero holdout constructs repo-wide | **VERIFIED** |
| Dataset size 11 + 33 = 44 (baseline says 14 + 33 = 47) | **VERIFIED — baseline correction** |
| Multi-signal arm in production | **NO** — flag-dark; `competitorQualificationShadow.ts:31`, `competitorQualificationRouter.ts:29-32` |
| Held-out set | **DEFERRED** — needs H3 labellers; none exist |
| Any DT-U4 evidence | **NONE.** Rung 1. No held-out result exists. |
| This design executed | **NOT RUN** |
