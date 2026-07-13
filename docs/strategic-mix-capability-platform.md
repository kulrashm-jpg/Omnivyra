# Strategic Mix Capability Platform (PMF-006)

Strategic (Intelligent) Mix, executed through the canonical platform as a **Decision
Graph + Capability Profiles + an AIA agent + a platform runtime**, behind a reversible
flag. The existing mix engine (deterministic platform/format ordering, distribution,
binding, + the delegated planner call) is **unchanged** — it runs as the backend
inside the AIC pipeline, orchestrated by the agent. Production behaviour is identical
(guaranteed by construction); the platform path is opt-in and defaults off.

## The wiring, not a rewrite

Strategic Mix is the BOLT `isCombined` (Intelligent-Mix) branch, computed in
`runAiPlan` (the plan sub-step of the BOLT pipeline — all mix origins converge there).
PMF-006 wires the flag there, scoped to the combined path.

```
runAiPlan(runId, campaignId, companyId, payload, …, isCombined)   ← default 'legacy' = unchanged
  └─ isCombined && shouldRunPlatform()?
        ── platform ──▶ runStrategicMixViaPlatform({ companyId,
                          generate: () => runAiPlanCore(… same args …) })
                          runAgent('STRATEGIC_MIX_AGENT', … , { capabilityExecutor })
                            orchestrates the Decision Graph (dependency-ordered waves,
                            checkpoints, resume, approval, recovery — all AIA-001)
                            mix node (CAMPAIGN_SELECTION) → executeCapability('STRATEGIC_MIX_DECISION', {
                               modelRunner: runs the MIX ENGINE core (backend) })
                            other nodes → structural (orchestration only, no extra inference)
                          → serve the EXACT engine mix (parity)
                          ↳ SAFETY NET: mix node never ran the engine → run core directly
        ── legacy  ──▶ runAiPlanCore(… same args …)   (byte-identical)
```

The core (`runAiPlanCore`) is the renamed original body; the public `runAiPlan` is a
thin flag branch. Default legacy calls the core directly (byte-identical). On the
platform path the SAME core runs inside the AIA agent, its exact result captured via
closure and served verbatim, with a safety net that runs the core directly if the mix
node never executes it — so the platform path can never be worse than legacy.

## Modules (`backend/services/strategicMixCapability/`)

| Module | Role |
| --- | --- |
| `strategicMixDecisionGraph.ts` | §2/§3 — the 12 decision nodes (dependencies, I/O, knowledge, validation, confidence, metadata) + deterministic `strategicMixExecutionOrder`. |
| `strategicMixPlatformRuntime.ts` | §1/§5/§6/§11 — runs the AIA agent; the mix node executes through AIC with the engine backend; closure-capture parity, safety net, telemetry. |
| `strategicMixMigrationFlag.ts` | §10 — `STRATEGIC_MIX_RUNTIME` = legacy \| platform \| dual (default legacy). |
| `index.ts` | Single import surface. |
| (AIA) `STRATEGIC_MIX_AGENT` | §6 — the agent, derived from the graph (in `agentRegistry.ts`). |
| (AIC) `STRATEGIC_MIX_DECISION` capability + `strategic_mix` contract | §3/§5 — the execution capability each node runs through. |
| (wiring) `boltPipelineServiceRunPlan.ts` | The one flag branch at `runAiPlan`. |

## Decision Graph (§2) & Capability Profiles (§3)

`STRATEGIC_MIX_GRAPH` registers the 12 decisions — BUSINESS_ANALYSIS, MARKET_ANALYSIS,
AUDIENCE_ANALYSIS, POSITIONING, COMPETITOR_REVIEW, CHANNEL_STRATEGY (platform-authority
+ format-platform-binding validators), CONTENT_STRATEGY (text-lane-floor),
CAMPAIGN_SELECTION (produces the mix, engine backend; capacity + distribution-floor),
BUDGET_ALLOCATION, TIMELINE, RISK_ASSESSMENT, FINAL_RECOMMENDATION (terminal, approval
gate) — each with dependencies, inputs, outputs, required CKC knowledge, validation,
confidence threshold, and execution metadata. Every node executes one AIC capability
(`STRATEGIC_MIX_DECISION`). The edges ARE the deterministic execution graph;
`strategicMixExecutionOrder()` is a cycle-detecting topological sort. Adding a strategy
capability = add a node + edges; no orchestration code.

