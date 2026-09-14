# DEEPTECH_BASELINE_001

**Canonical technical baseline for Omnivyra — hostile-review edition.**

> This document is **not** an application, a marketing document, a certification, or an argument that Omnivyra is strong. It is a deliberately adversarial baseline whose purpose is to make future claims **impossible to overstate**. Where evidence is weak it says weak. Where evidence is absent it says absent. Where a prior claim was wrong it corrects it — including claims made by its own predecessor specification.

---

## 1. Verification Header

| Field | Value |
|---|---|
| Document ID | `DEEPTECH_BASELINE_001` |
| Supersedes | `DT-SPEC-001` (conversational only — never a repository artifact) |
| Verification timestamp (UTC) | `2026-09-09T17:52:14Z` |
| HEAD SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| Expected SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| **SHA gate (AC-01)** | ✅ **EXACT MATCH** |
| Branch | `preserve/creator-canonical-template-pool` |
| `main` | `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2` |
| `origin/main` | `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2` |
| `main == origin/main` | ✅ YES |
| HEAD commit date | `2026-09-04 15:48:02 +0530` |
| Node | `v22.17.0` |
| npm | `10.9.2` |
| Package manager | npm (`package-lock.json`; no yarn/pnpm lockfile) |
| Working tree | 40 entries: 26 modified, 14 untracked |

### 1.1 Verification commands (read-only, reproducible)

```bash
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
git rev-parse main
git rev-parse origin/main
git log -1 --format='%ci'
node -v && npm -v
git status --porcelain
```

### 1.2 Working-tree caveat

The tree is **not clean**. 26 modified + 14 untracked files exist, concentrated in the canonical-report / Report-1 surface (`backend/services/canonicalReport/*`, `backend/services/intelligence/exportRenderer*`, `backend/tests/unit/report1*.test.ts`). None of the 18 capabilities audited here is among the modified files, so the audit is unaffected. **An independent reviewer reproducing this document must check out the SHA cleanly** — the working-tree deltas are not part of the baseline.

---

## 2. Repository Baseline

| Metric | Value | Method |
|---|---|---|
| Total commits (HEAD) | 931 | `git rev-list --count HEAD` |
| Development window | 2026-01 → 2026-09 (~9 months) | `git log --format='%ad'` |
| Monthly commit distribution | 01:3 · 02:10 · 03:37 · 04:8 · 05:117 · 06:99 · **07:528** · 08:126 · 09:3 | ibid. |
| Distinct author identities | 3 (`kulrashm-jpg`, `drishiq2-dot`, `drishiq1`) over 2 email addresses | `git shortlog -sne --all` |
| Tracked test files | **1,410** total — 1,147 `backend/tests/unit`, 128 `backend/tests/integration`, 135 elsewhere | `git ls-files '*.test.ts' '*.test.tsx'` |
| Production npm dependencies | 52 | `package.json` |
| Dev dependencies | 18 | `package.json` |
| **AI/ML dependencies** | **`openai@^5.23.0` — ONE, and only one** | `package.json` |
| ML frameworks present | **NONE** (no torch, tensorflow, onnx, transformers, langchain, cohere, pinecone, weaviate) | dependency scan |

### 2.1 The single most important structural fact

**1,410 test files coexist with zero recorded experimental results.** This is the defining shape of the repository: exceptional engineering discipline, absent scientific validation. The two are not substitutes. The sheer volume of the former makes the absence of the latter easy to miss, and that is precisely the trap this baseline exists to prevent.

---

## 3. Search for Prior DeepTech Artifacts

Exhaustive repository-wide search performed with ripgrep across all tracked files.

| Search term | Material hits |
|---|---|
| `DPIIT` | **0** |
| `DeepTech` / `Deep Tech` / `deep-tech` | **0** |
| `technical uncertainty` | **0** |
| `originality cascade` | **0** |
| `grounding evaluation` | **0** |
| `threshold calibration` | 1 — incidental (`topicResolutionService.ts:29`, unrelated B7.3 backfill note) |
| `competitor qualification` | 0 as a documented artifact (module directory exists; no evidence document) |
| `proprietary know-how` | **0** |
| `prior art` | 1 — false positive (`blogGenerationEnginePipeline.ts:423`, "prior articles") |
| `trade secret` | **0** |
| `U1`–`U9` as uncertainty identifiers | **0** |

### 3.1 Resolution of one earlier false positive

An initial (slower, non-gitignore-aware) grep reported a hit in `docs/archive/REDIS_POLLING_INDEX.md`. Verified and dismissed:

- Actual matched text — `docs/archive/REDIS_POLLING_INDEX.md:162`: `### Path 4: Deep Technical Dive (60 minutes)`
- Coincidental substring match on "Deep Tech" inside "Deep **Tech**nical".
- The file is **gitignored** (`.gitignore:35` → `REDIS_POLLING*.md`) and **not tracked** (`git ls-files --error-unmatch` → NOT TRACKED).

### 3.2 Finding

> **ABSENT.** No durable prior DeepTech, DPIIT, uncertainty-register, or R&D-evidence artifact exists anywhere in this repository. Zero. The predecessor specification `DT-SPEC-001` exists only as conversational output and has no repository existence.

Consequence: prior to this document, **every DeepTech claim about Omnivyra was untraceable** — not merely unvalidated, but incapable of being re-verified by anyone without access to a specific chat transcript. This document is the first durable artifact in the chain. Nothing here inherits an unverifiable ancestor; every claim below is re-derived from the repository at the stated SHA.

---

## 4. Executive Technical Position

**Classification: SUPPORTED (engineering) / UNPROVEN (efficacy).**

Omnivyra contains a substantial, genuinely differentiated **deterministic decision layer** wrapped around third-party foundation models. That layer is real, well-documented, disciplined, and in two cases unconditionally live in production. Its architectural qualities — determinism, fail-open/fail-safe design, architecturally enforced abstention, default-deny flag discipline — are engineering facts provable from the repository.

**Not one of its efficacy claims has ever been measured.**

| Position | Classification | Basis |
|---|---|---|
| A deterministic decision layer exists and is substantial | **PROVEN** | §5 inventory, file:line throughout |
| Two differentiated capabilities run unconditionally in production | **PROVEN** | C-01 §5.1, C-02 §5.2 |
| That layer improves output quality vs. direct model invocation | **UNPROVEN** | Zero experiments (§9, §10) |
| Any threshold is empirically calibrated | **UNPROVEN** | §7 — 0 of 24 calibrated |
| Competitor model generalizes to unseen industries | **UNPROVEN — and currently confounded** | §6.2 |
| A proprietary/trained AI model exists | **FALSE — never claim** | §2, one dep: `openai` |
| Omnivyra is DeepTech-ready | **UNPROVEN** | 0 of 9 criteria met |

**Highest evidence rung attained across all nine technical uncertainties: Rung 1 (engineering proof). No uncertainty has reached Rung 2.**

---

## 5. The 18-Capability Inventory

Legend — Production state per §4 vocabulary. Evidence per §3 classification.

### 5.1 C-01 — Originality Cascade

| Field | Value |
|---|---|
| Location | `backend/services/content/originalityGate.ts` (347 lines); primitives in `lib/content/originality/{fingerprint,similarity,types}.ts` |
| Implementation | **PROVEN** — 7-stage early-terminating cascade, `originalityGate.ts:1-28` (header contract) |
| **Production state** | **LIVE IN PRODUCTION** |
| Feature flag | **NONE — unconditional** |
| Production call sites | `content/runtime/generationRuntime.ts:349` · `lib/post/runPostGeneration.ts:455` · `lib/thread/runThreadGeneration.ts:398` · `content/campaignUniquenessGuard.ts:328` |
| Test coverage | 3 files (`originalityFingerprint`, `originalityGate`, `originalitySimilarity`) |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** — strongest Q1 candidate |
| Proprietary element | Stage ordering (cheap→costly); early termination; per-stage cutoffs; and specifically the aggregate's deliberate discount of SimHash's ~0.5 chance baseline on unrelated text (`originalityGate.ts:20-23`) |
| Limitation | Thresholds are engineering defaults (§7). Embedding stage (stage 6) is **OFF by default** and requires an injected embedder — `originalityGate.ts:70-72`; no production path supplies one (`topicResolutionService.ts:21`) |
| Uncertainty | U6 |
| Next evidence | Ablation vs. no-gate; threshold sweep against labeled duplicate/non-duplicate pairs |

Fail-open contract: the entire pipeline is try/catch-wrapped; on any error it returns `bypassed` / `isOriginal: true` so originality checking can never block generation (`originalityGate.ts:25-28`). This is a deliberate availability trade-off and must be disclosed in any efficacy claim — **the gate is designed to fail open, so a production "pass" rate is not evidence of a working gate.**

### 5.2 C-02 — Grounding Policy

