# Contract 0.3.0: approval revocation, outcome mapping and suspension

Orchestration Prompt 4, Deliverable A. Owner of the contract: Orchestration (Agent A). Base: frozen `7f2ca186f` (`outreach/foundation-base-20261104`). Branch `orch/c4-a-contract`, uncommitted. Not merged, not deployed; `WORKFLOW_ORCHESTRATION_ENABLED` stays off.

**Outreach sign-off: pending.** Outreach agreed the `journeyEvents.ts` changes in principle and reviews the exact diff.

The normative text is in `docs/orchestration/contract/`: `SHARED-INTEGRATION-CONTRACT.md` sections E.1 to E.4 and G, and `API-AND-EVENT-SCHEMAS.md`, "From 0.2.0 to 0.3.0". This document summarises it and records how it was verified.

## 1. Version

| Constant | 0.2.0 | 0.3.0 | Rule |
|---|---|---|---|
| `EXECUTION_CONTRACT_VERSION` | `0.2.0` | `0.3.0` | Additive change: minor bump. `checkCapabilityDeclaration` compares the major only, so 0.1.0 and 0.2.0 declarations still pass |
| `JOURNEY_EVENT_VERSION` | `1` | `1` | Kept. Owner decision EV-1 is open; the reasoning is in `API-AND-EVENT-SCHEMAS.md` |

## 2. Schema

```ts
// executionContract.ts. Added to JOURNEY_EVENT_TYPES:
'journey.suspended'   // the run is paused for a person
'approval.revoked'    // an approval withdrawn after it was given
'record.unmapped'     // a stored code with no mapping; no consequence

interface JourneyEvent {
  // ...every 0.2.0 field, unchanged...
  readonly actor?: JourneyEventActor;   // OPTIONAL; approval.granted / .rejected / .revoked only
}
interface JourneyEventActor {
  readonly kind: 'user';
  readonly id: string;                  // the deciding or revoking user: internal uuid only (AC-1)
  readonly tier: 'tenant' | 'platform' | null;
}

// journeyEvents.ts
export function isComplaintInferredEvidence(row: { delivery_status: unknown; transport_response?: unknown }): boolean;
export const JOURNEY_SUSPENSION_OUTCOME_PREFIXES = ['reply_awaiting_evaluation:', 'approval_revoked:'] as const;
```

None of the new types is positive engagement: `POSITIVE_ENGAGEMENT_EVENTS` is still `['response.replied']`.

## 3. Ownership

| Artefact | Owner | Others |
|---|---|---|
| `executionContract.ts`, `journeyEvents.ts`, `docs/orchestration/contract/*` | Orchestration (Agent A) | Propose diffs through the lead |
| `outreach_approvals`, `revokeOutreachApproval`, the dispatch gate and the claim trigger | Outreach (WS-3, D-02) | Read only |
| `outreach_delivery_evidence` and its SES writer (`sesEventNormalizer.ts`, the complaint marker) | Outreach | Read only; the marker is read, never written |
| The `needs_human` suspension decisions and the complaint exit | Orchestration (Agent B) | Agent A reads them in the view; Agent B calls `isComplaintInferredEvidence` |
| SC-7 vocabulary | Outreach; ratification by the owner (SC7-R, open) | Referenced only |

No new store, writer, event bus or migration is added.

## 4. Semantics

**Approval decisions.** `approved` maps to `approval.granted`, `rejected` (declined, or withdrawn before a decision) to `approval.rejected`, and `revoked` to `approval.revoked`. An unstorable value maps to `approval.rejected`, never to a grant. Expiry writes no decision row, so it is never a revocation. A revocation is refused once a task has left `approved` or `queued`, so it never claims that a send was undone; if a revoked row ever follows a send, the view shows both facts.

**A revocation pauses the run** (RV-1, owner, 2026-11-05). Agent B records it as a `needs_human` decision with an `approval_revoked:` outcome, and the view reads that as `journey.suspended`.

**Delivery evidence.** Only an observed delivery is `delivery.confirmed`.

