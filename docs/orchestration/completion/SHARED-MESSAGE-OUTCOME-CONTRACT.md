# Deliverable D: SHARED-MESSAGE-OUTCOME contract (0.3.0)

Orchestration Prompt 4, Agent C, round 2, 2026-11-05.

**Status: FINAL DRAFT for integration. Outreach sign-off: pending.**

## Basis

| Input | Reference |
|---|---|
| Frozen base | `7f2ca186f` (`outreach/foundation-base-20261104`) |
| Contract implementation (Agent A) | `C:/tmp/orch-c4-a-contract`: `journeyEvents.ts` sha256 `b82b894d…59a9` and `executionContract.ts` `fe1436a4…beb2`, `EXECUTION_CONTRACT_VERSION = '0.3.0'`, `JOURNEY_EVENT_VERSION = 1` |
| Contract text (Agent A) | `docs/orchestration/contract/SHARED-INTEGRATION-CONTRACT.md` §E.3, §E.4 and §G |
| Decisions | Owner decisions and Outreach answers of 2026-11-05 (section 9) |

- Unless marked otherwise, line references are to the frozen base.
- **Tests:** pinned by `backend/tests/unit/sharedMessageOutcomeMapping.test.ts`. Against A's tree it gives 31 passed and 10 todo. Each todo is a pending follow-up and names its owner.

> **SC-7 is UNRATIFIED** (owner decision SC7-R is open).
> - The `sc7-draft-1` codes are named here only as the classification dimension.
> - This contract defines no classification code.
> - No runtime path lets a classifier output drive a journey.
> - Migration `20270125000000` stays unapplied.

## 1. The five layers

| Layer | What it is | Store (source of truth) | Writer |
|---|---|---|---|
| (a) Raw provider event | The provider's own event or status, as received | SES: `outreach_delivery_evidence.transport_response` (`sesEventType`, `bounceType`, `complaintFeedbackType`, the marker). Meta: `whatsapp_broadcast_recipients.status`, `error_code`. Community: `community_ai_actions.status`, `execution_result` | The channel adapter |
| (b) Normalized channel outcome | Two orthogonal axes:<ul><li>**delivery**: `delivery_status`, 9 values;</li><li>**business**: `outcome_type`, 8 values, with `complained` held.</li></ul> | `outreach_delivery_evidence` and `outreach_outcomes`, both append-only by trigger (`20260910000000:271-284`) | `ingestFeedback`, WS-3 dispatch, the operator route |
| (c) Message classification | What an inbound message means. **UNRATIFIED** | None (`20270125000000` unapplied) | None at runtime |
| (d) Orchestration decision | What the sweep decided for a step or a run | `execution_journey_decisions` (append-only; `decision` CHECK `20270120000000:44`) | `recordJourneyDecisions` |
| (e) Journey consequence | Continue, wait, suspend, skip, or end the run | `execution_instances.lifecycle_state`, plus the `exited` and `needs_human` decision rows | `workflowProgressionSweeper` |

- The journey event (`readJourneyEvents`) is a **view** over (b), (d) and the WhatsApp inbound rows. It is not a layer.
- No layer is stored twice. No new event store, outcome store, suppression system or status registry is introduced.

## 2. Shared classification (layer c), UNRATIFIED

| Field | Meaning |
|---|---|
| `vocabularyVersion` | `sc7-draft-1` (unratified) |
| `code` | One of 16 draft codes (`vocabulary.ts:20-39`): `positive_interest`, `enquiry`, `information_request`, `pricing`, `meeting_request`, `objection`, `not_interested`, `follow_up`, `complaint`*, `support_request`, `unsubscribe`*, `stop`*, `wrong_recipient`, `out_of_office`, `spam_suspicious`, `ambiguous`. (* = governance.) |
| `governance[]` | Ordered **`complaint` > `stop` > `unsubscribe`** (`GOVERNANCE_PRECEDENCE`, `governanceDetection.ts:37`). All classes present are returned |
| `governanceMatches[]` | `{ code, basis: keyword / channel_signal / phrase, rule }`. Never message text |
| `confidence` | [0,1], or null for a deterministic match |
| `abstained` | True when nothing is determinable. It maps to `ambiguous`, never to governance |

Rules:

