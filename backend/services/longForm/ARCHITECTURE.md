# longFormGenerationOrchestrator — Architecture & Change-Safety Contract

_Audited 2026-07-09. Covers `backend/services/longForm/longFormGenerationOrchestrator.ts`
(1,513 LOC) — the article-level generation coordinator for long-form content._

## Classification

`runLongFormGenerationOrchestrator` (~1,070 lines): **Coordinator** — but unlike
the other repo giants, it is **dependency-injected and pure**. Generation itself
arrives as the `SectionGenerator` interface; the orchestrator's entire import
graph is ~30 sibling governance modules (continuity governor, generic-writing
suppression, claim extraction, evidence classification, hallucination
suppression, speculative-language enforcement, trust calibration, citation
orchestration, recovery coordinators, convergence, telemetry) — **no DB, no
network, no AI, no config**. Small helpers in-file (`stripHtml`,
`summarizeForCrossSection`, `runSectionFactualPass`, `factualToSectionAction`)
are Pure and already minimal.

## Execution shape

Per-section loop: contract build → generate (injected) → continuity govern →
genericity suppress → factual pass → alignment gate (when companyIdentity) →
recovery loop (max attempts default 2; recovery hints + execution directives
escalate compact → emergency → minimal) → lifecycle state tracking. Then
article-level: assembly → post-generation integrity + factual + source
integrity validators → grounded/factual recovery plans → citations → source
conflicts → convergence verdict → diagnostics + operational explanation →
`finalLifecycleState` (completed / recovered / failed).

Grounding profile optional: absent ⇒ traceability layers return permissive
neutral results (`no_grounding_profile` orphans) — this degradation contract is
observable behavior.

## Characterization (the key finding)

The repo already contained THREE complete scenario harnesses for this
orchestrator — `generationExecutionStressTests.ts` (13 scenarios: baseline,
generic collapse, operational erosion, terminology simplification, capability
disappearance, ICP flattening, SEO over-optimization, repetitive structures,
weak sequencing, inconsistent tone, narrative drift, partial recovery, cascade
degradation), `factualIntegrityStressTests.ts` (11), and
`groundedIntegrityStressTests.ts` (11) — with fixture builders and ~40 scripted
SectionGenerators. **They were dormant: nothing imported them.**

`backend/tests/unit/longFormOrchestratorCharacterization.test.ts` now runs all
three suites in CI with ZERO mocks (real governance stack, injected
generators) and golden-masters every scenario/assertion verdict. Current state:
**35/35 scenarios pass (110 assertions, all green)**. A silent verdict flip is
a regression in the long-form quality gates — update snapshots only for
deliberate governance changes.

**Uncovered paths**: companyIdentity alignment gate (fixtures omit identity),
strategicAssignments consumption, fragmentCache reuse metrics, telemetry
consumers of companyId/contentType.

## Governance verdict (2026-07-09)

Architecture **82/100** — this file is what the other giants should become:
IO inverted out, layers extracted, coordinator pure. Testability **90/100**
(after wiring; the harnesses existed but never ran). Maintainability 70/100
(size is inherent: 30 governance layers × sequencing). Coupling: wide but
directional (orchestrator → layers, no cycles). Cohesion: total. Runtime risk
of further decomposition: MODERATE — but there is nothing left to extract that
isn't already a module; the remaining body IS the sequencing contract.
**Verdict B: optimal maintainable form under the behavior-preservation
constraint.** Do not split the section loop: recovery-hint threading,
lifecycle-state transitions, and layer ordering (continuity → genericity →
factual → alignment) are the product. Extend the scenario suites instead.
