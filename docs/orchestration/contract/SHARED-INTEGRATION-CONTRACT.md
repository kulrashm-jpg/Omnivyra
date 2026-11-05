# Omnivyra shared integration contract, v0.3.0

**Status: proposed.** 0.3.0 is implemented on the local branch `orch/c4-a-contract` (Orchestration Prompt 4, on `7f2ca186f`), uncommitted; earlier versions on `feat/orchestration-recovery`. Not merged, not deployed, and `WORKFLOW_ORCHESTRATION_ENABLED` stays off. The PI lead has not reviewed sections A and B. The Outreach lead has agreed the ownership split in section D, and its branch has merged an earlier commit of this contract (0.1.0, at `30a421c2`). It has not yet merged 0.2.0.

Code of record: `backend/services/orchestration/executionContract.ts`, `engineCapabilities.ts`, `journeyEvents.ts`, `journeyGovernance.ts`, `journeyExit.ts`.

## Who owns what

| Domain | Owns | Must not |
|---|---|---|
| **Prospect Intelligence** | Prospects, people, identity, enrichment, scoring, the lifecycle ledger and its writer | Decide what is sent or when |
| **AI Orchestration** | Workflows, versions, enrollment, plans, the clock, journey decisions, routing, the engine interface, the request ledger, the event view | Hold a prospect database, or contain channel or provider logic |
| **Outreach Engines** | Adapters and everything behind them: send paths, provider calls, webhooks, engine-level gates | Keep a second registry, or bypass section F |

| Shared artefact | Owner | Others |
|---|---|---|
| `ENGINE_NAMES`, `EngineAdapter`, `buildAdapterRegistry`, sweeper, `execution_engine_requests` | Orchestration | Outreach proposes diffs |
| `*EngineAdapter.ts` behaviour, values in `engineCapabilities.ts` | Outreach | Orchestration applies the diffs while v0.1 stabilises |
| `prospect_lifecycle_transitions`, `lifecycleWriter` | PI | Orchestration calls the writer and reads the ledger |
| `outreach_governance_config`, `contact_governance_records` | WS-3 and PI respectively | Orchestration reads only, except writes through their own services |

Five engines are in scope: WS-3 email, WhatsApp broadcast, Social publish/BOLT, Community and Browser. SMS, voice and a separate LinkedIn engine need an explicit scope change. A channel added later declares itself under section D and needs no redesign. Until it has a permission source, the sweeper holds it (`no_permission_source`).

## A. Identity and data ownership

| Concept | Canonical key | Tenant column | Notes |
|---|---|---|---|
| Prospect | `canonical_leads.id` | `company_id` | The journey subject `prospect` |
| Lead | `leads.id` | `company_id` | A different entity from a prospect; the subject `lead` |
| Person | `unified_persons.id` | `company_id` | Contact anchor, resolved by `resolveSubjectPersonId`; never part of a journey's identity |
| Tenant | `organization_id` = `company_id` | | Every read and write is tenant first |

Orchestration creates no prospect table. Current lifecycle state is the latest `prospect_lifecycle_transitions` row by `seq`; there is no state table. States: `identified`, `qualified`, `engaged`, `nurture`, `meeting_scheduled`, `not_interested`, `closed_disqualified`. The last two refuse enrollment and end a running journey.

A lifecycle source key must match `^(outcome|evidence|governance|derivation|human):[A-Za-z0-9._-]{1,200}$`. Orchestration writes through PI's opener and producer only.

`lead_intelligence*` is not read directly, except `lead_intelligence_profiles` for leads.

### Actor rule: DRAFT, UNRATIFIED

Owned by the governance programme (session virality-b6; `backend/services/actorExistence.ts` in `C:/tmp/gov2-actor-contract`, uncommitted). Quoted so the contract is explicit. **It is not approved, and F-1 and F-2 stay open.**

1. `origin='human'` must name an actor that exists as a row in `public.users(id)`: row presence only.
2. `public.users` is authoritative, never `auth.users`.
3. A soft-deleted user still exists.
4. Existence is not authorization or tenant membership.
5. `origin='provider'` or `'derived'` names no actor, and none is looked up.
6. Shape before existence: a non-uuid is refused locally.
7. Fail closed on three outcomes: exists, absent, unverifiable. The caller refuses on the last two.
8. The uuid is never rewritten or erased.