| Field | Value |
|---|---|
| Location | `backend/services/ai/grounding/groundingPolicy.ts` (103 lines) |
| Implementation | **PROVEN** — pure/deterministic freshness + floor evaluation |
| **Production state** | **LIVE IN PRODUCTION** |
| Feature flag | **NONE at the call site** |
| Production call site | `backend/services/context/contextAssimilationEngine.ts:215` (import at `:26`) |
| Test coverage | 10 files |
| Experiment evidence | **ABSENT** — see F1 (§6.1) |
| Differentiation | **PROPRIETARY CALIBRATION (claimed) / PROPRIETARY COMPOSITION (actual)** |
| Proprietary element | Freshness→confidence multiplier table; grounding floor; `GroundingDecision` contract |
| Limitation | **Enforcement is proven; efficacy is entirely unmeasured.** Multipliers and floor are engineering defaults (§7) |
| Uncertainty | U1, U3 |
| Next evidence | Counterfactual baseline + scored evaluation |

The module's own header is unusually honest and is worth preserving as evidence of good-faith engineering: it states the infrastructure "already exists... found it computed but NEVER ENFORCED. This policy ENFORCES it — it does NOT build a new retrieval/ranking framework" (`groundingPolicy.ts:5-11`). **The claim scope is enforcement, not retrieval innovation.** Any external description must respect that scope.

### 5.3 C-03 — Grounding Evaluation Harness

| Field | Value |
|---|---|
| Location | `backend/evaluation/canonicalGrounding/` — 9 files, 931 lines |
| Implementation | **PROVEN** (scaffold) — deterministic dataset, fixed `EVAL_EPOCH = 2026-07-15T00:00:00Z` (`dataset.ts:10`) |
| **Production state** | **SHADOW/TEST ONLY** — and see below |
| Feature flag | none; `liveRunner.ts:66,109` gate on `OPENAI_API_KEY` presence |
| Production call sites | **NONE** |
| Invocation path | **NONE — no npm script, no job, no page, no backend script invokes it** |
| Test coverage | 7 files |
| Experiment evidence | **ABSENT — see F1 (§6.1)** |
| Differentiation | **EXPERIMENTAL** (design is sound; execution is nil) |
| Proprietary element | Dataset design: size × completeness × website × market-intel × activity |
| Limitation | **All 8 efficacy metrics hard-coded `'pending'`; no scoring layer; no result persistence; no invocation path** |
| Uncertainty | U1, U3 |
| Next evidence | Counterfactual baseline arm, then a scoring layer with independent raters |

**Reclassification vs. DT-SPEC-001:** listed there as `SHADOW/TEST ONLY`. That is too generous. The harness has **no caller anywhere in the repository**. It is more accurately **CONCEPT/FUTURE with a completed scaffold**. It cannot produce evidence in its current state, and no code path would run it if it could.

### 5.4 C-04 — Quality Engine

| Field | Value |
|---|---|
| Location | `backend/services/content/qualityEngine.ts`; types in `lib/content/quality/types.ts` |
| Implementation | **PROVEN** — 12 dimensions, pure rule-based |
| **Production state** | **PARTIAL** |
| Feature flag | varies by consumer |
| Test coverage | 9 files |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Proprietary element | 12-dimension weighted rubric (`qualityEngine.ts:53-64`) |
| Limitation | **Never validated against human judgment.** Determinism is proven; *validity* is entirely unestablished |
| Uncertainty | **U8** |
| Next evidence | Spearman correlation vs. blind human ratings |

Genuine and provable engineering constraint (`qualityEngine.ts:1-20`): makes **no AI calls, touches no database, and uses no `Math.random`/`Date.now`** — the same input yields a byte-identical scorecard. The only non-pure value (`evaluatedAt`) is accepted from the caller, never generated internally. This is a real, verifiable property and a legitimate SAFE-NOW claim.

**But:** a deterministic scorer that does not track human judgment is *precise and wrong*, and that failure mode is invisible to every one of the 9 test files. U8 exists precisely because determinism is frequently mistaken for validity.

### 5.5 C-05 — Competitor Qualification

| Field | Value |
|---|---|
| Location | `backend/services/competitor/qualification/` — 7 files, ~92 KB |
| Implementation | **PROVEN** |
| **Production state** | **SHADOW/TEST ONLY** |
| Feature flag | `COMPETITOR_MULTISIGNAL_SHADOW` — `competitorQualificationShadow.ts:32`; **default OFF** |
| Production call sites | **NONE** — observer never touches the request (`competitorQualificationShadow.ts:28`) |
| Test coverage | 17 files |
| Experiment evidence | **IN-SAMPLE ONLY — see F2 (§6.2)** |
| Differentiation | **EXPERIMENTAL** (downgraded — see below) |
| Proprietary element | Weight profiles V1/V2; abstention-aware renormalization; 47-case dataset |
| Limitation | **Weights fitted on the validation set. No holdout. Not in production.** |
| Uncertainty | U4 |
| Next evidence | Sealed, independently-labeled held-out set |

The genuine engineering insight here is abstention-aware renormalization: the model renormalizes over signals that have coverage on each candidate, so an abstaining signal never silently drags the score toward zero (`competitorQualificationModel.ts:53-55`). That is a real and non-obvious design choice.

**Downgrade rationale:** DT-SPEC-001 classified this MEDIUM differentiation. Corrected to **EXPERIMENTAL**, because a model whose parameters are fitted on its own validation set has no established generalization property at all. The classification cannot exceed the evidence.

### 5.6 C-06 — Evidence / Abstention Contract

| Field | Value |
|---|---|
| Location | `backend/services/intelligence/canonical/{contracts,scoring,fusion,explain,primitives,helpers}.ts` |
| Implementation | **PROVEN** — `scoring.ts:31` returns `abstained: true` when no usable contributor exists |
| **Production state** | **IMPLEMENTED BUT FLAG-DARK** |
| Feature flag | inherited from the Understanding spine (all OFF — §8) |
| Production call sites | **NONE** |
| Test coverage | via Understanding suites |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** — joint-strongest Q1 candidate |
| Proprietary element | `Facet<T>` / `EvidenceRef` / `ReasoningTrace` contract; abstention as an architectural invariant, not a per-call choice |
| Limitation | **Zero production usage.** Effect on decision quality never measured |
| Uncertainty | U5 |
| Next evidence | Precision/coverage frontier vs. a forced-answer control |

Single source of truth, no fork: `contracts.ts:1-11` documents that entity-agnostic contracts are **re-exported** rather than duplicated across Lead/Company/Offering. The stated engine invariant is "Abstain when evidence is absent — a facet abstains rather than fabricating a value" (`companyIntelligence/contract.ts:65`).

### 5.7 C-07 — Understanding Spine

| Field | Value |
|---|---|
| Location | 8 modules: `companyIntelligence`, `leadUnderstanding`, `offeringIntelligence`, `contactIntelligence`, `visitorIntelligence`, `journeyIntelligence`, `intentIntelligence`, `qualificationIntelligence` |
| Implementation | **PROVEN** — extensive |
| **Production state** | **IMPLEMENTED BUT FLAG-DARK (all 8)** |
| Feature flags | **16 flags — 2 per Understanding** (`*_UNDERSTANDING_ENABLED` + `*_UNDERSTANDING_AUTHORITATIVE`) |
| Default state | **ALL 16 default OFF under strict `=== 'true'`** — verified at `companyIntelligence/flags.ts:8,11`; `contactIntelligence/flags.ts:7,10`; `intentIntelligence/flags.ts:7,10`; `journeyIntelligence/flags.ts:6,9`; `leadUnderstanding/flags.ts:8,13`; `offeringIntelligence/flags.ts:7,10`; `qualificationIntelligence/flags.ts:7,10`; `visitorIntelligence/flags.ts:6,9` |
| Production call sites | **NONE** |
| Test coverage | 5+ files by name; extensive by content |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Limitation | **Largest single body of differentiated work in the repository — with zero production usage** |
| Uncertainty | U5 |
| Next evidence | Production shadow-parity before any capability claim |

**Correction vs. DT-SPEC-001:** that document reported "8 flags". The actual count is **16** — every Understanding carries both an `_ENABLED` and an `_AUTHORITATIVE` gate. The two-stage gating (exists → is authoritative) is itself good adoption discipline and strengthens, not weakens, the default-deny claim.

### 5.8 C-08 — AI Gateway

| Field | Value |
|---|---|
| Location | `backend/services/aiGateway*.ts` — 10 modules |
| Implementation | **PROVEN** |
| **Production state** | **LIVE IN PRODUCTION** |
| Production consumers | **190 tracked files** import the gateway |
| Test coverage | 14 files |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD ENGINEERING TECHNIQUE** |
| Proprietary element | Dual-namespace provider identity with fail-closed resolution (`aiGatewayProviderIdentity.ts:6-24`): PRODUCT ids (`chatgpt`\|`gemini`\|`claude`\|`perplexity`\|`copilot`) vs PLATFORM ids (`openai`\|`anthropic`\|`gemini`\|`perplexity`\|`copilot`); three coincide, two do not; unknown input throws rather than guesses |
| Limitation | Multi-provider routing is industry-standard. **Do not over-frame** |
| Uncertainty | U2 |

The identity-mapping module is careful, well-reasoned work, but careful work on a standard problem is not technical differentiation. Classified honestly as standard.

### 5.9 C-09 — Model Routing / Transports

