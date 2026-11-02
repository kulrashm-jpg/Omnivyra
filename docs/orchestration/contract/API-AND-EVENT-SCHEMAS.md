# API and event schemas, contract 0.2.0

The TypeScript in `backend/services/orchestration/executionContract.ts` is the source of truth; this is its readable form. None of these routes is deployed. Every route resolves tenant membership first, then a capability, and passes the verified tenant down. Another tenant's run answers 404, the same as one that does not exist.

**Interim capability.** Run sub-resources use `PROSPECT_ICP_MANAGE` until a dedicated capability is ratified.

## Routes

| Method and path | Body or query | Returns | Notes |
|---|---|---|---|
| `GET` `POST` `/api/workflows` | `company_id`, `name`, `description?` | `{ workflows }`, `{ workflow }` | |
| `GET` `/api/workflows/:id/versions`, `POST` `/api/workflows/:id/publish` | | | Published versions are frozen into plans |
| `GET` `/api/workflows/:id/report` | `company_id` | Journey report | Read-only. Fails rather than report an unreadable ledger as "not requested" |
| `POST` `/api/prospect-campaigns/:id/enroll` | | Enrollment report | Closed prospects are `excluded`, with no row written |
| `GET` `PATCH` `/api/execution-instances/:id` | `company_id`; `{ lifecycleState }` | `{ instance }` | A terminal `PATCH` withdraws unsent tasks. Terminal runs cannot reopen |
| `GET` `POST` `/api/execution-instances/:id/plan` | `company_id` | `{ plan, steps, tasks }` | The body carries nothing: all content comes from the pinned version |
| `GET` `POST` `/api/execution-instances/:id/progression` | `{ action: 'advance' \| 'cancel' }` | `{ advanced \| cancelledSteps, ... }` | `advance` is an idempotent poll. `cancel` withdraws unsent tasks, or errors if that cannot be confirmed |
| `PATCH` `/api/execution-instances/:id/progression` | `{ stepId, state }` | `{ step, engineHolds, ... }` | The step must belong to this run. `engineHolds: true` tells the person an engine already holds the action |
| `GET` `POST` `/api/execution-instances/:id/outreach-bridge` | `{ executionTaskId }` | `{ handoff, replayed }` | Idempotent by a database unique key |
| `GET` `POST` `/api/execution-instances/:id/community-link` | `{ company_id, executionTaskId, communityActionId }` | `{ link, replayed }` | Refused without proof the action concerns this person |
| `GET` `/api/execution-instances/:id/events` | `company_id`, `after?`, `limit?` | `JourneyEventsPage` | Read-only, codes only |
| `GET` `/api/cron/workflow-execution-progression` | | Sweep result | Does nothing while `WORKFLOW_ORCHESTRATION_ENABLED` is off |

`buildEmailApprovalPreview` has **no route**. It grants nothing and waits on decisions A to E.

## Engine interface

```ts
interface EngineStepContext {
  organizationId: string; executionInstanceId: string; executionTaskId: string; planStepId: string;
  channel: string; subject: SubjectRef; step: WorkflowStep | null; personId: string | null; now?: string;
  holdOnly?: boolean;   // added in 0.2.0: report what you hold; begin nothing new
}
interface EngineResult {
  engine: EngineName; outcome: string; disposition: 'completed' | 'skipped' | 'wait' | 'needs_human';
  reason: string | null; externalRef: string | null;
}
```

## Normalized execution result

```ts
interface NormalizedExecutionResult {
  contractVersion: string; engine: EngineName;
  state: 'REQUESTED' | 'AUTHORIZED' | 'QUEUED' | 'EXECUTING' | 'ACCEPTED' | 'DELIVERED'
       | 'FAILED' | 'RETRY_REQUIRED' | 'CANCELLED' | 'REJECTED';
  certainty: 'definite' | 'uncertain';
  errorClass: 'gate_refused' | 'approval_missing' | 'person_ineligible' | 'invalid_request' | 'not_configured'
            | 'unsupported' | 'transient_not_acted' | 'may_have_acted' | 'provider_rejected' | null;
  retryability: 'not_retryable' | 'next_sweep' | 'human_only';
  engineOutcome: string; disposition: EngineDisposition; externalRef: string | null;
}
```

`AUTHORIZED` is declared and no current outcome maps to it. WS-3's approved state is not separately reported to the sweep.

## Capability declaration

```ts
interface EngineCapabilityDeclaration { contractVersion: string; engine: EngineName; actions: ActionCapability[]; }
interface ActionCapability {
  action: string; channel: string; contactsPerson: boolean;
  idempotency: 'engine_record' | 'request_ledger' | 'observation_only' | 'none_acts';
  approval: 'ws3_task' | 'engine_record' | 'none_available' | 'not_applicable';
  creditMetered: boolean; reportsDelivery: boolean; reportsResponses: boolean;
  providers: Array<{ provider: string; credentials: 'tenant' | 'platform' | 'none';
                     verification: 'mocked' | 'postgres_verified' | 'sandbox_provider_verified' | 'production_verified'; }>;
}
```

## Event

```ts
interface JourneyEventsPage { contractEventVersion: number; events: JourneyEvent[]; cursor: string | null; hasMore: boolean; }
interface JourneyEvent {
  eventId: string;            // deterministic from the source row and type
  eventVersion: number;       // 1
  type: JourneyEventType;
  organizationId: string; executionInstanceId: string;
  subject: { kind: string; id: string };
  engine: string | null; channel: string | null;
  idempotencyKey: string | null;   // task:<execution_task_id>
  correlationId: string;           // journey:<instance>/step:<plan_step>
  occurredAt: string;
  source: { table: string; id: string };
  code: string | null;             // a code, never personal data or content
  positiveEngagement: boolean;     // true only for response.replied
}
```

| Group | Types | Emitted today |
|---|---|---|
| Prospect | `prospect.lifecycle_changed` | Yes |
| Journey | `journey.enrolled`, `.terminated`, `.completed` | Yes |
| Decision | `decision.recorded` | Yes |
| Approval | `approval.granted`, `.rejected` | Yes |
| | `approval.requested` | **Declared, not emitted (G-7)** |
| Execution | `execution.requested`, `.started`, `.accepted` | Yes |
| | `execution.failed`, `.cancelled` | **Declared, not emitted (G-7).** They surface as `decision.recorded` with a code |
| Delivery | `delivery.confirmed`, `.failed`, `.bounced`, `.complained` | Yes, from recorded evidence |
| Response | `response.replied`, `.unsubscribed`, `.rejected`, `.other` | Yes, from recorded outcomes |
| Outcome | `outcome.recorded` | Yes |

## Three limits a consumer must know

1. **A late row can sort before a cursor.** A provider event with an earlier time sorts before an existing cursor. For completeness, re-read from the start and dedupe on `eventId`.
2. **Codes reflect the current row.** A ledger event's `code` is the row's state now, under a fixed `eventId` and time. A consumer holding a cursor does not see a later change to `uncertain`. Re-reading does.
3. **One WhatsApp response is shown.** The view reads the same single message that ends a journey, so a later STOP replaces an earlier `response.replied`.