**Order is one-way.** `20270116000003` removes the only database enforcer, so it is valid only with the merged writer. Applied first, a human-origin transition naming a fictional uuid is accepted where it used to raise 23503.

**Not yet uniform.** Per the owner of that work, three implementations exist: only `problemObservationRepository` imports the shared check, `lifecycleWriter` matches it inline, and `relationshipAttributeIngestion` differs on a malformed actor.

Orchestration's own lifecycle calls (`feedWhatsAppReplyToLifecycle`, `ensureProspectLifecycleOpen`) use `derived` with a null actor, compatible with rule 5 by code reading. Human-origin outcomes reach PI's writer through `outcomeLifecycleProducer`, with the actor from the outcome's `metadata.recordedByUserId`, which `pages/api/outreach/outcomes.ts` sets from `tenant.userId`. The actor must be `public.users.id`, not the auth uid. `authResolver.ts` returns `public.users.id` as `id`; the step through `requireTenantAccess` was not traced.

**Which tree a test ran on matters.** `origin/main` has no actor validation, so any uuid passes. The governance branch refuses with `actor_not_a_uuid`, `actor_not_found` or `actor_unverifiable`. Orchestration's journey suites ran on the first, so they do not prove the second. Rules 6 and 7 are enforced by the lifecycle writer's branch, not yet by the relationship attribute branch. That work is uncommitted pending owner approval.

**Enablement gate:** orchestration stays off until the writer validation and the FK removal land together, writer first, and the rule is ratified.

## B. Enrollment

- **Eligibility:** `orchestration/enrollment.ts`. A closed prospect is refused, with no row written (422, or `excluded` in a campaign batch).
- **Deduplication:** `uq_execution_instances_active (organization_id, campaign_id, workflow_id, subject_kind, subject_id)` over the states `created`, `queued`, `active`, `paused`.
- **Provenance:** on the instance and on `prospect_campaign_targets`.
- **Version pinning:** a plan freezes the workflow version's definition, so publishing a new version never alters a running journey.
- **Withdrawal:** cancel through `POST /api/execution-instances/:id/progression`, or a terminal lifecycle `PATCH`. Both withdraw unsent WS-3 tasks.

## C. Workflow

A version holds steps with `channel`, `instruction`, optional `when` conditions and an optional `choice_group`, plus a policy with `min_hours_between_actions` and `execution_window`.

**What branching is, exactly.** A choice group is a set of consecutive steps: the first whose conditions hold acts, and the rest are skipped with `branch_not_taken`. Nothing adds or reorders steps at run time. The next-best action is rule-based on facts read live. There is no model choosing actions.

The database clock (`advance_execution_plan`) is the only scheduler. A failed or cancelled step ends the run as `failed` and withdraws what was unsent.

**A failed read decides nothing.** A fact missing because a read failed holds the step as `facts_unreadable` rather than skipping it, so an outage cannot lose a step. After 7 days it is reported to a person.

## D. Outreach execution

An engine implements `EngineAdapter`: `execute(ctx)` returns `{ engine, outcome, disposition, reason, externalRef }`. **`disposition` alone settles a step.**

| Disposition | Effect on the step |
|---|---|
| `completed` | Settled completed; the journey advances |
| `skipped` | Settled skipped; the journey advances |
| `wait` | Stays ready; asked again next sweep; reported to a person after 7 days |
| `needs_human` | Stays ready; reported each sweep; a person settles it |

**Normalized result** (`normalizeEngineResult`). It reads what an engine reported and never claims more: `sent` is `ACCEPTED`, and only a delivery event is `DELIVERED`.

| Field | Values |
|---|---|
| `state` | `REQUESTED`, `AUTHORIZED`, `QUEUED`, `EXECUTING`, `ACCEPTED`, `DELIVERED`, `FAILED`, `RETRY_REQUIRED`, `CANCELLED`, `REJECTED` |
| `certainty` | `definite`, `uncertain` |
| `errorClass` | `gate_refused`, `approval_missing`, `person_ineligible`, `invalid_request`, `not_configured`, `unsupported`, `transient_not_acted`, `may_have_acted`, `provider_rejected` |
| `retryability` | `not_retryable`, `next_sweep`, `human_only` |