| Field | Value |
|---|---|
| Location | `backend/services/aiGatewayTransports.ts`; `aiGatewayDispatcher.ts` |
| Implementation | **PROVEN** — `GatewayTransportId = 'gemini' \| 'perplexity' \| 'copilot'` (`aiGatewayTransports.ts:60`); dispatcher namespace adds `openai`, `anthropic` |
| **Production state** | **PARTIAL** |
| Test coverage | shared with C-08 |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD ENGINEERING TECHNIQUE** |
| Proprietary element | Operation-keyed long-form timeouts; truncation warnings (`aiGatewayTransports.ts:306,349`) |
| Uncertainty | U2 |

### 5.10 C-10 — Real Embeddings

| Field | Value |
|---|---|
| Location | `backend/services/signalEmbeddingService.ts`; `content/knowledgeGraph/topicCandidateService.ts` |
| Implementation | **PROVEN** — OpenAI `text-embedding-3-small`, 1536-dim (`signalEmbeddingService.ts:16-17`) |
| **Production state** | **PARTIAL / LIVE** |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD PRIMITIVE — THIRD-PARTY** |
| Proprietary element | **The vectors are not ours.** Only the cost-attribution wrapper is: per-call `usage_events` with `source_type='embedding'`, system-vs-user attribution (`signalEmbeddingService.ts:5-10`), pricing assertion + anomaly recording (`:14`) |
| Limitation | **This is a purchased third-party capability** |
| Next evidence | None needed — **must never be claimed as Omnivyra technology** |

### 5.11 C-11 — Hash "Embedding"

| Field | Value |
|---|---|
| Location | `backend/services/semanticIndexingService.ts:47-56`; **duplicated** at `hybridSemanticRetrievalService.ts:49` |
| Implementation | **PROVEN** — sha256 per token → `readUInt32BE(0) % dim` bucket → count → L2-normalise |
| **Production state** | **PARTIAL** |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD PRIMITIVE** — this is the classical hashing trick / feature hashing, textbook since ~2009 |
| Proprietary element | Determinism and replayability only |
| Limitation | **NOT SEMANTIC — see F3 (§6.3)** |
| Next evidence | Rename; never describe as semantic |

Note the duplication: `deterministicEmbedding` is implemented **twice**, independently, at `semanticIndexingService.ts:47` and `hybridSemanticRetrievalService.ts:49`. Recorded as an observation only — no change made.

### 5.12 C-12 — Hybrid Retrieval

| Field | Value |
|---|---|
| Location | `backend/services/hybridSemanticRetrievalService.ts` |
| Implementation | **PROVEN** — 3 modes (`:6-9`), weights `lexicalWeight` 0.4 / `semanticWeight` 0.6 (`:94-95`) |
| **Production state** | **LIVE IN PRODUCTION** |
| Production consumers | `aiInvestigationService.ts:32` · `copilotService.ts:30` · `pages/api/active-leads/semantic-retrieval.ts:18` |
| Test coverage | **ZERO** — no test file references `retrieveHybrid` or `hybridSemanticRetrievalService` |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD ENGINEERING TECHNIQUE** |
| Proprietary element | Mandatory per-hit human-readable `explanation` (no opaque ranking); audit persistence to `semantic_retrieval_explanations`; tenant-first filter on every read (`:13-21`) |
| Limitation | **Its "semantic" mode is lexical (F3). It has three live production consumers and zero tests.** |
| Uncertainty | U3 |

**New finding, not in DT-SPEC-001:** a live production capability with three consumers has **no test coverage at all**. This is a materially worse position than the prior specification recorded (it listed "✅" for tests based on a filename-pattern match that does not correspond to any actual test of this service).

### 5.13 C-13 — Learning Loop

| Field | Value |
|---|---|
| Location | Write: `backend/services/content/learningEngine.ts`. Read: `backend/services/content/recommendationRuntime.ts` |
| Implementation | **PROVEN (wiring, both directions)** |
| **Production state** | **PARTIAL** |
| Write call site | `content/approvalService.ts:182` — `learningEngine.recordLearningEvent({ companyId, contentId })` |
| Read call sites | `recommendationRuntime.ts:574,584,594` — consumes `learning_memory.platform_adaptations`, `winning_structures`, narrative/messaging rollups |
| Test coverage | 6 files |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Proprietary element | Percentile-thresholded fold (`HIGH_PERCENTILE=0.6`, `LOW_PERCENTILE=0.4`, `learningEngine.ts:35-36,116-117`); explicitly **"No ML"** (`:20`) |
| Limitation | **The loop closes structurally. Whether it changes outcomes is entirely unmeasured. Production row volume is unknown** |
| Uncertainty | U7 |
| Next evidence | Production row counts, then a longitudinal outcome comparison |

Invariants are strong and provable (`learningEngine.ts:11-20`): fail-open, idempotent, append-only, never reads or mutates the `content` table, deterministic and explainable. **None of that is evidence that learning improves outcomes.** "Closed-loop learning" remains a prohibited claim (§11).

### 5.14 C-14 — Capability Runtimes

| Field | Value |
|---|---|
| Location | `backend/services/content/runtime/` — 12 modules |
| Implementation | **PROVEN** |
| **Production state** | **PARTIAL** |
| Feature flags | 5 delegation flags: `BOLT_`, `CONTENTGEN_DAY_`, `LONGFORM_`, `TEXTGEN_`, `WRITER_RUNTIME_DELEGATION_ENABLED` |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Proprietary element | `taskPolicyRegistry`, `taskProfileRuntime`, `semanticContinuityGuard`, `semanticSpine`, `deterministicFormatter`, `retryPolicy` |
| Limitation | Flag-gated; per-environment flag state not verifiable from the repository |

`generationRuntime.ts:17` documents the 5-stage pipeline including "Originality Validation → assertOriginality + regenerateUntilOriginal", corroborating C-01's live status independently.

### 5.15 C-15 — Agent Runtime

| Field | Value |
|---|---|
| Location | `backend/services/aiAgent/` — 12 modules |
| Implementation | **PROVEN** |
| **Production state** | **PARTIAL** |
| Consumers | `campaignCapability/campaignPlatformRuntime.ts:23,41,90` · `recommendationCapability/recommendationPlatformRuntime.ts:21,42,97` · `strategicMixCapability/strategicMixPlatformRuntime.ts:22,40,95` — all via injectable `agentRunner` default |
| Autonomous flag | `AUTONOMOUS_CRON_ENABLED` — `autonomousFeatureFlag.ts:33,41`; **strict `=== 'true'`, default OFF; "defaults to closed, no inference"** (`:36-39`) |
| Test coverage | 8 files by content |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Proprietary element | Approval, lifecycle, recovery, state-store, registry as separate concerns |
| Limitation | **Autonomous stack is in containment mode** — `autonomousFeatureFlag.ts:89` states it requires the Phase B canonical migration before enabling |
| Next evidence | Per-environment flag state |

`runAgent` is capability *delegation* within bounded, approval-gated flows. **"Agentic production capability" is a prohibited claim** (§11).

### 5.16 C-16 — Governance

| Field | Value |
|---|---|
| Location | `backend/governance/` (6 modules) · `backend/chatGovernance/` (4) · `backend/jobs/governanceAuditJob.ts` |
| Implementation | **PROVEN** |
| **Production state** | **PARTIAL** — audit job flag-gated |
| Test coverage | **54 files** — the single most heavily tested area in the repository |
| Experiment evidence | **ABSENT** |
| Differentiation | **PROPRIETARY COMPOSITION** |
| Proprietary element | `ExecutionStateMachine`, `GovernancePolicyRegistry`, `GovernanceLedger`, `GovernanceContract` |
| Limitation | Governance is internal control, not product differentiation. **Do not present as a DeepTech differentiator** |

### 5.17 C-17 — Safety

| Field | Value |
|---|---|
| Location | `backend/services/ai/safety/` — 10 modules |
| Implementation | **PROVEN** — `aiError`, `safeParse`, `promptSafety`, `outboundModeration`, `marketProvenance`, `providerRetryPolicy`, plus 3 `*Adoption` seams |
| **Production state** | **PARTIAL** — core modules separate from adoption seams |
| Experiment evidence | **ABSENT** |
| Differentiation | **STANDARD ENGINEERING TECHNIQUE** |
| Proprietary element | Adoption-seam pattern (core policy vs. call-site adoption kept separate) |
| Limitation | Adoption is incomplete by design; coverage per call site unverified |
| Uncertainty | U2 |

### 5.18 C-18 — Feature Gates

| Field | Value |
|---|---|
| Location | `config/featureFlags.ts` (45 lines) · `lib/featureFlags.ts` (30) · `backend/services/featureFlagService.ts` · `backend/types/featureFlag.ts` |
| Implementation | **PROVEN** |
| **Production state** | **LIVE IN PRODUCTION** |
| Differentiation | **STANDARD ENGINEERING TECHNIQUE** |
| Proprietary element | **Default-deny discipline — 89 strict `=== 'true'` reads vs. 6 default-ON `!== 'false'` reads** (§8) |
| Limitation | 111 flag-shaped names is significant configuration surface; per-environment state is not repository-verifiable |

### 5.19 Inventory roll-up

