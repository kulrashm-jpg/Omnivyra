# u4u8 — DT-U4 held-out harness and DT-U8 rating instrument

**Artefact class of this file: PREPARATION.** It indexes and classifies the artefacts in
this directory. It registers nothing, executes nothing and reports no study result.

**Stream:** DEEPTECH-PARALLEL-005, TASK U2. **Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18`
(disposable worktree `C:/tmp/dt5-u4`, detached). **Designs implemented (not rewritten):**
`C:/tmp/dt004-operations/uncertainties/DT_U4_HELD_OUT_DESIGN.md`, `DT_U8_PROTOCOL_DRAFT.md`,
`DT_U4_U8_U9_DEPENDENCY_MAP.md`.

## Evidence position, stated once

**DT-U4 and DT-U8 remain at Rung 1. There is no held-out result, no rating, no labeller and
no rater.** Everything here is H0 tooling from the dependency map (U4-H0-1/2/3/6, U8-H0-1/3/4/5).
No engineering removes the H3 constraint: what both uncertainties lack is an external reference.

The coverage audit is a **finding about the existing fixtures' labels**. It is never evidence
about the model, and it does not make the 44-case dataset a held-out set.

## Artefacts and classification

| Path | Class | State |
|---|---|---|
| `README.md` (this file) | PREPARATION | IMPLEMENTED |
| `lib/pinned_source.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED by tests |
| `lib/params.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED |
| `unseen_determiner.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED |
| `coverage_audit.mjs` | ENGINEERING ARTIFACT (its output is a FINDING about fixtures) | IMPLEMENTED / VERIFIED |
| `holdout_split.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED |
| `endpoint_calc.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED |
| `quality_rating_packet.mjs` | ENGINEERING ARTIFACT (an emitted packet is an empty instrument; a **completed** packet would be HUMAN-REQUIRED INPUT) | IMPLEMENTED / VERIFIED |
| `agreement_calc.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED |
| `scorer_identity.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED |
| `tests/u4.test.mjs`, `tests/u8.test.mjs` | ENGINEERING ARTIFACT | IMPLEMENTED / VERIFIED (27 pass, 0 fail) |
| `tests/fixtures/SYNTHETIC_*` | ENGINEERING ARTIFACT (synthetic fixtures, clearly marked) | IMPLEMENTED |
| A published registration | REGISTERED ARTIFACT | **DEFERRED** — none exists |
| A completed run's outputs | EXECUTION EVIDENCE | **NOT RUN** — none exists |
| Endpoints and an outcome word | ANALYTICAL RESULT | **NOT RUN** — none exists |
| Labels, ratings, labellers, raters, adjudicators | HUMAN-REQUIRED INPUT | **BLOCKED** — no person identified; none invented here |
| A DT-U8 rubric | HUMAN-REQUIRED INPUT (draftable at H0, **not validatable** at H0) | **DEFERRED** — not written by this task |

Nothing in this directory is a REGISTERED ARTIFACT, EXECUTION EVIDENCE or ANALYTICAL RESULT.

## What each tool does, and what it refuses

- **`unseen_determiner.mjs`** — the `DT_U4_HELD_OUT_DESIGN.md` §5.1 procedure. Reads
  `backend/services/competitorTaxonomy.ts` at a pinned SHA via `git show`, extracts the ten
  enumerated categories, the twenty positive signal branches, the eighteen functional pairs and
  the out-of-vocabulary fallback, then reports per input: `verdict` (INSIDE/OUTSIDE), the
  vocabulary entries that matched with their matched terms, and the pinned SHA plus a
  `vocabularySha256`. It never reads a `coverage` flag.
- **`coverage_audit.mjs`** — runs the determiner over the existing 44 cases and compares each
  hand-written `coverage` literal against the mechanical verdict. Read-only: product files are
  opened through `git show` and **no fixture is written**.
- **`holdout_split.mjs`** — refuses `F2_OVERLAP` (a case in both parts), `DUPLICATE_WITHIN_PART`,
  `ASSIGNED_ID_NOT_IN_POOL`, `X1_DEVELOPMENT_DATA` and `POOL_CARRIES_OUTCOME_KEYS`. The split is
  derived only from an external assignment list or from `HMAC-SHA256(external seed, case id)` —
  never from case content, labels or model performance. The manifest hashes each part; the seed
  is never printed, only fingerprinted.