| Status | Event |
|---|---|
| `confirmed`, `sent_unverified` | `execution.accepted` |
| `suppressed`, `expired` | `execution.cancelled` |
| `delivered` | `delivery.confirmed` |
| `delivered`, complaint-inferred | `delivery.complained` |
| `bounced` | `delivery.bounced` |
| `failed` | `delivery.failed` |
| `queued`, `dispatched`, anything else | `record.unmapped` |

**The complaint marker** (P-1, option E). The SES writer stores `transport_response.deliveryInferredFrom = 'Complaint'` on a `delivered` row. `isComplaintInferredEvidence` fails toward complaint and never throws:

- it accepts any status, a JSON string, other key cases and spellings, and value variants;
- it treats a pre-D7 row with `sesEventType: 'Complaint'` as a complaint;
- it reads nothing else of the response.

**Outcomes.** `opened`, `clicked` and `no_response` stay `response.other`. An unknown type is `record.unmapped`, which carries no consequence.

**Suspension and ends.**

- An unclassified reply or a revocation suspends the run until a person resumes or ends it.
- `response.replied` is not terminal.
- A journey ends only with `journey.terminated` (or `journey.completed`).
- These still terminate: a WhatsApp STOP; a recorded `unsubscribed`, `rejected`, `converted` or `meeting_booked`; and a complaint (Q-C1).
- There is no `journey.resumed` event, because resuming writes no durable row.

**Pending, not built.**

- Once the `complained` outcome row exists (Outreach S-1, `20270125000001`, `BUSINESS_OUTCOME_TYPES`), `delivery.complained` is emitted once per provider event id.
- Outreach also has DF-5 (SES `Reject` stored as `failed` with code `rejected`) and DF-7 pending.
- Reading `whatsapp_broadcast_recipients` (P-6) is a follow-up.

## 5. Idempotency, identity and ordering

- `eventId` is the first 32 hex characters of `sha256("<table>|<id>|<type>")`. One row and one type always give one event; time is not part of the id.
- Correlation is `journey:<instance>/step:<planStep>`. `idempotencyKey` is `task:<execution_task_id>`, the execution's key, not the event's.
- The order is `(occurredAt, eventId)`, and the cursor is `<occurredAt>|<eventId>`.
- A failed source read fails the whole read, so a retry is safe.
- A repeated SES complaint (same SNS id) adds no row and no event.

## 6. Compatibility

- A 0.2.0 declaration still passes.
- A 0.2.0 event consumer keeps working if it ignores unknown types, as the contract requires.
- Re-mapped rows change `type`, and therefore `eventId`. A consumer that read a test database under 0.2.0 must re-read from the start.
- No consumer exists outside a test database: the route is undeployed and orchestration is off.

## 7. Tests

| Suite | Kind | Covers |
|---|---|---|
| `backend/tests/unit/orchestrationExecutionContract.test.ts` | Unit | Versions; 0.1.0 and 0.2.0 declarations compatible, 1.0.0 refused; new types additive; never positive |
| `backend/tests/unit/journeyEventsApprovalRevoked.test.ts` | Unit, store double | Decision mapping; actor and tier; no free text; duplicate delivery; id independent of time and order; cursor; retry after a failed read; tenant isolation |
| `backend/tests/unit/journeyEventsOutcomeMapping.test.ts` | Unit, store double | Every delivery status and outcome type; `record.unmapped`; complaint marker odd cases (status, keys, JSON string, case, pre-D7, hostile values); suspension prefixes |
| `backend/tests/realschema/orch_c4_approval_revoked.test.ts` | Real PostgreSQL | Revocation (valid, duplicate, concurrent, invalid references, before and after a send, racing the claim and the sweep, cross-tenant); event view reads; **the complaint marker read from a row stored by the real SES path**; a stored JSON-string and a pre-D7 row; acceptance never `delivery.confirmed` |
| `backend/tests/realschema/orch_contract_journey.test.ts`, `d02_approval_binding.test.ts` | Real PostgreSQL | Regression |

Mutation checks were run on the delivery re-mapping, `expired`, and the complaint marker. Each mutant fails at least one test. The commands and logs are in the agent's report to the lead.