| Production state | Count | Capabilities |
|---|---|---|
| LIVE IN PRODUCTION | 4 | C-01, C-02, C-08, C-12, C-18 (5 incl. gates) |
| PARTIAL | 7 | C-04, C-09, C-10, C-11, C-13, C-14, C-15, C-16, C-17 |
| IMPLEMENTED BUT FLAG-DARK | 2 | C-06, C-07 |
| SHADOW/TEST ONLY | 1 | C-05 |
| CONCEPT/FUTURE (reclassified) | 1 | C-03 |
| **With any experimental evidence** | **0** | **— none —** |

---

## 6. F1 / F2 / F3 — Mandatory Corrections of Record

### 6.1 F1 — The grounding evaluation has produced no results

**Prior claim (implicit in program framing):** grounding efficacy is partially validated; U1 requires *replication*.

**Repository evidence — conclusive:**

1. All eight efficacy metrics are hard-coded to the literal string `'pending'`, with `reviewer: 'unassigned'` — `analysis.ts:18-23`:
   `factualCorrectness`, `relevance`, `completeness`, `brandConsistency`, `instructionFollowing`, `hallucination`, `campaignUsefulness`, `contentQuality`.
2. The live runner emits the same — `liveRunner.ts:138`: `reviewer: 'unassigned', notes: ''`, and its own header states it "Never fabricates scores; emits the schema + references for a human reviewer" (`:130`).
3. The type permits scores but defaults to pending — `types.ts:92-102`.
4. The harness **self-reports its own lack of evidence** — `analysis.ts:72-74`: `hasPending` → `'AI-output quality unscored (pending) — no equivalence evidence yet'`.
5. Pending quality forces shadow retention — `types.ts:140`: `requireQualityForEnforce` → pending ⇒ `KEEP_IN_SHADOW`.
6. **No result persistence exists** — `report.ts:3`: "Pure string builders; no filesystem writes (the caller decides where to persist)."
7. **No caller exists.** No npm script, backend script, job, or API route references `canonicalGrounding` or `liveRunner`. Verified: `node -e` scan of `package.json` scripts for `/eval|ground|experiment/i` → zero matches.
8. No result artifact of any kind exists in the repository.
9. The only non-`pending` scores anywhere are **synthetic unit-test fixtures** — `canonicalGroundingHarness.test.ts:163` uses `reviewer: 'eval-bot'` with invented values. **These are test fixtures, not experimental results, and must never be cited as evidence.**

**CORRECTED POSITION — `ABSENT`:**

> The grounding evaluation has **never been run**. No experiment was executed, no metric was scored, no result exists, and no independent evaluation occurred. The harness is a completed scaffold with no invocation path and no scoring layer. **U1 is at Rung 1 (engineering proof) and cannot be "replicated" because it has never been run once.**

**Severity: CRITICAL.** This finding also corrects DT-SPEC-001, which classified C-03 as `SHADOW/TEST ONLY`; with no caller anywhere, `CONCEPT/FUTURE` is the accurate classification.

**Mitigating note, recorded in fairness:** the harness is *honest* scaffolding, not deceptive. It explicitly refuses to fabricate scores, self-reports unscored state, and forces shadow retention when quality is pending. The engineering intent was correct; only the execution is absent.

### 6.2 F2 — Competitor weights are fitted on the validation set

**Prior claim** — `competitorQualificationModel.ts:74-77`: V2 is "Derived DETERMINISTICALLY, not hand-tuned, by `deriveOptimizedProfile` over the 44-case cross-industry dataset."

**Repository evidence — conclusive:**

| Item | Finding | Evidence |
|---|---|---|
| Dataset composition | **Two arrays**: `CALIBRATION_CASES` (14 cases) + `EXTENDED_CALIBRATION_CASES` (33 cases) = **47 total** | `competitorQualificationCalibration.ts:104`; `competitorCalibrationDataset.ts:172` |
| Stated size | Code comment claims "44-case" | `competitorQualificationModel.ts:75` |
| Coverage split (extended) | 13 seen / 20 unseen | dataset scan |
| Label balance (extended) | 16 true / 17 false | dataset scan |
| Label authorship | Hand-authored in-repo, `expectedCompetitor` literals; **no external labeling provenance recorded** | `competitorCalibrationDataset.ts` |
| **Fitting set** | `deriveOptimizedProfile(ALL)` | `competitorCalibrationAnalysis.test.ts:42` |
| **Validation set** | `evaluateProfile(ALL, V1)` / `evaluateProfile(ALL, V2)` | `competitorCalibrationAnalysis.test.ts:99-100` |
| `ALL` definition | `const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES]` | `competitorCalibrationAnalysis.test.ts:26` |
| **Holdout / CV / train-test split** | **ZERO occurrences repository-wide** for `holdout`, `heldOut`, `hold_out`, `crossValidat`, `kFold`, `k_fold`, `trainSet`, `testSet`, `train_test`, `validationSet` | ripgrep, case-insensitive, all tracked files |

**CORRECTED POSITION — `UNPROVEN, CONFOUNDED`:**

> `MULTISIGNAL_WEIGHT_PROFILE_V2` is derived from per-signal discrimination measured over `ALL` (47 cases), and is then evaluated against **that identical set**. This is fitting on the validation set. Every reported accuracy, precision, recall or false-positive figure for V2 is **in-sample** and carries no generalization guarantee. No held-out set, no cross-validation, and no independent evaluation set exists anywhere in the repository. Labels were authored in-repo by the same party as the model, with no recorded independent labeling provenance.
>
> Additionally, the stated dataset size (44) does not match the actual size (47).

**Severity: CRITICAL.** This is the most externally-falsifiable weakness in the portfolio; a competent reviewer will locate it in minutes by reading a single test file.

**Recorded in fairness:** the derivation *method* is principled — discrimination-proportional allocation, 50% shrinkage toward V1 as regularization, a 0.05 evidence floor, and a bounded 0.10 taxonomy prior (`competitorQualificationModel.ts:74-82`; `competitorCalibrationAnalysis.ts:351-369`). The regularization shows awareness of overfitting risk. The defect is the **absence of held-out data**, not carelessness in the optimizer. The fix is new data, not new code.

### 6.3 F3 — "Semantic" retrieval is lexical feature hashing

**Prior claim:** "hybrid semantic/lexical clustering" is a differentiated capability; `hybridSemanticRetrievalService` offers a `semantic_only` mode.

**Repository evidence — conclusive.** Three distinct vector paths exist and had been conflated:

| Path | Implementation | Genuinely semantic? |
|---|---|---|
| **(a) Real embeddings** | OpenAI `text-embedding-3-small`, 1536-dim — `signalEmbeddingService.ts:16-17,79,171,328`; `topicCandidateService.ts:132` | ✅ **YES** — but third-party |
| **(b) Hash vectors** | `deterministicEmbedding` — `semanticIndexingService.ts:47-56`, duplicated at `hybridSemanticRetrievalService.ts:49` | ❌ **NO** |
| **(c) Hybrid retrieval** | Consumes **(b)**, not (a) — `hybridSemanticRetrievalService.ts:154` | ❌ **NO** |

The implementation of (b), verbatim (`semanticIndexingService.ts:47-56`):

```ts
function deterministicEmbedding(text: string, dim = SEMANTIC_INDEXING_DEFAULT_DIM): number[] {
  const counts = new Array<number>(dim).fill(0);
  for (const tok of tokenise(text)) {
    const h = createHash('sha256').update(tok).digest();
    const bucket = h.readUInt32BE(0) % dim;
    counts[bucket] += 1;
  }
  const magnitude = Math.sqrt(counts.reduce((acc, v) => acc + v * v, 0)) || 1;
  return counts.map((v) => Number((v / magnitude).toFixed(6)));
}
```

This is the **hashing trick (feature hashing)**: an L2-normalised token-frequency histogram over sha256 buckets. Its own header describes it accurately — "the L2-normalised token-frequency vector over the resulting `dim`-bucket histogram" (`semanticIndexingService.ts:44-45`).

**Why it is not semantic — decisive:** sha256 is designed so that similar inputs produce maximally dissimilar outputs. Synonyms ("car"/"automobile") land in unrelated buckets with probability ≈ 1 − 1/dim. The representation has **zero** capacity for semantic generalization; cosine over it is a normalized lexical-overlap measure and nothing more. No repository evidence establishes any semantic behaviour, and none can, because the construction precludes it.

The routing is explicit — `hybridSemanticRetrievalService.ts:154`:
```ts
const queryEmbedding = mode === 'lexical_only' ? null : deterministicEmbedding(input.query, SEMANTIC_INDEXING_DEFAULT_DIM);
```
So `semantic_only` mode embeds the query with the **hash** function, and `hybrid` mode combines lexical scoring with hash-vector cosine at weights 0.4 / 0.6 (`:94-95`).

**CORRECTED TERMINOLOGY (binding):**

| Do not say | Say instead |
|---|---|
| "semantic retrieval" (re: this service) | "hybrid lexical retrieval (token-overlap + hashed term-frequency cosine)" |
| "semantic clustering" | "lexical clustering" — unless the path demonstrably uses (a) |
| "semantic embedding" (re: `deterministic_hash_v1`) | "deterministic hashed term-frequency vector" |
| "semantic_only mode" | "hashed-term-frequency mode" |

The identifiers `semantic_only`, `semanticWeight`, `semanticIndexingService` and the table `semantic_retrieval_explanations` are **existing code and database names and were NOT changed** (§1 scope). This is a documentation-and-claims correction only. Any future rename is a separate, out-of-scope task.