- **`endpoint_calc.mjs`** — precision, recall, F1, false-positive count, FPR and the
  taxonomy-baseline comparison. A case with no label, a null label or `EVIDENCE-INSUFFICIENT` is
  `not_evaluated`: excluded from every denominator, counted, never converted to a positive, a
  negative or a zero. An empty denominator yields the string `undefined`. `borderline` is not a
  positive, so a borderline on a true competitor is a FALSE NEGATIVE. No outcome word is emitted
  while any threshold is UNDECIDED, and never for a synthetic input.
- **`quality_rating_packet.mjs`** — a blinded packet: the artefact, the scale, an explicit
  `CANNOT-RATE`, empty rating cells, a per-rater order derived from a published seed. It refuses
  an items file contaminated with engine output, refuses to emit while D-U8-2/3/4 are UNDECIDED,
  and asserts blinding over its own output before writing anything.
- **`agreement_calc.mjs`** — Spearman ρ (P-U8-1), quadratic-weighted Cohen's κ (P-U8-2),
  Krippendorff's α (draft §9.2, and DT-U4 §12.1), plus S-U8-1..4. Refuses below the rater floor;
  reports an undefined statistic as `undefined` with a reason; never imputes a human value.
- **`scorer_identity.mjs`** — the engine's file set, a content hash over it, the twelve
  dimensions with weights, the band boundaries (85/70/50, fallback `poor`), the guarded-degrade
  score (20) and the repository SHA. It does not import, run or modify the engine.

## Parameters and the open decisions they map to

Every quantity a design leaves open is a parameter defaulting to `UNDECIDED`
(`lib/params.mjs`). **Supplying a value at invocation does not resolve the decision**; it is
recorded as `operatorSuppliedAtInvocation`, and tests record `synthetic-fixture-override`.

| Open decision | Parameter(s) | Enforced by |
|---|---|---|
| **D-U4-1** candidates per company context | `candidatesPerContext` | recorded in the split manifest; clustering note in endpoints |
| **D-U4-2** S-SEEN size / gating | `sSeenRole`, `sSeenFloor` | S-U4-4 carries no acceptance role while open |
| **D-U4-3** randomness source | `randomnessSource` | split mode recorded; listed as open in the manifest |
| **D-U4-4** held-out size | `sPosFloor`, `sNegFloor` | G-U4 floors are UNASSESSABLE while open |
| **D-U4-5** recall-gain minimum, FP tolerance δ | `recallGainMin`, `fpTolerance` | P-U4-1 / P-U4-2 UNASSESSABLE while open; no outcome word |
| **D-U4-6** Krippendorff α floor | `alphaFloor` | label agreement reported without a verdict while open |
| **D-U8-1** content provenance | `contentProvenance` | recorded in the packet |
| **D-U8-2** tenant-data exposure | `tenantDataPolicy` | **packet emission REFUSED while open** |
| **D-U8-3** what humans rate | `ratedConstructs` (+ `--subset`) | packet REFUSED while open; subset never chosen by the tool |
| **D-U8-4** scale form | `scaleForm` | packet and agreement REFUSED while open; κ requires a band scale |
| **D-U8-5** rater count | `raterFloor`, `humanReference` | agreement REFUSED below the floor and while open |
| **D-U8-6** disagreement trigger | `disagreementTrigger`, `humanReference` | conflict cells excluded, never averaged |
| **D-U8-7** ρ and κ floors | `rhoFloor`, `kappaFloor` | no floor comparison and no outcome word while open |
| **D-U8-8** item count vs claim scope | `itemCountTarget` | recorded in the packet; G-U8 item floor |