**"It may have happened" is not a state.** An uncertain result stays `EXECUTING` with class `may_have_acted` and `human_only`. It never reads as `FAILED`, which invites a retry. This is an addition to the owner's ten states, not a change to them, and is listed for approval in the decision register.

**Adapter rule for a result about the attempt, not the person.** The state reading depends on the disposition. An outcome such as a voice call's `no_answer` must use `completed`, since the action happened and nobody answered. Using `skipped` would read as `REJECTED` / `person_ineligible`, which is wrong.

**Idempotency and correlation.** The key is `task:<execution_task_id>`, and the correlation ID is `journey:<instance>/step:<plan_step>`. An action is repeat-safe through `engine_record`, `request_ledger`, `observation_only` or `none_acts`, as each engine declares.

**A provider refusal goes to a person.** WS-3 returns a refused task to `queued`, which is right for a person retrying and wrong for a clock. The adapter stops at the first recorded refusal with `provider_refused_prior_attempt`, so the clock does not call the provider again. `disabled` never reached a provider and stays free to go.

**Withdrawing a step.** Before a step is skipped or settled, `withdrawStepAction` decides what is left.

| What exists | Result |
|---|---|
| Ledger row `requested` | Compare-and-set to `skipped`. It holds nothing, because adapters claim with `requested → submitting` before creating anything. The loser of a race moves nothing |
| Any other ledger row except `skipped` | `engine_holds`. The step goes to the engine with `holdOnly` |
| WS-3 task `pending`, `awaiting_approval`, `approved`, `queued`, `paused` | Cancelled |
| WS-3 task `failed`, `escalated` | `engine_holds`: it may have reached the person. When a whole run ends, it is cancelled instead |
| WS-3 task `retried`, `resumed`, `reassigned` | Incomplete: re-read, then reported. The run stays open |
| WS-3 task `dispatching`, `sent`, `delivered`, `completed` | `engine_holds` |

**`holdOnly` (added in 0.2.0).** An adapter given `holdOnly` reports what it holds and begins nothing new. A stale claim with nothing behind it settles `skipped` with `not_begun`, so a step whose conditions failed is not started by releasing a claim.

**Capability declaration** (`engineCapabilities.ts`, checked by `checkCapabilityDeclaration`). Engine, provider and action are separate identities. Each action declares channel, `contactsPerson`, idempotency, approval model, `creditMetered`, delivery and response reporting, and providers with credentials and a verification level. The check is static: no runtime negotiation yet.

**Verification levels:** `mocked`, `postgres_verified`, `sandbox_provider_verified`, `production_verified`. No engine claims either of the last two.

**Usage.** `ExecutionUsage` is reported, not charged. No engine charges credits today, and pricing is owner decision C-1.

## E. Events

`GET /api/execution-instances/:id/events?company_id=&after=&limit=` returns `{ contractEventVersion, events, cursor, hasMore }`.

**A view, not a store.** Events are read from the rows that already hold them, so no second log can disagree. Each event names its `source.table` and `source.id`.

| Guarantee | How |
|---|---|
| Tenant scope | The run is resolved in the tenant; another tenant gets 404 |
| Deduplication | `eventId` derives from the source row and type |
| Replay | Reading again gives the same events in the same order |
| Cursor | `after` is the last event seen; order is `(occurredAt, eventId)` |
| No personal data | Codes only. `evidence` and message content are never read. Of `transport_response`, only the complaint marker is used (0.3.0, E.3), and nothing of it is copied into an event |

**Cursor limit.** A row that arrives late with an earlier `occurredAt`, as a provider event can, sorts before an existing cursor. A ledger event's `code` is the row's current state, so a cursor reader does not see a later change to `uncertain`. A consumer needing completeness re-reads from the start and dedupes on `eventId`.

**WhatsApp responses.** The view reads the same single message that ends a journey, so a later STOP replaces an earlier `response.replied` in a replay.

