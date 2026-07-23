# CONVERSATION-INTELLIGENCE-004 — Duplicate & Production Certification

**Type:** Certification-only (no feature code introduced).
**Branch:** `feat/company-profile-conversation-intelligence` — 7 commits ahead of `origin/main` (`f6cda8d0`…`e7625ef9`).
**Verdict:** ✅ **PRODUCTION-READY** (flag-dark). No production-blocking defect found. All remaining work is operational hardening or future enhancement.

---

## Executive Summary

The Company Profile Conversation Intelligence implementation (CONV-INTEL-001 A–E,
-002, -003) is certified production-ready. Objective evidence proves **exactly one
canonical implementation** of every capability, **no architectural drift** (no
parallel orchestrator / knowledge model / readiness evaluator / route interview
engine), behavioural guarantees hold across both governed routes, and flag-OFF
behaviour is byte-identical. The entire program ships **dark** (all flags default
OFF), so production runtime/customer impact is zero until deliberately enabled.

The success criteria are met:

| Success criterion | Status |
|---|---|
| exactly one canonical conversation implementation | ✅ `profileConversationOrchestrator.ts` |
| exactly one readiness evaluator (conversation) | ✅ `profileKnowledgeReadiness` |
| exactly one extraction engine | ✅ `chatKnowledgeExtraction.ts` |
| exactly one persistence path | ✅ `saveProfile` |
| exactly one completion engine | ✅ orchestrator terminal state |
| duplicate conversation logic eliminated | ✅ none introduced; legacy field-count demoted |
| behavioural guarantees hold across governed routes | ✅ 109/109 tests |
| no architectural drift | ✅ (Phase 3) |
| production readiness demonstrated | ✅ (Phase 6) |
| remaining work classified as hardening/future | ✅ (Phase 7) |

---

## Phase 1 — Ownership Matrix

Each capability resolves to exactly one definition site (verified by repo-wide
`export function` search):

| Capability | Single owner | Line |
|---|---|---|
| Company Knowledge Graph | `backend/services/companyProfile/companyKnowledgeGraph.ts` `buildCompanyKnowledgeGraph` | 337 |
| Question Selector | same file · `selectNextProfileQuestion` | 439 |
| Semantic Eligibility / node resolver | same file · `isQuestionEligible` / `resolveQuestionNode` | 419 / 404 |
| Readiness Evaluator | same file · `profileKnowledgeReadiness` | 471 |
| Confidence Model | same file · `readFieldConfidenceBand` | (Phase A) |
| Conversation Orchestrator | `profileConversationOrchestrator.ts` `orchestrateProfileConversation` | 182 |
| Completion Intelligence | same file · terminal state + `PROFILE_CONVERSATION_HANDOFF_KEY` | 106 |
| Productive-Work Handoff | same file · `PROFILE_CONVERSATION_HANDOFF_KEY = 'campaign-strategy'` | 106 |
| Knowledge Extraction | `chatKnowledgeExtraction.ts` `extractAndPersistProfileKnowledge` | 186 |
| Persistence | `companyProfileServiceRest1Rest2Pulse.ts` `saveProfile` | 484 |
| Feature Flags | `lib/platform/rollout.ts` — reused (`profile-conversation-orchestrator`, `profile-chat-extraction`, `profile-knowledge-readiness`) | — |

---

## Phase 2 — Duplicate Certification

Exactly one implementation of each capability. Three symbols that *look* like
candidates were examined and classified:

| Symbol | Classification | Evidence |
|---|---|---|
| `isQuestionEligibleForOrchestration` (orchestrator) | **Thin adapter, not a duplicate** | body is `return isQuestionEligible(decision.graph, questionText)` — pure delegation to the canonical graph function |
| `calculateCompanyProfileCompleteness` (`fieldConstants.ts`) | **Intentional compatibility layer** (field-count DISPLAY helper, demoted in CONV-INTEL-002) | single definition; live use is only the flag-OFF fallback at `index.ts:349`; 4 `companyProfileService*` files import for **barrel re-export** (not called as a decision — pre-existing in HEAD); it is NOT a competing conversation-readiness decision |
| `calculateIntelligenceReadiness` (`companyContextIntelligenceService.ts`) | **Different domain — not a duplicate** | firmographic/context-intelligence signal; deliberately kept independent by CONV-INTEL-002 |

**Remaining duplicate implementations: none.**
**Migration artifact:** `pages/api/company-profile/completeness.ts` is a **dead endpoint** (zero callers across `pages/components/lib/src/app`). It pre-dates this program (identified in the CONV-INTEL-001 audit) and builds the graph only to serve a route nothing calls. Classification: **migration artifact / pre-existing dead route** — safe to leave; recommended-follow-up removal (not a blocker).