**Severity: HIGH** — a live, externally-visible overclaim, and the cheapest of the three to correct.

---

## 7. Threshold Census

All material thresholds in differentiated decision systems. Classification per §9 of the task.

| # | Threshold | Value | File:Line | Mechanism | Source | Derivation | Dataset | Sens. analysis | Calib. evidence | Classification |
|---|---|---|---|---|---|---|---|---|---|---|
| T-01 | `DEFAULT_ORIGINALITY_THRESHOLD` | 0.82 | `originalityGate.ts:52` | `score >= t ⇒ isOriginal` | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-02 | `DEFAULT_MAX_CANDIDATES` | 50 | `originalityGate.ts:54` | memories compared | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-03 | `SIMHASH_CUTOFF` | 0.9 | `originalityGate.ts:57` | stage-3 confident dup | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-04 | `SEMANTIC_CUTOFF` | 0.82 | `originalityGate.ts:58` | stage-4 confident dup | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-05 | `EMBEDDING_CUTOFF` | 0.92 | `originalityGate.ts:59` | stage-6 confident dup | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-06 | `VARIANT_CUTOFF` | 0.85 | `originalityGate.ts:60` | stage-7 sibling variant | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-07 | `STRUCTURAL_SEMANTIC_FLOOR` | 0.6 | `originalityGate.ts:62` | structural dup requires semantic backing | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-08 | `FRESHNESS_MULTIPLIER.today` | 1.0 | `groundingPolicy.ts:16-18` | confidence multiplier | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-09 | `FRESHNESS_MULTIPLIER.recent` | 0.95 | `groundingPolicy.ts:16-18` | ditto | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-10 | `FRESHNESS_MULTIPLIER.aging` | 0.8 | `groundingPolicy.ts:16-18` | ditto | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-11 | `FRESHNESS_MULTIPLIER.stale` | 0.5 | `groundingPolicy.ts:16-18` | ditto | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-12 | `FRESHNESS_MULTIPLIER.unknown` | 0.7 | `groundingPolicy.ts:16-18` | ditto | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-13 | `GROUNDING_FLOOR_THRESHOLD` | 0.3 | `groundingPolicy.ts:21` | floor-breach gate | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-14 | freshness `today` boundary | ≤1 day | `groundingPolicy.ts:30` | freshness bucket | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-15 | freshness `recent` boundary | ≤7 days | `groundingPolicy.ts:31` | freshness bucket | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-16 | `staleDays` | 14 | `groundingPolicy.ts:28` | stale window | hard-coded default param | **partial** — header cites parity with the website freshness engine (`:25-26`) | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** (consistency rationale only) |
| T-17 | Quality dimension weights (12) | 0.12/0.08/0.1/0.1/0.1/0.08/0.07/0.08/0.07/0.07/0.06/0.07 | `qualityEngine.ts:53-64` | scorecard composition | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-18 | V1 weights (7 signals) | 0.22/0.20/0.15/0.12/0.08/0.13/0.10 | `competitorQualificationModel.ts:57-70` | qualification score | hard-coded | header claims calibration (`:51-52`) | 47-case | no | **in-sample only** | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-19 | V2 weights (7 signals) | 0.19/0.21/0.17/0.17/0.09/0.07/0.10 | `competitorQualificationModel.ts:89-102` | qualification score | derived | **method documented** (`:74-82`), **fitted on validation set (F2)** | 47-case `ALL` | no | **in-sample only** | **EXPERIMENTAL — derivation exists, generalization UNPROVEN** |
| T-20 | `qualifyThreshold` | 55 | `competitorQualificationModel.ts:68,100` | qualify cut | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-21 | `borderlineThreshold` | 40 | `competitorQualificationModel.ts:69,101` | borderline band | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-22 | `taxonomyCap` | 0.1 | `competitorCalibrationAnalysis.ts:348` | bounded taxonomy prior | hard-coded | rationale prose only | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-23 | `HIGH_PERCENTILE` | 0.6 | `learningEngine.ts:35,116` | winning content | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-24 | `LOW_PERCENTILE` | 0.4 | `learningEngine.ts:36,117` | losing content | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-25 | Rollup caps | 50/30/25/25 | `learningEngine.ts:39-42` | bounded rollup | hard-coded | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-26 | `lexicalWeight` | 0.4 | `hybridSemanticRetrievalService.ts:94` | hybrid blend | hard-coded default | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |
| T-27 | `semanticWeight` | 0.6 | `hybridSemanticRetrievalService.ts:95` | hybrid blend | hard-coded default | absent | — | no | no | **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** |

### 7.1 Census verdict

| Classification | Count |
|---|---|
| **CALIBRATED (derivation + held-out validation)** | **0 of 27** |
| EXPERIMENTAL (derivation exists, generalization unproven) | 1 — T-19 |
| **ENGINEERING DEFAULT — NOT EMPIRICALLY CALIBRATED** | **26 of 27** |
| With sensitivity analysis | 0 |

> **No threshold in any differentiated system is empirically calibrated against held-out data.** One (T-19) has a documented derivation, and that derivation is confounded (F2). "Proprietary calibration" is therefore **not currently a supportable Q1 or Q3 claim.** It is supportable only after derivation records and held-out validation exist.

A `sensitivitySweep` function exists (`competitorCalibrationAnalysis.ts`, exported and imported at `competitorCalibrationAnalysis.test.ts:20`), but no sweep result is recorded anywhere, and sweeping the fitting set would not constitute sensitivity evidence in any case.

---

## 8. Flag-State Census

**Method (independent, tracked files only):** `git ls-files '*.ts' '*.tsx' | xargs grep -hoE "process\.env\.[A-Z][A-Z0-9_]{4,}"` → dedupe.

| Metric | Value |
|---|---|
| Distinct `process.env.*` names in tracked source | **713** |
| Of those, flag-shaped (`_ENABLED`/`_MODE`/`_SHADOW`/`_ROLLOUT`) | **111** |
| Strict default-OFF reads (`=== 'true'`) | **89** |
| Default-ON reads (`!== 'false'`) | **6** |
| Named default-ON flags | `ENABLE_PLANNER_ADAPTER`, `INTERNAL_STAGING_ONLY`, `LANGUAGE_REFINEMENT_ENABLED`, `WIKIDATA_ENABLED` |

### 8.1 Correction — the "215 flags" figure was wrong

DT-SPEC-001 reported "215 distinct flag names". **That figure is incorrect and is withdrawn.** It was produced by a regex over the entire working directory, which included `.claude/worktrees/*/node_modules/**` and matched inside binary files (the run emitted `Binary file ... matches` warnings). The corrected, reproducible figure is **111 flag-shaped names among 713 environment variables** in tracked source.

### 8.2 Flags of interest

| Group | Count | Default | Semantics | Evidence |
|---|---|---|---|---|
| **Understanding** | **16** (8 × `_ENABLED` + 8 × `_AUTHORITATIVE`) | **ALL OFF** | strict `=== 'true'` | `companyIntelligence/flags.ts:8,11` · `contactIntelligence/flags.ts:7,10` · `intentIntelligence/flags.ts:7,10` · `journeyIntelligence/flags.ts:6,9` · `leadUnderstanding/flags.ts:8,13` · `offeringIntelligence/flags.ts:7,10` · `qualificationIntelligence/flags.ts:7,10` · `visitorIntelligence/flags.ts:6,9` |
| Competitor | 1 — `COMPETITOR_MULTISIGNAL_SHADOW` | OFF | accepts `1`/`true`/`on` | `competitorQualificationShadow.ts:32` |
| Autonomous agent | 1 — `AUTONOMOUS_CRON_ENABLED` | OFF | strict `=== 'true'`, "defaults to closed, no inference" | `autonomousFeatureFlag.ts:33,36-41` |
| Capability delegation | 5 — `BOLT_`/`CONTENTGEN_DAY_`/`LONGFORM_`/`TEXTGEN_`/`WRITER_RUNTIME_DELEGATION_ENABLED` | not repo-determinable | varies | grep census |
| Grounding gate | **0** | — | **`evaluateGrounding` is unconditional** | `contextAssimilationEngine.ts:215` |
| Originality gate | **0** | — | **`assertOriginality` is unconditional** | 4 call sites, §5.1 |

### 8.3 Assessment

**Default-deny discipline is PROVEN and is a legitimate SAFE-NOW claim**: 89 strict default-OFF reads against 6 default-ON. The Understanding spine's two-stage gating (`_ENABLED` then `_AUTHORITATIVE`) is careful adoption engineering.

**The same evidence is a hard constraint on capability claims.** Sixteen OFF flags mean the Understanding spine — the largest differentiated body of work in the repository — has **zero production usage**.

⚠️ **Per-environment flag state cannot be determined from the repository.** All statements above describe *code defaults*. Actual production values live in Vercel/Railway environment configuration and constitute **ABSENT** evidence requiring an operator-supplied export.

---

## 9. U1–U9 Evidence Status

No experiment was executed in producing this document. Every status below reflects evidence that already existed at the audited SHA.