**Types:** `prospect.lifecycle_changed`; `journey.enrolled`, `.terminated`, `.completed`; `decision.recorded`; `approval.requested`, `.granted`, `.rejected`, `.revoked` (0.3.0); `execution.requested`, `.started`, `.accepted`, `.failed`, `.cancelled`; `delivery.confirmed`, `.failed`, `.bounced`, `.complained`; `response.replied`, `.unsubscribed`, `.rejected`, `.other`; `outcome.recorded`; and, added in 0.3.0, `journey.suspended` and `record.unmapped`.

`JOURNEY_EVENT_VERSION` is bumped when a field's meaning changes, not when an optional field or a new type is added. It is still 1 at 0.3.0, although 0.3.0 re-maps four delivery statuses: the reasoning is in `API-AND-EVENT-SCHEMAS.md`, "From 0.2.0 to 0.3.0", and the owner decision EV-1 is open. Only `response.replied` is positive engagement. A STOP, an unsubscribe, a bounce, a complaint, every approval event (`approval.revoked` included), `journey.suspended` and `record.unmapped` never are.

### E.1 Event rules (written down in 0.3.0; unchanged in behaviour)

| Rule | What holds |
|---|---|
| **Identity** | `eventId` is the first 32 hex characters of `sha256("<source.table>\|<source.id>\|<type>")`. One durable row and one type are one event, however often it is read. The time is not part of it |
| **Correlation** | `correlationId` is `journey:<executionInstanceId>/step:<planStepId>`, or `journey:<executionInstanceId>` for a run-level event. Every event of one step shares it, across engines |
| **Idempotency** | `idempotencyKey` is `task:<execution_task_id>` for an event about a step's task, otherwise null. It is the execution's key, not the event's, so many events share it. Deduplicate events on `eventId` |
| **Tenant context** | `organizationId` is the tenant the run was resolved in. Every read is tenant first. Another tenant's run is not found (404 through the route), and no row of another tenant is read into a run |
| **Actor context** | Optional `actor` (0.3.0), on `approval.granted`, `.rejected` and `.revoked` only: `{ kind: 'user', id, tier }` from `outreach_approvals.approver_user_id` and `.tier`. `actor.id` is the user who decided, or who revoked: an internal user uuid only, never a name or an address, and served only through the tenant-scoped route (owner decision AC-1, 2026-11-05). Absent when the row names nobody. The view does not re-verify the id against `public.users` (the actor rule in section A is unratified). The free-text `reason` and `notes` are never read |
| **Ordering** | `(occurredAt, eventId)`, both ascending, compared as strings. `occurredAt` is the source row's own time, ISO-8601 UTC |
| **Cursor** | `after` is `<occurredAt>\|<eventId>` of the last event seen. The page holds the events strictly after it |
| **Replay** | Reading again gives the same events, ids and order, unless a source row was added or changed since (the cursor limit above) |
| **Failure** | An unreadable source fails the whole read (`journey_events_unreadable`; 500 through the route). A partial page is never returned, so a retry is safe |

**Producer responsibilities.** A domain that owns a source row writes it durably, append-only where its store is, with its own time. It never writes an event: the view derives events from its rows. A new event type is added to `JOURNEY_EVENT_TYPES` and mapped in `journeyEvents.ts` by the contract owner, Orchestration, with every stored value mapped deliberately.

**Consumer responsibilities.** Deduplicate on `eventId`. Ignore a `type` it does not know, rather than fail. Never treat an approval event as engagement. Never act on `record.unmapped`: it is kept so nothing is lost, and it carries no consequence. Treat an event as a fact already recorded, never as a command. For completeness, re-read from the start and deduplicate, because a cursor alone can miss a late row. Treat `actor` as optional and `code` as a code.

### E.2 `approval.revoked` (0.3.0)

Produced from the `revoked` row that `revokeOutreachApproval` (`leadOutreachExecution/approvalRevocation.ts`) appends to `outreach_approvals`. No new store, writer or bus. The tenant surface is `POST /api/outreach/journey-approval` with `action: 'revoke'`.