---

## Phase 3 — Architectural Drift Audit

| Drift class | Result |
|---|---|
| parallel orchestrators | ❌ none — only `profileConversationOrchestrator.ts`; imported solely by the 2 governed routes |
| parallel knowledge models | ❌ none — single `companyKnowledgeGraph.ts`; `buildCompanyKnowledgeGraph` referenced only by the 2 governed routes + `index.ts` (readiness surface) + `completeness.ts` (dead) |
| parallel readiness evaluators | ❌ none for the conversation — field-count demoted, intelligence-readiness is a separate domain |
| route-specific interview engines | ❌ none — governed routes delegate; the 3 non-governed routes are documented distinct surfaces (CONV-INTEL-003 §4), not forks of the canonical |
| duplicate extraction | ❌ none — single `extractAndPersistProfileKnowledge`, itself reusing `buildExtractionPrompt` |
| duplicate persistence | ❌ none — single `saveProfile` seam |
| duplicate confidence logic | ❌ none — single `readFieldConfidenceBand` |

**Architectural consistency: CERTIFIED.**

---

## Phase 4 — Behavioural Certification

Full CONV-INTEL test corpus (12 suites, **109/109 passing**, bounded run):

`companyKnowledgeGraph` · `profileConversationOrchestrator` · `profileConversationCompletion` ·
`profileKnowledgeReadinessInvariants` · `chatKnowledgeExtraction` · `chatExtractionLoopClosed` ·
`companyProfileCompletenessEndpoint` · `companyProfileIndexKnowledgeReadinessEndpoint` ·
`defineTargetCustomerOrchestratorPilot` · `defineTargetCustomerCompletionPilot` ·
`defineTargetCustomerChatExtractionPilot` · `defineCampaignPurposeCanonicalAdoption`.

Every governed-route guarantee is asserted for **both** `define-target-customer`
and `define-campaign-purpose`:

| Guarantee | Proven |
|---|---|
| highest-value unknown selection | ✅ satisfied-node re-ask replaced with highest-value gap |
| semantic deduplication / never-re-ask | ✅ satisfied node refused in any phrasing |
| multi-field extraction | ✅ loop-closed proof (answer → save → node ineligible) |
| confidence-aware progression | ✅ readiness gates on `field_confidence` bands |
| readiness-driven progression | ✅ completion delegates to `enoughToProceed` |
| completion intelligence | ✅ terminal state at core sufficiency, no false completion |
| productive-work handoff | ✅ `transition.suggestedNext === PROFILE_CONVERSATION_HANDOFF_KEY` |

**Behaviour is consistent across all governed routes: CERTIFIED.**

---

## Phase 5 — Compatibility Certification

| Dimension | Result |
|---|---|
| Backward compatibility | ✅ every flag defaults OFF |
| API compatibility | ✅ flag-OFF response contracts byte-identical (asserted for both routes; index.ts `overall_profile_completion` byte-identical OFF) |
| Prompt compatibility | ✅ campaign-purpose grounding is flag-gated → OFF prompt is byte-identical (asserted) |
| Persistence compatibility | ✅ unchanged `saveProfile`, `source:'user'`; no new tables/stores |
| Feature-flag compatibility | ✅ reuses shared Rollout Kit; no new flag family |
| UI compatibility | ✅ OFF: no change. ON: additive `{complete,transition,readiness}` terminal shape; no downstream workflow invoked |

**Flag-OFF byte-identity: CERTIFIED wherever specified.**

---

## Phase 6 — Production Readiness

| Gate | Result |
|---|---|
| Repository impact | 7 commits, all `backend/services/companyProfile/*` + 2 routes + `index.ts` + tests/docs; no cross-cutting change |
| Runtime impact | Zero when flags OFF (grounding + orchestrator + extraction all gated). ON: one graph build/turn; extraction runs `saveProfile` (same cost profile as pilot) |
| Customer impact | Zero until enabled (dark) |
| Performance | Graph build is pure/in-memory; no new I/O on the OFF path |
| Observability | Reuses `rollout.shadow{flag,result}` metrics; no new metric names (see Phase 7 for expansion recommendation) |
| Rollback | Flip flags OFF — no persisted state introduced; commits are additive |
| Feature-flag strategy | Three flags, all default OFF; one toggle (`profile-conversation-orchestrator`) governs both routes |
| Deployment safety | Additive, flag-dark; no schema/migration changes |
| Typecheck (backend certification) | ✅ `tsconfig.backend.json` 1/1 baseline · `tsconfig.backend-tests.json` 470/470 baseline · **net-new 0** (working-tree attribution) |
| Typecheck (app project) | ✅ 6 errors = branch baseline; **none** in the conversation routes (the 6 are pre-existing in Bolt/Leads/companyProfileForm/`index.ts:308`, unrelated to this program) |
| Tests | ✅ 109/109 CONV-INTEL |
| CI | ✅ Backend TypeScript certification job green (net-new 0) |
| Production build | Typecheck-certified. A full `next build` was **not** re-run; the only outstanding app-tsc errors are pre-existing baseline errors in components off the conversation path (not introduced here) — not a build regression from this program |

