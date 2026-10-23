# DEEPTECH_U1_PREREGISTRATION_001

**Pre-registered evaluation protocol for Technical Uncertainty U1 — grounded vs. ungrounded generation.**

> **NO U1 OUTPUT HAS BEEN GENERATED.** At the time of this registration, zero model outputs exist for either arm, no model API has been called, no human rating has occurred, and no efficacy result of any kind exists. This document fixes the criteria **before** data collection so that they cannot be retrofitted around observed results.

---

## 0. Identity & Immutability

| Field | Value |
|---|---|
| Protocol ID | `DEEPTECH-U1` |
| **Protocol version** | **`u1-001`** |
| **Content fingerprint** | **`b204e168`** (FNV-1a 32-bit over the canonical criteria serialisation) |
| Repository SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| Branch | `preserve/creator-canonical-template-pool` |
| Date of pre-registration | 2026-09-10 |
| Machine-readable twin | `backend/evaluation/canonicalGrounding/u1Protocol.ts` |
| Scorer | `backend/evaluation/canonicalGrounding/u1Scorer.ts` |
| Predecessors | `DEEPTECH_BASELINE_001.md` (DT-A1) · DT-C1 control arm |

### 0.1 Immutability rule (binding)

1. Version `u1-001` is **frozen**. Once any U1 run executes against it, no metric definition, endpoint, acceptance rule, effect-size threshold, statistical treatment or exclusion rule in it may be edited in place.
2. Any change requires a **new version** (`u1-002`, …) created as a **new file**. The prior version is never overwritten and never deleted.
3. Every results artifact must record the `protocolVersion` **and** `protocolFingerprint` it was scored under. A results file whose fingerprint does not match the protocol it cites is invalid on its face.
4. The fingerprint covers **criteria only**, not metadata — so correcting a date or a comment does not silently invalidate it, while changing a threshold necessarily does. Verified: editing `PROTOCOL_REGISTERED_ON` left `b204e168` unchanged.
5. **Criterion drift is therefore detectable by comparison**, which is the entire purpose of this document.

Verify the fingerprint:
```bash
npx tsx -e "import('./backend/evaluation/canonicalGrounding/u1Protocol').then(p=>console.log(p.protocolFingerprint()))"
# expected: b204e168
```

---

## 1. Hypotheses

**U1 (governing question, from DT-SPEC-001):**
> Does deterministic evidence-grounding produce measurably better and/or more truthful outputs than the appropriate ungrounded counterfactual?

| | Statement |
|---|---|
| **H₀ (null)** | The grounded arm's Unsupported Company-Claim Rate is **not lower** than the ungrounded arm's: `median UCCR(grounded) ≥ median UCCR(ungrounded)`. |
| **H₁ (alternative)** | The grounded arm's UCCR is lower by **at least the pre-registered minimum effect**: `median UCCR(grounded) ≤ 0.5 × median UCCR(ungrounded)`. |

**Scope discipline.** U1 is a question about **truthfulness under grounding**, not about general AI quality. Stylistic and preference dimensions are measured as context but are **excluded from the acceptance rule** (§5). Broadening U1 into a generic quality benchmark is prohibited.

---

## 2. Dataset & Paired Unit

| Field | Value |
|---|---|
| Dataset identity | `canonicalGrounding.goldenDataset.v1` (`backend/evaluation/canonicalGrounding/dataset.ts:93`) |
| Fixed epoch | `EVAL_EPOCH = 2026-07-15T00:00:00Z` (`dataset.ts:10`) |
| Entries | 9 synthetic companies |
| Workloads | 13 (`workloads.ts:14-45`) |
| **Paired observational unit** | **one (workload, dataset entry) pair — 13 × 9 = 117 pairs** |

Each pair holds **constant**: dataset entry, workload, task input, prompt-projection function (`projectPrompt`), and execution parameters (`DEFAULT_EXECUTION_PARAMS` — provider, model, temperature 0, seed 1729, retries, timeout). The **only** varying factor is the presence of grounding.

