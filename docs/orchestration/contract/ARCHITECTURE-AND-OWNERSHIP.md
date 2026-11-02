# Architecture and ownership map

How the target chain runs in code on `feat/orchestration-recovery`, and who owns each part. Nothing here is deployed, and `WORKFLOW_ORCHESTRATION_ENABLED` stays off. The rules themselves are in `SHARED-INTEGRATION-CONTRACT.md`.

## The chain

| Stage | Owner | Code | What it does | Highest proof |
|---|---|---|---|---|
| Prospect Intelligence | PI | `canonical_leads`, `unified_persons`, `lifecycleWriter` | Holds prospects, people and lifecycle | Real schema |
| Enrollment | Orchestration | `pages/api/prospect-campaigns/[id]/enroll.ts`, `orchestration/campaignEnrollment.ts`, `enrollment.ts` | Refuses closed prospects, dedupes, freezes the workflow version into a plan | Real schema |
| Orchestration decision | Orchestration | `workflowExecution/workflowProgressionSweeper.ts`, `journeyPolicy.ts`, `journeyDecisionLog.ts` | Decides per step and records every decision | Real schema |
| Authorized execution | Orchestration gates, Outreach acts | `journeyGovernance.ts`, `engineAdapters.ts`, `*EngineAdapter.ts` | Central gate, then the engine and its own gates | Real schema, **provider stubbed** |
| Response and event | Outreach ingests, Orchestration reads | `pages/api/webhooks/ses.ts`, WhatsApp webhook, `journeyResponses.ts`, `journeyEvents.ts` | Records responses; one read-only event view | Real schema, **no real signed webhook** |
| Journey adaptation | Orchestration | Sweeper, `journeyExit.ts` | Ends the journey and withdraws what was unsent | Real schema |
| PI update | PI's writer, called by Orchestration | `outcomeLifecycleProducer`, `journeyFeedback.ts` | Writes lifecycle through PI's producer only | Real schema, actor rule unratified |
| Outcome reporting | Orchestration | `journeyReport.ts`, `pages/api/workflows/[id]/report.ts` | Attainment, exits, per-engine outcomes | Real schema |

## One sweep of one step

The order is the safety property. Each check can end the sweep for that step.

1. **Exit.** A response or a closed prospect ends the run. Unsent tasks are withdrawn before the run goes terminal.
2. **Choice group.** If an earlier candidate acted, this one is skipped as `branch_not_taken`.
3. **Central gate.** Global, tenant and channel controls hold a contact step as `waiting`. After 168 hours it is reported as `stuck_waiting`, and nothing moves on its own.
4. **Permission source.** A contact channel nothing can read permission for goes to a person as `no_permission_source`.
5. **Conditions.** If a read failed and the fact is therefore unknown, the step waits as `facts_unreadable`. If conditions are truly unmet, the step's action is withdrawn and the step is skipped.
6. **Frequency and window.** The step is deferred.
7. **Engine.** The adapter acts, and only its `disposition` settles the step.

If step 2 or 5 finds that an engine may already hold the action, the step goes to the engine with `holdOnly` set instead of being skipped. The engine reports what it holds and begins nothing new. Skipping there would let the next candidate contact the same person a second time.

## Ownership

| Domain | Owns | Must not |
|---|---|---|
| Prospect Intelligence | Prospects, people, identity, enrichment, scoring, lifecycle ledger and writer | Decide what is sent or when |
| AI Orchestration | Workflows, versions, enrollment, plans, the clock, decisions, routing, the engine interface, the request ledger, the event view, the contract | Hold a prospect database, or contain channel or provider logic |
| Outreach Engines | Adapter behaviour and everything behind it: send paths, provider calls, webhooks, engine gates | Keep a second registry, or bypass section F of the contract |

| Shared artefact | Owner | Others |
|---|---|---|
| `ENGINE_NAMES`, `EngineAdapter`, `buildAdapterRegistry`, sweeper, `execution_engine_requests`, execution contract | Orchestration | Outreach proposes diffs |
| `*EngineAdapter.ts` behaviour, `verification` values in `engineCapabilities.ts` | Outreach | Orchestration applies the diffs while its work is open |
| `prospect_lifecycle_transitions`, `lifecycleWriter`, actor rule | PI and the governance programme | Orchestration calls the writer and reads the ledger |
| `outreach_governance_config` | WS-3 | Orchestration reads only |
| `contact_governance_records` | PI | Orchestration reads; writes go through their own services |
| `providerCapabilityModel` | PI (Integration Hub) | Outreach proposes additions in contract v0.2 proposals |

The mandate names no individual leads. Working owners in this phase were this session for Orchestration, `virality-52` for Outreach and `virality-b6` for the actor rule. The owner can overrule any of this.

## Duplication check

| Could have been duplicated | What was done instead |
|---|---|
| Workflow engine | Recovered and extended the existing one. No new engine |
| Prospect or contact store | None created. Facts are read live from PI |
| Event log | The event view reads existing rows, so no second log can disagree |
| Engine registry | One, `buildAdapterRegistry`. Outreach keeps none |
| Suppression store | `contact_governance_records` only |
| Provider model | None added. v0.2 proposes extending `providerCapabilityModel` |
| LinkedIn, SMS or voice engine | None. Out of scope. Outreach's extensibility test only proves a later channel is held until it declares a permission source |
| Approval records | Read-only preview only. The record itself waits on decision A |

The execution contract work adds no migration.