| ID | Question | Hypothesis defined? | Baseline | Intervention | Metric | Existing result | **Rung** | Unresolved | Next evidence |
|---|---|---|---|---|---|---|---|---|---|
| **U1** | Does grounding improve factual correctness / reduce hallucination? | informal only | **ABSENT** — no ungrounded control exists | `evaluateGrounding` enforcement | 8 metrics *defined* (`types.ts:94-101`) | **NONE — all `'pending'`** (F1) | **1** | No baseline; no scoring layer; no caller | Build control arm; build scoring layer |
| **U2** | How much variance is provider nondeterminism, and does the deterministic layer absorb it? | not defined | raw repeated calls — not implemented | deterministic stack | not defined | **NONE** | **1** | No variance measurement exists | Repeated-measures design |
| **U3** | Which workloads resist grounding? | not defined | as U1 | as U1, stratified by `workloads.ts` | not defined | **NONE** | **1** | Strictly downstream of U1 | Complete U1 first |
| **U4** | Does qualification generalize to unseen industries? | **yes, defined** — `competitorQualificationCalibration.ts:6-10` | **taxonomy-only gate — IMPLEMENTED ✅** | V2 multi-signal | precision/recall/FP vs taxonomy | **in-sample only, CONFOUNDED** (F2) | **1** | Fitted on validation set; no holdout | Seal ≥60 independently-labeled new cases |
| **U5** | Does abstention improve decision quality? | not defined | forced-answer variant — not implemented | abstention contract | not defined | **NONE** | **1** | Contract enforced but flag-dark | Precision/coverage frontier |
| **U6** | Is 0.82 (and per-stage cutoffs) the right operating point? | not defined | current constants | swept thresholds | not defined | **NONE** | **1** | 7 undocumented constants (T-01..T-07) | Labeled duplicate/non-duplicate pairs; sweep |
| **U7** | Does the learning loop improve outcomes? | not defined | learning inputs suppressed — not implemented | `learning_memory` recommendations | not defined | **NONE** | **1** | Wiring proven both directions; production volume unknown | Production row counts, then longitudinal study |
| **U8** | Do deterministic quality scores track human judgment? | not defined | — | — | — | **NONE** | **1** | Never posed before DT-SPEC-001 | Correlation vs. blind human ratings |
| **U9** | Does the deterministic stack beat direct model invocation? | not defined | **ABSENT — the critical gap** | full stack | — | **NONE** | **1** | **This is the DPIIT question and it has never been posed** | Blind head-to-head vs. counterfactual baseline |

### 9.1 The one genuine asset in the register

**U4 is the only uncertainty with an implemented baseline.** The taxonomy-only gate exists and is explicitly designed as a comparison arm (`competitorQualificationCalibration.ts:6-10`: "scores every case with the multi-signal model AND with a taxonomy-only baseline that mirrors the live category gate"). U4 is therefore **the closest uncertainty to producing real evidence** — it needs only held-out data, not new infrastructure. Every other comparative uncertainty (U1, U3, U5, U6, U7, U9) needs a control arm built from nothing.

---

## 10. Evidence-Ladder Position

```
Rung 7 — Real-world validation     ░░░░░░░░░  0/9
Rung 6 — Held-out validation       ░░░░░░░░░  0/9   ← U4 actively violates
Rung 5 — Human review              ░░░░░░░░░  0/9
Rung 4 — Independent evaluation    ░░░░░░░░░  0/9
Rung 3 — Replication               ░░░░░░░░░  0/9
Rung 2 — Controlled experiment     ░░░░░░░░░  0/9
Rung 1 — Engineering proof         █████████  9/9
```

> **Every one of U1–U9 stands at Rung 1 only.**

Three rung-awarding errors explicitly avoided:
- A harness exists (C-03) → **no rung awarded**; it has never run (F1).
- 1,410 test files exist → **no rung awarded**; tests prove code does what it was written to do, not that it works better than the alternative.
- An in-sample metric exists (U4) → **no rung awarded**; fitting on the validation set is not validation.

---

## 11. Production Indispensability

A capability qualifies as **CORE PRODUCTION TECHNOLOGY** only with (1) an unconditional/live call path, (2) production invocation, (3) telemetry where available, (4) a real technical role, and (5) product dependence on it.

| Capability | (1) Live path | (2) Prod invocation | (3) Telemetry | (4) Role | (5) Dependence | **Verdict** |
|---|---|---|---|---|---|---|
| C-01 Originality cascade | ✅ unconditional, 4 sites | ✅ inferred from live paths | ⚠️ `originalityMetrics.ts` exists; **no prod counter available** | blocks near-duplicates | ✅ | **CORE — differentiated** |
| C-02 Grounding policy | ✅ unconditional, `:215` | ✅ inferred | ⚠️ `groundingObservability.ts` exists; **no prod counter available** | freshness + floor enforcement | ✅ | **CORE — differentiated** |
| C-08 AI gateway | ✅ 190 consumers | ✅ | ⚠️ | provider abstraction | ✅ | **CORE — but STANDARD, not differentiated** |
| C-18 Feature gates | ✅ | ✅ | — | rollout control | ✅ | **CORE INFRASTRUCTURE — not differentiated** |
| C-12 Hybrid retrieval | ✅ 3 consumers | ✅ | ⚠️ | retrieval + explanation | partial | **SUPPORTING — standard; zero tests; F3 mislabeled** |
| C-04 Quality engine | ◐ partial | ◐ | ⚠️ `qualityMetrics.ts` | deterministic scoring | partial | **SUPPORTING — validity unproven (U8)** |
| C-13 Learning loop | ✅ write+read wired | ⚠️ **row volume unknown** | ⚠️ `learningMetrics.ts` | outcome feedback | **weak** | **SUPPORTING — impact unmeasured** |
| C-10 Real embeddings | ✅ | ✅ | ✅ cost-tracked | vectorization | ✅ | **SUPPORTING — THIRD-PARTY, not ours** |
| C-14/15/16/17 | ◐ flag-gated | ◐ | ⚠️ | delegation/control/safety | partial | **SUPPORTING** |
| C-05 Competitor qualification | ❌ shadow only | ❌ | — | — | ❌ | **NOT PRODUCTION** |
| C-06 Abstention contract | ❌ flag-dark | ❌ | — | — | ❌ | **NOT PRODUCTION** |
| C-07 Understanding spine | ❌ 16 flags OFF | ❌ | — | — | ❌ | **NOT PRODUCTION** |
| C-03 Grounding harness | ❌ **no caller** | ❌ | — | — | ❌ | **NOT PRODUCTION** |
| C-11 Hash "embedding" | ✅ | ✅ | — | lexical vectors | partial | **SUPPORTING — standard primitive** |

### 11.1 The central asymmetry

> **Exactly two capabilities are simultaneously (a) live in production, (b) unconditional, and (c) genuinely differentiated: C-01 and C-02.**
>
> **Both have zero efficacy evidence.**
>
> Conversely, the most sophisticated work — the Understanding spine, the abstention contract, the competitor model — is **entirely outside production**.

Any DPIIT artifact presenting C-05, C-06, or C-07 as production capability would be a **material misstatement**. They are R&D assets, and should be presented as such — which is legitimate and arguably favourable for a DeepTech narrative, provided the framing is accurate.

⚠️ Metrics modules exist (`observability/{originalityMetrics,qualityMetrics,learningMetrics}.ts`) but **no production telemetry values are obtainable from the repository**. Criterion (3) is **ABSENT** for every capability and requires an operator-supplied export.

---

## 12. Differentiation Classification

| Mechanism | Classification | Basis |
|---|---|---|
| SimHash, MinHash, Jaccard, shingling, cosine, sha256 | **STANDARD PRIMITIVE** | textbook |
| Feature hashing (`deterministicEmbedding`) | **STANDARD PRIMITIVE** | hashing trick, ~2009 |
| OpenAI embeddings + LLM invocation | **STANDARD PRIMITIVE — third-party** | purchased |
| Percentile thresholding (learning rollup) | **STANDARD PRIMITIVE** | textbook |
| Multi-provider routing, retry/backoff, prompt assembly | **STANDARD ENGINEERING TECHNIQUE** | industry standard |
| Feature-flag gating; governance state machine; safety seams | **STANDARD ENGINEERING TECHNIQUE** | industry standard |
| Hybrid lexical retrieval with mandatory per-hit explanation | **STANDARD ENGINEERING TECHNIQUE** | blend is standard; explanation discipline is good practice |
| **7-stage early-terminating originality cascade with chance-baseline discount** | **PROPRIETARY COMPOSITION** | `originalityGate.ts:1-28`; non-obvious ordering + aggregate design |
| **Architecturally enforced abstention (`Facet`/`EvidenceRef`/`ReasoningTrace`)** | **PROPRIETARY COMPOSITION** | `canonical/scoring.ts:31`; `companyIntelligence/contract.ts:65` |
| **Byte-identical deterministic 12-dimension quality engine** | **PROPRIETARY COMPOSITION** | `qualityEngine.ts:1-20`; determinism is a real engineering constraint |
| **Deterministic grounding policy (freshness enforcement + floor)** | **PROPRIETARY COMPOSITION** | `groundingPolicy.ts:1-11` |
| **Abstention-aware signal renormalization** | **PROPRIETARY COMPOSITION** | `competitorQualificationModel.ts:53-55` |
| Explainable learning rollup (no ML, append-only, idempotent) | **PROPRIETARY COMPOSITION** | `learningEngine.ts:11-20` |
| Dual-namespace provider identity, fail-closed | **STANDARD ENGINEERING TECHNIQUE** | careful, but a standard problem |
| V2 weight derivation (discrimination-Δ + shrinkage + floor) | **EXPERIMENTAL** | method documented; **fitted on validation set (F2)** |
| All 26 undocumented thresholds | **NOT PROPRIETARY CALIBRATION** | engineering defaults (§7) |

