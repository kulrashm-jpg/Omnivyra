# IMPLEMENTATION-002F — Generation Pipeline & Industry Packs (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002F.md`](../implementation/IMPLEMENTATION-002F.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-GEN, Phase 6 (parallels Phase 5). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2E]. Distinguishing invariant: **no hidden AI generation — every LLM call is a registered workflow with a run record** (P16). **Classification: Ready for Development.**

---

## 1. Executive Summary

This program consolidates the 13 certified hand-rolled LLM call sites and the 10 duplicated execution scaffolds into one Generation Runtime, and converts the certified single-creator-peer-pack archetype system into declarative, versioned Industry Packs. Today every AI workflow independently repeats the same boilerplate — model/temperature/JSON-mode call, `JSON.parse` with default, strict-JSON retry (implemented twice), coercion helpers (six copies), the marketing 7-field list (four copies) — with no governance over prompts (inline, contradictory evidence stances), no governance over models (per-call `OPENAI_MODEL` reads), and no evaluation gate. The result was the certified weak tier: prompts that license invention, a boilerplate injector that fabricates identical content per company, and a draft workflow with no cliché filter while another has the only good one. The runtime makes AI generation a governed, single-seam operation. Prompts become registered, versioned, approved governed assets — the contradictory prompts fail approval; the reference cliché filter is available to every workflow; no inline production prompt survives. Models become a governed registry — routing, fallback, and rollback are runtime policy atop the preserved AI gateway. The offline LLM-judge bench becomes the standing evaluation gate that promotes prompt and model versions. Industry Packs replace the hardcoded creator peer pack and the `'business_operations'` fallback with data-driven per-industry vocabularies, goal/KPI frames, and competitor topologies — content, not code. The program is a per-workflow shadow strangle.

## 2. Repository Inventory