Pre-declared in the designs (**not** open decisions, defaulted here to the design's value):
`labellingCompleteness` 0.90, `evidenceInsufficientMax` 0.20, `borderlineCountsPositive` false,
`interRaterAlphaFloor` 0.667, `cannotRateMax` 0.20, `leakageAlarmRho` 0.95,
`ratingCompleteness` 0.90. Environment, not a study decision: `taxonomyP0` (`on`).

## Findings produced by implementation

1. **Two existing fixtures' `coverage` literals disagree with the mechanical verdict.**
   `x-healthtech-true` and `x-healthtech-wellness-neg` (`industry: 'healthtech_ehr'`, literal
   `coverage: 'unseen'`) resolve to the in-vocabulary category `therapy_marketplace`, because the
   `HEALTHTECH_EHR` context text contains "clinical", which the taxonomy's therapy branch matches.
   Mechanical verdict: **INSIDE**. Agreement over the 44 cases is 42/44 (95.45 %).
   **Reported, not repaired: no fixture was modified.**
2. **The `positive / negative` column of `DT_U4_HELD_OUT_DESIGN.md` §2.1 is wrong.** Counted at
   `af2fb6e9`: `CALIBRATION_CASES` = 5 positive / 6 negative (the design says 4 / 7), so the
   combined total is 21 / 23, not 20 / 24. The 11 / 33 / 44 sizes and the 18 seen / 26 unseen
   split are **correct as published**. This changes no conclusion (`ALL.length >= 40` and the
   ≥ 18/≥ 18 guards still hold), but a corrections section with a wrong number invites the same
   criticism it makes. See DECISION REQUIRED below.
3. **§5.1 clause 3b is unreachable on its own.** Whenever `normalizeCompetitorCategory` returns
   an in-vocabulary category, `categoryAffinity(c, c)` is `same`, so "no `same`/`functional`
   affinity against any in-vocabulary category" can only hold when the category is `unknown` —
   i.e. when clause 3a has already fired. The determination therefore reduces to clause 3a.
   Both clauses are implemented and reported separately so the redundancy is visible.
4. **The mechanical UNSEEN determination depends on `COMPETITOR_TAXONOMY_P0`.** With the flag
   off, the fallback is `marketing_seo_software` (an in-vocabulary category), so nothing can ever
   be determined UNSEEN. `--taxonomyP0=off` reproduces this and the tool emits it as a finding.
5. **X2's industry list reproduces.** The 16 distinct industry strings in the two arrays are
   exactly the 16 the design lists.

## DECISION REQUIRED (not resolved here)

- **New, from finding 2 — amend `DT_U4_HELD_OUT_DESIGN.md` §2.1?** Its positive/negative figures
  (4 / 7 and 20 / 24) do not match the code (5 / 6 and 21 / 23). The design document is a
  companion PREPARATION artefact owned by another task and **was not edited**. The owner decides
  whether to amend it, and whether the amendment is published with its own hash.
- **New, from finding 3 — is §5.1 clause 3b intended to be redundant?** If a stricter test was
  intended (for example, affinity of a *candidate's* category against the company's, rather than
  of the resolved category against itself), §5.1 needs a wording change before registration.
- All of D-U4-1..6 and D-U8-1..8 remain open, parameterised as tabled above. None was resolved,
  defaulted to a recommendation, or worked around.

## Running the tools

```
node unseen_determiner.mjs --industry=<s> --description="<s>"     # or --input=<json> / --vocabulary
node coverage_audit.mjs [--out=<file>]
node holdout_split.mjs --pool=<json> --mode=list --assignment=<json>
node holdout_split.mjs --pool=<json> --mode=seed --seed-file=<file> --eval-fraction=0.5
node endpoint_calc.mjs --cases=<json> [--recallGainMin=.. --fpTolerance=.. --sPosFloor=.. --sNegFloor=..]
node quality_rating_packet.mjs --items=<json> --raters=<h1,h2,h3> --order-seed-file=<file> \
     --scaleForm=engine-4-band --ratedConstructs=overall-only --tenantDataPolicy=<policy> [--rubric=<file>]
node agreement_calc.mjs --ratings=<json> [--engine=<json>] --raterFloor=3 \
     --humanReference=adjudicated-only --scaleForm=engine-4-band
node scorer_identity.mjs [--sha=<rev>]
node --test tests/u4.test.mjs tests/u8.test.mjs
```

## Constraints honoured

No model call, no network call, no production access. No product code, fixture or
`DEEPTECH_BASELINE_001.md` modified. Nothing read from or written to `research/cpg-u1/**` or
`C:/tmp/dt002`. No commit, push or PR. No labeller, rater, label, rating or result invented.
The worktree `C:/tmp/dt5-u4` is **DISPOSABLE**.