**Production readiness: DEMONSTRATED.**

---

## Phase 7 — Deferred Items Classification

| Deferred item | Classification | Rationale |
|---|---|---|
| **Confidence-contract consolidation** (migrate live `companyProfileProvenanceService.readAiConfidence` + CKRE `domainConfidence` onto `readFieldConfidenceBand`) | **Recommended follow-up** (separately governed) | Changes content-gen / review-UI outputs → needs its own before/after decision. Does NOT block the conversation program (the graph already reads confidence tolerantly). |
| **Observability expansion** | **Future enhancement** | Current `rollout.shadow` metrics are sufficient to operate the dark rollout; richer conversation telemetry is additive. |
| **Prompt hygiene** (prompt sprawl in the define-* routes) | **Recommended follow-up** | Cosmetic/maintainability; no correctness impact. |
| **`guidance.ts` write-path cleanup** (raw-update bypass) | **Recommended follow-up** | `guidance.ts` is not a governed conversation route and does not touch the canonical seams; its raw write is a pre-existing hygiene item, not on the certified path. |
| **completeness.ts dead endpoint** | **Recommended follow-up** | Pre-existing dead route; safe to leave, tidy to remove. |
| **4 non-governed define-* routes** (marketing/context/problem-transformation breadth) | **Out of scope / future** | CONV-INTEL-003 documented these as architecturally distinct with forward paths; forcing them would breach Non-Goals. |

**No deferred item is a production blocker.**

---

## Phase 8 — Repository Health

| Aspect | Finding |
|---|---|
| Branch cleanliness | ✅ 7 clean, linear CONV-INTEL commits on top of `origin/main`; fast-forwardable (0 behind) |
| Local `main` ref | ⚠️ **stale/absent** — merge readiness must be assessed against `origin/main` (which already contains PR#3 `95babf96`), not local `main`. Cosmetic; no impact on the commits. |
| Certification status | ✅ all 7 commits individually certified at commit time; re-certified in aggregate here |
| Open implementation branches | This branch is the sole CONV-INTEL branch; not pushed |
| **Parallel workstream (MERGE RISK)** | ⚠️ **9 uncommitted files** from a concurrent competitor-identity/capability effort live in the same working tree: `entityArchetype.ts`, `companyProfileServiceCore.ts`, `companyProfileServiceRest1Enrich.ts`, `companyProfileServiceRest1Rest2Competitors.ts`, `companyProfileServiceRest1Rest2Pulse.ts`, `competitorEngineServiceEngineRankingFinal.ts`, `competitorEngineServiceModel.ts`, `competitorEngineService.test.ts`, `competitorIdentityCapabilityGuard.test.ts`. **Not authored by CONV-INTEL; deliberately left untouched.** They are type-clean (certification working-tree attribution shows net-new 0), but they are unrelated in-flight work sharing the branch. |
| Parked stashes | ✅ 3 stashes (BRANCH-001 ×2, carousel-phase-a) — other parties' work; untouched. |

### Merge risks & recommendations
1. **Reconcile the parallel workstream before merge.** The 9 uncommitted files belong to a separate effort. They must be committed by their owner (or explicitly excluded) before this branch is pushed/merged, so CONV-INTEL and the competitor-identity work land as distinct, attributable commits. Do **not** sweep them into a CONV-INTEL commit.
2. **Assess merge against `origin/main`.** Local `main` is stale; the true delta is the 7 CONV-INTEL commits.
3. **Merge lands dark.** All flags default OFF — merging is safe with zero runtime change; enabling is a separate product decision (product should review the readiness `%` shift documented in CONV-INTEL-002 before flipping `profile-knowledge-readiness`).

---

## Final Certification

The Company Profile Conversation Intelligence implementation is **CERTIFIED
PRODUCTION-READY**, flag-dark. Exactly one canonical implementation of each
capability exists; no architectural drift; behavioural guarantees hold across the
governed routes; flag-OFF byte-identity holds; no production-blocking defect exists.
All remaining work is classified as operational hardening or future enhancement.

**Recommended sequencing:** (1) owner reconciles the parallel competitor-identity
workstream out of the shared tree; (2) merge the 7-commit CONV-INTEL stack to
`origin/main` (dark); (3) product reviews the readiness-percentage change, then
enables `profile-conversation-orchestrator` / `profile-knowledge-readiness` when ready.