1. **Governance comes from the deterministic detector only** (`detectGovernanceClasses`, `governanceDetection.ts:167-197`). It uses no model, network or database, and runs before any classifier.
2. **AI output is a recommendation, never an authorisation.**
   - It may add labels.
   - It never removes or replaces a governance class.
   - It never authorises contact, writes a restriction, or ends, suspends or advances a journey.
   - A governance class it suggests is a `governanceCandidate` for human review.
3. **Until SC7-R, layer (c) is text and fixtures only.**
   - Classification is not used at runtime.
   - An inbound message that has not been evaluated is handled by the **unclassified-reply** rule (section 7), not by any code.

## 3. Channel outcome vocabulary (layer b)

### 3.1 Delivery axis: `outreach_delivery_evidence.delivery_status`

The value list is `DELIVERY_STATUSES` (`lifecycle.ts:104-107`), with its CHECK at `20260910000000:196-199`. The event column is Agent A's 0.3.0 `DELIVERY_EVENTS`.

| Value | Meaning | Journey event | Code |
|---|---|---|---|
| `queued`, `dispatched` | Not yet with a provider | `record.unmapped` | the value |
| `confirmed` | Internal transport acknowledgement (`internalTransport.ts:121`) | `execution.accepted` | `confirmed` |
| `sent_unverified` | Email transport accepted (`emailTransport.ts:350`) | `execution.accepted` | `sent_unverified` |
| `delivered` | Observed delivery (SES `Delivery`) | `delivery.confirmed` | `delivered` |
| `delivered`, complaint-inferred (`isComplaintInferredEvidence`) | SES `Complaint`. The row is an inference, marked `deliveryInferredFrom: 'Complaint'` (`sesEventNormalizer.ts:191`) | `delivery.complained` | `complained` |
| `bounced` | SES `Bounce`; also SES `Reject` today (DF-5) | `delivery.bounced` | `bounced` |
| `failed` | Transport error | `delivery.failed` | `failed` |
| `suppressed` | Refused at dispatch; never sent | `execution.cancelled` | `suppressed` |
| `expired` | Lapsed before sending; not a delivery failure | `execution.cancelled` | `expired` |
| Any other value | — | `record.unmapped` | the value |

Only `delivered` that is not complaint-inferred is `delivery.confirmed`.

### 3.2 Business axis: `outreach_outcomes.outcome_type`

The value list is `BUSINESS_OUTCOME_TYPES` (`lifecycle.ts:134-138`, restated at `corpus.ts:67-70`), with its CHECK at `20260915000000:28-36`.

| Value | Journey event | Positive? |
|---|---|---|
| `replied` | `response.replied` | **yes, the only one** |
| `unsubscribed` | `response.unsubscribed` | no |
| `rejected` | `response.rejected` | no |
| `meeting_booked`, `converted` | `outcome.recorded` | no |
| `opened`, `clicked`, `no_response` | `response.other` | no |
| `complained` (**held**: in `20270125000001` only) | `delivery.complained` | no |
| Any other value | `record.unmapped` | no |

- **`FEEDBACK_SIGNALS`** (`feedbackIngestion.ts:76-86`) excludes `rejected`, and **never** includes `complained`.
- **Events with no consequence.** `record.unmapped` and `response.other` end, pause and advance nothing.

### 3.3 Event invariants (pinned)

- Every stored value maps to a declared `JOURNEY_EVENT_TYPES` member. Nothing is dropped.
- Unknown values become `record.unmapped` with their code, never the nearest known value.
- `POSITIVE_ENGAGEMENT_EVENTS = ['response.replied']`. None of these is ever positive:
  - `delivery.complained`, `delivery.bounced`, `response.unsubscribed`;
  - `journey.suspended`, `record.unmapped`, `approval.*`.
- From provider evidence only one code reaches an event, the complaint verdict. No address, provider id or feedback text does.

## 4. `complained`: semantics and consequences

**What it is.** A **business** outcome (owner decision Q-C2). It is distinct from three other facts, both in recording and in consequence:

| Distinct from | Why | How it is kept apart |
|---|---|---|
| `bounced` / `failed` | Delivery facts about transport | A complaint never yields `bounced` or `bounce_hard` (`sesEventNormalizer.ts:164-171`). Its events are `delivery.complained`, never `delivery.bounced` or `delivery.failed` |
| `unsubscribed` | A recipient instruction | Governance type `complaint` (on `*`), not `unsubscribe`. Event `delivery.complained`, not `response.unsubscribed` |
| Positive engagement | — | Never positive |

**How it is recorded, with no new store:**

