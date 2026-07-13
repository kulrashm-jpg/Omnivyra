# Campaign Planner Capability Platform (PMF-005)

Campaign Planner, executed through the canonical platform as a **Capability Graph +
an AIA agent + a platform runtime**, behind a reversible flag. The existing planner
engine (drafting, alignment, parsing, deterministic weeks) is **unchanged** — it runs
as the inference backend inside the AIC pipeline, orchestrated by the agent.
Production behaviour is identical (guaranteed by construction); the platform path is
opt-in and defaults off.

## The wiring, not a rewrite

`runCampaignAiPlan` is the single canonical façade (all synchronous origins converge
there via `plan.ts`). PMF-005 wires the flag there.

```
runCampaignAiPlan(input)                         ← default 'legacy' = unchanged
  └─ shouldRunPlatform()?  ── platform ──▶ runCampaignPlanViaPlatform({ companyId,
                                              generate: () => executeRunCampaignAiPlan(input, runWithContext) })
                                              runAgent('CAMPAIGN_PLANNER_AGENT', … , { capabilityExecutor })
                                                orchestrates the Capability Graph (dependency-ordered waves,
                                                checkpoints, resume, approval, recovery — all AIA-001)
                                                plan node (CAMPAIGN_STRATEGY) → executeCapability('CAMPAIGN_PLAN', {
                                                   modelRunner: runs the PLANNER ENGINE (backend) })
                                                other nodes → structural (orchestration only, no extra inference)
                                              → serve the EXACT engine plan (parity)
                                              ↳ SAFETY NET: plan node never ran the engine → run engine directly
                             ── legacy  ──▶ executeRunCampaignAiPlan(input, runWithContext)   (byte-identical)
```

The definitive plan is produced by the existing engine and captured via closure, so
the platform result is byte-identical to legacy; a safety net runs the engine directly
if the plan node never executes it — so the platform path can never be worse than
legacy.

## Modules (`backend/services/campaignCapability/`)

| Module | Role |
| --- | --- |
| `campaignCapabilityGraph.ts` | §2/§6 — the 10 capability profiles + the execution-graph dependency edges + deterministic `campaignExecutionOrder`. |
| `campaignPlatformRuntime.ts` | §1/§4/§6/§11 — runs the AIA agent; the plan node executes through AIC with the engine backend; closure-capture parity, safety net, telemetry. |
| `campaignMigrationFlag.ts` | §10 — `CAMPAIGN_PLANNER_RUNTIME` = legacy \| platform \| dual (default legacy). |
| `index.ts` | Single import surface. |
| (AIA) `CAMPAIGN_PLANNER_AGENT` | §5 — the agent, derived from the graph (in `agentRegistry.ts`). |
| (AIC) `CAMPAIGN_PLAN` capability + `campaign_plan` contract | §4 — the execution capability each node runs through. |
| (wiring) `campaignAiOrchestrator.ts` | The one flag branch at the façade. |

## Capability Graph (§2) & Execution Graph (§6)

`CAMPAIGN_CAPABILITY_GRAPH` registers the 10 nodes — GOAL_ANALYSIS, AUDIENCE_ANALYSIS,
CHANNEL_SELECTION, CAMPAIGN_STRATEGY (produces the plan), CONTENT_STRATEGY,
CONTENT_CALENDAR, BUDGET_PLANNING, KPI_SELECTION, RISK_ANALYSIS, CAMPAIGN_VALIDATION —
each with knowledge/planning/validation/output-contract/timeouts/retry/executionMetadata
and its `dependsOn` edges. Those edges ARE the deterministic execution graph;
`campaignExecutionOrder()` is a cycle-detecting topological sort. Adding a planner
capability = add a node + edges; no orchestration code.

## AIA Orchestration (§5)

`CAMPAIGN_PLANNER_AGENT` (AIA-001) is **derived from the graph** (single source): each
graph node → an agent step with the graph's `dependsOn` edges, all executing through
the AIC `CAMPAIGN_PLAN` capability. The agent inherits AIA-001's dependency-ordered
waves (parallel where independent, sequential across waves), checkpoints, resume,
retry, recovery, and the approval gate on CAMPAIGN_VALIDATION. **The agent never runs
models directly** — AIA-001 executes only through AIC. The synchronous planner has no
human gate today, so the runtime **auto-approves** the modeled validation gate
(preserving current behavior); an async/review workflow would withhold approval.

