# AI Capability Framework (AIC-001)

The **single canonical runtime** every AI-powered feature in Omnivyra executes
through. It orchestrates the existing platform — CKC-001 for knowledge, the
current AI gateway for the model call, existing services as tools, the AUTH-001
event envelope, and HARDEN-001 observability — and reimplements none of them.
No module implements its own AI runtime; new capabilities are added as registry
configuration, not new code paths.

```
executeCapability(request, deps)
  knowledge (CKC-001)
    → planning
    → prompt assembly
    → tool selection
    → tool execution
    → grounding
    → validation
    → confidence
    → output assembly
  → CapabilityResult (canonical contract)
```

## Modules (`backend/services/aiCapability/`)

| Module | Role |
| --- | --- |
| `aiCapabilityRuntime.ts` | **THE runtime.** `executeCapability(request, deps)` runs the fixed pipeline with deterministic recovery. Never throws. |
| `capabilityRegistry.ts` | **The one registry.** Each capability's id, description, required knowledge, tools, permissions, execution + validation strategy, output contract, supported models, config. |
| `capabilityContracts.ts` | Canonical `CapabilityRequest` + `CapabilityResult` (result, confidence, sources, knowledgeVersion, execution metadata, tool summary, validation summary). |
| `capabilityKnowledge.ts` | Knowledge acquisition — **reuses CKC-001** `getKnowledgeContext`; no direct Company-Knowledge reads. |
| `capabilityTools.ts` | Tool orchestration — parallel / sequential / conditional, with fallback, retry, timeout, idempotency memo. Tools are existing services wrapped as `ToolSpec`s. |
| `capabilityValidation.ts` | The one validation layer — schema, business, grounding, hallucination, confidence, policy. Built-ins are pure; business/policy rules inject per capability. |
| `capabilityRecovery.ts` | Deterministic recovery decision table — retry / fallback_model / partial / fail. |
| `capabilityModelRunner.ts` | The model-call seam. Default runner delegates to the existing gateway (`runCompletionWithOperation`); billed capabilities inject a `runBilledAiCompletion`-backed runner. |
| `capabilityEvents.ts` | `capability.<Event>` events + `capability.*` telemetry on the AUTH-001 envelope + HARDEN-001 registry. |
| `index.ts` | Single import surface. |

## Running a capability

```ts
import { executeCapability } from 'backend/services/aiCapability';

const res = await executeCapability({
  capability: 'CONTENT_WRITER',
  companyId,
  userId,
  input: { topic: 'Q3 launch' },
  // optional: knowledge overrides, model, maxRetries, correlationId
});
// res.status: 'completed' | 'partial' | 'failed' | 'blocked'
// res.result, res.confidence, res.sources, res.knowledgeVersion,
// res.execution (model, attempts, stages, tokens, cacheUsed),
// res.tools (per-tool summary), res.validation (per-check summary)
```

Dependencies are injectable (`CapabilityRuntimeDeps`) — `knowledgeFetcher`,
`toolRegistry`, `modelRunner`, per-capability `rules`, and the clocks — which is
what makes the runtime deterministic and unit-testable. Production wiring uses the
defaults: CKC for knowledge and the AI gateway for the model.

## Registry (§2)

Every capability lives in `CAPABILITY_REGISTRY`. Adding a capability = adding a
row: identifier, description, `knowledge` (CKC consumer + domains + mode),
`tools`, `permissions`, `executionStrategy`, `validation` strategy, `outputContract`,
`supportedModels`, and `config` (default/fallback model, temperature, token caps,
`maxRetries`, `timeoutMs`, `partialAllowed`).

## Pipeline (§4)

The nine stages run in a fixed order for every capability. Knowledge and tools are
acquired once; the model → confidence → validation steps run inside the recovery
loop. `execution.stagesCompleted` records exactly which stages a run reached.

## Tool orchestration (§5)

`orchestrateTools` runs a plan of `ToolSpec`s: **parallel** items concurrently
(barrier), **sequential** items in order (may read earlier tools' memo),
**conditional** items gated by `when()`. Each tool has retry (`maxAttempts`),
`timeout`, a `fallback` spec, and an `idempotencyKey` memo so identical work runs
once. Tools wrap existing services — no service logic is duplicated.

## Validation (§6)

`validateCapabilityOutput` composes: **schema** (required contract keys present +
non-empty), **grounding** (output backed by ≥1 source), **hallucination**
(non-empty payload), **confidence** (≥ threshold), and injected **business** /
**policy** rules. Returns a `ValidationSummary { ok, checks[], failures }`. No
capability writes its own validator; custom rules flow through this layer.

## Output contract (§7)

Every capability returns the same `CapabilityResult` envelope — result, confidence,
sources, knowledge version, execution metadata, tool summary, validation summary.
There are no custom response formats.

## Failure recovery (§8)

`decideRecovery(state)` is pure and deterministic. Precedence: attempts exhausted →
partial (if allowed) else fail; `no_knowledge` → partial/ fail; model/timeout error
with an unused fallback → `fallback_model`; otherwise → `retry`. The runtime carries
the best attempt so a `partial` terminal still returns usable output. Resume/manual
retry are provided at the billing seam (`runAiExecution`) which a billed model
runner composes.

## Observability (§9) & Events (§10)

Events: `capability.CapabilityRequested / Started / Completed / Failed / Retried /
Validated / Recovered`. Telemetry: `capability.executions`, `completed`, `failed`,
`retries`, `recovered`, `latency_ms` (histogram), `tool_calls`,
`validation_failures`, `tokens`, `model_usage`, `knowledge_version_usage`,
`cache_usage`. All on existing infrastructure.

## Future extension points

- **New capability:** add a `CAPABILITY_REGISTRY` row — no new runtime.
- **New tool:** wrap an existing service as a `ToolSpec`, add its id to a
  capability's `tools`, register it in the runtime's `toolRegistry`.
- **New validation rule:** inject `business`/`policy` rules via `deps.rules` — the
  validation framework composes them.
- **Billing/resume:** inject a `modelRunner` backed by `runBilledAiCompletion` +
  `runAiExecution` to bill and resume through the existing bank-grade seams.
- **New execution strategy:** extend `ExecutionStrategy` + the planning stage.

## Invariants

- **Deterministic** given deterministic dependencies (injected clocks, model,
  knowledge, tools) — no randomness in decisions.
- **Never throws** — every path returns a `CapabilityResult`.
- **Additive** — no schema changes, no new tables, no duplicate runtime/planning/
  tool-execution/validation/retry/grounding.
- **Backward compatible** — existing AI code paths are untouched; adoption is opt-in
  per capability.

## Tests

- `backend/tests/unit/aic001Units.test.ts` — registry, recovery table, tool
  orchestration, validation framework (pure).
- `backend/tests/unit/aic001Runtime.test.ts` — full pipeline, output contract,
  events, fallback recovery, no-knowledge, determinism, tool integration (injected deps).