1. **The canonical governance restriction.**
   - SES writes `complaint` on channel `*` for the ADDRESS, and for the PERSON when the task has one (`sesProviderEventIngestion.ts:183-237`).
   - It writes this even when the evidence write fails (D7 E-2), and reconciliation fills any missing anchor (`sesEvidenceReconciliation.ts:255-265`).
   - It is idempotent on `uq_contact_governance_identity` (`20261003000000:168`).
2. **The delivery evidence row.** This is the `delivered` row with the complaint marker. **Until migration `20270125000001` is applied and GD-4 is decided, this marker is the only source of `delivery.complained`** (option E).
3. **The `complained` outcome row (held).**
   - It needs migration `20270125000001` plus GD-4, and is then written only by the authenticated SES path, through `appendOutcome` **directly**.
   - It must not go through `ingestBusinessSignal`, so that no second, channel-scoped restriction can be added.
   - Once it is written, `delivery.complained` must be emitted **once per provider event id**, not from both rows. That is the contract owner's change, landing with S-1.

**Consequences:**

| Who | Consequence | State |
|---|---|---|
| Orchestration (Q-C1) | **The affected run terminates**: an `exited` decision with reason `complained`, then `journey.terminated`. The run is detected through `isComplaintInferredEvidence` (and, after S-1, the outcome row) | Agent B; pending integration |
| Orchestration | Writes **no** restriction of its own | Holds today (no Orchestration governance writer) |
| Governance | The recipient-level `complaint` restriction stays **independently enforced** on every channel and in every future journey, by each engine's gate and the central `mayContact` gate. **Termination is never the only protection.** If the evidence row is late (an SNS retry), the restriction already refuses contact | Holds today |
| PI | Disposition of `complained` in `OUTCOME_TRANSITION_MAP` (forced by the compiler once the type gains it). Today `journeyFeedback.ts:35` does not forward it, and `outcomeLifecycleProducer.ts:46` documents complaint as not lifecycle-bearing | Pending (PI) |

**Double recording: none found.** Each check:
- SES writes one restriction per anchor.
- Reconciliation only fills a missing anchor.
- `ingestFeedback` writes governance only for `unsubscribed`, and SES feeds it `delivered`.
- Orchestration writes none.

## 5. Provider provenance

Every normalized fact carries its provenance, read from existing columns.

| Field | WS-3 / SES | WhatsApp (Meta) | Community |
|---|---|---|---|
| `provider` | the SES edge provider name; `outreach_outcomes.provider` | `meta_whatsapp` (implicit by table) | `community_ai_actions.platform` |
| `rawStatus` | `transport_response.sesEventType` (+ `bounceType`, `complaintFeedbackType`) | `whatsapp_broadcast_recipients.status` (4 mapped values) + `error_code`; **unmapped values are dropped today** (DF-7) | `community_ai_actions.status` |
| `providerEventId` | SNS MessageId (`provider_event_id`, dedup key) | `wa_message_id` | action id, `execution_correlation_id` |
| `source { table, id }` | `outreach_delivery_evidence` / `outreach_outcomes` row | `whatsapp_broadcast_recipients` / `engagement_messages` row | `community_ai_actions` row |
| `derived` / inferred | `outreach_outcomes.derived`; `deliveryInferredFrom` on evidence | — | — |
| `occurredAt` | provider time, clamped to now for restrictions | `delivered_at`, `read_at`, `engagement_messages.created_at` | action timestamps |

- **Inferred facts are never presented as observed.** The complaint-inferred row is not a delivery.
- **Unmapped raw values** (Outreach answer Q-C4): kept, with no consequence.
- **Reject** (Q-C6): `failed` with code `rejected` and no restriction. This is the DF-5 Outreach follow-up and is still pending.

## 6. Non-email outcomes: channel truth table

A type existing in the code does not make a channel work.

