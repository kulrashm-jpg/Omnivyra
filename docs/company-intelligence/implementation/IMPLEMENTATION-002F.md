# IMPLEMENTATION-002F — Generation Pipeline & Industry Packs Implementation Program v1.0

**Status:** Authoritative program for the Generation Pipeline (WS-GEN, Phase 6; parallels Phase 5). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2E]. Distinguishing invariant: **no hidden AI generation — every LLM call is a registered workflow with a run record** (P16).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Consolidates the 13 hand-rolled LLM call sites and 10 duplicated scaffolds [A3 §4, §13] into **one Generation Runtime**, and converts the single-creator-peer-pack archetype system [A3 §8] into **declarative, versioned Industry Packs**. Prompts become registered/versioned/approved governed assets (contradictory prompts fail approval; the reference cliché filter available to all); models a governed registry; the offline judge bench the standing evaluation gate. Packs replace the hardcoded pack and `'business_operations'` fallback [A4 §7] with per-industry data. A per-workflow shadow strangle.

## 2. Repository Inventory

AI gateway → Preserve (model seam); extraction (now grounds existing profile, fixes [A4 §2]), cleaning, questions, strategy (reference filter → shared Sem tier), marketing (now Sem-validated), PT → Refactor to workflows; 6 conversational prompts → Replace (registered); content/campaign/report workflows → Refactor. Scaffolds → runtime dispatch/handler/retry engine; PT prompt (3 places) + MI list (4 places) → prompt registry; coercion (6 copies) → runtime helpers; deterministicRefineFallback → Retire (P20). Archetype pack → first packs; classifier fallback → honest low-confidence; per-call OPENAI_MODEL → model registry; judge bench → evaluation gate.

## 3. Generation Boundary (frozen)

**Owns:** Workflow Runtime, Workflow/Prompt Registries + versioning, model selection, retry policy, execution lifecycle, output assembly, Industry Packs, execution metrics. **Does NOT own:** Grounding (consumes), Validation (submits), Knowledge (produces mutation basis), Evidence (emits generation output), Confidence (emits a signal, never composes — P12), Conversation (invoked by engine), Consumer Contracts. No LLM call outside a registered workflow (P16).

## 4. Workflow Registry

Per-workflow: registration key, purpose, consumer, grounding profile, validation profile (determinability per field), model policy, retry policy, output contract. Registered set from the certified inventory. An unregistered workflow cannot execute (P16).

## 5. Generation Runtime

Requested → PromptResolved → ModelSelected → GroundingInjected → Executed → OutputAssembled → ValidationSubmitted → {Completed | Retried | Failed}. Dispatch by key; model selection (routing over registry); prompt resolution (no inline); Grounding injected as structured context (never raw row); one structured-output handler; one retry engine; per-workflow timeout; cancellation; idempotency by (workflow, grounding-context id, prompt version, model version).

## 6. Prompt Governance

Single-source registry; ownership; SemVer; lifecycle Draft→Approved (bench-gated)→Active→Deprecated→Retired. Approval rule: declare determinability + evidence-discipline clause; **contradictory stances fail approval** (closes [A4 §4]). No inline production prompts (P16-adjacent).

## 7. Model & Evaluation Governance

Model: approved registry; routing (capability/tier/cost/budget); fallback among approved; versioned; rollback; cost controls (refresh-gate budget model generalized, P24). Evaluation: judge bench = standing gate; per-workflow acceptance criteria gate prompt/model promotion; regression testing mandatory; baselines recorded.

## 8. Industry Packs

Declarative/versioned: industry templates, vocabulary/terminology, business context (fact-schema extensions), workflow specialization (goal/KPI vocab, audience/messaging frames, competitor topology, campaign templates, recommendation priors, evidence expectations), inheritance, per-tenant overrides (data). Content not code; pack selection owned by Knowledge classifier (honest low-confidence, no silent flattening); consumed by Generation. Packs must not duplicate prompts.

## 9–10. Integration

Grounding Context consumption (existing profile now grounded, fixes [A4 §2]); Validation submission (ValidationPassed required before fact-basis, P19); provenance (prompt/model/pack/grounding-context id); retry-after-validation; contradiction routing. Consumes grounding/tokens/knowledge refs/evidence refs/confidence; emits a generation-confidence signal to Trust (never composes, P12).

## 11. Event Integration

WorkflowStarted/Completed/Failed, PromptResolved, ModelSelected, RetryStarted; ValidationRequested/Passed/Failed (submitted). Idempotent by run key; replayable; observable (per workflow/prompt/model + cost + failure taxonomy + bench); audited.

## 12. Legacy Migration

(1) runtime + registries; (2) extraction/cleaning/questions; (3) strategy/marketing/PT (MI Sem-validated; PT fallback deleted); (4) conversational workflows (with Phase 5); (5) content/campaign/report; (6) industry packs; (7) model registry. Three CI census: zero unregistered LLM calls (P16), zero inline prompts, zero direct model reads.

## 13–14. Shadow & Rollback

Dual execution + output/validation/retry/bench comparison; promotion on bench pass + zero unexplained divergence + warn→block + cost budget. Rollback: per-workflow flag revert; prompt/model/pack version re-point; runs idempotent; no workflow interruption (structural).

## 15. Testing

Workflow, prompt (approval rule), model routing, retry, validation ([A3 §7] blocked, MI Sem-validated), grounding integration, evaluation (bench gate), industry pack, replay, tenancy, performance/cost, rollback.

## 16. Certification Gates

(1) one runtime (P16); (2) one workflow registry; (3) one prompt registry / zero inline; (4) zero direct model calls; (5) validation mandatory (P19); (6) grounding mandatory (P11); (7) evaluation gate active; (8) industry packs registered; (9) event correctness; (10) rollback verified; (11) production safety (cost P24, PT fallback deleted).

## 17. Implementation Sequence

GEN0 (requires **Grounding+Validation gate**; gateway preserved; bench available) → GEN1 runtime core → GEN2 workflow registry → GEN3 prompt governance → GEN4 model governance → GEN5 Grounding/Validation integration → GEN6 evaluation governance → GEN7 Industry Packs → GEN8 shadow → GEN9 workflow migration → GEN10 enforcement → GEN11 certification → GEN12 retirement.

## 18–19. Certification

**Ready for Development.** Complete scope; 13 call sites, 10 scaffolds, contradictory/permissive prompts, boilerplate injector, single creator pack + generic fallback, ungoverned models each map to a census-enforced closure. Clean boundary (generation-confidence is a signal, never a composite; no LLM call escapes registration). Not "Production Implementation Ready" — awaits the Grounding+Validation gate; on it, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002D](IMPLEMENTATION-002D.md) · [IMPLEMENTATION-002E](IMPLEMENTATION-002E.md) · [IMPLEMENTATION-002G](IMPLEMENTATION-002G.md) · **Depends on:** I1, I2A–E · **Related ADRs:** [ADR-007](../adr/ADR-007-generation-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002F-FULL.md`](../full/IMPLEMENTATION-002F-FULL.md) · **Certification:** Ready for Development · GATE-6. See [`../appendices/relationships.md`](../appendices/relationships.md).