### 12.1 Novelty finding

> **No genuinely novel algorithm or scientific contribution identified from repository evidence.**

Every primitive is standard. The defensible position is **proprietary composition** — internally designed arrangements of standard techniques under hard determinism, fail-safety, and abstention contracts. That is a legitimate and common DeepTech posture. It is **not** algorithmic or scientific novelty, and must never be presented as such.

**Proprietary calibration is NOT currently claimable** (§7.1): zero of 27 thresholds are calibrated against held-out data.

---

## 13. Proprietary Know-How Inventory

Strictly separated categories. **No patentability determination is made.**

| Asset | Internally developed | Copyrightable software | Trade-secret candidate | Proprietary calibration | Proprietary dataset | Patent candidate | **Patentability** |
|---|---|---|---|---|---|---|---|
| Originality cascade architecture | ✅ | ✅ | ✅ | ❌ (§7) | ❌ | referral candidate | **NOT DETERMINED — requires prior-art + counsel** |
| Cascade cutoffs T-01..T-07 | ✅ | — | ✅ | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| Grounding policy + T-08..T-16 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| Quality engine rubric T-17 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| Competitor weights V1/V2 + optimizer | ✅ | ✅ | ✅ | **⚠️ confounded (F2)** | ❌ | ❌ | **NOT DETERMINED** |
| 47-case calibration dataset | ✅ | ✅ | ✅ | — | **✅ (only proprietary dataset identified)** | ❌ | **NOT DETERMINED** |
| Evidence/abstention contract | ✅ | ✅ | ⚠️ (architecture is disclosable) | ❌ | ❌ | referral candidate | **NOT DETERMINED** |
| Understanding spine (8 engines) | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| AI gateway + identity mapping | ✅ | ✅ | ❌ (standard) | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| Governance / safety / runtimes | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ | **NOT DETERMINED** |
| OpenAI SDK/models/embeddings, Next.js, Supabase, BullMQ, Redis, Vercel, Railway (52 prod deps) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **NOT APPLICABLE — third-party** |

### 13.1 Disclosure boundary

| Disclose | Withhold |
|---|---|
| Existence and architecture of the cascade; stage count; ordering principle | Exact cutoff values (T-01..T-07); the chance-baseline discount formula |
| Existence of a grounding policy; freshness-enforcement principle | Multiplier table; floor value; window boundaries |
| Abstention contract architecture; type shapes | — |
| Existence, size and design axes of the calibration dataset | Dataset contents and labels |
| Quality-engine determinism guarantee and dimension count | Dimension weights |
| Dependency list (must be declared) | — |

### 13.2 Two hard constraints

1. **No patentability assertion is made anywhere in this document**, and none may be made until a qualified practitioner completes a prior-art review. Two referral candidates are identified; "referral candidate" means *worth asking a professional about*, nothing more.
2. **Copyright basis is BLOCKED pending an authorship determination.** See §15 / BG-05.

---

## 14. DPIIT Q1–Q6 Evidence Status

### Q1 — Novel systems / processes → **SUPPORTED (composition) / UNPROVEN (novelty)**
Supportable: proprietary composition of standard primitives under determinism + abstention contracts (§12). Two strongest candidates: originality cascade (C-01), abstention contract (C-06 — *with the mandatory qualifier that it is not in production*).
**Not supportable:** algorithmic novelty, scientific contribution, proprietary calibration (§7.1), "semantic" clustering (F3).

### Q2 — R&D intensity & capital → **ABSENT (≈85% outside the repository)**

| Item | Repo | Status |
|---|---|---|
| Development period, volume, cadence | ✅ 931 commits, 2026-01→09, 1,410 tests | **PROVEN** |
| Architecture/design deliberation | ✅ `docs/pmo/`, `docs/company-intelligence/` | **SUPPORTED** |
| Model/API spend | ◐ tracking code only (`usageLedgerService`, `pricingService`) | **PARTIAL** |
| R&D expenditure; CA certification; payroll; personnel; qualifications; time allocation; infrastructure invoices; grants/AIF; board records | ❌ | **ABSENT** |

⚠️ **Q2 is the binding constraint on DPIIT readiness and no engineering work can close it.**

### Q3 — Proprietary IP / know-how → **SUPPORTED (existence) / UNPROVEN (defensibility)**
Internal development and copyrightable software: **PROVEN**. Trade-secret candidates: identified. Proprietary calibration: **UNPROVEN** (§7.1). Patentability: **NOT DETERMINED**. Copyright basis: **BLOCKED** on authorship (BG-05).

### Q4 — Technical uncertainty → **UNPROVEN across all nine**
Nine uncertainties, all at Rung 1, zero experiments (§9, §10). U4 alone has an implemented baseline.

### Q5 — Core technology indispensability → **PARTIAL**
Two capabilities qualify as core-and-differentiated (C-01, C-02) — both without efficacy evidence. Two are core-but-standard (C-08, C-18). Four are explicitly **not production** (C-03, C-05, C-06, C-07). Telemetry criterion **ABSENT** for all (§11).

### Q6 — DeepTech / technology dependence → **SUPPORTED**

| Boundary | Content |
|---|---|
| **Omnivyra-owned** | Originality cascade · grounding policy · quality engine · abstention contract · Understanding engines · competitor model · governance · safety · capability runtimes |
| **Omnivyra orchestration** | AI gateway · `runAiExecution` seam · task-policy registry |
| **Third-party models** | OpenAI (sole SDK dep); transports target Gemini, Perplexity, Copilot, Anthropic |
| **Third-party embeddings** | OpenAI `text-embedding-3-small` — **all real embeddings are third-party** |
| **Open source** | 52 production dependencies |
| **External services** | Supabase, Railway, Vercel, Upstash |

**Differentiation resides in — evidence-ranked:** (1) systems architecture & decision systems; (2) evidence handling & abstention *(architecturally, not behaviourally)*; (3) orchestration & integration *(standard)*; (4) calibration — **claimed but not substantiated**; (5) algorithms — composition only; (6) **model research — ZERO**.

---

## 15. Claim-Control Matrix

### ✅ SAFE NOW

| Claim | Evidence |
|---|---|
| A deterministic 7-stage originality cascade runs **unconditionally** on live content generation | `originalityGate.ts`; 4 call sites §5.1 |
| A grounding policy enforcing freshness-degraded confidence and an evidence floor runs in production | `groundingPolicy.ts`; `contextAssimilationEngine.ts:215` |
| A 12-dimension quality engine scores content with **byte-identical determinism** — no AI calls, no DB, no wall-clock | `qualityEngine.ts:1-20` |
| An abstention-first evidence contract is **architecturally enforced** across 8 Understanding engines *(add: not in production)* | `canonical/scoring.ts:31` |
| Default-deny feature-flag discipline: 89 strict default-OFF vs 6 default-ON | §8 |
| ~9 months sustained development: 931 commits, 1,410 test files | §2 |
| A multi-provider AI gateway with fail-closed dual-namespace provider identity *(standard technique)* | `aiGatewayProviderIdentity.ts:6-24` |
| Per-call cost attribution and anomaly detection for embeddings/models | `signalEmbeddingService.ts:5-14` |
| Fail-open/fail-safe design so quality machinery never blocks production | `originalityGate.ts:25-28`; `learningEngine.ts:11-13` |

### ⚠️ SAFE ONLY AFTER VALIDATION

| Claim | Blocker |
|---|---|
| Grounding improves factual correctness / reduces hallucination | U1 — needs baseline + scoring layer |
| The deterministic stack outperforms direct model invocation | **U9 — never posed** |
| Competitor qualification generalizes to unseen industries | U4 — needs sealed held-out set |
| Thresholds are empirically calibrated | U6 + §7 — 0 of 27 today |
| Abstention improves decision quality | U5 |
| Quality scores track human judgment | U8 |
| The learning loop improves outcomes | U7 |

### 🚫 NOT SAFE — must not appear in DPIIT or external material

| Claim | Reason |
|---|---|
| **Proprietary AI model** | Zero training code; sole AI dep is `openai`; no ML framework. **Categorically false** |
| **Trained / fine-tuned model** | Same |
| **Scientific novelty** | §12.1 — no novel algorithm identified |
| **Patent / patentable / patent-pending** | No prior-art review, no counsel opinion (§13.2) |
| **Production accuracy figures** | **No accuracy has ever been measured** (F1) |
| **Customer efficacy** | No outcome study exists |
| **Closed-loop learning** | Loop wired; impact unmeasured (U7) |
| **Agentic production capability** | `AUTONOMOUS_CRON_ENABLED` OFF; containment mode (`autonomousFeatureFlag.ts:89`) |
| **Semantic clustering / semantic retrieval** (re: C-12) | **F3 — lexical feature hashing** |
| **Validated / experimentally proven grounding** | **F1 — zero scored runs, no caller** |
| **Competitor model generalizes** | **F2 — fitted on the validation set** |
| **Proprietary calibration** | §7.1 — 0 of 27 thresholds calibrated |
| **Understanding spine / abstention contract as live capability** | 16 flags OFF |
| **DeepTech-ready** | 0 of 9 criteria met |