| Channel | Send | Delivery receipt | Inbound response | Writes `outreach_outcomes` | Reaches the journey through | Evidence |
|---|---|---|---|---|---|---|
| Email (SES) | **Real** code, gated by `LEAD_OUTREACH_EMAIL_ENABLED`; the edge-function deploy is not evidenced | **Real** (SNS webhook) | **None**: no inbound mail. Replies are operator-recorded only | **Yes** | WS-3 evidence and outcomes | `ENGINE-READINESS-D7.md:75-77`; `storage.ts:505-526` |
| WhatsApp | **Real** (broadcast engine). No WS-3 transport | **Real**, into `whatsapp_broadcast_recipients` (mutable, forward-only). **Not read by the journey after settlement** (DF-7) | **Real**, into `engagement_messages`; STOP keyword → `unsubscribe` governance on `whatsapp` | **No** (`task_id` NOT NULL; no outreach task) | `whatsappReply` only (`journeyResponses.ts:64-128`), and PI through `feedWhatsAppReplyToLifecycle` | `whatsappWebhookProcessor.ts:43-53,95-103,143-199`; `whatsappEngineAdapter.ts:196-214` |
| SMS | **Type only**: no transport | None | None | No | `unsupported` decision | `channelCapabilityModel.ts:222-238` |
| Voice | **Type only** | None | None | No | `unsupported` decision | `channelCapabilityModel.ts:240-256` |
| Social publish | **Real**, as a broadcast with no recipient | Post status only | None per person | No | Step decisions (`execution.accepted` / `decision.recorded`) | `socialPostPublicationStatus.ts:6-18` |
| Community | **Real** via API and extension (`executed` only on `confirmed === true`); RPA refused for journeys | Execution status only | Platform replies are not linked to a person or journey | No | Step decisions | `communityEngineAdapter.ts:162,178-181,606-632`; `pages/api/extension/action-result.ts:251` |
| Browser (RPA) | Refuses every request (no channels) | — | — | No | — | `browserEngineAdapter.ts:61` |

How each non-email channel records into the shared contract, through **existing** stores:

- **WhatsApp.**
  - **Delivery.** Read `whatsapp_broadcast_recipients` through the engine request's `external_ref`:
    - `delivered_at` → `delivery.confirmed`;
    - `failed` → `delivery.failed`;
    - an unmapped Meta value → `record.unmapped`.

    Provenance is `wa_message_id`. This is P-6 (the Orchestration reader) and depends on Outreach keeping unmapped raw values (Q-C4).
  - **Response.** Stays on `engagement_messages`. No outcome row is written, because widening `outreach_outcomes` is a store-ownership change.
- **SMS, voice.** Nothing is recorded or claimed. A future engine must declare send, delivery receipt, inbound reply and call disposition separately, and use these layers.
- **Social publish.** Has no message outcome, because there is no recipient.
- **Community.** Records on the execution axis only, via decisions. Responses wait on person linking (CN-1..3).

## 7. Orchestration consequences (layer e)

| Trigger | Decision written | Journey event | Consequence | Owner and state |
|---|---|---|---|---|
| WS-3 `unsubscribed`, `rejected`, `converted`, `meeting_booked` | `exited`, reason = outcome | `journey.terminated` | The run ends; unsent tasks are withdrawn (`journeyExit.ts:91-96`) | Exists |
| WhatsApp whole-message opt-out keyword | `exited`, `unsubscribed` | `response.unsubscribed`, `journey.terminated` | The run ends; governance is already written by the webhook | Exists |
| **Complaint** (evidence marker; later the `complained` outcome) | `exited`, `complained` | `delivery.complained`, `journey.terminated` | **The run ends.** The restriction protects independently | Agent B (Q-C1) |
| **Unclassified reply** (any reply not evaluated, including every non-keyword WhatsApp inbound until SC7-R) | `needs_human`, `reply_awaiting_evaluation:<channel>` | `journey.suspended` | Paused for a person, who resumes or ends it | Agent B; A's view implemented |
| **Revocation** of an approval (RV-1) | `needs_human`, `approval_revoked:<task>` | `approval.revoked`, `journey.suspended` | Paused for review | Agent B; A's view implemented |
| Bounce (permanent) | — | `delivery.bounced` | Later email steps are `skipped` by the gate (`bounce_hard` on email) | Exists |
| Delivery, acceptance, `opened` / `clicked` / `no_response`, `record.unmapped` | — | as mapped | Continue. No consequence from `record.unmapped` | Exists |
| A failed or cancelled step | `exited`, `step_<state>` | `journey.terminated` | The run fails | Exists |

Two more rules:
- **`journey.suspended` is never an end.** A journey ends only with `journey.terminated` or `journey.completed`. No `journey.resumed` event exists, because resuming writes no row.
- **No outcome-driven branching is added.** A response only ends or pauses a run. It never chooses or adds a step.

## 8. Cross-channel mapping (0.3.0)

