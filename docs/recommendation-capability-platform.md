# Recommendation Engine Capability Platform (PMF-007)

The Recommendation Engine, executed through the canonical platform as a **Recommendation
Graph + Capability Profiles + an AIA agent + a platform runtime**, behind a reversible
flag. The existing engine (deterministic signal fetch, scoring, ranking, sequencing,
blueprinting + LLM theme synthesis) is **unchanged** — it runs as the backend inside the
AIC pipeline, orchestrated by the agent. Production behaviour is identical (guaranteed by
construction); the platform path is opt-in and defaults off. **Every served recommendation
is explainable** (§7).

## The wiring, not a rewrite

`generateRecommendations` (`recommendationEngine/engine.ts`, public via
`recommendationEngineService.ts`) is the canonical façade. PMF-007 wires the flag there.

```
generateRecommendations(input)                    ← default 'legacy' = unchanged
  └─ shouldRunPlatform()?  ── platform ──▶ runRecommendationsViaPlatform({ companyId,
                                              generate: () => generateRecommendationsCore(input, options) })
                                              runAgent('RECOMMENDATION_AGENT', … , { capabilityExecutor })
                                                orchestrates the Recommendation Graph (dependency-ordered
                                                waves, checkpoints, resume, approval, recovery — all AIA-001)
                                                producing node (CAMPAIGN_RECOMMENDATIONS) → executeCapability(
                                                   'RECOMMENDATION_DECISION', { modelRunner: runs the ENGINE core })
                                                other nodes → structural (orchestration only, no extra inference)
                                              → serve the EXACT engine result + additive §7 explanation (parity)
                                              ↳ SAFETY NET: producing node never ran the engine → run core directly
                             ── legacy  ──▶ generateRecommendationsCore(input, options)   (byte-identical)
```

The core (`generateRecommendationsCore`) is the renamed original body; the public
`generateRecommendations` is a thin flag branch. Default legacy calls the core directly
(byte-identical). On the platform path the SAME core runs inside the AIA agent, its exact
result captured via closure and served verbatim (plus the additive explanation), with a
safety net that runs the core directly if the producing node never executes it — so the
platform path can never be worse than legacy.

## Modules (`backend/services/recommendationCapability/`)

| Module | Role |
| --- | --- |
| `recommendationGraph.ts` | §2/§3 — the 10 recommendation nodes (dependencies, I/O, knowledge, confidence, priority, evidence, reason code, validation, metadata) + deterministic `recommendationExecutionOrder`. |
| `recommendationExplainability.ts` | §7 — `buildRecommendationExplanation` + `withExplanation` (additive, non-mutating). |
| `recommendationPlatformRuntime.ts` | §1/§5/§6/§12 — runs the AIA agent; the producing node executes through AIC with the engine backend; closure-capture parity, explanation attach, safety net, telemetry. |
| `recommendationMigrationFlag.ts` | §11 — `RECOMMENDATION_RUNTIME` = legacy \| platform \| dual (default legacy). |
| `index.ts` | Single import surface. |
| (AIA) `RECOMMENDATION_AGENT` | §6 — the agent, derived from the graph (in `agentRegistry.ts`). |
| (AIC) `RECOMMENDATION_DECISION` capability + `recommendation_node` contract | §3/§5 — the execution capability each node runs through. |
| (wiring) `recommendationEngine/engine.ts` | The one flag branch at `generateRecommendations`. |

## Recommendation Graph (§2) & Capability Profiles (§3)

`RECOMMENDATION_GRAPH` registers the 10 recommendations — KNOWLEDGE_ANALYSIS,
BUSINESS_ANALYSIS, CONTENT_RECOMMENDATIONS, CHANNEL_RECOMMENDATIONS, SEO_RECOMMENDATIONS,
GROWTH_RECOMMENDATIONS, CAMPAIGN_RECOMMENDATIONS (produces the set, engine backend),
PRIORITY_SCORING, RISK_ANALYSIS, FINAL_RECOMMENDATIONS (terminal, approval gate) — each with
dependencies, inputs, outputs, required CKC knowledge, confidence threshold, priority,
evidence sources, reason code, validation, and execution metadata. Every node executes one
AIC capability (`RECOMMENDATION_DECISION`). The edges ARE the deterministic execution graph;
`recommendationExecutionOrder()` is a cycle-detecting topological sort. Adding a
recommendation capability = add a node + edges; no orchestration code.

## CKC Adoption (§4)