| `outreach_approvals.decision` | Event |
|---|---|
| `approved` | `approval.granted` |
| `rejected`: a human declined, or withdrew a request before deciding | `approval.rejected` |
| `revoked`: an approval withdrawn after it was given | `approval.revoked` |
| Any other value | Cannot be stored (CHECK since `20270120000011`). Were one read, it is `approval.rejected`, never a grant |

**Expiry is not revocation.** A lapsed approval ends the task `expired` and writes no decision row, so it never reads as `approval.revoked`.

**A revocation never claims a send was undone.** It is refused once a task has left `approved` or `queued`. If a revoked row ever follows a send, the view shows both facts and retracts nothing.

**What a revocation does downstream today**, proven on real PostgreSQL in `backend/tests/realschema/orch_c4_approval_revoked.test.ts`:

- the task moves to `cancelled` by compare-and-set, so exactly one of a revocation and a claim wins;
- the dispatch gate and the database claim trigger also refuse a task whose latest decision is `revoked`;
- on the frozen base `7f2ca186f`, the next sweep reads the cancelled task as disposition `skipped`, the step settles `skipped` (decision `skipped`, outcome `cancelled`, shown as `decision.recorded`), and the journey moves to its next step.

**RV-1, decided by the owner on 2026-11-05: a revocation PAUSES the run for human review.** Agent B implements the pause in the sweeper (not in this change). It is recorded as a `needs_human` decision whose outcome starts `approval_revoked:`, which the view reads as `journey.suspended` (E.4). The step-skipping behaviour above is superseded once that lands.

### E.3 Delivery evidence, outcomes and the complaint marker (0.3.0)

Every stored value is mapped deliberately. Only an observed delivery is `delivery.confirmed`.

| `outreach_delivery_evidence.delivery_status` | 0.2.0 | 0.3.0 | Why |
|---|---|---|---|
| `delivered` | `delivery.confirmed` | `delivery.confirmed`, or `delivery.complained` when complaint-inferred | An observed delivery. A complaint's `delivered` row is an inference (D7) |
| `confirmed` | `delivery.confirmed` | `execution.accepted` | The internal transport's acknowledgement. It proves no delivery |
| `sent_unverified` | none (dropped) | `execution.accepted` | The email transport accepted it. It proves no delivery |
| `suppressed` | none (dropped) | `execution.cancelled` | Refused at dispatch. Never sent |
| `expired` | `delivery.failed` | `execution.cancelled`, code `expired` | Lapsed before it was sent. Not a delivery failure |
| `bounced` | `delivery.bounced` | `delivery.bounced` | Unchanged. An SES `Reject` is also stored as `bounced` today: DF-5, pending with Outreach |
| `failed` | `delivery.failed` | `delivery.failed` | Unchanged |
| `queued`, `dispatched`, any other | none (dropped) | `record.unmapped`, original code | Nothing is dropped (Q-C4) |

| `outreach_outcomes.outcome_type` | Event |
|---|---|
| `replied` | `response.replied` (the only positive engagement) |
| `unsubscribed` | `response.unsubscribed` |
| `rejected` | `response.rejected` |
| `complained` (only in the unapplied `20270125000001`) | `delivery.complained` |
| `meeting_booked`, `converted` | `outcome.recorded` |
| `opened`, `clicked`, `no_response` | `response.other`, as in 0.2.0 |
| Any other | `record.unmapped`, original code (in 0.2.0 it was `response.other`) |

**Why one new type, `record.unmapped`, and not a reused one.** `response.other` says a response-axis fact that the contract chooses not to classify (`opened`, `clicked`, `no_response`). `outcome.recorded` says a business result. A `queued` delivery status is neither, and labelling it either way would give it a meaning it does not have. One additive type covers both stores (`source.table` tells them apart), so a consumer finds every unmapped code with one filter. It is never positive and carries **no consequence**: nothing ends, pauses or advances a journey on it.

**The complaint marker (P-1, option E).** The SES adapter records a complaint as a `delivered` evidence row (a complaint implies the message arrived) whose `transport_response` holds `deliveryInferredFrom: 'Complaint'` beside `sesEventType: 'Complaint'` (`sesEventNormalizer.ts:191`, verified on a stored row). The view emits `delivery.complained` (code `complained`) for that row instead of `delivery.confirmed`, so one SES complaint is one event, keyed by its evidence row, which the provider event id already deduplicates.