The AI gateway → Preserve (the runtime's model-execution seam). Profile extraction (now grounds the existing profile, fixing the certified ignored-`_currentProfile` defect), evidence cleaning, missing-field questions, strategy draft (the reference cliché filter → shared Sem tier), marketing intelligence draft (now Sem-validated), problem transformation → Refactor to workflows; the six conversational prompts → Replace (registered, invoked by the Conversation Engine); content/campaign/report workflows → Refactor. The 10 scaffolds → runtime dispatch/structured-output handler/one retry engine; the PT prompt (3 places) + MI field list (4 places) → the prompt registry (single source); coercion helpers (6 copies) → runtime output-assembly helpers; the server question-flow duplication → the Conversation Engine; audience-led scaffolding → Industry Pack + shared config; `deterministicRefineFallback` → Retire (P20). Archetype system + hardcoded creator peer pack → the first Industry/Archetype Packs; `classifyCompanyBusiness` `'business_operations'` fallback → honest low-confidence pack selection; per-call `OPENAI_MODEL` reads → the model registry; the judge bench → the evaluation-governance gate; operation tags → workflow registry keys.

## 3. Generation Boundary (frozen)

**Owns:** the Workflow Runtime, Workflow/Prompt Registries + versioning, model selection (routing over the registry), the retry policy/engine, the execution lifecycle, output assembly, Industry Packs, execution metrics. **Does NOT own:** Grounding (consumes Grounding Contexts, never assembles), Validation (submits outputs, never validates), Knowledge (produces values that become fact-mutation basis, never writes facts), Evidence (emits generation-output evidence, never stores), Confidence (emits a generation-confidence *signal* as one Trust input, never composes — P12), Conversation (the engine invokes generation workflows), Consumer Contracts. No LLM call exists outside a registered workflow (P16).

## 4. Workflow Registry

Every AI workflow is a registered entry with: registration key, purpose, consumer, grounding profile (which Grounding Context sections/fields it requires), validation profile (which tiers apply, with determinability class per output field), model policy, retry policy, output contract. Registered workflows: profile extraction, evidence cleaning, missing-field questions, strategy draft, marketing intelligence, problem transformation, competitor suggestion, content context, campaign purpose, audience, messaging, content generation (all formats), recommendations, and future workflows (registration-only). An unregistered workflow cannot execute (P16).

## 5. Generation Runtime

One runtime: Requested → PromptResolved → ModelSelected → GroundingInjected → Executed → OutputAssembled → ValidationSubmitted → {Completed | Retried | Failed}. Dispatch by key (loads prompt version, grounding profile, validation profile, model policy, retry policy, output contract); model selection (routing over the registry by capability + plan tier + cost + budget, atop the preserved gateway); prompt resolution (the registered version; no inline); runtime execution (Grounding Context injected as structured context, never a raw row; single gateway call with cross-provider fallback preserved); one structured-output handler (replaces 13 hand-rolled `JSON.parse`+default paths); one retry engine (replaces the two near-identical strict-JSON retries; same-provider retry on transient, strict-JSON escalation on parse failure, cross-provider fallback, retry-after-validation-failure); per-workflow timeout; cancellation (partial output discarded); idempotency by (workflow, grounding-context id, prompt version, model version).

## 6. Prompt Governance

Single-source registry (the PT prompt and MI field list collapse to one asset each); ownership (Generation context); SemVer (every run records its prompt version); lifecycle Draft → Approved (bench-gated) → Active → Deprecated → Retired. Approval rule: a prompt MUST declare its output fields' determinability class and carry the matching evidence-discipline clause; **contradictory evidence stances fail approval** — the certified "Use ONLY grounded concepts" vs "typical for that industry" contradiction cannot be approved. Compatibility (MAJOR change requires shadow + bench pass). Deprecation/rollback (instant re-point). No inline production prompts remain.

## 7. Model & Evaluation Governance

Model: approved registry; routing (capability/tier/cost/budget); fallback among approved (cross-provider preserved); capability matching; cost controls (the refresh-gate budget model generalized to every AI stage, P24; per-workflow budgets; block/downgrade on breach); per-workflow timeout; versioned; rollout/rollback (bench-gated promotion; rollback restores the prior routing-policy version). Evaluation: the offline judge bench becomes the standing gate — versioned datasets sampled from production lineage; per-workflow acceptance criteria (minimum judged factual-correctness and grounding-adherence); every prompt/model version promotion requires a bench pass; regression testing mandatory; a bench baseline per workflow recorded at first registration.

## 8. Industry Packs

Declarative, data-driven, versioned: industry templates (per-industry declarations), vocabulary/terminology (industry-specific expression frames for interpretive fields — replacing the certified generic-goal starvation), business context (fact-schema extensions as knowledge-node extensions), workflow specialization (per-industry goal/KPI vocabularies, audience/messaging frames, competitor topology generalizing the single creator pack, campaign objective templates, recommendation priors, evidence expectations), inheritance (a base pack; industry packs inherit and specialize; archetype packs become one family), overrides (per-tenant as declared data), versioning (every run records the pack version). Packs must not duplicate prompts — a pack supplies vocabulary/frames/priors that a single registered prompt consumes as grounding-adjacent configuration; adding an industry is authoring a pack. Pack selection is owned by the Knowledge classifier (uncertainty exposed as confidence, user override authoritative); Generation consumes the selected pack — the `'business_operations'` silent flattening is replaced by honest low-confidence selection.

## 9–10. Grounding/Validation & Knowledge/Trust/Evidence Integration

Every workflow requests a Grounding Context by its declared profile; the context is injected as structured context (the certified extraction defect — ignoring `_currentProfile` — is resolved because the existing profile is now a grounded knowledge section). Every output is submitted to the Validation Pipeline; a `ValidationPassed` token is required before the output can become fact-mutation basis (P19). Explainability (the Grounding Context id recorded on the run). Provenance (prompt/model/pack versions, grounding-context id). Retry-after-validation-failure (the taxonomy feeds prompt governance + Learning). Contradiction routing. Generation consumes grounding/tokens/knowledge refs/evidence refs/confidence; emits a generation-confidence signal to Trust's dimension — never composes the composite (P12).

## 11. Event Integration

WorkflowStarted/Completed/Failed, PromptResolved, ModelSelected, RetryStarted; ValidationRequested/Passed/Failed (submitted). Idempotent by run key; replayable; observable (per workflow/prompt-version/model + cost + validation-failure taxonomy + bench scores); audited.

## 12. Legacy Migration

Per-workflow: (1) runtime + registries; (2) extraction/cleaning/questions (Grounding-injected — existing profile now grounded); (3) strategy/marketing/PT drafts (MI now Sem-validated; PT fallback deleted); (4) conversational workflows (co-migrate with Phase 5); (5) content/campaign/report; (6) industry packs (archetype pack → pack data; classifier selection consumed); (7) model registry (per-call reads → routing). Three CI census rules: zero LLM calls outside a registered workflow (P16), zero inline production prompts, zero direct model reads.

## 13. Shadow & Rollback

Dual execution (legacy serves; the runtime records its output). Output comparison (richer/consistent output whitelisted). Validation comparison (would-be-rejected count — values legacy shipped that now fail validation, e.g. the MI cliché tier). Retry comparison (unified vs the two legacy variants). Bench comparison (per-workflow scores; promotion requires a bench pass at/above baseline). Promotion (per workflow per tenant): bench pass; zero unexplained divergence; validation warn→block completed; cost within budget; determinism verified; rollback exercised. Rollback: per-workflow flag revert; prompt/model/pack version re-point; runs idempotent; no workflow interruption (structural).

## 14. Testing Framework

Workflow (dispatch, output contract, grounding profile honored); prompt (single-source; version resolution; approval rule — contradictory prompt rejected); model routing (registry routing, fallback among approved, capability match, cost/budget block-downgrade); retry (unified engine); validation (every output carries a token; the launder case blocked; MI now Sem-validated); grounding integration (no raw-row injection); evaluation (bench gate; regression on version change); industry pack (selection, inheritance, override, versioning; no prompt duplication); replay (cached runs deterministic; run-key idempotency); tenancy; performance/cost (vs baseline; budget adherence, P24); rollback.

## 15. Certification Gates

(1) one Generation Runtime (zero LLM calls outside a registered workflow, P16); (2) one Workflow Registry (13 call sites consolidated); (3) one Prompt Registry / zero inline prompts; (4) zero direct model calls; (5) validation mandatory (P19; MI/PT validated); (6) grounding mandatory (P11; zero raw-row injection); (7) evaluation gate active (bench pass required; baselines recorded); (8) industry packs registered (archetype pack → data; honest low-confidence replaces silent flattening); (9) event correctness; (10) rollback verified; (11) production safety (cost P24; PT fallback deleted).

## 16. Implementation Sequence

GEN0 (requires the Grounding+Validation gate; gateway preserved; bench available) → GEN1 runtime core → GEN2 workflow registry → GEN3 prompt registry + governance → GEN4 model registry + governance → GEN5 Grounding/Validation integration → GEN6 evaluation governance → GEN7 Industry Packs → GEN8 shadow → GEN9 workflow migration (co-sequences conversational workflows with WS-C) → GEN10 enforcement → GEN11 certification → GEN12 retirement staging.

## 17–18. Certification

**Ready for Development.** Complete scope; the 13 call sites, 10 scaffolds, contradictory/permissive prompts, boilerplate injector, single creator pack + generic fallback, and ungoverned models each map to a census-enforced closure; clean boundary (generation-confidence is a signal never a composite; no LLM call escapes registration). Not "Production Implementation Ready" — awaits the Grounding+Validation gate; on it, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002F.md`](../implementation/IMPLEMENTATION-002F.md) · [`IMPLEMENTATION-002E-FULL.md`](IMPLEMENTATION-002E-FULL.md) · [`IMPLEMENTATION-002G-FULL.md`](IMPLEMENTATION-002G-FULL.md) · **Related ADRs:** [ADR-007](../adr/ADR-007-generation-runtime.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-6.