## CKC Adoption (§4)

On the platform path, knowledge is acquired through **AIC's knowledge stage, which is
CKC-001** (`getKnowledgeContext(STRATEGIC_MIX)`) at the mix node — the CKC consumer is
consulted and the consumed version recorded. `runAiPlan` carries `companyId`, so the
AIC/CKC path is fully exercised. **Caveat:** the mix engine's own signals (marketing
memory, campaign-performance aggregates, platform-content-type prefs) are richer and
performance-specific; substituting a CKC-only context would change the deterministic
scoring and the recommendation — forbidden — so the engine keeps its exact signals
while CKC is the versioned knowledge authority for the pipeline. Full signal
substitution is deferred to a future CKC extension.

## AIC Execution (§5)

The mix node executes through `executeCapability('STRATEGIC_MIX_DECISION', …)` with the
existing engine inside the injected `modelRunner` — AIC owns knowledge, validation,
telemetry, recovery, and the output contract; the engine owns the deterministic
platform/format ordering, distribution, binding rules, and the delegated planner call.
Lenient validation + disabled recovery so AIC never rejects or re-runs a mix the legacy
path would return (the engine owns platform-authority / format-binding /
distribution-floor rules and retries). Non-mix graph nodes are structural
(orchestration only) — no extra inference, cannot change the mix.

## AIA Orchestration (§6)

`STRATEGIC_MIX_AGENT` (AIA-001) is **derived from the graph** (single source): each node
→ an agent step with the graph's `dependsOn` edges, all executing through the AIC
`STRATEGIC_MIX_DECISION` capability. It inherits AIA-001's dependency-ordered waves,
checkpoints, resume, retry, recovery, and the approval gate on FINAL_RECOMMENDATION.
**The agent never runs models directly** — AIA-001 executes only through AIC. The mix
computation has no human gate today, so the runtime **auto-approves** the modeled gate
(preserving current behavior); an async/review workflow would withhold approval.

## Prompt Preservation (§7)

No prompt or scoring heuristic is rewritten. Prompt/strategy selection moves behind the
graph: the mix node runs the engine, which applies its deterministic ordering and the
delegated planner prompts exactly as today. Recommendation quality is unaltered.

## Output Compatibility (§8)

Guaranteed: the exact `{ plan, result }` object is captured via closure and returned
verbatim (no reshape), so downstream consumers (`runCommitPlan`, scheduling, the UI)
are unaffected. No compatibility adapter is needed. The safety net guarantees the
platform path always yields at least the legacy result.

## Legacy Retirement (§9) & Feature Flag (§10)

**No retirement yet — by design.** The flag defaults to `legacy`; the core remains the
default and the safety net. `STRATEGIC_MIX_RUNTIME` = `legacy` (default) | `platform` |
`dual`; rollback is a single env change. `dual` runs the platform path with the core as
the guaranteed fallback for parity validation at zero risk. Platform becomes default
only after parity validation.

## Observability (§11)

`strategicmix.runtime_usage`, `migration_coverage`, `decision_graph_ms`,
`capability_executions`, `checkpoint_count`, `resume_count`,
`knowledge_version_usage{version}`, `token_usage`, `recommendation_quality{outcome}`,
`validation_failures`, `confidence{bucket}`, plus AIA's `agent.*`, AIC's `capability.*`,
and CKC's `consumption.*` — all on the existing telemetry registry.

## Creating a new strategy capability (future)

1. Add a `STRATEGIC_MIX_GRAPH` node (dependencies, I/O, knowledge, validation).
2. The agent's steps derive from the graph automatically — it appears in the execution
   graph with no orchestration code.
3. (If it produces distinct inference) point its executor at an engine substep or a new
   AIC capability. That's it.

## Tests

- `pmf006StrategicMixCapability.test.ts` — decision graph (12 nodes), execution-graph
  topological order + dependency invariants, AIA agent derivation + approval gate, flag.
- `pmf006Runtime.test.ts` — platform runtime output parity (exact mix identity), mix
  node through AIC, auto-approval, observability, determinism, safety net.
- Legacy path (default flag) covered by the existing BOLT pipeline suites — the flag
  branch defaults to the byte-identical core.
