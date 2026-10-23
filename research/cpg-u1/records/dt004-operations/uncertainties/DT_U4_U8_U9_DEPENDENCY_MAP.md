# DT_U4_U8_U9_DEPENDENCY_MAP — what can be built now, and what waits on a human

**Artefact class: PREPARATION.**
A dependency analysis. It builds nothing, schedules nothing, commits nothing and produces no
evidence. No model, API or network call was made in producing it.

**Stream:** DEEPTECH-PARALLEL-004, Stream U (uncertainties H/I/J).
**Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18` (disposable worktree `C:/tmp/dt4-uncert`).
**Companion documents:** `DT_U4_HELD_OUT_DESIGN.md`, `DT_U8_PROTOCOL_DRAFT.md`,
`DT_U9_COUNTERFACTUAL_DESIGN.md` — same directory.

---

## 0. NAMING DISCIPLINE

**DT-U4, DT-U8 and DT-U9 are the DEEPTECH baseline's uncertainties
(`DEEPTECH_BASELINE_001.md:643,647,648`). They are NOT CPG-U4, CPG-U8 and CPG-U9, which are
CPG-U1 Protocol-004 §16's boundary statements for a different system
(`research/cpg-u1/CPG_U1_PROTOCOL_004.md:872-897`).** The numbering collision is coincidental and
has no shared content. This document concerns the DT- series only, reuses no CPG-U1 artefact, and
neither reads nor writes anything under `research/cpg-u1/**`.

**Evidence position for all three: Rung 1 (engineering proof), no held-out result, no independent
evaluation.** Nothing in this stream constitutes evidence.

---

## 1. Human-dependency classes used here

| Class | Meaning |
|---|---|
| **H0** | No human input at all. Pure code, pure analysis, pure documents. Any agent can complete it. |
| **H1** | Needs the **operator** (the owner) only — a decision, an approval, a credential, a budget, a data-access permission. No external person. |
| **H3** | Needs an **independent human** — someone satisfying the independence criteria (not employed by, engaged by, financially interested in, or related to the developing organisation, and who has not read the relevant source). Recruitment, contracting and payment are external to the repository. |

**H3 is the binding constraint on all three uncertainties.** No amount of engineering removes it,
because what each uncertainty lacks is *an external reference* — labels, ratings or judgments
produced by someone who did not build the thing being measured.

---

## 2. Summary table

| | **DT-U4** | **DT-U8** | **DT-U9** |
|---|---|---|---|
| Question | Does qualification generalise to unseen industries? | Do deterministic quality scores track human judgment? | Does the deterministic stack beat direct model invocation? |
| Comparison arm exists today | **YES** — `competitorQualificationCalibration.ts:330-345` | N/A (correlational, not comparative) | **NO** — BG-01, `DEEPTECH_BASELINE_001.md:892` |
| Scorer/model exists today | YES, flag-dark | YES, **live and user-visible** | YES (treatment); control does not exist |
| New engineering needed before humans | **Minimal** | **Small** (packet builder) | **Substantial** (E1–E7) |
| H3 role needed | Labellers (≥ 2) + adjudicator + enumerator | Raters (≥ 2–3) + adjudicator | Judges (≥ 2) + adjudicator + independent prompt author |
| H1 gates | Thresholds, sample size, randomness scheme, budget | Content provenance, tenant-data exposure, scale, floors, budget | Control definition, task set, credential, spend cap, MDD, budget |
| Depends on CPG-U1 finishing | **NO** (§5) | **NO** (§5) | **NO** (§5) |
| Cheapest to a defensible result | **1st** | 2nd | 3rd |
| Highest consequence if left unmeasured | 3rd — arm is dark | **1st — the score is already shown to users and feeds predictions** | 2nd — it is the DPIIT thesis |

Two orderings disagree, and both are correct: **DT-U4 is the cheapest path to a real rung**, while
**DT-U8 has the most immediate product exposure** because the quality engine is live
(`pages/api/content/[id]/quality.ts`) and its output feeds `predictionEngine.ts:31`. The baseline's
own sequencing advice puts the U4 held-out set on a separate track precisely because it needs data
rather than engineering (`DEEPTECH_BASELINE_001.md:921`).

---

## 3. DT-U4 — dependency breakdown

### 3.1 H0 — buildable now, zero human input

| ID | Work | Why it is H0 |
|---|---|---|
| U4-H0-1 | **Enumerate the taxonomy vocabulary** at a frozen SHA: the full set of categories `normalizeCompetitorCategory` can return, and the `categoryAffinity` relation over them | Pure functions in `backend/services/competitorTaxonomy.ts`; offline; no network |
| U4-H0-2 | **Implement the UNSEEN determination procedure** (`DT_U4_HELD_OUT_DESIGN.md` §5.1) as a pure function over a public company description | Mechanical; replaces the self-asserted `coverage` literal |
| U4-H0-3 | **Audit the existing 44 cases**: per-case coverage, label, industry; confirm the 11 + 33 = 44 count; produce the ineligibility lists X1/X2 (`§5.2`) as data | Already done descriptively in `DT_U4_HELD_OUT_DESIGN.md` §2.1; the machine-readable form is H0 |
| U4-H0-4 | **A held-out evaluation harness** that takes an external labelled case file and runs both arms with **explicit** arguments (V2 profile, supplied cases), given that `runCalibration`'s defaults are V1 + 11 cases (`competitorQualificationCalibration.ts:367-368`) | Both arms already exist; this is plumbing |
| U4-H0-5 | **A repository-name contamination scanner** for X3 | Pure repo scan |
| U4-H0-6 | **Endpoint calculators** for P-U4-1, P-U4-2, S-U4-1..4 and Krippendorff's α | Pure arithmetic |
| U4-H0-7 | **The preregistration document template** with every field of §9 present and unfilled | Document work |

**None of U4-H0-1..7 exists at `af2fb6e9`.** None is implemented by this stream (design only).

### 3.2 H1 — operator only

| ID | Decision or input | Companion reference |
|---|---|---|
| U4-H1-1 | Resolve D-U4-1 (candidates per context) | §4 |
| U4-H1-2 | Resolve D-U4-2 (S-SEEN size; gating or diagnostic) | §5.3 |
| U4-H1-3 | Resolve D-U4-3 (randomness scheme) | §5.4 |
| U4-H1-4 | Resolve D-U4-4 (60 vs 100 vs 150+) — **this is the budget decision** | §6.1 |
| U4-H1-5 | Resolve D-U4-5 (recall-gain minimum, FP tolerance δ) | §10 |
| U4-H1-6 | Resolve D-U4-6 (α floor) | §12.1 |
| U4-H1-7 | Approve the labelling budget and the fixed, result-independent fee structure | §7.1 item 4 |
| U4-H1-8 | Sign the registration and publish its hash | §9 |
| U4-H1-9 | Accept the no-refit prohibition in writing | §6.2 |

### 3.3 H3 — independent humans

| Role | Count | What they do | Blocking |
|---|---|---|---|
| Enumerator | ≥ 1 | Build the admissible pool from public sources under X1–X5 | Blocks the draw |
| Labeller | **≥ 2** | Label each case `competitor`/`not-competitor`/`EVIDENCE-INSUFFICIENT`, blind to both arms | **Blocks every endpoint** |
| Label adjudicator | 1 | Resolve disagreement on a blinded packet | Blocks final labels |

Minimum **4 independent persons**. **None is identified, contracted or recruited. This document
invents none.**

### 3.4 Earliest defensible result

```
U4-H0-1..7 (engineering, parallel)      ──┐
U4-H1-1..9 (operator decisions)         ──┼─→ registration published
                                          │
H3 recruitment + independence declarations┘
        ↓
pool built (enumerator) → manifest hashed → draw → labelling (≥2) → adjudication
        ↓
labels sealed and hashed → arms run → endpoints computed → outcome word
```

**Earliest defensible result = the moment ≥ 4 independent persons have completed pool
construction, labelling and adjudication on ≥ 60 cases, after a published registration.** The
engineering (H0) is small and is not the critical path; **recruitment and labelling of ~60 cases by
independent people is.** No engineering shortens it.

**What is achievable with zero H3:** a fully registered, fully tooled, fully documented study with
an empty labelled set. That is real preparation and it is **not evidence**. DT-U4 remains at Rung 1
until the labels exist.

---

## 4. DT-U8 — dependency breakdown

### 4.1 H0 — buildable now

| ID | Work | Why it is H0 |
|---|---|---|
| U8-H0-1 | **Freeze and record the scorer identity**: the SHA, `DIMENSION_WEIGHTS` (`qualityEngine.ts:52-65`), the twelve dimensions (`lib/content/quality/types.ts:33-46`), the band boundaries | Registration item 1 of §16.2's pattern: the formula registered **before** it sees any label. Because the formula is code, the SHA *is* the registration |
| U8-H0-2 | **Determinism re-verification harness**: re-evaluate each item and assert byte-identity | Needed for §11.1 condition 1 |
| U8-H0-3 | **A rating-packet builder** (uniform presentation, no engine output, mechanically derived ordering) | Pure |
| U8-H0-4 | **Agreement calculators**: Spearman ρ, quadratic-weighted κ, Krippendorff's α, the S-U8-1..4 diagnostics | Pure arithmetic |
| U8-H0-5 | **Band-boundary extraction**: the exact score→`QualityLabel` mapping, published so raters' bands and the engine's bands are comparable | Reading existing code |
| U8-H0-6 | **A rubric draft** describing each rated construct in outcome terms, deliberately **not** describing the heuristics (`DT_U8_PROTOCOL_DRAFT.md` §4.3 item 3) | Document work — **but see the caveat below** |
| U8-H0-7 | **Floor/guard detector**: flag items where the engine returned `floorScorecard` (`qualityEngine.ts:482`) or a guarded 20 (`:515`) | Pure |

**Caveat on U8-H0-6.** The rubric is *draftable* at H0 but is **not validatable** at H0. Whether it
defines a shared construct is exactly what the §9.2 α floor tests, and that needs H3 raters. A
rubric written by the implementers and never tested is an untested instrument, and
`DT_U8_PROTOCOL_DRAFT.md` §9.2 correctly makes a failing α an *instrument* finding rather than an
engine finding.

### 4.2 H1 — operator only

| ID | Decision or input | Companion reference |
|---|---|---|
| U8-H1-1 | Resolve D-U8-1 (content provenance) | §3.1 |
| U8-H1-2 | **Resolve D-U8-2 (tenant-data exposure to external raters)** — this is a confidentiality decision, not a study-design one, and it is the operator's alone | §3.1 |
| U8-H1-3 | Resolve D-U8-3 (what humans rate: overall / all 12 / subset) | §4.1 |
| U8-H1-4 | Resolve D-U8-4 (scale form) | §4.2 |
| U8-H1-5 | Resolve D-U8-5 (rater count) | §6.1 |
| U8-H1-6 | Resolve D-U8-6 (disagreement trigger) | §8 |
| U8-H1-7 | Resolve D-U8-7 (ρ and κ floors) — **before any data exists** | §9.1 |
| U8-H1-8 | Resolve D-U8-8 (item count vs claim scope) — the budget decision | §10 |
| U8-H1-9 | Approve budget and result-independent fees | §6.2 item 4 |
| U8-H1-10 | Freeze `qualityEngine.ts` and `lib/content/quality/**` for the study window; any change voids the run | §3.2 |
| U8-H1-11 | Accept the §11.3 consequences of a PRECISE-AND-WRONG finding **in advance** | §11.3 |

U8-H1-11 deserves emphasis: pre-accepting the consequences of a negative result is what makes the
study honest. Deciding afterwards is not.

### 4.3 H3 — independent humans

| Role | Count | What they do | Blocking |
|---|---|---|---|
| Rater | **≥ 2 (≥ 3 recommended, D-U8-5)** | Apply the rubric, blind to engine output **and to the engine's source** | **Blocks every endpoint** |
| Rating adjudicator | 1 | Resolve disagreement on a blinded packet | Blocks final ratings |

Minimum **3 independent persons**. **The source-reading prohibition
(`DT_U8_PROTOCOL_DRAFT.md` §6.2 item 5) is a hard eligibility bar specific to DT-U8**: a rater who
has read `scoreReadability` will rate the way the code scores and manufacture agreement.

**None is identified, contracted or recruited. This document invents none.**

### 4.4 Earliest defensible result

```
U8-H0-1..7 ──┐
U8-H1-1..11 ─┼─→ SHA + rubric + floors registered and published
             │
H3 recruitment (raters must not have read the source)
             ↓
content sample drawn and split (CALIBRATION / HELD-OUT) → held-out sealed
             ↓
rating (≥2 raters) → adjudication → ratings sealed and hashed
             ↓
engine run on held-out items → determinism re-check → endpoints → outcome word
```

**Earliest defensible result = after ≥ 3 independent raters complete ~60 items (overall-only claim,
D-U8-8(a)) or ~150 items (per-dimension claims, D-U8-8(b)) on a sealed held-out set.**

**Two non-engineering items can delay this more than the rating itself:** D-U8-2 (tenant data) may
require per-tenant consent, and D-U8-1(b) content generation is itself work.

---

## 5. DT-U9 — dependency breakdown

### 5.1 H0 — buildable now (the largest H0 block of the three)

| ID | Work | Class in the companion doc |
|---|---|---|
| U9-H0-1 | **Direct-invocation module** — registered prompt template + task inputs → pinned model, registered parameters → raw output + usage | E1 |
| U9-H0-2 | **Task-set definition and loader**, stratified on content type, platform, context richness and duplicate pressure | E2 |
| U9-H0-3 | **Two-arm run harness** with per-item provenance (arm id, model id, parameters, prompt hash, timestamps) | E3 |
| U9-H0-4 | **Cost/latency instrumentation** — total model calls, tokens, wall-clock, regeneration attempts | E4 |
| U9-H0-5 | **Gate-execution telemetry** — did the cascade run or bypass (`originalityGate.ts:25-28`), which stage terminated | E5 |
| U9-H0-6 | **Output archive** with hashes, in a non-production store | E6 |
| U9-H0-7 | **Blinded judging-packet builder** — strip arm identity, normalise presentation, derive ordering mechanically | E7 |
| U9-H0-8 | **Model pinning**: replace env-resolved model selection (`blueprintGenerator.ts:134,502,596`; `platformVariantGenerator.ts:141,570`) with an explicitly registered literal **for the experiment path only** — never a change to the production default | — |
| U9-H0-9 | **Endpoint calculators**: win rate, κ/α, tie rate, variance and duplicate-avoidance measures, cost/latency rollups | — |
| U9-H0-10 | **Resume detector**: flag items where `runAiExecution` resumed (`aiExecutionRuntime.ts:11-17`) so cost endpoints are not silently zeroed | — |

**Note on U9-H0-1:** writing the module is H0; **authoring the control prompt is not** — under
D-U9-3(b) that is H3 (an independent prompt author). The module accepts a prompt; it does not
author one.

**Note on the mock path:** `CERT_AI_MOCK` is referenced only in `.env.cert.example:23,26` and no
code at `af2fb6e9` reads it, so there is **no deterministic stub arm** to build on. Any H0 harness
that assumed one would be wrong.

**None of U9-H0-1..10 exists at `af2fb6e9`. None is implemented by this stream.**

### 5.2 H1 — operator only

| ID | Decision or input | Companion reference |
|---|---|---|
| U9-H1-1 | Resolve D-U9-1 (treatment arm entry point) | §3.2 |
| U9-H1-2 | **Resolve D-U9-2 (which control arm[s])** — the definition of "direct model invocation" is the owner's call and determines the whole result | §4.1 |
| U9-H1-3 | Resolve D-U9-3 (who authors the control prompt) | §4.3 |
| U9-H1-4 | Resolve D-U9-4 (company contexts; possible confidentiality question) | §6.1 |
| U9-H1-5 | Resolve D-U9-5 (repeats per arm) | §6.2 |
| U9-H1-6 | Resolve D-U9-6 (endpoint form) | §7.1 |
| U9-H1-7 | Resolve D-U9-7 (MDD and therefore scale) — the budget decision | §7.2 |
| U9-H1-8 | Resolve D-U9-8 (κ floor) | §7.4 |
| U9-H1-9 | **Resolve D-U9-9 (equal-spend best-of-N control)** — the decision that determines whether a stack win survives the "it just sampled more" objection | §8 |
| U9-H1-10 | **Provision a dedicated non-production model credential with a hard spend cap.** Production credentials never enter the experiment | E8, §4.2 |
| U9-H1-11 | Approve model spend (multiplied by arms × repeats) and judging budget | §6.2, §7.2 |
| U9-H1-12 | Freeze the stack's files for the study window; any change voids the run | §9 |

U9-H1-10 is the one H1 item that is a **hard blocker on any execution at all**: without a
non-production credential and a spend cap, no arm may be run.

### 5.3 H3 — independent humans

| Role | Count | What they do | Blocking |
|---|---|---|---|
| Independent prompt author (if D-U9-3(b)) | 1 | Author the control prompt without seeing the stack's code or output | Blocks generation |
| Judge | **≥ 2** | Blinded preference (and/or absolute rating) | **Blocks every endpoint** |
| Judging adjudicator | 1 | Resolve disagreement on a blinded packet | Blocks final judgments |

Minimum **4 independent persons** (3 if the prompt author role is folded into D-U9-3(a), at the
cost of strawman exposure). **None is identified, contracted or recruited. This document invents
none.**

### 5.4 Earliest defensible result

```
U9-H0-1..10 (substantial engineering)  ──┐
U9-H1-1..12 (incl. credential + spend) ──┼─→ registration published
                                          │
H3: independent prompt author ────────────┘
        ↓
control prompt frozen and hashed → task set frozen → both arms generated
        ↓   (pilot first, if D-U9-9(b): measure stack call count → fix N → never judged)
outputs archived and hashed → blinded packets built
        ↓
judging (≥2) → adjudication → judgments sealed → unblind → endpoints → outcome word
```

**Earliest defensible result = after the E1–E7 engineering is complete, a non-production credential
is provisioned, a control prompt is authored independently, both arms are generated over the frozen
task set, and ≥ 3–4 independent judges complete blinded judging of ~60 items (MDD 0.20) or ~120
items (MDD 0.15).**

**DT-U9 is the longest of the three**, and its critical path is **engineering first, then humans**
— the reverse of DT-U4, whose engineering is small.

---

## 6. Dependency on CPG-U1 finishing — verified, and the answer is none

**Requirement: verify and state whether any of DT-U4, DT-U8 or DT-U9 depends on CPG-U1 finishing.**

**VERIFIED: none of the three depends on CPG-U1 in any way.** The basis, item by item:

| Dependency channel | DT-U4 | DT-U8 | DT-U9 |
|---|---|---|---|
| **Shared code under test** | None. Subject is `backend/services/competitor/qualification/**` | None. Subject is `backend/services/content/qualityEngine.ts` + `lib/content/quality/**` | None. Subject is the content generation stack (`lib/post/**`, `backend/services/content/**`, `backend/services/contentGeneration/**`) |
| **Shared dataset** | No. DT-U4 needs its own competitor cases; CPG-U1's units are companies for profile grounding | No. DT-U8 needs content items | No. DT-U9 needs generation tasks |
| **Shared labels / reference truth** | No. `competitor`/`not-competitor` | No. Content-quality ratings | No. Preference judgments |
| **Shared personnel** | Independent of CPG-U1's roles; DT-U4 recruits its own and may not reuse a CPG-U1 role holder if that would breach its own mutual-exclusion rule | Same | Same |
| **Shared randomness / seeds / commitments** | No — DT-U4 establishes its own (D-U4-3) | Not applicable | Not applicable |
| **Shared tooling** | No — U4-H0-1..7 are new | No — U8-H0-1..7 are new | No — E1–E7 are new |
| **Shared credential** | None needed (both arms are pure, offline functions) | None needed (the engine makes **no AI calls** — `qualityEngine.ts:1-19`) | **Its own** dedicated non-production credential (U9-H1-10); never CPG-U1's |
| **Shared artefact directory** | `research/deeptech-operations/uncertainties/` only | Same | Same |

**One direction of influence exists, and it is methodological only, not a dependency:** CPG-U1's
Protocol-004 §16.2 supplies the *sequencing principle* DT-U8 adopts (formula registered before any
label; calibration labels separate from a never-calibrated held-out set), and §16.3 supplies the
*separation rules* DT-U9 adopts (own hypotheses, own prompt/model/parameters, own non-production
credential, never merged into the single-arm study). **A pattern is not a prerequisite.** DT-U8 and
DT-U9 can proceed whether CPG-U1 succeeds, fails, is inconclusive, or never runs.

**Two genuine couplings exist, and neither is a dependency on CPG-U1 *finishing*:**

1. **Resource contention (H1/H3), not logical dependency.** CPG-U1 requires a minimum of 7
   independent persons (`CPG_U1_PROTOCOL_004.md:180-181`). DT-U4 needs 4, DT-U8 needs 3, DT-U9
   needs 3–4. If the same recruitment budget and the same operator attention serve all four
   studies, they compete for people, money and the operator's decision time. **That is a
   scheduling constraint for the owner, not a technical prerequisite**, and it should be stated as
   such rather than described as DT-U* "waiting on" CPG-U1.
2. **Do-not-touch, which is a prohibition rather than a dependency.** DT-U9's §11 requires that
   nothing it does modify a file, flag or env var bound by CPG-U1's registered treatment. No such
   overlap is known at `af2fb6e9`. **UNVERIFIED** in the strict sense: no exhaustive cross-check of
   CPG-U1's bound file set against the content stack was performed in this task, because doing so
   would mean reading CPG-U1's registration in detail, which this stream deliberately avoids
   beyond the methodological sections. **If DT-U9 execution is ever scheduled, that cross-check is
   a prerequisite of execution — not of design.**

---

## 7. Cross-cutting dependencies, and one sequencing observation

### 7.1 DT-U8 and DT-U9 share a latent coupling worth knowing

`DT_U9_COUNTERFACTUAL_DESIGN.md` D-U9-6(b) would make DT-U9's primary endpoint an **absolute
quality rating** on a rubric. But **no validated quality rubric exists** — that is precisely what
DT-U8 is for (`DT_U8_PROTOCOL_DRAFT.md` §15: "Human rating instrument — DOES NOT EXIST").

- If DT-U9 chooses **D-U9-6(a) forced-choice preference** (recommended), **no coupling exists** and
  the two studies are fully independent.
- If DT-U9 chooses **D-U9-6(b) or (c)**, it either inherits DT-U8's rubric — creating a real
  ordering constraint, DT-U8 before DT-U9 — or writes its own unvalidated rubric, which weakens
  DT-U9.

**This is a coupling between two DT-U studies, created by a design choice, and it is entirely
within the owner's control. It is not a CPG-U1 dependency.**

### 7.2 A shared H0 opportunity

Three pieces of tooling are needed by more than one study and could be built once:

| Shared component | Used by |
|---|---|
| Agreement statistics (Krippendorff's α, Cohen's κ, Spearman ρ) | DT-U4 (§12.1), DT-U8 (§9), DT-U9 (§7.4) |
| Blinded packet builder with mechanically derived ordering | DT-U4 (§8), DT-U8 (§5), DT-U9 (§6.3) |
| Independence-declaration register and structural checker | All three |

Building these once is legitimate reuse **within** the DT-U series. It must **not** be done by
copying CPG-U1's tooling, and it must not import from, or write into, `research/cpg-u1/**`.

### 7.3 What none of the three can do, ever, without H3

State it plainly, because it is the single most important line in this document:

> **No engineering, no tooling, no registration and no document can produce DT-U4, DT-U8 or DT-U9
> evidence without an independent human. What each uncertainty lacks is an external reference. The
> repository cannot supply one, and a study run by the people who built the system measures the
> system against itself — which is exactly the F2 defect
> (`DEEPTECH_BASELINE_001.md:468-490`) one level up.**

---

## 8. Artefact classification

| Artefact | Class |
|---|---|
| `DT_U4_HELD_OUT_DESIGN.md` | **PREPARATION** |
| `DT_U8_PROTOCOL_DRAFT.md` | **PREPARATION** |
| `DT_U9_COUNTERFACTUAL_DESIGN.md` | **PREPARATION** |
| `DT_U4_U8_U9_DEPENDENCY_MAP.md` (this file) | **PREPARATION** |
| U4-H0-1..7, U8-H0-1..7, U9-H0-1..10 (E1–E7) | **ENGINEERING ARTIFACT** — none built; all **DEFERRED** |
| Every H1 decision | **HUMAN-REQUIRED INPUT** (operator) — all **BLOCKED** pending the owner |
| Every H3 role and its output | **HUMAN-REQUIRED INPUT** (independent) — all **BLOCKED**; no person identified |
| A published registration | **REGISTERED EVIDENCE** — none exists |
| A completed run's outputs | **EXECUTION EVIDENCE** — none exists |
| Computed endpoints and an outcome word | **ANALYTICAL RESULT** — none exists |

**Nothing in this stream is anything other than PREPARATION.**

---

## 9. Status

| Item | State |
|---|---|
| DT-U4 comparison arm exists in code | **VERIFIED** |
| DT-U8 scorer exists, is live, and is user-visible | **VERIFIED** |
| DT-U9 counterfactual arm exists | **NO — it does not exist** (BG-01) |
| Any H0 tooling for any of the three | **DEFERRED** — none built by this stream |
| Any H1 decision resolved | **BLOCKED** — all open; see the consolidated tables in each companion document |
| Any H3 person identified, recruited or contracted | **NONE.** No labeller, rater, judge, adjudicator, enumerator or prompt author exists or is named |
| Dependency on CPG-U1 finishing | **VERIFIED: none** (§6) |
| CPG-U1 artefacts read, written or reused | **NONE** — Protocol-004 was read as a methodological pattern only; nothing under `research/cpg-u1/**` was modified |
| Any DT-U4 / DT-U8 / DT-U9 evidence | **NONE. All three at Rung 1. No held-out result exists for any of them.** |
| Anything executed in this stream | **NOT RUN** |