| Channel | Raw (a) | Normalized (b) | Journey event | Consequence (e) |
|---|---|---|---|---|
| Email | transport accepted | `sent_unverified` | `execution.accepted` | continue |
| Internal | internal ack | `confirmed` | `execution.accepted` | continue |
| Email | queue expiry | `expired` | `execution.cancelled` (`expired`) | continue |
| Email | dispatch-time suppression | `suppressed` | `execution.cancelled` (`suppressed`) | step skipped by its gate |
| Email | transport error | `failed` | `delivery.failed` | engine `needs_human` |
| Email | SES `Delivery` | `delivered` | `delivery.confirmed` | continue |
| Email | SES `Bounce` Permanent | `bounced` + `bounce_hard`/`email` | `delivery.bounced` | later email steps skipped |
| Email | SES `Bounce` Transient/Undetermined | `bounced` | `delivery.bounced` | continue |
| Email | SES `Reject` | `bounced` today; **pending: `failed`, code `rejected`** (DF-5) | `delivery.bounced` today; `delivery.failed` after DF-5 | continue; no restriction |
| Email | SES `Complaint` | `delivered`, complaint-inferred + `complaint`/`*` | `delivery.complained` (once) | **run terminates**; restriction on every channel |
| Email | SES `Complaint`, after S-1 | + outcome `complained` | `delivery.complained`, once per provider event id | same |
| Email | operator `replied` | `replied` | `response.replied` (positive) | per the journey's reply rule (Agent B) |
| Email | operator `unsubscribed` | `unsubscribed` + `unsubscribe` governance | `response.unsubscribed` | run ends |
| Email | unsubscribe **link** | governance `unsubscribe` on `*`; **no outcome row** (SC-4 pending) | none | later steps skipped by the gate; no exit event |
| Email | `rejected` (human) | `rejected` | `response.rejected` | run ends |
| Email | `converted`, `meeting_booked` | outcome | `outcome.recorded` | run ends |
| Email | `opened`, `clicked`, `no_response` | outcome | `response.other` | continue |
| Any | stored code with no mapping | as stored | `record.unmapped` | none |
| WhatsApp | Meta `sent` | recipient `sent` | `execution.accepted` (via `executed`) | step completed |
| WhatsApp | Meta `delivered`/`read`/`failed` after settlement | recipient row | none today (DF-7) → P-6 | continue |
| WhatsApp | inbound opt-out keyword | message + `unsubscribe`/`whatsapp` | `response.unsubscribed` | run ends |
| WhatsApp | any other inbound | message | `response.replied` (positive; DF-6) | **run suspended** (unclassified reply) |
| SMS, voice | — | — | — | channel unsupported |
| Social publish | post status | `scheduled_posts` | `execution.accepted` / `decision.recorded` | completed / needs a person |
| Community | `executed` / `sent_unverified` | `community_ai_actions.status` | `execution.accepted` | step completed |
| Community | `failed` / `skipped` / `blocked` / `uncertain` | same | `decision.recorded` | needs a person |
| Any | approval `revoked` | `outreach_approvals` row | `approval.revoked`, `journey.suspended` | paused for review |

## 9. Decisions applied (2026-11-05)

| Decision | Applied as |
|---|---|
| SC-7 stays unratified | Sections 2 and 3; tests label it UNRATIFIED |
| Q-C1: a complaint terminates the affected run; recipient-level suppression is independent; termination is never the sole protection | Sections 4 and 7 |
| Q-C2: `complained` is distinct from `unsubscribed`, through the existing outcome model and the canonical restriction; no new store | Section 4 |
| RV-1: a revocation pauses the run for review | Section 7 |
| An unclassified reply pauses the run (`journey.suspended`) | Section 7 |
| Writing `complained` is held behind `20270125000001` plus GD-4; until then `delivery.complained` comes from the evidence marker | Sections 3.2 and 4 |
| Outreach Q-C3: option E now | Section 4 |
| Outreach Q-C4: keep raw and unmapped values, with no consequence | Sections 5 and 6 |
| Outreach Q-C6: Reject → `failed`, code `rejected`, no restriction; pending as DF-5 | Sections 5 and 8 |
| Contract owner Q-C5: expired → `execution.cancelled`, code `expired` | Section 3.1 |

## 10. Pending, by owner