On the platform path, knowledge is acquired through **AIC's knowledge stage, which is
CKC-001** (`getKnowledgeContext(RECOMMENDATION_ENGINE)`) at the producing node — the CKC
consumer is consulted and the consumed version recorded (`recommendation.knowledge_version_usage`).
`generateRecommendations` carries `companyId`, so the AIC/CKC path is fully exercised.
**Caveat:** the engine's own signals (company context intelligence, campaign memory,
performance insights, external trend APIs, learning signals) are far richer and
performance-specific than CKC composes; substituting a CKC-only context would change the
deterministic scoring/ranking and the recommendations — forbidden — so the engine keeps its
exact signals while CKC is the versioned knowledge authority. Full signal substitution is
deferred to a future CKC extension.

## AIC Execution (§5)

The producing node executes through `executeCapability('RECOMMENDATION_DECISION', …)` with
the existing engine inside the injected `modelRunner` — AIC owns knowledge, validation,
telemetry, recovery, and the output contract; the engine owns the deterministic scoring,
ranking, blueprinting, and the delegated theme-synthesis LLM call. Lenient validation +
disabled recovery so AIC never rejects or re-runs a result the legacy path would return.
Non-producing graph nodes are structural (orchestration only) — no extra inference, cannot
change the recommendations.

## AIA Orchestration (§6)

`RECOMMENDATION_AGENT` (AIA-001) is **derived from the graph** (single source): each node →
an agent step with the graph's `dependsOn` edges, all executing through the AIC
`RECOMMENDATION_DECISION` capability. It inherits AIA-001's dependency-ordered waves,
checkpoints, resume, retry, recovery, and the approval gate on FINAL_RECOMMENDATIONS. **The
agent never runs models directly** — AIA-001 executes only through AIC. The engine has no
human gate today, so the runtime **auto-approves** the modeled gate (preserving current
behavior); an async/review workflow would withhold approval.

## Explainability (§7)

Every served recommendation carries an explanation (`recommendationExplainability`):
`confidence`, `evidence` (from the node), `knowledgeVersion` (CKC), `decisionSource`
(node + capability + runtime), `dependencies` (upstream nodes), `reasonCodes` (canonical
`RC_*`), and `priorityExplanation` (banded). The explanation is **additive** — attached under
a reserved `__explanation` key without mutating the payload, so downstream consumers that
ignore it keep working unchanged (§9/§10). The engine's own result is already explainable
(`confidence_score`, `explanation`, `scoring_adjustments`, `scenario_outcomes`,
`omnivyra_metadata`); the platform explanation complements it and is deterministic. Set
`explain: false` for strict byte parity.

## Prompt Preservation (§8)

No prompt or scoring heuristic is rewritten. Prompt/strategy selection moves behind the
graph: the producing node runs the engine, which applies its deterministic scoring and the
delegated theme-synthesis prompts exactly as today. Recommendation quality is unaltered.

## Output Compatibility (§9) & Legacy Retirement (§10)

Guaranteed: the exact `RecommendationEngineResult` is captured via closure and returned
verbatim (plus the additive `__explanation`), so downstream consumers are unaffected. No
compatibility adapter is needed; the reserved key is the additive-metadata adapter. **No
retirement yet — by design;** the flag defaults to `legacy` and the core is the default +
safety net.

## Feature Flag (§11) & rollback

`RECOMMENDATION_RUNTIME` = `legacy` (default) | `platform` | `dual`. Rollback is a single env
change. `dual` runs the platform path with the core as the guaranteed fallback for parity
validation at zero risk. Platform becomes default only after parity validation.

## Observability (§12)

`recommendation.runtime_usage`, `migration_coverage`, `graph_execution_ms`,
`capability_executions`, `checkpoint_count`, `resume_count`, `knowledge_version_usage{version}`,
`token_usage`, `quality{outcome}`, `validation_failures`, `confidence{bucket}` (distribution),
plus AIA's `agent.*`, AIC's `capability.*`, and CKC's `consumption.*` — all on the existing
telemetry registry.

## Creating a new recommendation capability (future)

1. Add a `RECOMMENDATION_GRAPH` node (dependencies, I/O, knowledge, evidence, reason code,
   priority, validation).
2. The agent's steps derive from the graph automatically — it appears in the execution graph
   with no orchestration code, and its recommendations are explainable by construction.
3. (If it produces distinct inference) point its executor at an engine substep or a new AIC
   capability. That's it.

## Tests

- `pmf007RecommendationCapability.test.ts` — graph (10 nodes), execution-graph topological
  order + invariants, AIA agent derivation + approval gate, explainability
  (`buildRecommendationExplanation`/`withExplanation`), flag.
- `pmf007Runtime.test.ts` — platform runtime output parity + explanation attach, producing
  node through AIC, `explain=false` byte parity, auto-approval, observability, determinism,
  safety net.
- Legacy path (default flag) covered by the existing recommendation characterization suites —
  verified green after the flag branch was added.