The rule is one exported function, `isComplaintInferredEvidence(row: { delivery_status: unknown; transport_response?: unknown }): boolean` in `journeyEvents.ts`. The journey's complaint exit (Agent B) calls the same function on the evidence it reads directly. It **fails toward complaint** and never throws:

- any `delivery_status` counts, expected or not;
- `transport_response` may be an object, a JSON string (even doubly encoded) or plain text naming the marker;
- the key may be in any case, or spelled with `_` or `-`; the value counts when it contains "complaint" in any case, or is a list that does;
- a row written before D7 (`25e1c8a96`), which has `sesEventType: 'Complaint'` and no marker, counts too;
- nothing else in `transport_response` is looked at, and the function's answer is the only thing that reaches an event.

**Pending, not built.** Once Outreach writes the `complained` outcome row (S-1, after `20270125000001` is applied and `complained` is added to `BUSINESS_OUTCOME_TYPES`), `delivery.complained` must be emitted once per provider event id, not once from the evidence row and again from the outcome row. That change belongs to the contract owner and lands with S-1.

### E.4 Suspension and the end of a journey (0.3.0)

- **An unclassified reply, or a revocation, suspends the journey.** The run is paused until a person resumes or ends it. The sweeper records it as a `needs_human` decision whose outcome starts `reply_awaiting_evaluation:` or `approval_revoked:`, and the view reads that decision as `journey.suspended`. Any other `needs_human` decision stays `decision.recorded`. Writing the decision is Agent B's work.
- **`response.replied` is not terminal.** A reply is positive engagement, and its consequence is decided by the journey's rules, not by the event.
- **A journey ends only with `journey.terminated`** (or `journey.completed` when its plan finishes). `journey.suspended` is never an end.
- **Still terminal:** a WhatsApp STOP; a recorded `unsubscribed`, `rejected`, `converted` or `meeting_booked`; and now a complaint (owner decision Q-C1, 2026-11-05; the exit is Agent B's, through `isComplaintInferredEvidence`).
- **Open: an unclassified WhatsApp inbound is still positive (DF-6; X-3 in the decision register).** The view still emits `response.replied` with `positiveEngagement: true` for every WhatsApp inbound that is not an opt-out keyword, and `feedWhatsAppReplyToLifecycle` still moves PI to `engaged`. Prompt 4 does not change that. It waits for SC7-R or a PI decision.
- **No `journey.resumed` event.** Resuming writes no durable row of its own today, and the view emits only what a row records. A consumer sees the next decision or execution event of the run instead.

**Mandate events with no separate type.** `prospect discovered`, `qualified` and `updated` appear as `prospect.lifecycle_changed` from enrollment on; before enrollment they belong to PI. `approval.requested` is declared but not emitted yet: approvals expose only decisions. `execution.failed` is declared and not emitted: a failed step surfaces as `decision.recorded` with a code. `execution.cancelled` is emitted since 0.3.0 for `suppressed` and `expired` evidence only; a cancelled or skipped step still surfaces as `decision.recorded`.

## F. Governance

Every contact step passes these whichever engine serves it. The central gate is in the sweeper, so an engine cannot be left out by forgetting to call one. Engines keep their own gates behind it.

| Control | WS-3 email | WhatsApp | Community | Social publish | Browser |
|---|---|---|---|---|---|
| Global kill switch | Central + engine | Central + engine | Central | Not contact | No actions |
| Tenant enablement, kill switch | Central + engine | Central + engine | Central | Not contact | No actions |
| Channel enablement | Central + engine | Central + engine | Central | Not contact | No actions |
| Consent and suppression (`mayContact`) | Fact + engine | Fact + send time | Fact | Not contact | No actions |
| Human approval | WS-3 task (super-admin only today) | **None exists: refuses** | Engine record | Release, not approval | No actions |
| Deduplication | Bridge unique per task | Request ledger | Engine record | Observation only | No actions |
| Quota | WS-3 attempts | **None in this path** | **None in this path** | Not contact | No actions |
| Credits | **None** | **None** | **None** | **None** | **None** |
| Audit | Decisions + attempts | Decisions + ledger | Decisions + engine | Decisions | Decisions |
| Retention and erasure | **Open: B-3, B-4** | **Open** | **Open** | | |

Social publish is `NON_CONTACT`: it publishes to an account and addresses nobody, so the central gate does not apply. It has no per-person capability.

A hold is `waiting`, recorded and visible, and the step resumes when the control clears. A refused permission settles the step `skipped`.

## G. Shared message-outcome layers (0.3.0)

From Agent C's draft (`docs/orchestration/completion/SHARED-MESSAGE-OUTCOME-CONTRACT.md` on `orch/c4-c-outcomes`), with the owner's decisions of 2026-11-05 applied. **SC-7 stays unratified** (owner decision SC7-R is open): layer (c) is named only as a dimension, no code is defined here, and no runtime path lets a classifier's output drive a journey. Migration `20270125000000` stays unapplied.

Each layer is read from the store its owner already writes. No layer is stored twice, and none is a new event store. The journey event view (section E) reads (b), (d) and the WhatsApp inbound rows; it is not a layer.

| Layer | What it is | Store (source of truth) | Writer |
|---|---|---|---|
| (a) Raw provider event | The provider's own status or event, as received | SES: `outreach_delivery_evidence.transport_response.sesEventType`. Meta: `whatsapp_broadcast_recipients.status`, `error_code`. Community: `community_ai_actions.status`, `execution_result` | The channel adapter |
| (b) Normalized channel outcome | Two axes: **delivery** (`delivery_status`, 9 values) and **business** (`outcome_type`). A fact the adapter inferred says so with `deliveryInferredFrom`, and is never presented as observed | `outreach_delivery_evidence`, `outreach_outcomes` (append-only) | `ingestFeedback`, dispatch, the operator route |
| (c) Message classification | What an inbound message means. **SC-7 `sc7-draft-1`, UNRATIFIED.** Governance classes would come from the deterministic detector only; a classifier would only recommend | None (`20270125000000` unapplied) | None at runtime |
| (d) Orchestration decision | What the sweep decided for a step or a run | `execution_journey_decisions` | `recordJourneyDecisions` |
| (e) Journey consequence | Continue, wait, suspend, skip, or end the run | `execution_instances.lifecycle_state` and the `exited` / `needs_human` decision rows | `workflowProgressionSweeper` |

**The outcome `complained`** (owner decision Q-C2, 2026-11-05) is a business outcome distinct from `unsubscribed` (a recipient instruction) and from `bounced` and `failed` (delivery facts). Only an authenticated provider complaint path may write it, so it is never a feedback signal. **A complaint ends the run** (Q-C1).

### Agreed mapping

| Channel | Raw (a) | Normalized (b) | Event | Consequence (e) |
|---|---|---|---|---|
| Email | transport accepted | `sent_unverified` | `execution.accepted` | continue |
| Internal | internal ack | `confirmed` | `execution.accepted` | continue |
| Email | queue expiry, never sent | `expired` | `execution.cancelled`, code `expired` | continue |
| Email | dispatch-time suppression | `suppressed` | `execution.cancelled`, code `suppressed` | step skipped by its gate |
| Email | transport error | `failed` | `delivery.failed` | engine `needs_human` |
| Email | SES `Delivery` | `delivered` | `delivery.confirmed` | continue |
| Email | SES `Bounce` Permanent | `bounced`, plus restriction `bounce_hard` on email | `delivery.bounced` | later email steps skipped by the gate |
| Email | SES `Bounce` Transient or Undetermined | `bounced`, no restriction | `delivery.bounced` | continue |
| Email | SES `Reject` | `bounced` (DF-5) | `delivery.bounced` | continue. **Pending (Outreach): `failed`, code `rejected`** |
| Email | SES `Complaint` | `delivered`, complaint-inferred, plus restriction `complaint` on every channel | `delivery.complained`, once | **the run ends** (Q-C1; Agent B) |
| Email | operator `replied` | `replied` | `response.replied` (positive) | per the journey's rules; not terminal by itself (E.4) |
| Email | operator-recorded `unsubscribed` | `unsubscribed`, plus governance | `response.unsubscribed` | the run ends |
| Email | unsubscribe link | governance only: no `outreach_outcomes` row (`unsubscribeService.ts` calls neither `appendOutcome` nor `ingestFeedback`) | none yet (pending SC-4) | no exit; the dispatch governance gate refuses the later steps |
| Email | `rejected` (human) | `rejected` | `response.rejected` | the run ends |
| Email | `converted`, `meeting_booked` | outcome | `outcome.recorded` | the run ends |
| Email | `opened`, `clicked`, `no_response` | outcome | `response.other` | continue |
| Any | a stored code with no mapping | as stored | `record.unmapped`, original code | **none** |
| WhatsApp | Meta `sent` | recipient `sent` | `execution.accepted`, through the `executed` decision | step completed |
| WhatsApp | inbound opt-out keyword (STOP) | inbound message, plus governance on WhatsApp | `response.unsubscribed` | the run ends |
| WhatsApp | any other inbound | inbound message | `response.replied` | the run is suspended for a person (Agent B) until SC-7 is ratified |
| SMS, voice | none | none | none | the channel is unsupported |
| Social publish | post status | `scheduled_posts` | `execution.accepted` or `decision.recorded` | completed, or needs a person; no per-person outcome |
| Community | action `executed` / `sent_unverified` | `community_ai_actions.status` | `execution.accepted` | step completed |
| Any | revocation of an approval | `outreach_approvals` `revoked` row | `approval.revoked`, then `journey.suspended` | the run is paused for review (RV-1; Agent B) |

### Pending, not done

| Item | Owner | State |
|---|---|---|
| DF-5: SES `Reject` recorded as `failed` with code `rejected`, not `bounced` | Outreach | Pending |
| DF-7: a WhatsApp failure after the step settled is invisible to the journey; unmapped Meta statuses are dropped | Outreach (raw-status retention), Orchestration (reader) | Pending |
| `complained` in `BUSINESS_OUTCOME_TYPES`, with migration `20270125000001` applied, and the S-1 writer | Outreach | Pending. Then `delivery.complained` once per provider event id (E.3) |
| P-6: read `whatsapp_broadcast_recipients` for WhatsApp delivery and late failure | Orchestration | Out of scope for 0.3.0; follow-up |
| SC-7 ratification (SC7-R) and any classifier-driven consequence | Owner | Open |

## Compatibility register

| Contract | Version | Consumers | Status |
|---|---|---|---|
| Execution contract | 0.3.0 | Five adapters | Implemented locally, uncommitted. Outreach merged 0.2.0 (`d682ab13`); 0.3.0 is not merged by Outreach yet |
| Event view | event version 1 | `events` route | Implemented. 0.3.0 adds `approval.revoked`, `journey.suspended`, `record.unmapped` and the optional `actor`, and re-maps four delivery statuses (E.3) |
| Capability declarations | 0.3.0 | `checkCapabilityDeclaration`, Outreach fixtures | Implemented. A 0.2.0 or 0.1.0 declaration still passes: only the major is compared |
| PI lifecycle writer | Unversioned | Sweeper feed, opener | In use; actor validation pending |

**Rules.** A breaking change bumps the major version, and `checkCapabilityDeclaration` then refuses a mismatched declaration. Adding an optional field bumps the minor. Changes are recorded here with the commit.

| Version | Commit | Change |
|---|---|---|
| 0.1.0 | `77e90518` | First version |
| 0.2.0 | `019b6de5` | Optional `holdOnly` on `EngineStepContext`; outcomes `not_begun`, `broadcast_unreadable`, `facts_unreadable` |
| 0.3.0 | Uncommitted, `orch/c4-a-contract` | Event types `approval.revoked`, `journey.suspended`, `record.unmapped`; optional `actor` on approval events; delivery re-mapping and the complaint marker (E.3); suspension and end rules (E.4); the event rules (E.1) written down; section G. Event version stays 1 (EV-1 open) |

Outreach's `CONTRACT-V0.2-PROPOSALS.md` (provider availability, webhook verification) was named before this version existed. It is undecided, unbuilt, and not part of 0.2.0.
