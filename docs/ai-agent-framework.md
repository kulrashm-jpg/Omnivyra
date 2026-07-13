# AI Agent Framework (AIA-001)

The **execution layer for long-running AI workflows**. Agents orchestrate
capabilities — they **never** run inference, assemble prompts, or read Company
Knowledge directly. Every unit of AI work goes through AIC-001; the agent runtime
adds planning, dependency-ordered coordination, deterministic lifecycle,
resumable checkpoints, versioned memory, human approval gates, and deterministic
recovery on top. It composes the existing platform (AIC-001, CKC-001, CKRE,
`report_settings` persistence, AUTH-001 events, HARDEN-001 telemetry) and
duplicates none of it. New autonomous workflows are added as registry
configuration, not new orchestration code.

```
runAgent(request, deps)                     ← never performs inference
  CREATED → PLANNING → READY → RUNNING
    for each ready wave (deps satisfied):
      conditional gate → approval gate
      execute step via AIC-001 (executeCapability)   ← the ONLY execution path
      record memory + checkpoint
    approval needed → WAITING  ──resume──▶  RESUMING → RUNNING
    step failure → deterministic recovery (retry / fallback / rollback / partial / manual / fail)
  → COMPLETED | PARTIAL | WAITING | BLOCKED | FAILED | CANCELLED
```

## Modules (`backend/services/aiAgent/`)

| Module | Role |
| --- | --- |
| `aiAgentRuntime.ts` | **THE runtime.** `runAgent` / `resumeAgent` / `cancelAgent`. Plans, coordinates, schedules, resumes, recovers, monitors, delegates, completes. Never runs inference. |
| `agentRegistry.ts` | **The one registry.** Each agent's id, purpose, supported capabilities, permissions, execution strategy, approval requirement, memory + completion strategy, config, and its deterministic step plan template. |
| `agentContracts.ts` | Canonical request / plan / step / result / memory / checkpoint / approval types. |
| `agentLifecycle.ts` | Deterministic state machine (CREATED→…→COMPLETED/FAILED/CANCELLED/BLOCKED); illegal transitions throw. |
| `agentCapabilityOrchestrator.ts` | Dependency-ordered waves, conditional gating, per-step execution **through AIC-001 only** (parallel / sequential / conditional / fallback). |
| `agentStateStore.ts` | One persistence for checkpoints (which embed versioned memory) in `report_settings.agent_checkpoints`. No new table, no separate memory/checkpoint stores. |
| `agentApproval.ts` | Approval gate decisions — approved / rejected / timeout / resubmit. Deterministic. |
| `agentRecovery.ts` | Deterministic step-recovery table — retry / fallback_capability / rollback / partial / manual / fail. |
| `agentEvents.ts` | `agent.<Event>` events + `agent.*` telemetry on the AUTH-001 envelope + HARDEN-001 registry. |
| `agentOperationalModel.ts` | Read-only operational snapshot (running / queued / blocked / waiting approvals / checkpoints / next step / health). |
| `index.ts` | Single import surface. |

## Running an agent

```ts
import { runAgent, resumeAgent } from 'backend/services/aiAgent';

const res = await runAgent({ agent: 'CONTENT_AGENT', companyId, userId, runId, input });
if (res.status === 'waiting') {
  // res.pendingApproval.{stepId, capability} — collect a human decision, then:
  const done = await resumeAgent({ agent: 'CONTENT_AGENT', companyId, runId,
    approvals: [{ stepId: res.pendingApproval!.stepId, decision: 'approved', at: new Date().toISOString() }] });
}
```

Dependencies are injectable (`AgentRuntimeDeps`) — `store`, `capabilityExecutor`
(default = `executeCapability`), `predicates`, and clocks — which is what makes
the runtime deterministic and unit-testable. Production uses the defaults:
`report_settings` store + AIC-001 executor.

## Registry (§2)

Every agent lives in `AGENT_REGISTRY`. Adding an autonomous workflow = adding a
row: id, purpose, `steps` (the deterministic plan template of capability
invocations with `dependsOn`, `mode`, `requiresApproval`, `fallbackCapability`,
`when`), permissions, strategies, and config. `supportedCapabilities` is derived
from the steps.