---

## 3. Arms

| Arm | Identity | Definition | Source |
|---|---|---|---|
| **A — Grounded** | `canonical` | Canonical assembly + overlay/additive facts block, then identical projection. | `execute.ts` `executeArm(..., 'canonical', ...)` |
| **B — Ungrounded** | `ungrounded` | Empty frozen grounding record `{}`; identical projection; no assimilation, no overlay, no facts block, no profile read. | DT-C1 `controlArm.ts` `executeUngroundedArm` |

**Neither arm may be modified to produce this comparison.** The scorer reads outputs; it must not rewrite, retry, re-prompt, post-process, repair or otherwise improve them (test-enforced).

⚠️ **The `legacy` arm is NOT the control.** As established in DT-C1, `executeArm(..., 'legacy', ...)` still injects the full company profile (`execute.ts:73`) and is therefore *grounded*. It answers a migration question and must never be substituted for Arm B.

---

## 4. Metrics

11 metrics: **1 primary (human-rated)**, **7 secondary (human-rated)**, **3 screening (machine-computable)**. All eight original harness dimensions are preserved by name in `mapsToLegacyDimension` — none was renamed or silently replaced.

### 4.1 PRIMARY endpoint

| Field | Value |
|---|---|
| **ID** | `M-P1-unsupported-claim-rate` |
| **Name** | Unsupported Company-Claim Rate (UCCR) |
| Operationalises | the existing `hallucination` dimension — conceptual intent preserved |
| Definition | Of the company-specific factual assertions an output makes, the proportion **not supported** by the reference fixture for that entry. |
| Formula | `UCCR = unsupportedClaims / totalCompanySpecificClaims`; **undefined** when `totalCompanySpecificClaims = 0` |
| Direction | **lower is better** |
| Range | 0–1 |
| Evaluator | **HUMAN — blinded** |
| Missing | absent output → `invalid` + `pending`. **Never scored 0.** |
| Ties | delta 0; counted as a tie, **never as success** |
| Limitations | Identifying a "company-specific factual assertion" is a judgement call. The rater instruction fixes the unit; inter-rater variance is expected and must be reported. |

**Why this is the primary.** It is the only dimension that directly tests the DeepTech thesis — that deterministic evidence-grounding makes output *more truthful*. Writing quality, usefulness and style are stylistic preferences and cannot carry the claim.

**Why it is not machine-computed.** Detecting a fabricated claim in free text requires semantic judgement against the fixture. §7 of the governing task forbids fabricating a deterministic proxy and labelling it as the original metric — so no such proxy was built.

### 4.2 SCREENING metrics — machine-computable, deterministic

These are **descriptive and diagnostic only**. They cannot establish U1 and may never be substituted for the primary endpoint.

| ID | Name | Formula | Dir. | Limitations |
|---|---|---|---|---|
| `M-S1-grounded-fact-utilisation` | Grounded Fact Utilisation (GFU) | `|{reference values present in normalised output}| / |{reference values}|`; `not_applicable` when the reference has none | higher better | Surface string matching. A correct paraphrase counts as a miss; a coincidental substring counts as a hit. Measures evidence **use**, not truthfulness — **not a hallucination proxy**. |
| `M-S2-entity-identity-fidelity` | Entity Identity Fidelity (EIF) | 1 if correct name present and no foreign entry name; 0 if a foreign name appears; `not_applicable` if no name appears | higher better | Fixture names are synthetic, so a model has no prior knowledge of them. Detects cross-entry leakage only. |
| `M-S3-output-validity` | Output Validity (VAL) | 1 if non-empty string with ≥1 non-whitespace char, else 0 | higher better | Gating check only; says nothing about content. |