| # | Item | Owner | Test todo |
|---|---|---|---|
| PD-1 | Apply `20270125000001` (after GD-4)<ul><li>`complained` joins `BusinessOutcomeType` and both `BUSINESS_OUTCOME_TYPES` copies; `FEEDBACK_SIGNALS` stays without it.</li><li>The SES path appends the outcome via `appendOutcome` directly.</li></ul> | Outreach | S-1 (layer b) |
| PD-2 | `delivery.complained` once per provider event id once PD-1 writes the outcome row | Contract owner (Agent A), with Outreach | S-1 (outcomes) |
| PD-3 | DF-5: SES Reject → `failed`, code `rejected`, no restriction | Outreach | DF-5 |
| PD-4 | DF-7: keep unmapped Meta statuses (raw), with no consequence | Outreach | DF-7 / P-6 |
| PD-5 | P-6: read `whatsapp_broadcast_recipients` for WhatsApp delivery and late failure | Orchestration (reader) | DF-7 / P-6 |
| PD-6 | The complaint exit (Q-C1). The restriction must still refuse a new journey | Agent B | Q-C1 (2) |
| PD-7 | The unclassified-reply suspension; the RV-1 revocation suspension | Agent B | 2 todos |
| PD-8 | `OUTCOME_TRANSITION_MAP.complained` and `journeyFeedback` forwarding | PI | PI |
| PD-9 | SC-7 ratification, and any classifier-driven consequence (e.g. a WhatsApp complaint phrase never positive) | Owner (SC7-R) | After SC7-R |
| PD-10 | Unsubscribe link writes an outcome row (`recipient_link` source, `20270125000002`) | Outreach (SC-4) | — |
| PD-11 | `channelCapabilityModel` WhatsApp wording (DF-8); the restated vocabulary in `corpus.ts` (DF-9) | Outreach, PI | — |

**Outreach sign-off: pending.**

## 11. Points where Agent A's 0.3.0 text differs from this inventory

| # | Point | Detail | Suggested resolution |
|---|---|---|---|
| X-1 | The unsubscribe **link** has no outcome row | §G's agreed mapping reads "operator **or link** `unsubscribed` → `response.unsubscribed` → the run ends". But the link path (`recordOutreachUnsubscribe`) writes governance only and **no** `outreach_outcomes` row (D7 §1.3; SC-4 pending). So a link unsubscribe yields no event and no exit; the gate skips later steps | Reword §G to "operator `unsubscribed`", and list the link under PD-10 |
| X-2 | Reply consequence is out of step with the frozen base | §E.4 and §G say `response.replied` is not terminal, and that a non-keyword WhatsApp inbound suspends the run. On the frozen base, `JOURNEY_EXIT_OUTCOMES` still includes `replied` (`journeyResponses.ts:30`) and any WhatsApp inbound exits (`workflowProgressionSweeper.ts:416-437`) | Consistent only once Agent B lands. Until then the contract text describes behaviour the integrated code does not have |
| X-3 | A suspended reply still reads as positive engagement | The view still emits `response.replied` with `positiveEngagement: true` for every non-keyword WhatsApp inbound, including a complaint phrase (DF-6). Under the unclassified-reply rule, the run is suspended pending evaluation while the event asserts positive engagement, and `feedWhatsAppReplyToLifecycle` would move PI to `engaged` | Agent B decides whether the PI feed waits for the evaluation. The event type itself waits for SC7-R |
| X-4 | An unknown approval decision is not `record.unmapped` | It is read as `approval.rejected` (A's `APPROVAL_EVENTS` fallback). That departs from "nothing unmapped is coerced", but it fails safe (never a grant) | No change proposed; noted for consistency |
| X-5 | `isComplaintInferredEvidence` fails toward complaint | It matches any delivery status, and any value containing "complaint" under the marker or `sesEventType` key. That matches this contract's intent, because a false positive only narrows contact and ends a run | No change; recorded here so that PD-3 (`Reject` → `failed`) never writes "complaint" into those keys |

## 12. Test record

`backend/tests/unit/sharedMessageOutcomeMapping.test.ts`, run with `c3-unit.sh`, MW=1.

| Tree | Result | Meaning |
|---|---|---|
| A's tree (`C:/tmp/orch-c4-a-contract`) | 1 suite passed: 31 passed, 10 todo | The 0.3.0 assertions hold |
| Frozen base alone | 10 failed, 21 passed, 10 todo | Expected. The 10 failures are exactly the 0.3.0 assertions, which shows they tell 0.3.0 from 0.2.0 |