## Lifecycle (§3)

`agentLifecycle.ts` is a frozen transition table. The machine is deterministic and
replayable (no clock/randomness in transitions); `assertAgentTransition` makes
illegal transitions impossible. WAITING and BLOCKED are the resumable non-terminal
pauses; COMPLETED/FAILED/CANCELLED are terminal.

## Capability orchestration (§4)

The planner expands the registry step template; the runtime executes it as
dependency-ordered **waves** — steps whose dependencies are all satisfied run in
**parallel**; waves are **sequential**. Conditional steps are gated by a named
predicate; a failing step can **fall back** to another capability. Every execution
is `executeCapability(...)` — agents never bypass AIC.

## Memory (§5) & Checkpoints (§6)

Memory is versioned and carries execution context, working memory, conversation
state, intermediate results (per-step capability results), and a decision history.
A **checkpoint** embeds the memory plus current step, completed/pending
capabilities, approvals, and execution metadata — it is the single resumable unit,
persisted after each step to `report_settings.agent_checkpoints`. There is no
separate memory store and no second checkpoint system.

## Approval (§7)

Any step may set `requiresApproval`. When a wave's only remaining ready work is
approval-blocked, the agent transitions to WAITING and returns `pendingApproval`;
a caller resumes with an `ApprovalRecord`. Decisions: approved → proceed, rejected
→ fail, resubmit/timeout → re-request. All deterministic (`decideApprovalGate`).

## Recovery (§8)

`decideAgentRecovery` is pure. Precedence: retry the step while attempts remain →
fall back to another capability → accept partial (best-effort agents) → roll back
to the last checkpoint and block for manual intervention → fail. This composes
with AIC's *intra-capability* recovery: AIC recovers within a capability; the agent
recovers the step. A blocked capability escalates straight to manual intervention.

## Operational read model (§11)

`getAgentOperationalSnapshot(companyId)` projects, read-only, from the checkpoint
store: running / queued / blocked agents, waiting approvals, checkpoint counts,
each run's last completed and next planned step, and overall execution health.

## Events (§9) & Observability (§10)

Events: `AgentCreated / Started / Paused / Resumed / Waiting / Completed / Failed /
Cancelled`, `ApprovalRequested / Received`, `CheckpointCreated / Restored`.
Telemetry: `agent.started / completed / failed / waiting / resumed / cancelled`,
`approvals_requested / received`, `checkpoints`, `checkpoint_restores`,
`execution_ms` (histogram), `approval_latency_ms` (histogram), `resume_count`,
`memory_bytes`, `capability_utilization`. All on existing infrastructure.

## Future extension points

- **New agent / workflow:** add an `AGENT_REGISTRY` row — no new runtime.
- **New step relationship:** dependency edges, `mode`, conditional `when`
  predicates, and `fallbackCapability` cover parallel/sequential/conditional/
  fallback without code changes.
- **Durable scheduling:** inject a store/executor backed by the existing BullMQ
  queues to run long workflows across workers (the runtime is resume-safe).
- **Richer memory:** memory is versioned JSON — extend it without schema changes.

## Invariants

- **Deterministic** given deterministic dependencies — no randomness in decisions;
  lifecycle/approval/recovery are pure tables.
- **Resumable** — every execution checkpoints and resumes from the last checkpoint.
- **Never throws** — every path returns an `AgentResult`.
- **Additive** — no schema changes, no new tables, no duplicate runtime/planning/
  retry/memory. Agents execute only through AIC-001.
- **Backward compatible** — existing code paths are untouched; adoption is opt-in.

## Tests

- `backend/tests/unit/aia001Units.test.ts` — lifecycle, registry, approval gate,
  recovery table, orchestration helpers, operational model (pure/injected).
- `backend/tests/unit/aia001Runtime.test.ts` — full runtime: dependency-ordered
  orchestration via AIC, approval WAIT + resume, checkpoints/memory, fallback
  recovery, blocked-for-manual, determinism, cancel, guards (injected deps).