## AIC Execution (§4)

The plan node executes through `executeCapability('CAMPAIGN_PLAN', …)` with the
existing planner engine inside the injected `modelRunner` — AIC owns knowledge
(CKC), validation, telemetry, recovery, and the output contract; the engine owns
prompts + drafting + alignment + parsing + deterministic weeks. Lenient validation +
disabled recovery so AIC never rejects or re-runs a plan the legacy path would have
returned (the engine owns planner-contract enforcement, capacity, and retries). The
non-plan graph nodes are structural (orchestration only) — they add no inference and
cannot change the plan.

## CKC Adoption (§3)

On the platform path, knowledge is acquired through **AIC's knowledge stage, which is
CKC-001** (`getKnowledgeContext(CAMPAIGN_PLANNER)`) at the plan node — the CKC consumer
is consulted, `consumption.*` events fire, and the consumed version is recorded.
**Two precise caveats:** (1) the planner engine builds a far richer bespoke context
(`resolveExecutionContext` → `getProfile` + `buildCompanyContext` + strategy learning +
prior-campaign context) than CKC composes; substituting it would change prompts and
planning quality — forbidden — so the engine keeps its exact context while CKC is the
versioned knowledge authority. (2) The `runCampaignAiPlan` façade receives
`campaignId`, not `companyId` (the engine resolves company internally), so when
`companyId` is absent the plan node's AIC grounding guard trips and the safety net runs
the engine directly — the agent still orchestrates the graph. Wiring at a seam that
carries `companyId` (or threading it) fully enables the AIC/CKC plan-node path;
deferred to keep this migration to the safe single façade.

## Prompt Preservation (§7)

No prompt is rewritten. Prompt selection moves behind the profile/graph: the plan node
runs the engine, which selects its prompts (`generateCampaignPlan`, `parsePlanToWeeks`,
alignment, refinement) exactly as today.

## Output Compatibility (§8)

Guaranteed: the exact `CampaignAiPlanResult` is captured via closure and returned
verbatim (no reshape), so downstream consumers (persistence, UI, validators) are
unaffected. No compatibility adapter is needed. The safety net guarantees the platform
path always yields at least the legacy result.

## Legacy Retirement (§9)

**None yet — by design.** The flag defaults to `legacy`; the engine call remains the
default and the safety net. Nothing is removed. Once `platform` is validated in `dual`
and soaked, obsolete branches can be retired — the post-parity step.

## Feature Flag (§10) & rollback

`CAMPAIGN_PLANNER_RUNTIME` = `legacy` (default) | `platform` | `dual`. Rollback is a
single env change (or unset) — no code/schema change. `dual` runs the platform path
with the engine as the guaranteed fallback for parity validation at zero risk.

## Observability (§11)

`campaign.runtime_usage`, `campaign.migration_coverage`, `campaign.agent_execution_ms`,
`campaign.capability_executions`, `campaign.checkpoint_count`, `campaign.resume_count`,
`campaign.knowledge_version_usage{version}`, `campaign.token_usage`,
`campaign.planning_quality{outcome}`, `campaign.validation_failures`, plus AIA's
`agent.*`, AIC's `capability.*`, and CKC's `consumption.*` — all on the existing
telemetry registry.

## Creating a new planner capability (future)

1. Add a `CAMPAIGN_CAPABILITY_GRAPH` node (profile + `dependsOn` edges).
2. The agent's steps derive from the graph automatically — it appears in the execution
   graph with no orchestration code.
3. (If it produces distinct inference) point its executor at the engine substep or a
   new AIC capability. That's it.

## Tests

- `pmf005CampaignCapability.test.ts` — graph (10 nodes), execution-graph topological
  order + dependency invariants, AIA agent derivation + approval gate, flag.
- `pmf005Runtime.test.ts` — platform runtime output parity (exact plan identity), plan
  node through AIC, auto-approval, observability, determinism, safety net.
- Legacy path (default flag) covered by the existing campaign characterization suites —
  verified green after the flag branch was added.
