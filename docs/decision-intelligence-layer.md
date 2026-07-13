# Decision Intelligence Layer (PMF-007R)

The Recommendation Engine is now the canonical **Decision Intelligence** layer: alongside
recommendations, it produces canonical **Decision Objects** — the reusable, machine-readable
representation every future platform capability consumes instead of parsing recommendation
text. **Purely additive** over PMF-007: recommendations, prompts, quality, and the API are
unchanged; recommendation text becomes a presentation layer over Decision Objects.

## What changed (additive only)

- A new `backend/services/decisionIntelligence/` layer (model, lifecycle, mapping,
  explainability, relationships, export, events, observability, service).
- The PMF-007 recommendation platform runtime now **additively** attaches the canonical
  Decision Object export under a reserved `__decisions` key (alongside `__explanation`),
  gated by the same `explain` flag — existing consumers ignore it. Nothing else changed.

## Decision Object model (§1)

`DecisionObject` (schema `1.0`) carries: `decisionId` (deterministic hash), `decisionType`,
`priority`, `confidence`, `status`, `title`, `summary`, `recommendedAction`, `expectedOutcome`,
`businessImpact`, `effort`, `urgency`, `risk`, `dependencies`, `prerequisites`, `reasonCodes`,
`evidence`, `knowledgeVersion`, `decisionSource`, `createdAt`, `schemaVersion`, `metadata`.
`buildDecisionObject` is pure and deterministic (injected `createdAt`; id derived from
company + type + node + title), so a decision is fully reproducible and replayable.

## Recommendation mapping (§2)

`decisionMapping` maps every Recommendation Graph node deterministically to one or more
Decision Objects — `mapNodeToDecision` (one per node), `mapRecommendationItemToDecision` (one
per served recommendation item), `mapRecommendationsToDecisions` (a served result → decisions,
falling back to the producing node), and `mapGraphToDecisions` (the whole graph → the canonical
internal representation). Recommendations are unchanged; Decision Objects are **derived**, never
rewritten.

## Lifecycle (§3)

`decisionLifecycle` is a frozen transition table: `CREATED → VALIDATED → APPROVED → EXECUTING →
COMPLETED`, with `SUPERSEDED` / `REJECTED` reachable from pre-terminal states. Deterministic,
replayable (`replayDecisionLifecycle`), illegal transitions impossible (`assertDecisionTransition`).

## Explainability (§4)

`explainDecision` exposes `why`, `whyNow`, `whyThisPriority`, `whatEvidence`, `whatDependencies`,
and `whatConfidenceFactors` for every Decision Object. No opaque decisions. Pure/additive
(`withDecisionExplanation` never mutates the decision).

## Relationships (§5)

`deriveDecisionRelationships` derives `depends_on` / `blocks` (from graph dependencies),
`duplicates` / `conflicts_with` (same type + title, same/different action), `supersedes` (a fresh
decision over a terminal duplicate), and `related_to` (same-type siblings). Deterministic; a
projection over the decision set, never a mutation.

## Export & consumer integration (§6)

`decisionExport` provides the canonical machine-readable envelope (`exportDecisions` →
`{ schemaVersion, exportedAt, companyId, count, decisions[+explanation], relationships }`) plus
backward-compatibility adapters both directions: `recommendationResultToDecisions` (the canonical
derivation) and `decisionsToRecommendationText` (recommendation text as a presentation over
decisions). **Future modules should import `decisionIntelligence` and consume the export** rather
than parsing recommendation text; call `recordDecisionConsumption(consumer, count)` and emit
`DecisionConsumed` to track consumption.

## Events (§7)

`decisionEvents` reuses the AUTH-001 envelope: `decision.DecisionCreated / DecisionValidated /
DecisionApproved / DecisionSuperseded / DecisionConsumed / DecisionRejected`, each mapped to a
`decision.*` counter. The canonical service `produceDecisionsFromRecommendation` emits
`DecisionCreated` per decision (and records telemetry) when decisions are produced. The
recommendation hot path attaches the export **without** emitting events (zero added latency);
events flow when a module produces/consumes decisions.

## Observability (§8)

`buildDecisionSnapshot` (read model) reports decision count, priority (impact) distribution,
confidence distribution, decision age (min/max/avg), the relationship-graph counts, and totals.
`recordDecisionTelemetry` / `recordDecisionConsumption` feed the HARDEN-001 registry
(`decision.count`, `decision.priority_distribution`, `decision.confidence_distribution`,
`decision.consumption`).

## Consumer integration (how to consume Decision Objects)

```ts
import { recommendationResultToDecisions, exportDecisions, recordDecisionConsumption } from 'backend/services/decisionIntelligence';

const decisions = recommendationResultToDecisions(recommendationResult, { companyId, knowledgeVersion, createdAt });
const exported = exportDecisions(decisions, { companyId, exportedAt: createdAt }); // machine-readable
recordDecisionConsumption('my_module', exported.count);
// consume exported.decisions[].{recommendedAction, priority, confidence, explanation, ...}
// (or read result.__decisions when served via the platform recommendation runtime)
```

## Future extension points

- **New decision fields:** extend `DecisionObject` + bump `DECISION_SCHEMA_VERSION` (additive).
- **New relationship types:** add to `RelationshipType` + a derivation rule.
- **New lifecycle states:** extend the transition table (kept deterministic).
- **Persistence:** decisions are pure/derivable; a store can be added without changing the model.
- **Cross-module decisions:** any capability can emit Decision Objects using the same model, making
  Decision Intelligence the platform-wide decision substrate.

## Invariants

- **Additive:** recommendations, prompts, quality, and the API are unchanged; Decision Objects are
  derived and attached under reserved keys.
- **Deterministic:** identical inputs → identical decisions/relationships/exports (injected clock).
- **Never throws:** production and event emission are fail-safe.

## Tests

- `pmf007rDecisionIntelligence.test.ts` — model, lifecycle, mapping, explainability, relationships,
  export, observability, determinism, backward compatibility.
- `pmf007rEvents.test.ts` — decision events on the AUTH envelope + the canonical production service.
