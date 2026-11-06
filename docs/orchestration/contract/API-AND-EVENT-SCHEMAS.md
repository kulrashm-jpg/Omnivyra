# API and event schemas, contract 0.3.0

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
  actor?: JourneyEventActor;       // 0.3.0, optional: approval events only, absent when the row names nobody
}
interface JourneyEventActor {      // 0.3.0
  kind: 'user';
  id: string;                      // outreach_approvals.approver_user_id, as written; not re-verified
  tier: 'tenant' | 'platform' | null;   // outreach_approvals.tier; null on rows before D-02
}
```

`eventId` is the first 32 hex characters of `sha256("<source.table>|<source.id>|<type>")`. The cursor is `<occurredAt>|<eventId>`, and the order is `(occurredAt, eventId)` ascending. Identity, correlation, tenant and actor context, producer and consumer duties, idempotency, ordering and replay are set out in `SHARED-INTEGRATION-CONTRACT.md`, section E.1.

| Group | Types | Emitted today |
|---|---|---|
| Prospect | `prospect.lifecycle_changed` | Yes |
| Journey | `journey.enrolled`, `.terminated`, `.completed` | Yes |
| | `journey.suspended` (0.3.0) | Yes, from a `needs_human` decision whose outcome starts `reply_awaiting_evaluation:` or `approval_revoked:`. Agent B writes those decisions. There is no `journey.resumed` |
| Decision | `decision.recorded` | Yes |
| Approval | `approval.granted`, `.rejected`, `.revoked` (0.3.0) | Yes, from `outreach_approvals` decisions `approved`, `rejected`, `revoked`. Each carries the optional `actor` |
| | `approval.requested` | **Declared, not emitted (G-7)** |
| Execution | `execution.requested`, `.started`, `.accepted` | Yes. Since 0.3.0 `execution.accepted` is also read from `confirmed` and `sent_unverified` evidence |
| | `execution.cancelled` | Since 0.3.0, from `suppressed` and `expired` evidence only. A cancelled step still surfaces as `decision.recorded` |
| | `execution.failed` | **Declared, not emitted (G-7).** A failed step surfaces as `decision.recorded` with a code |
| Delivery | `delivery.confirmed`, `.failed`, `.bounced`, `.complained` | Yes, from recorded evidence. `delivery.confirmed` only for an observed delivery; `delivery.complained` also for a complaint-inferred `delivered` row (`isComplaintInferredEvidence`) |
| Response | `response.replied`, `.unsubscribed`, `.rejected`, `.other` | Yes, from recorded outcomes |
| Outcome | `outcome.recorded` | Yes |
| Unmapped | `record.unmapped` (0.3.0) | Yes: a stored delivery status or outcome type with no mapping, with its original `code`. Never a consequence, never positive |

## Three limits a consumer must know

1. **A late row can sort before a cursor.** A provider event with an earlier time sorts before an existing cursor. For completeness, re-read from the start and dedupe on `eventId`.
2. **Codes reflect the current row.** A ledger event's `code` is the row's state now, under a fixed `eventId` and time. A consumer holding a cursor does not see a later change to `uncertain`. Re-reading does.
3. **One WhatsApp response is shown.** The view reads the same single message that ends a journey, so a later STOP replaces an earlier `response.replied`.

## From 0.2.0 to 0.3.0

**What changed.**

- Three event types: `approval.revoked`, `journey.suspended` and `record.unmapped`.
- One optional field, `actor`, on the three approval events. `actor.id` is the user who decided or revoked, an internal uuid only (AC-1).
- One exported rule, `isComplaintInferredEvidence`, shared with the journey's complaint exit.
- Delivery statuses re-mapped, so that only an observed delivery is `delivery.confirmed`:

| Stored row | 0.2.0 event | 0.3.0 event |
|---|---|---|
| evidence `confirmed` | `delivery.confirmed` | `execution.accepted` |
| evidence `sent_unverified` | none | `execution.accepted` |
| evidence `suppressed` | none | `execution.cancelled` |
| evidence `expired` | `delivery.failed` | `execution.cancelled` |
| evidence `delivered`, complaint-inferred | `delivery.confirmed` | `delivery.complained` |
| evidence `queued`, `dispatched`, unknown | none | `record.unmapped` |
| outcome of an unknown type | `response.other` | `record.unmapped` |
| decision `needs_human` with outcome `reply_awaiting_evaluation:` or `approval_revoked:` | `decision.recorded` | `journey.suspended` |
| approval `revoked` | `approval.rejected` | `approval.revoked` |

Nothing was removed or renamed, and no field was added except `actor`. `EXECUTION_CONTRACT_VERSION` is `0.3.0`. `checkCapabilityDeclaration` compares the major only, so every 0.2.0 and 0.1.0 declaration still passes (tested in `orchestrationExecutionContract.test.ts`).

**Why `JOURNEY_EVENT_VERSION` stays 1 (owner decision EV-1, open).** This is a judgement, stated plainly. The re-mapping above narrows what `delivery.confirmed`, `delivery.failed` and `response.other` cover, and by the letter of the rule ("bumped when a field's meaning changes") that could justify 2. It stays 1 because:

- no consumer of the event view exists outside a test database: the events route is deployed nowhere, `WORKFLOW_ORCHESTRATION_ENABLED` is off everywhere, and without a run there is no handoff and so no event;
- `actor` is optional, and the new types are additive for a reader that ignores unknown types, as the consumer rules require;
- every re-mapped row changes `type`, and therefore `eventId`, so a re-reading consumer sees a new event for it rather than a silently changed one.

From the first deployment of the route on, the rule applies strictly: a change like this one would bump the event version. Bumping to 2 now instead would also need the eventVersion pins in `orch_contract_journey.test.ts`, a file this change does not own, updated.

**Consumer note.** A 0.2.0 consumer keeps working unchanged: it either ignores `approval.revoked` as an unknown type or, if it treated every non-`approval.granted` approval event as "not authorised", reaches the same answer. To use 0.3.0:

- handle `approval.revoked` as "an approval was withdrawn", never as engagement and never as a send being undone;
- treat `approval.rejected` as declined, or withdrawn before a decision, only;
- read `actor` when present, and never require it;
- read `delivery.confirmed` as an observed delivery only, and `execution.accepted` from evidence as "the transport took it", which proves no delivery;
- read `delivery.complained` as a complaint whether it came from evidence or (once S-1 lands) an outcome row; it is never positive;
- never act on `record.unmapped`;
- read `journey.suspended` as "paused for a person", not as an end; there is no `journey.resumed`;
- if a test database was read under 0.2.0, re-read from the start: every re-mapped row's old event is replaced by one with a new `eventId`.