---

## 16. Delta Against DT-SPEC-001

| ID | DT-SPEC-001 statement | Repository evidence | Corrected position | Severity |
|---|---|---|---|---|
| D-01 | "215 distinct flag-like env names" | 111 flag-shaped among 713 env names in tracked source; 215 came from a scan including `.claude/worktrees/*/node_modules` and binary files | **111 flag-shaped / 713 total.** 215 withdrawn | **HIGH** — methodology error in own prior work |
| D-02 | "all 8 Understanding-spine flags default OFF" | **16 flags** — every Understanding has `_ENABLED` **and** `_AUTHORITATIVE` | **16 flags, all OFF.** Conclusion unchanged and strengthened | MEDIUM |
| D-03 | Competitor dataset "33 cases" | Two arrays: `CALIBRATION_CASES` 14 + `EXTENDED_CALIBRATION_CASES` 33 = **47** | **47 cases.** F2 conclusion unchanged and strengthened | MEDIUM |
| D-04 | C-03 grounding harness = `SHADOW/TEST ONLY` | **No caller anywhere** — no script, job, route, or npm script | **CONCEPT/FUTURE.** Worse than reported | **HIGH** |
| D-05 | C-12 hybrid retrieval tests "✅" | **Zero** test files reference `retrieveHybrid`/`hybridSemanticRetrievalService` | **ZERO test coverage on a live 3-consumer capability.** Worse than reported | **HIGH** |
| D-06 | C-05 competitor differentiation "MEDIUM" | Parameters fitted on the validation set | **EXPERIMENTAL.** Downgraded | MEDIUM |
| D-07 | Prior-artifact search: hit in `docs/archive/REDIS_POLLING_INDEX.md` | Line 162 `### Path 4: Deep Technical Dive` — substring of "Deep **Tech**nical"; file is gitignored (`.gitignore:35`) and untracked | **Zero DeepTech artifacts.** Conclusion unchanged; provenance now exact | LOW |
| D-08 | Threshold count implied ~8 | **27 material thresholds** censused | **27 thresholds; 0 calibrated; 26 engineering defaults** | MEDIUM |
| D-09 | Code comment: V2 derived over "the 44-case dataset" (`competitorQualificationModel.ts:75`) | Actual `ALL` = 47 | **In-code comment is inaccurate.** Recorded; **not changed** (§1 scope) | LOW |
| D-10 | Test file count "1,156 unit + 128 integration" | `git ls-files`: 1,147 unit, 128 integration, **1,410 total** | **1,410 total tracked test files** | LOW |

**Ten contradictions recorded, four of them in DT-SPEC-001's own favour being corrected downward (D-04, D-05, D-06, D-01).** No contradiction is hidden and no prior statement was silently amended.

---

## 17. Blocking Gaps

| ID | Gap | Severity | Blocks | Closable by engineering? |
|---|---|---|---|---|
| **BG-01** | **No counterfactual baseline exists** — no ungrounded/direct-model control arm anywhere | 🔴 CRITICAL | U1, U3, U5, U6, U8, **U9** — six of nine | ✅ Yes |
| **BG-02** | **Grounding harness has no scoring layer and no caller** (F1) | 🔴 CRITICAL | U1, U3 | ✅ Yes |
| **BG-03** | **Competitor weights fitted on validation set; zero holdout constructs repo-wide** (F2) | 🔴 CRITICAL | U4; credibility of every calibration claim | ⚠️ Needs **new, independently-labeled data** |
| **BG-04** | **All Q2 financial/personnel evidence outside the repository** | 🔴 CRITICAL | DPIIT readiness entirely | ❌ **No — longest external lead time** |
| **BG-05** | **AI-assisted-development authorship position absent.** `.claude/worktrees/agent-*` directories present; 528 commits in 2026-07 across 3 identities | 🔴 CRITICAL | Q2 personnel, Q3 copyright, **filing integrity** | ❌ No — requires counsel |
| **BG-06** | **Zero thresholds calibrated** (0/27) | 🟠 HIGH | Q1/Q3 "proprietary calibration" | ✅ Yes |
| **BG-07** | **"Semantic" mislabeling live** (F3) | 🟠 HIGH | Q1/Q6 accuracy | ✅ Yes — cheapest fix in the program |
| **BG-08** | **No production telemetry obtainable from repo** | 🟠 HIGH | Q5 criterion (3) for every capability | ❌ Needs operator export |
| **BG-09** | **Per-environment flag state not repo-determinable** | 🟠 HIGH | All production-state claims | ❌ Needs operator export |
| **BG-10** | **Largest differentiated surface (C-07, 16 flags) has zero production usage** | 🟠 HIGH | Q5 for that surface | ⚠️ Product decision |
| **BG-11** | **C-12 live with zero tests** | 🟠 HIGH | Reliability of a live capability | ✅ Yes |
| **BG-12** | **U9 never posed** — the central DPIIT question | 🟠 HIGH | The entire technical thesis | ✅ Yes (after BG-01) |
| **BG-13** | Learning-loop production volume unknown | 🟡 MEDIUM | U7 | ⚠️ Needs time + traffic |
| **BG-14** | Quality engine never validated against human judgment | 🟡 MEDIUM | Q1 quality claim | ✅ Yes |
| **BG-15** | No prior-art review | 🟡 MEDIUM | Any novelty language | ❌ Requires counsel |

⚠️ **BG-04 and BG-05 are the two gaps engineering can never close, and together they gate DPIIT readiness completely.** They have the longest external lead times in the program and should be started immediately and in parallel with all technical work.

---

## 18. Recommended Next Evidence

**BG-01 remains the highest-priority technical blocker**, re-confirmed rather than assumed. It blocks six of nine uncertainties including U9 (the central DPIIT question), it has no prerequisite of its own, and no other technical work can produce comparative evidence while it is open.

**Smallest executable step that removes it:** build the ungrounded control arm for the existing `canonicalGrounding` dataset. Scope is deliberately minimal — a control arm only, no scoring layer, no rater protocol, no experiment execution. The dataset already exists and is deterministic (fixed `EVAL_EPOCH`, `dataset.ts:10`), so the control arm is the only missing piece before any comparison becomes possible.

**Explicitly deferred and why:**
- **U1 execution** — cannot run; needs both BG-01 and BG-02 closed.
- **Scoring layer (BG-02)** — correctly sequenced *after* the baseline; a scorer with nothing to compare against produces nothing.
- **U4 / held-out set (BG-03)** — genuinely parallel and independent; it needs data acquisition, not engineering, so it should start now on a separate track rather than compete for the critical path.
- **F3 correction (BG-07)** — cheapest item in the program and removes a live overclaim; should be done opportunistically, but it is documentation, not evidence, so it does not advance any rung.

**Start immediately in parallel (non-engineering, longest lead times):** BG-04 (CA/financial records), BG-05 (counsel-reviewed authorship position), BG-08/BG-09 (operator-supplied production telemetry and per-environment flag export).

---

## 19. Reproduction Instructions

```bash
git fetch --all
git checkout 82754497e8f9b64a893319e863941ad2994fd9b7   # verify clean tree; see §1.2
git rev-parse HEAD    # must equal 82754497e8f9b64a893319e863941ad2994fd9b7

# §3 prior-artifact search
rg -i "DPIIT|DeepTech|Deep Tech" ; rg -i "technical uncertainty|originality cascade|trade secret"

# §6.1 F1
rg -n "pending|reviewer" backend/evaluation/canonicalGrounding/
rg -n "canonicalGrounding|liveRunner" --glob '!backend/evaluation/**'   # expect: no caller

# §6.2 F2
rg -ni "holdout|heldOut|crossValidat|kFold|train_test|validationSet"    # expect: 0 material
rg -n "deriveOptimizedProfile\(ALL\)|evaluateProfile\(ALL" backend/tests/unit/competitorCalibrationAnalysis.test.ts

# §6.3 F3
sed -n '47,56p' backend/services/semanticIndexingService.ts
sed -n '154p'   backend/services/hybridSemanticRetrievalService.ts

# §8 flag census
git ls-files '*.ts' '*.tsx' | xargs grep -hoE "process\.env\.[A-Z][A-Z0-9_]{4,}" | sed 's/process\.env\.//' | sort -u | wc -l
```

**Every factual claim in this document is traceable to a `file:line` reference at the stated SHA.** Where evidence could not be established from the repository, the claim is marked `ABSENT` or `UNPROVEN` with the specific external evidence or future experiment identified. Nothing is inferred where it could be verified, and nothing is upgraded because implementation exists.

---

*End of `DEEPTECH_BASELINE_001`. No production code, tests, flags, thresholds, configuration, migrations, or database state were modified in producing this document. No experiment was executed. No external model API was called. No commit or PR was created.*