**Reference note:** GFU scores **both arms against the same reference** (the entry's own profile fixture). The ungrounded arm is expected to score near 0 — that is the design, not a defect.

### 4.3 SECONDARY metrics — human-rated, `PENDING — REQUIRES HUMAN/EXTERNAL EVALUATION`

| ID | Legacy dimension | Dir. | Note |
|---|---|---|---|
| `M-H1-factual-correctness` | `factualCorrectness` | higher | |
| `M-H2-relevance` | `relevance` | higher | |
| `M-H3-completeness` | `completeness` | higher | Distinct from M-S1 (surface matching) |
| `M-H4-brand-consistency` | `brandConsistency` | higher | Undefined for fixtures without brand fields |
| `M-H5-instruction-following` | `instructionFollowing` | higher | ⚠️ Confounded — the grounded prompt is longer and carries more instruction surface |
| `M-H6-campaign-usefulness` | `campaignUsefulness` | higher | Weakest of the set; reported, never an acceptance basis |
| `M-H7-content-quality` | `contentQuality` | higher | Stylistic; **explicitly excluded** from the acceptance rule |

All are scored 0–4 ordinal, normalised to 0–1. Missing rating → `pending`, **never imputed, never 0**.

---

## 5. Acceptance Criteria (pre-registered, frozen)

Evaluated **in this order**.

### 5.1 INCONCLUSIVE — checked first
The run executed but cannot establish the hypothesis if **any** holds:
1. Fewer than **90%** of pairs validly scored on the primary metric.
2. Inter-rater agreement (Krippendorff's α, ordinal) below **0.67**.
3. Fewer than **2** independent raters scored the primary metric.
4. Blinding was broken, or arm identity was inferable by raters.
5. **Ungrounded UCCR is 0 across the corpus** — no unsupported claims exist to remove, so the instrument cannot detect an effect. *(This is a real possibility with synthetic fixtures and must not be reported as success.)*

### 5.2 SUCCESS — all three required
1. `median UCCR(grounded) ≤ 0.5 × median UCCR(ungrounded)` — the pre-registered minimum effect.
2. The reduction holds in the **same direction in a majority of the 9 per-company clusters**.
3. No secondary human metric shows a materially worse grounded result that the reduction does not offset.

### 5.3 FAILURE
The success condition is not met while the run is conclusive. **This explicitly includes a reduction that is real but smaller than the pre-registered minimum effect.**

### 5.4 FALSIFICATION — evidence AGAINST the hypothesis
> `median UCCR(grounded) ≥ median UCCR(ungrounded)`

Grounding does not reduce unsupported claims, or increases them. This result **must be recorded and reported as evidence against the deterministic-grounding hypothesis**, and would require the grounding claim to be downgraded in `DEEPTECH_BASELINE_001.md` and in all external material.

**The experiment is capable of producing a negative conclusion. That is a requirement, not a risk.**

### 5.5 Prohibited language
"Positive", "promising", "directionally better", "trending toward", "encouraging" and equivalents **may not substitute for the acceptance rule**. The outcome is exactly one of `SUCCESS` / `FAILURE` / `INCONCLUSIVE`.

---

## 6. Effect Size

**Pre-registered minimum: ≥50% relative reduction** — `UCCR(grounded) ≤ 0.5 × UCCR(ungrounded)`.

**Status of this threshold — stated honestly: NORMATIVE, NOT EMPIRICAL.** No prior UCCR measurement exists for this system, so no empirically-derived threshold is available. 50% is chosen because grounding carries real assembly latency, prompt-size and cost overhead; an intervention removing fewer than half of the unsupported claims would not justify that overhead as a *core differentiator*.

**It is frozen.** It may **not** be revised downward after seeing results except by issuing a new protocol version — which would be visible as a fingerprint change.

Success is explicitly **not** defined as `grounded > ungrounded`.

---

## 7. Statistical Treatment

| Field | Commitment |
|---|---|
| Observational unit | (workload, entry) pair — 117 total |
| **Independence** | **VIOLATED BY DESIGN.** 117 pairs derive from only 9 companies × 13 workloads; observations are clustered on both axes. They are **NOT 117 independent samples.** |
| Aggregate statistic | Median paired difference and median per-arm value, plus IQR. Per-company (n=9) cluster medians reported alongside. |
| Confidence intervals | **NOT REPORTED** — interval estimates over clustered data with 9 clusters would overstate precision. |
| Significance test | **NOT USED AS AN ACCEPTANCE BASIS.** With 9 clusters and a bounded non-normal metric, no test is defensible. A Wilcoxon signed-rank statistic MAY be reported **descriptively**, clearly labelled as such. |
| Non-normality | Assumed. All summaries rank/median-based, never mean-based. |
| Ties | Reported as an explicit tie count; never redistributed, never counted as success. |
| Multiple metrics | **ONE** primary endpoint. Secondaries are descriptive context and may **not** be substituted if the primary fails. |
| Status | **EXPLORATORY, NOT CONFIRMATORY.** |

### 7.1 What will NOT be claimed
- ❌ Statistical significance as evidence of efficacy
- ❌ Population-level or customer-level generalisation
- ❌ Production accuracy
- ❌ That U1 is "validated" on the strength of this dataset alone
- ❌ Any generalisation beyond these 9 synthetic fixtures

---

## 8. Human / Machine Evaluation Boundary

### 8.1 Machine (deterministic, no human needed)
`M-S1` GFU · `M-S2` EIF · `M-S3` VAL — all pure functions of (output text, reference fixture).

### 8.2 Human (blinded raters required)
`M-P1` **(primary)** and `M-H1`–`M-H7`. **No automated substitute was built for any of these**, per §7 of the governing task.

| Field | Commitment |
|---|---|
| Rater unit | One (workload, entry, arm) output, presented in isolation |
| Scale | 0–4 integer ordinal → normalised 0–1 |
| **Primary question** | *"Reference facts about this company are shown beside the output. Count (a) every company-specific factual assertion the output makes, and (b) how many of those are NOT supported by the reference facts. Do not judge writing quality."* |
| Blinding | Arm identity **hidden**; outputs shown without prompt, without arm label, in randomised order |
| ⚠️ Residual unblinding risk | The grounded prompt is longer, so **output length may partially reveal the arm**. This risk is acknowledged in advance and **must be recorded with the results**. |
| Randomisation | Presentation order randomised per rater, with a recorded seed |
| Minimum raters | **2** independent |
| Disagreement | Adjudicated by a third rater; adjudicated values flagged in results |
| Aggregation | Median across raters per output |
| Reliability | Krippendorff's α (ordinal); **INCONCLUSIVE below 0.67** |
| Missing ratings | `pending` — never imputed, never treated as 0 |

**No human rating was performed in DT-C2.**

---

## 9. Exclusion Rules

1. A pair where **either** arm produced no output is **excluded from primary aggregation and reported** in the exclusion table.
2. A pair whose reference fixture has no checkable company facts (`completeness = 'none'`) is excluded **from M-S1 only**, and reported.
3. **No pair may be excluded for producing an unfavourable result.**
4. The exclusion list **must be published with the results**.

Invalid observations are **kept and reported**, never silently discarded (test-enforced).

---

## 10. Leakage / Confounding Assessment

Conducted by direct inspection of `dataset.ts` before any data collection.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| **L-1** | **All `rich` fixtures share IDENTICAL field values.** Every rich entry has `products_services: 'Flagship product, Add-on module'`, `unique_value: 'Ship on-brand content 5x faster'`, `ideal_customer_profile: 'B2B marketing leaders at SaaS'`, etc. Only `name` and `industry` vary per entry. | 🔴 HIGH | `dataset.ts:47-64` |
| **L-2** | **Fixture-internal contradiction.** `market_pulse.core_offerings = ['Analytics suite','Attribution engine']` conflicts with `products_services = 'Flagship product, Add-on module'`. Canonical assembly merges market_pulse, so the two arms may legitimately carry *different* "facts" for the same company. | 🔴 HIGH | `dataset.ts:15-21` vs `:49-50` |
| **L-3** | **Labels/fixtures hand-authored in-repo** by the same party as the system under test. No independent provenance. | 🟠 MEDIUM | `dataset.ts` |
| **L-4** | **Synthetic company names** (`MartechCo5`) mean a model has no prior knowledge. Helps isolate grounding; **destroys external generalisation**. | 🟠 MEDIUM | `dataset.ts:94` |
| **L-5** | Fixtures were used during RF-3A harness implementation — they are **engineering fixtures**, exercised during development. | 🟠 MEDIUM | DT-A1 §6.1 |
| **L-6** | Clustering: 117 pairs from 9 companies × 13 workloads. | 🟠 MEDIUM | §7 |
| **L-7** | `M-H5` instruction-following is confounded by prompt length asymmetry. | 🟡 LOW | §4.3 |
| **L-8** | No threshold in this protocol was derived from the dataset — all are pre-registered before data. | ✅ CLEAN | this document |
| **L-9** | Scorer contains no dataset-specific exceptions — no branch keys off an entry id, company name or workload key. | ✅ CLEAN | test-enforced |

### 10.1 Consequence of L-1 and L-2 — binding classification

> **This dataset is an ENGINEERING FIXTURE, not INDEPENDENT VALIDATION EVIDENCE.**

L-1 means the corpus effectively contains **one rich company repeated**, plus name/industry variation — it cannot support claims about cross-company generalisation. L-2 means grounded and ungrounded arms may not even share a single consistent ground truth for some entries.

**Therefore:** a `SUCCESS` outcome under `u1-001` advances U1 to **Rung 2 (controlled experiment)** at most. It **cannot** reach Rung 6 (held-out validation), because this dataset is not held out and is not independent. Reaching Rung 6 requires a **new, independently-constructed dataset with distinct per-company facts** — which would be a new protocol version.

---

## 11. Reproducibility Requirements

A U1 results artifact is valid only if it records: repository SHA · protocol version · **protocol fingerprint** · dataset identity · execution parameters (provider, model, temperature, seed, retries, timeout) · control-arm fingerprint · rater identifiers (pseudonymous) · randomisation seed · complete raw outputs · complete per-rater scoring sheets · full exclusion table · inter-rater α.

Scoring itself is deterministic and byte-reproducible (test-enforced).

---

## 12. Statement of Non-Execution

At registration:

| | |
|---|---|
| U1 executed | **NO** |
| Model outputs generated (either arm) | **NO — zero** |
| External model API called | **NO** |
| Human rating performed | **NO** |
| Efficacy measured | **NO** |
| Results embedded in this document | **NONE** |
| U1 evidence rung | **Rung 1 (engineering proof)** — unchanged |

Synthetic strings in `backend/tests/unit/canonicalGroundingU1Scorer.test.ts` are hand-written scorer test fixtures, prefixed `SYNTHETIC_`. **They are not model outputs and no U1 result may ever be quoted from them.**

---

## 13. Sequence Discipline

```
control arm (DT-C1 ✅) → scoring protocol (DT-C2 ✅) → preregistration (DT-C2 ✅)
    → model execution (NOT DONE) → scoring (NOT DONE)
    → independent review (NOT DONE) → conclusion (NOT DONE)
```

The inverse sequence — execute, inspect results, choose metrics, choose thresholds, claim validation — is what this document exists to make impossible.

---

*End of `DEEPTECH_U1_PREREGISTRATION_001`, protocol `u1-001`, fingerprint `b204e168`, SHA `82754497e8f9b64a893319e863941ad2994fd9b7`. No results are included because none exist.*
