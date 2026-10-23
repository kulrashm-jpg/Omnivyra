# ENG-002 — OUTCOME OBSERVABILITY & INBOUND ARCHITECTURE

**Mode:** characterization gate. READ-ONLY. No implementation, no migration, no provider call.
**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`, 434 migrations.
**Gate status:** see §24.

---

## 1. Executive Summary

ENG-001 classified G-05 as "the producer path does not exist". That is right in
outcome and **wrong in emphasis**, and the correction changes what should be built.

**Finding 1 — the ingestion boundary is already production-grade.**
`backend/services/leadOutreachExecution/feedbackIngestion.ts` (`FEEDBACK_VERSION =
'fb-1.0.0'`) is not a stub. It already implements: a nine-signal vocabulary; strict
two-axis routing (delivery vs business) that it refuses to merge; **two independent
database-enforced idempotency keys**; duplicate-as-success semantics; separation of
*recording evidence* from *advancing state*, with refusal reported rather than
suppressed; and a hard restriction that feedback may only drive a task to `delivered`
or `failed`, never back into `queued` or `dispatching`. **IMPLEMENTED.**

**Finding 2 — the send already writes the correlation row.**
`dispatch.ts:313-323` calls `appendDeliveryEvidence` for **every** outcome, before
branching on success, including `providerMessageId`. So once A-O returns a real SES
MessageId, `outreach_delivery_evidence` carries `(company_id, provider,
provider_message_id, task_id, attempt_id)`. The lookup target for inbound correlation
exists. **IMPLEMENTED.**

**So G-05 is narrower than ENG-001 implied: what is missing is a *caller* and a
*resolver*, not a design.** Specifically, one authenticated provider-event route and
one `provider_message_id → task_id` resolver. `ingestFeedback` keys on
`outreach_tasks.id`; providers speak `provider_message_id`; nothing bridges the two.

**Finding 3 — and this is the one that matters most — the channel silo is not
hypothetical. It already exists, in WhatsApp.**
`pages/api/whatsapp/webhook/index.ts` → signature-verified → `whatsapp-webhook` BullMQ
queue → `whatsappWebhookProcessor` (registered at `workerTopology.ts:152`) routes
`statuses → updateRecipientDelivery`, `messages → handleInboundMessage`,
`message_template_status_update → handleTemplateStatusWebhook`. It is a complete,
running inbound-and-delivery observability stack — and it writes
`whatsapp_broadcast_recipients.status` / `whatsapp_broadcasts` counters
(`whatsappBroadcastService.ts:378-400`), **never `outreach_delivery_evidence` and never
`ingestFeedback`**. WhatsApp also tracks `read`, which email cannot observe.

ENG-001 recorded WhatsApp as a GAP. That was wrong, and the truth is worse than a gap:
**a second delivery-evidence authority is already in production.** Email's producer
should not be designed in isolation from it, or Omnivyra ends with two observability
stacks permanently.

**Correction to my own earlier reports.** ENG-001 §11, §12, §26 and PI-041-W2-P §12
state that `(company_id, provider, provider_message_id)` is **UNIQUE** and that tenant
isolation on reply correlation is therefore "a property of the key". **That is false.**
`idx_outreach_delivery_provider_message` is a plain, non-unique index, described in its
own migration as "the hot lookup during a deliverability investigation"
(`20260914000000_ws3_external_dispatch.sql:19-22`). The real unique keys are on
`provider_event_id`, not `provider_message_id`. Consequences in §4 and §15 — this is
not cosmetic: a correlation resolver must handle a **multi-row** result and must carry
`company_id` in its own predicate, because the database does not guarantee either.

---

## 2. G-05 Current State

| Layer | Status | Evidence |
|---|---|---|
| Outbound execution | IMPLEMENTED | Workflow → Instance → Plan → Step → Task → 040 → Common Outreach → Email Engine → SES |
| Delivery evidence **writer at send** | **IMPLEMENTED** | `dispatch.ts:313-323`, every outcome, pre-branch |
| Delivery evidence **schema for provider events** | IMPLEMENTED | `source ∈ {provider_webhook, provider_poll, manual, import, derived, internal}`, `provider_event_id` |
| Feedback ingestion boundary | **IMPLEMENTED** | `feedbackIngestion.ts`, dual idempotency, two axes |
| Feedback consumer | IMPLEMENTED | `feedbackSummary.ts` |
| Business outcome store | IMPLEMENTED | `outreach_outcomes`, 8-value CHECK |
| Lifecycle ledger | IMPLEMENTED | `prospect_lifecycle_transitions`, `pi.lifecycle.1` |
| Engagement conversation model | PARTIALLY IMPLEMENTED | social-only in code; `platform` has no CHECK |
| **Email provider-event producer** | **GAP** | `pages/api/webhooks/` holds only `payments/` and `razorpay-staging.ts` |
| **`provider_message_id → task_id` resolver** | **GAP** | nothing maps the provider's key to the ingestion key |
| **Inbound email path** | **GAP** | no inbound route, no MX, no SES receipt handling |
| **Email → Engagement writer** | **GAP** | zero `'email'` in engagement code |
| **Outcome → Lifecycle producer** | **GAP** | no importer of `prospectLifecycle/*` outside the module |
| WhatsApp provider-event producer | **IMPLEMENTED — on a separate stack** | `whatsappWebhookProcessor`, `workerTopology.ts:152` |

Why `ingestFeedback` has no effective producer, precisely: it requires
`{companyId, taskId, signal, occurredAt, source}`. A provider webhook supplies a
message id and an event id, not an `outreach_tasks.id`. The resolver that would convert
one into the other has never been written, and the module's own one-way rule means it
will not reach out for it — `feedbackIngestion` is "the terminus of the pipeline, not a
return path", and nothing in it may import upstream modules. **The producer must be a
separate component that resolves first and then calls in.** That is architecture
working as designed, not an oversight.

---

## 3. Existing Outcome / Evidence Models

**Ownership — confirmed, nothing reassigned:**

| Concern | Owner | Evidence |
|---|---|---|
| execution | Workflow + Execution chain | 037/036/033, frozen |
| delivery evidence | **Common Outreach** (`outreach_delivery_evidence`) | `dispatch.ts`, `storage.appendDeliveryEvidence` |
| inbound evidence | **channel engine ingestion** (none for email) | GAP |
| conversation | **Engagement** (`engagement_threads` / `_messages`) | the only conversation model |
| business outcome | **Common Outreach** (`outreach_outcomes` via `ingestFeedback`) | `feedbackIngestion` |
| lifecycle transition | **`prospect_lifecycle_transitions`** | PI-ADR-004 ledger |
| suppression | **Common Outreach** (`outreach_suppressions`, `mayContact`) | frozen gate order |
| intelligence | **does not exist** | ENG-001 G-07 |

**`outreach_attempts`** — `id`, `company_id` (**text**), `task_id`, `attempt_number`,
`channel`, `transport`, `governance_version`, `outcome`, `error`, `started_at`,
`completed_at`, `execution_runtime_version`, `limiter_layer`, `idempotency_key`.
**No `provider_message_id`.** The attempt is where the *outbound* provider idempotency
key lives, "unique per tenant so a repeated dispatch cannot produce a second provider
request" — a different concern from correlation.

**`outreach_delivery_evidence`** — `company_id` (text), `task_id`, `attempt_id`,
`delivery_status`, `transport_response` jsonb, `observed_at`, `provider`,
`provider_message_id`, `source`, `provider_event_id`.
`delivery_status` CHECK: `queued, dispatched, confirmed, sent_unverified, delivered,
bounced, failed, suppressed, expired` — **nine values, and no `complained`.**
Indexes: `uq_outreach_delivery_logical (company_id, task_id, delivery_status,
observed_at)`; `uq_outreach_delivery_provider_event (company_id, provider,
provider_event_id) WHERE provider_event_id IS NOT NULL`;
`idx_outreach_delivery_provider_message (company_id, provider, provider_message_id)
WHERE provider_message_id IS NOT NULL` — **NOT UNIQUE**.

**`outreach_outcomes`** — `company_id` (text), `task_id`, `outcome_type`, `derived`
boolean, `evidence` jsonb, `occurred_at`, `source`, `provider`, `provider_event_id`,
`metadata`. CHECK: `opened, clicked, replied, meeting_booked, rejected, no_response,
unsubscribed, converted` — **eight values; no `complaint`, no positive/negative reply
split.** `uq_outreach_outcomes_provider_event (company_id, provider,
provider_event_id) WHERE NOT NULL`.

**`email_outreach_content_evidence`** — pre-send, immutable, attempt-keyed; unchanged
by this gate.

**`engagement_messages`** — `thread_id`, `platform`, `platform_message_id text NOT
NULL`, `direction`, `status`, `parent_message_id`, `platform_parent_id`, `raw_payload`,
`sentiment_score`. **No `organization_id`** (§9, §17).

**`outreach_suppressions`** — `company_id` (text), `scope ∈ {recipient, channel, task,
lead}`, `value`, `reason` (**unconstrained text — no CHECK on this table**),
`created_by`, `revoked_at`, `revoked_by`. So channel-scoped and recipient-scoped
suppression are both supported, and revocation is modelled and attributed.

**`whatsapp_broadcast_recipients` / `whatsapp_broadcasts`** — **a second delivery
evidence authority** (§14).

---

## 4. Outbound Observability

**The transport axis and the business axis are already architecturally separate and
must stay so.** `feedbackIngestion`'s own words: "A message can be `delivered` and
never answered, which is the single most common and most operationally meaningful
combination in outreach; collapsing the axes would make it unrepresentable."

`sent` ≠ `delivered` ≠ `replied` ≠ `converted`. Concretely, the frozen lifecycle has
**no `sent_unverified` task state** — it is a *delivery status* only, and A-K settles a
Workflow step on dispatch (`sent`), never on delivery or reply.

### Required table — Outcome Matrix

| Outcome | Producer | Current storage | Observable? | Tenant scoped? | Idempotent? | Engagement impact | Lifecycle impact | Intelligence impact |
|---|---|---|---|---|---|---|---|---|
| `prepared` | Email Engine | `email_outreach_content_evidence` (pre-send) | **yes** | yes (`organization_id` uuid + DB guard) | one row per attempt | none today | none | content provenance |
| `dispatched` | `dispatch.ts` | delivery evidence | **yes** | yes | logical key | none today | none | volume |
| `sent` / `confirmed` / `sent_unverified` | `dispatch.ts` | attempt `outcome` + delivery evidence | **yes** | yes | logical key | none today | none (settles the *step*, not lifecycle) | volume, send success |
| `failed` | `dispatch.ts` | delivery evidence + attempt | **yes** | yes | logical key | none | none | failure rate |
| `delivered` | **MISSING (provider webhook)** | delivery evidence `delivered` | **NO** | would be | **yes** — both keys | should create/confirm nothing by itself | none directly | deliverability baseline |
| `bounced` | **MISSING (provider webhook)** | delivery evidence `bounced` | **NO** | would be | **yes** | none | none directly | **deliverability, hard-bounce → suppression** |
| `complaint` | **MISSING, and unrepresentable** | **no delivery status, no outcome type**; exists only as a *suppression reason* | **NO** | — | — | none | none | **reputation — the most damaging unobserved signal** |
| `rejected` | human operator with approver | `outreach_outcomes` | yes, via human path | yes | logical key | none | → `not_interested` (human) | response quality |
| `provider_error` | `emailTransport` | attempt `outcome`, delivery evidence | **yes** | yes | logical key | none | none | provider health |
| `ambiguous` (e.g. `timeout`) | `dispatchReconciliation` | classification only, **never auto-resolved** | yes | yes | n/a | none | none | must stay excluded from rates |
| `replied` | **MISSING (inbound)** | `outreach_outcomes` | **NO** | would be | **yes** | **creates the inbound message** | → `engaged` | the central engagement signal |
| `positive_reply` / `negative_reply` | **MISSING, and unrepresentable** | **not in the 8-value CHECK** | **NO** | — | — | classification on the message | → `qualified` / `not_interested` | response quality, content learning |
| `unsubscribed` | **MISSING (inbound/link)** | `outreach_outcomes` | **NO** | would be | **yes** | message | terminal-ish | **must become suppression (§11)** |
| `meeting_booked` | **MISSING** | `outreach_outcomes` | **NO — declared UNOBSERVABLE yet is a CONVERSION_TYPE** | — | yes if ingested | none | → `meeting_scheduled` | conversion — see §9 |
| `converted` | **MISSING** | `outreach_outcomes` | **NO** | would be | yes | none | post-sale (absent) | conversion |
| `no_response` | elapsed-window rule | `outreach_outcomes`, `derived = true` | **DERIVED, not observed** | yes | logical key | none | nurture/decay | frequency saturation |
| `opened` / `clicked` | — | `outreach_outcomes` | **declared UNOBSERVABLE** | — | — | none | none | must be reported unobservable, never zero |

**Two structural gaps this table exposes, neither noted by ENG-001:**

- **G-16 — `complaint` has no outcome or delivery representation.** It exists as a
  *suppression reason* (`20260727030000_guarded_execution.sql:22`) and a contact-governance
  reason (`20261003000000_li3_contact_governance.sql:119`), but there is no
  `complained` delivery status and no `complaint` outcome type. An SES complaint event
  therefore has **nowhere to be recorded as evidence** — only somewhere to act. For a
  reputation-bearing signal that is the wrong way round: the action is derivable from
  the evidence, not a substitute for it.
- **G-17 — no positive/negative reply split.** `outreach_outcomes.outcome_type` admits
  eight values and none expresses reply sentiment, so §10's classification has no
  persistence target on the outcome axis.

---

## 5. Provider Event Architecture

### Required table — Provider Event Matrix

| Event | Provider identity | Provider message ID | Provider event ID | Tenant resolution | Current producer | Future owner |
|---|---|---|---|---|---|---|
| SES `Delivery` | `EMAIL_FROM` identity / SES account | SES `mail.messageId` | SNS `MessageId` | via `(company_id, provider, provider_message_id)` lookup | **NONE** | email provider-event ingestion |
| SES `Bounce` (hard/soft) | same | same | same | same | **NONE** | same; hard bounce → suppression |
| SES `Complaint` | same | same | same | same | **NONE** | same; **needs G-16 first** |
| SES `Reject` | same | same | same | same | **NONE** | same → `failed` |
| SES `DeliveryDelay` | same | same | same | same | **NONE** | **deliberately not a status** — record raw or drop |
| SES inbound receipt | inbound identity | `In-Reply-To` / `References` | SNS `MessageId` | §6 | **NONE** | inbound email ingestion |
| WhatsApp `statuses` (sent/delivered/read/failed) | Meta phone-number id | `wa_message_id` | Meta event | `ownedDbTable` ownership | **`whatsappWebhookProcessor`** | **must converge (§14)** |
| WhatsApp `messages` (inbound) | same | `wa_message_id` | Meta event | `messageRouter` | **`handleInboundMessage`** | must converge |
| WhatsApp `message_template_status_update` | same | n/a | Meta event | `templateService` | **implemented** | stays channel-specific |
| Razorpay payment webhook | n/a | n/a | provider event | existing | **IMPLEMENTED** | **the auth precedent to copy** |

**What the email producer must do, in order.** Authenticate (SNS signature
verification; the `payments/:provider` route is the in-repo precedent for
"verify + record" and the WhatsApp route for "verify, enqueue, 200 immediately").
Normalize to a `FeedbackEvent`. Resolve tenant and task **by lookup, never by guess**.
Call `ingestFeedback`. Return **2xx on duplicate** — the module is explicit that "an
ingestion endpoint that 500s on a duplicate teaches the provider to retry harder."

A new route needs a `machine-secret` entry in `scripts/route-auth-allowlist.json` or
the route-auth gate fails.

**Unknown event types must be recorded raw or dropped — never mapped to the nearest
known status.** `DeliveryDelay` is the trap: it is not a delivery failure and must not
become `failed`.

---

## 6. Inbound Email Architecture

```
inbound email → SES inbound receipt rule → SNS/S3 → authenticated route
   → parse In-Reply-To / References
   → SELECT task_id, attempt_id FROM outreach_delivery_evidence
        WHERE company_id = ? AND provider = ? AND provider_message_id = ?
   → task → 040 handoff → execution task → subject → unified_person
   → engagement_thread(platform='email') → engagement_message(direction='inbound')
   → ingestFeedback(signal='replied')
```

**Is SES inbound sufficient?** For receiving, yes — SES inbound receipt rules can
deliver to S3 and notify SNS. It requires **MX records** on the receiving domain, which
is a materially larger DNS ask than the DKIM CNAMEs outbound needs. W2-P recommended
Pattern C (tenant inbound subdomain, `Reply-To: replies@replies.company.com`) so the
prospect sees a company address while Omnivyra receives the reply. **Outbound and
inbound domains therefore may and should differ** — `replies.company.com` receives
while `sales@company.com` sends.

Tenant `Reply-To` resolution is the inverse of sender resolution: the receiving address
identifies the tenant's inbound identity, and the quoted message id identifies the
conversation. Both must agree; if they disagree, **fail closed**.

**Fail-closed rules — non-negotiable.** If correlation fails: do **not** guess the
person, do **not** guess the tenant, do **not** create a person, do **not** attach to a
thread. Record the raw inbound as an uncorrelated artefact for human triage, or drop it.
An unknown sender is not a new prospect. A spoofed `In-Reply-To` is why the receiving
address and the quoted id must both resolve to the same tenant before anything is
written — and why DMARC on the inbound subdomain matters.

Duplicate inbound events dedupe on the SNS event id via the existing
`provider_event_id` unique keys.

---

## 7. Engagement Integration

`engagement_threads` + `engagement_messages` remain **the** conversation model. No
`email_conversations`, `whatsapp_conversations`, `sms_conversations` or
`voice_conversations` — and note that WhatsApp already complies on the *conversation*
axis (its processor writes `engagement_messages`) while diverging on the *delivery*
axis. That is the asymmetry to fix, in that direction.

| Field | Source for an email event |
|---|---|
| thread lookup | `(organization_id, platform='email', platform_thread_id)` where the thread key derives from the first message id of the exchange |
| thread creation | only after tenant **and** person are both resolved; never speculative |
| person association | `unified_person_id`, resolved through the task → handoff → subject chain, **not** from the From header |
| `platform` | `'email'` — schema-permissible today, no CHECK |
| `platform_message_id` | the provider message id; `text NOT NULL` already |
| `parent_message_id` / `platform_parent_id` | the quoted message |
| `direction` | `inbound` / `outbound` |
| `status` | provider-reported where known |
| `platform_created_at` | the recipient's action time, not ingest time |
| `raw_payload` | verbatim provider payload |
| `sentiment_score` | §10 classification output, advisory |

**Outbound should also appear in Engagement**, or a thread shows replies with nothing
to reply to. An `engagement_outbound_mirror` precedent exists
(`engagementOutboundMirrorService.ts`) and should be assessed for reuse rather than
replaced — **UNVERIFIED** whether it generalizes beyond social.

**`sync_source` is CHECK-constrained to `omniverva | platform_sync`**, so an email
ingestion writer must pick one of those two or the CHECK blocks the insert. Worth
knowing before implementation; not a reason to widen it casually.

---

## 8. Feedback Ingestion

**Status: IMPLEMENTED and safe for provider events — by design.**

`FEEDBACK_SIGNALS` (9): `delivered, bounced, opened, clicked, replied, unsubscribed,
meeting_booked, converted, no_response`.
Axis split: `delivered`/`bounced` → DELIVERY; the other seven → BUSINESS.
`FEEDBACK_SOURCES` (6): `provider_webhook, provider_poll, manual, import, derived,
internal`.

**`rejected` is deliberately NOT ingestible**: "No transport reports it: it is an
operator's reading of a reply, recorded through the human decision path with an
approver attached, and accepting it here would let an anonymous webhook assert a human
judgement." That is exactly the right boundary and must be preserved — it is also the
model for how reply *sentiment* should be treated (§10).

**`complaint` is absent from the vocabulary** (G-16).

Input contract — `FeedbackEvent`: `companyId`, **`taskId` (`outreach_tasks.id`)**,
`signal`, `occurredAt` ("when the recipient's action happened — NOT when we heard
about it"), `source`, optional `provider`, `providerEventId`, `attemptId`, `evidence`,
`metadata`.
Rejections: `unknown_signal | unknown_source | invalid_timestamp | missing_identity |
task_not_found | write_failed`.
Result: `{ok, duplicate, axis, recorded, stateAdvanced, stateRefusal, rejection, error}`.

Three properties worth stating because they are easy to break later:

- **Evidence and state advancement are separate acts.** "Evidence is a fact and is
  always kept, while the state machine may legitimately refuse the transition (late
  webhook, already terminal). Refusal is reported, not suppressed, and never discards
  the evidence."
- **Feedback can only move a task to `delivered` or `failed`.** `LIFECYCLE_FOR_DELIVERY`
  exists so "feedback is an OBSERVATION; it must not be able to drive a task into
  `queued`, `dispatching` or any state that implies the runtime is about to act."
- **The one-way rule** is guard-tested: nothing here may import behaviour, intent,
  qualification, recommendation, replay or fingerprint modules, "because the failure
  mode is silent: a single import would make yesterday's scores depend on today's
  webhooks."

Replay and duplicates are supported natively. **The only thing it cannot do is find its
own `taskId` — and it must not, by its own architecture.**

---

## 9. Business Outcome Model

| Outcome | Classification |
|---|---|
| `delivered`, `bounced` | **provider-observed** (delivery axis) |
| `replied` | **provider-observed** via inbound |
| `unsubscribed` | **provider- or application-observed** (link/List-Unsubscribe) |
| `opened`, `clicked` | **declared UNOBSERVABLE** — would require tracking instrumentation that does not exist |
| `rejected` | **user-entered**, approver attached, not ingestible |
| `no_response` | **DERIVED** by elapsed window, `derived = true` |
| `meeting_booked` | **declared UNOBSERVABLE, yet a `CONVERSION_TYPE`** |
| `converted` | **application-observed in principle; no producer** |
| `positive_reply` / `negative_reply` | **not representable** (G-17) |
| `complaint` | **not representable on either axis** (G-16) |

**The `meeting_booked` contradiction — characterized, not guessed.** It sits in
`UNOBSERVABLE_BUSINESS_OUTCOMES` *and* in `CONVERSION_TYPES`
(`feedbackSummary.ts:201`), *and* it is an ingestible `FEEDBACK_SIGNAL`. These are not
actually inconsistent once separated: it is **unobservable by any transport** (no email
provider reports a booked meeting) while being **ingestible from a non-transport
source** (`manual`, `import`, or a calendar/CRM integration via `internal`). So the
contradiction is really a **missing evidence source**, not a modelling error.

**The authoritative future evidence source required:** a calendar or CRM integration,
or an explicit human record with an actor — whichever is chosen, it must arrive with
`source ∈ {manual, import, internal}` and never be inferred from reply text. Until
then, conversion analytics must report `meeting_booked` as **unobservable, not zero**,
and the same applies to `opened` and `clicked`. **This is an OWNER DECISION, and I have
not resolved it.**

---

## 10. Reply Classification

| Class | Recommended determination |
|---|---|
| reply (that one occurred) | **deterministic** — an inbound message exists |
| unsubscribe | **deterministic where explicit** (List-Unsubscribe, link, unambiguous phrase); AI-assisted otherwise and then human-confirmed |
| out-of-office | **deterministic** — RFC `Auto-Submitted` / `X-Autoreply` headers |
| automated reply / bounce-as-reply | **deterministic** — headers |
| spam / abuse | deterministic-ish via provider signals |
| positive reply | **AI-recommended, human-ratified** |
| negative reply | **AI-recommended, human-ratified** |
| question / objection | **AI-recommended**, advisory only |
| unknown | the default; never coerced |

**The boundary that must not be crossed:** classification may become **lifecycle
evidence** only through ratification, and must **never** become suppression on its own.
`outreach_suppressions` is a consent record; an AI reading of tone is not consent.
Precedent to follow: `rejected` is already excluded from webhook ingestion precisely so
"an anonymous webhook" cannot "assert a human judgement". Reply sentiment deserves the
same treatment — and `engagement_messages.sentiment_score` already exists as the right
home for an advisory score, with confidence retained and human override available.

Out-of-office deserves emphasis: counted as a reply it **falsely inflates engagement**
and can wrongly move lifecycle to `engaged`. It must be classified before any outcome
is ingested.

---

## 11. Unsubscribe / Suppression

```
unsubscribe observed (link, List-Unsubscribe, explicit reply)
   → outreach_outcomes 'unsubscribed'            [evidence, exists]
   → outreach_suppressions scope='recipient'      [governance, MISSING WIRE]
   → mayContact → governance gate 2 → future sends blocked
```

Current state: the outcome is modelled; the suppression table supports it
(`scope ∈ {recipient, channel, task, lead}`, `value`, `reason`, `revoked_at`,
`revoked_by`); **nothing connects them.** The prior scoping decision is recorded and
should be respected: "wiring it into `outreach_suppressions` is deliberately out of M7
scope — an ingestion path that can add suppressions is a governance change, not a
feedback change."

Design points for the future authorized change: the suppression must be **person-keyed
and tenant-scoped**, matching quota's existing per-canonical-person grain;
**channel-specific** suppression is already expressible via `scope='channel'`, and the
owner must decide whether an email unsubscribe suppresses **email only or all
channels** — my recommendation is **all channels, because consent withdrawal is about
the person, not the medium**, with channel-scope reserved for operational pauses.
Idempotency should be a unique constraint on `(company_id, scope, value)` for live rows
— **I did not find such a constraint; UNVERIFIED.** `reason` is **unconstrained text**
on this table, so a reason vocabulary would need introducing rather than assuming.

**Race with an active execution:** suppression must be re-evaluated at dispatch, not
only at planning. It already is — suppression is gate 2 of the frozen order, evaluated
per dispatch. So an unsubscribe landing mid-Instance blocks the next step. A message
already handed to SES cannot be recalled; that is honest and should be stated to
tenants rather than engineered around.

Manual removal (`revoked_at`, `revoked_by`) exists and is audited. Suppression mutation
must be authorized — never by a webhook alone for anything beyond the
provider-attested facts of hard bounce and complaint.

---

## 12. Lifecycle Integration

Authority unchanged: `prospect_lifecycle_transitions`, `PROSPECT_LIFECYCLE_VERSION =
'pi.lifecycle.1'`, append-only, with a closed CHECKed typed-evidence citation.

| Observation | Target state | Classification |
|---|---|---|
| inbound reply, not auto/OOO | `engaged` | **deterministic** on a classified human reply |
| explicit qualification by a human | `qualified` | **human-ratified** |
| meeting booked (from an authoritative source, §9) | `meeting_scheduled` | **deterministic given the evidence**; the evidence source is what is missing |
| explicit decline | `not_interested` | **human-ratified** (mirrors `rejected`) |
| elapsed no response | nurture/decay behaviour | **derived** — `derived = true`, never "observed" |
| AI-judged positive sentiment | `qualified` | **AI-recommended → human-ratified only** |
| bounce, complaint | **nothing** | delivery facts are not relationship facts |
| unsubscribe | **nothing in lifecycle** | it is a consent fact (§11) |

**Minimum evidence for a transition:** a persisted outcome or engagement message, with
tenant, person, `occurred_at`, source, and the typed citation the ledger's CHECK
requires. No transition from a provider event alone, and none from an AI inference
alone.

**Three separations preserved:** execution state ≠ lifecycle state (the ledger already
excludes `outreach_active`, `outreach_ready`, `no_response`, `suppressed`, `candidate`);
suppression ≠ lifecycle; intelligence score ≠ lifecycle. The writer owns debounce — the
ledger deliberately permits `state = previous_state` because "debounce is the writer's
job, not a CHECK's."

---

## 13. Post-Sale Extension Boundary

Not implemented, not designed here. Characterization only: post-sale states must
**extend `pi.lifecycle.1` under a new version**, never fork it, and must attach to the
same `unified_persons` / `prospect_accounts` spine. Person-level signals are advocacy
and referral; account-level are adoption, health, expansion and renewal risk.
`platform_usage_events` exists and is the plausible adoption source — **UNVERIFIED**
whether its grain suffices. The relationship between `prospect_accounts` and a customer
state is undefined, and **account-level lifecycle does not exist at all**.

**Requires its own future gate.** It is out of scope here and depends on this gate's
observability landing first.

---

## 14. Cross-Channel Generalization

### Required table — Channel Matrix

| Channel | Outbound | Delivery | Inbound | Provider identity | Engagement | Feedback | Lifecycle |
|---|---|---|---|---|---|---|---|
| **Email** | IMPLEMENTED (Engine + SES, flag off) | evidence written at send; **no provider events** | **GAP** | platform `EMAIL_FROM`; tenant sender NOT FOUND | **GAP** (zero `'email'`) | **GAP** (no producer) | **GAP** |
| **WhatsApp** | IMPLEMENTED (`whatsappBroadcastService`) | **IMPLEMENTED on its own model** — `whatsapp_broadcast_recipients.status`, `delivered_at`, `read_at`, `error_code` | **IMPLEMENTED** — webhook → queue → `handleInboundMessage` | Meta phone-number id via `social_accounts` | **writes `engagement_messages`** | **does NOT call `ingestFeedback`** | **GAP** |
| **SMS** | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | — | — | — |
| **Social** | PARTIALLY (publishing adapters) | platform-specific | PARTIALLY ingested | `social_accounts` | **canonical consumer today** | NOT FOUND | **GAP** |
| **Voice** | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | — | — | — |

**Common across channels:** the tenant boundary; the attempt → evidence → outcome
shape; the two-axis separation; idempotency on a provider event id; conversation in
`engagement_*`; governance order; lifecycle ledger.

**Genuinely channel-specific — do not force into one schema:** WhatsApp has `read`
receipts and template-status events that email cannot produce; email has bounce and
complaint classes WhatsApp does not; WhatsApp has a 24-hour session window
(`engagement_threads.window_expires_at` is the existing precedent); Voice has call
duration and transcript; Social has public engagement counts. **Channels do not have
identical event semantics**, so the shared layer should be the *normalized* axis
vocabulary plus a verbatim raw payload — not a lowest-common-denominator event schema.

**G-18 — WhatsApp is already a second delivery-evidence authority. HIGH.** It is
running in production, it predates this architecture, and the Email producer must be
designed so WhatsApp can converge onto the same normalized boundary later. Building
Email's producer without that in mind guarantees two permanent stacks. Convergence
itself is a separate gate and **must not be attempted while closing G-05** — but the
ingestion boundary should be channel-neutral from the first line.

---

## 15. Idempotency / Replay

The correct boundary is **already chosen and DB-enforced**:

- **Provider-event key** — `(company_id, provider, provider_event_id)`, unique on both
  `outreach_delivery_evidence` and `outreach_outcomes`, partial `WHERE NOT NULL`. This
  "collapses one provider event redelivered with a re-stamped timestamp".
- **Logical key** — `(company_id, task_id, delivery_status, observed_at)` on delivery
  evidence; the matching outcome key "collapses the same observation reported through
  different channels".
- **Outbound** — `outreach_attempts.idempotency_key`, unique per tenant, so a repeated
  dispatch cannot produce a second provider request.
- **`provider_message_id` is NOT a uniqueness key** — plain index only.

| Scenario | Behaviour |
|---|---|
| same event twice | dedupes on provider-event key → `duplicate: true`, **2xx** |
| same provider message, two events (delivery then bounce) | **both recorded** — different `provider_event_id`. Correct, and why `provider_message_id` must not be unique |
| out-of-order events | evidence always kept; the state machine may refuse the transition, reported via `stateRefusal`, never discarding evidence |
| event replay | supported — same keys, same result |
| delayed delivery event after terminal state | evidence kept, state refusal reported |
| **inbound reply before the delivery webhook** | works — both key off the task, not off each other. The reply does not depend on `delivered` existing |
| provider retry | expected steady state, not an error |
| malformed event | reject with `invalid_timestamp` / `unknown_signal` / `unknown_source`; **do not partially write** |
| event for unknown tenant | **fail closed** — `missing_identity`. Never create a tenant |
| event for unknown provider message | **fail closed** — `task_not_found`. Never create a task |

**The multi-row consequence of the non-unique index (new).** A correlation lookup on
`(company_id, provider, provider_message_id)` can legitimately return **several rows** —
the send-time row plus every later provider-event row for the same message. So the
resolver must: filter by `company_id` **in its own predicate** (the DB does not enforce
tenant uniqueness here); accept multiple rows; **assert they agree on `task_id`**; and
**fail closed if they do not**, rather than taking the first. Treating the lookup as
single-valued is a latent correctness and isolation bug, and it is exactly what my own
earlier "UNIQUE" claim would have encouraged.

No mutation probes were run; none are authorized by this gate.

---

## 16. Failure / Security Model

| Condition | Required behaviour |
|---|---|
| invalid webhook authentication | **401/403, no write, no enqueue.** SNS signature verification before parsing |
| unknown provider | reject; never map to the default provider |
| unknown tenant | **fail closed.** `missing_identity`. Never create |
| unknown provider message | **fail closed.** `task_not_found`. Never create a task or attempt |
| cross-tenant provider message collision | **possible — not prevented by any unique constraint.** Always include `company_id`; on disagreement across rows, refuse and alert |
| malformed event | reject whole, write nothing partial |
| duplicate event | **success**, `duplicate: true`, 2xx |
| missing recipient | refuse; the Engine already fails closed pre-attempt |
| missing / ambiguous person | **fail closed.** Never create a person from a From header |
| ambiguous conversation | **fail closed.** Never attach to a guessed thread |
| uncorrelated inbound message | retain raw for human triage or drop; **never** synthesize identity |
| invalid lifecycle transition | ledger CHECKs refuse; evidence retained |
| unauthorized suppression mutation | refuse. Only provider-attested bounce/complaint and authorized human action may add suppressions |

**Two latent bypasses found, neither currently reachable, both worth recording:**

- **G-19 — `autoReplyService` is an auto-send path outside Common Outreach.**
  `backend/services/autoReplyService.ts` has `isEligible` (pattern exists, intent
  confidence > `0.85`, user-enabled) and calls `orchestrateResponse` via
  `responsePolicyEngine` / `responseOrchestrator`, gated by
  `engagementGovernanceService.getControls`. **I found no callers**, so it appears
  dormant. But it is a path from an inbound message to an outbound send that does not
  traverse the frozen gate order. The brief's constraint "let inbound messages directly
  send responses" is exactly this. **MED, must be assessed before inbound email exists**,
  because inbound email would hand it live material.
  To be precise and fair: `engagementGovernanceService` is a **feature-controls**
  service (`auto_reply_enabled`, `bulk_reply_enabled`, `ai_suggestions_enabled`,
  `triage_engine_enabled`, `opportunity_detection_enabled`) — it is **not** a competing
  consent or suppression authority, and I am not claiming it is.
- **G-18** (§14) — the WhatsApp stack reaches delivery state without the shared
  boundary.

---

## 17. Tenant Isolation

**G-04, characterized concretely rather than restated.**

*Current enforcement:* transitive only. `engagement_messages` has no
`organization_id`; tenant scope depends on `thread_id → engagement_threads.organization_id`.

*Actual exposure — measured.* Across `backend` and `pages`, only **two**
`engagement_messages` queries reference `organization_id` at all (necessarily via a
thread join). Five call sites fetch a message **by id**:

| Site | Predicate | Assessment |
|---|---|---|
| `autoReplyService.ts:26-27` | `.eq('id', messageId).eq('thread_id', threadId)` | thread-scoped, but the thread is not itself org-verified at that point |
| `autoReplyService.ts:109-110` | same | same |
| `bulkEngagementService.ts:95-96` | `.eq('id', messageId)` | **no thread, no tenant predicate** |
| `engagementAiAssistantService.ts:424-425` | `.eq('id', message_id)` | **no thread, no tenant predicate** |
| `engagementAiAssistantService.ts:483-484` | `.eq('id', message.parent_message_id)` | **no predicate at all — the sharpest case**; a parent is followed by id with nothing scoping it, and no composite FK prevents a parent pointing across tenants |

So the invariant is **not enforced — it is observed inconsistently.** A direct
message-id lookup can read a row the caller's tenant does not own; whether that is
*reachable* from a route depends on where the ids originate, which I did not trace to
completion — **the exposure is real, the reachability is UNVERIFIED.**

*Why inbound makes it worse:* inbound ingestion multiplies both message volume and
message **provenance** (ids arriving from outside), and adds `parent_message_id` chains
built from attacker-supplied `In-Reply-To` headers. A parent-by-id lookup with no
tenant predicate, fed by external headers, is a materially worse shape than the same
code fed only by internal social sync.

*Recommended enforcement:* add `organization_id` to `engagement_messages` (additive,
backfillable from the thread), a composite FK `(thread_id, organization_id)` →
`engagement_threads(id, organization_id)` so a message cannot join a foreign thread,
the same composite shape for `parent_message_id`, and tenant predicates at all five
sites. This mirrors the `(id, company_id)` composite-FK pattern already used on the
`unified_persons` merge path.

*Implementation gate required:* **yes, and before inbound email.** Not fixed here.

Elsewhere: delivery evidence and outcomes carry `company_id` as **text** while
identity tables use uuid — a type asymmetry that must not be papered over in a join.

---

## 18. Canonical Data Flow

| # | Boundary | Input | Output | Authority | Persistence | Idempotency | Tenant boundary | Failure |
|---|---|---|---|---|---|---|---|---|
| 1 | Provider → route | signed provider payload | accepted request | channel ingestion | none | none | none yet | **401, no write** |
| 2 | Authentication | signature, secret | verified payload | route | none | none | — | reject |
| 3 | Normalization | raw payload | `FeedbackEvent` draft (minus `taskId`) | channel ingestion | raw retained | none | — | reject whole |
| 4 | **Correlation** | `(company?, provider, provider_message_id)` | `task_id`, `attempt_id` | **the missing resolver** | read-only | n/a | **`company_id` in predicate; multi-row must agree** | **fail closed** |
| 5 | Idempotency | `provider_event_id`, logical key | new or duplicate | DB unique indexes | — | **enforced** | per tenant | duplicate = **success** |
| 6 | Feedback ingestion | `FeedbackEvent` | delivery or outcome row | **`ingestFeedback`** | `outreach_delivery_evidence` / `outreach_outcomes` | both keys | `companyId` required | typed rejection |
| 7 | Task state | delivery fact | `delivered`/`failed` only | `lifecycle.ts` | `outreach_tasks` | transition-guarded | per tenant | refusal reported, **evidence kept** |
| 8 | Person resolution | task → handoff → subject | `unified_person_id` | `personAnchor` | — | — | tenant-first | **fail closed** |
| 9 | Engagement | event + person | thread + message | **Engagement** | `engagement_threads` / `_messages` | `platform_message_id` | **G-04 weak** | fail closed |
| 10 | Classification | message content + headers | class + confidence | AI, advisory | `sentiment_score` | — | per tenant | `unknown` |
| 11 | Suppression | unsubscribe / hard bounce / complaint | suppression row | **Common Outreach** | `outreach_suppressions` | needs a live-row unique key | per tenant | **refuse — never silently grant** |
| 12 | Lifecycle | ratified outcome | transition | **ledger** | `prospect_lifecycle_transitions` | writer-debounced | per tenant | CHECK refuses |
| 13 | Intelligence | all of the above | derived state | **does not exist** | — | — | must be | — |

Boundary 4 is the whole of G-05.

---

## 19. Intelligence Readiness

After outcome observability lands (provider events + inbound email + engagement
writer), what can actually operate:

**Engagement Intelligence — READY, with one caveat.** Engagement strength, response
behaviour, timing and relationship progression all become computable from replies,
delivery and attempt history. Channel preference becomes computable **only for email**
until WhatsApp converges (G-18). Frequency saturation is computable from attempts plus
`no_response`.

**Content Intelligence — PARTIALLY READY.** Replies, bounces, unsubscribes and
delivery become available. **Still missing:** `opened` and `clicked` (declared
unobservable — and fabricating them is an explicit non-goal), positive/negative reply
split (**G-17**, no persistence target), and conversion (**§9** — `meeting_booked` has
no evidence source). So content *learning* can correlate to reply-or-not but **not to
conversion**, which is the signal that actually matters commercially.

**Deliverability Intelligence — PARTIALLY READY.** Delivery, bounce, suppression and
volume become available. **Still missing:** `complaint` has no representation
(**G-16**) — and complaint rate is the single most important reputation input, so
without G-16 this layer is structurally incomplete, not merely sparse. Also missing:
sender/domain health (no sending-domain model), provider limits, warm-up state.

**Next-Best-Action — NOT READY.** It needs lifecycle (blocked on the outcome →
lifecycle producer), channel availability (needs more than one converged channel),
engagement state (needs Engagement Intelligence first), plus consent and quota which
already exist.

**Lifecycle Intelligence — READY for pre-sale** once the producer exists; **NOT READY
post-sale** (no states, no account lifecycle).

**Signals that remain starved after this gate, stated exactly:** `complaint`
(unrepresentable), reply sentiment split (unrepresentable), `opened`/`clicked`
(unobservable by design), `meeting_booked`/`converted` (no authoritative source),
sender and domain health (no model), warm-up state (no model), and all post-sale
signals.

---

## 20. Gaps

| ID | Gap | Status | Sev | Owner | Schema? | Blocks | Defer? |
|---|---|---|---|---|---|---|---|
| **G-05a** | **Email provider-event producer** (authenticated route + normalization) | GAP | **CRITICAL** | email channel ingestion | no | all intelligence | **no** |
| **G-05b** | **`provider_message_id → task_id` resolver** | GAP | **CRITICAL** | Common Outreach adjacent | no | G-05a and inbound | **no** |
| G-09 | Inbound email path (SES receipt, MX, parsing) | GAP | HIGH | email channel | no | replies, conversation | no |
| **G-04** | `engagement_messages` tenant column + composite FKs; 5 unguarded lookups | GAP | **HIGH (security)** | Engagement | **yes** | safe inbound | **no — before inbound** |
| **G-16** | **`complaint` unrepresentable** on delivery and outcome axes | **GAP (new)** | **HIGH** | Common Outreach | **yes** (CHECK extension) | Deliverability Intelligence | no |
| **G-17** | **No positive/negative reply split** in `outreach_outcomes` | **GAP (new)** | MED | Common Outreach | **yes** (CHECK extension) | Content Intelligence | yes |
| **G-18** | **WhatsApp is a second delivery-evidence authority, in production** | **GAP (new)** | **HIGH** | channel engines | eventual | cross-channel intelligence | convergence yes, awareness no |
| **G-19** | **`autoReplyService` can send outside Common Outreach** (dormant, no callers) | **GAP (new)** | MED | Engagement + Common Outreach | no | safe inbound | **assess before inbound** |
| G-06 | Unsubscribe not wired to suppression | GAP | HIGH | Common Outreach (governance change) | likely a unique key | compliance | no |
| G-02 | Outcome → lifecycle producer | GAP | HIGH | Lifecycle | no | lifecycle intelligence | no |
| **G-20** | **No `meeting_booked`/`converted` evidence source** | **GAP (new)** | MED | product | no | conversion analytics | yes |
| **G-21** | **No live-row uniqueness on `outreach_suppressions (company_id, scope, value)`** | **UNVERIFIED** | MED | Common Outreach | maybe | idempotent suppression | yes |
| G-13 | No cross-channel relationship view | GAP | MED | Engagement Intelligence | no | — | yes |

No gap was fixed. No fix was attempted.

---

## 21. Decisions Required

1. **Is `outreach_delivery_evidence` the canonical delivery-evidence model?** Recommend
   **YES** — and accept that this makes **G-18 convergence** a commitment, not an
   aspiration.
2. **Is `provider_message_id` the canonical correlation key?** **YES as the correlation
   key, NO as a uniqueness key.** The index is non-unique; resolvers must carry
   `company_id` and handle multi-row results. **Do not add it to `outreach_attempts`.**
3. **Is Engagement the canonical conversation model?** **YES.** No channel-specific
   conversation tables.
4. **Is `feedbackIngestion` the canonical business-outcome ingestion boundary?**
   **YES** — it is already complete; preserve the one-way rule and the `rejected`
   exclusion.
5. **One normalized provider-event ingestion boundary?** **YES**, channel-neutral from
   the first line, so WhatsApp can converge onto it.
6. **How is inbound email correlated?** `In-Reply-To`/`References` → delivery evidence
   → task → person, with the receiving address independently resolving the tenant and
   both required to agree.
7. **What happens when correlation fails?** **Fail closed.** Retain raw for human
   triage. Never guess tenant, person or conversation; never create identity.
8. **How does unsubscribe feed suppression?** Person-keyed, tenant-scoped, as an
   explicitly authorized **governance change**. Decide **email-only vs all channels** —
   recommend all channels.
9. **Which outcomes are deterministic?** delivered, bounced, failed, reply-exists,
   out-of-office, automated, explicit unsubscribe.
10. **Which are AI-inferred?** reply sentiment, question/objection — **advisory only**.
11. **Which lifecycle transitions need human ratification?** `qualified`,
    `not_interested`, and every AI-recommended transition.
12. **Minimum evidence for a transition?** a persisted outcome or engagement message
    with tenant, person, `occurred_at`, source and the ledger's typed citation. Never a
    provider event alone; never an AI inference alone.
13. **Duplicate provider events?** success, `duplicate: true`, **2xx**.
14. **Out-of-order events?** evidence always kept; state refusal reported, never
    suppressed, never discarding evidence.
15. **Before Engagement Intelligence:** G-05a, G-05b, G-09, G-04.
16. **Before Deliverability Intelligence:** G-05a **and G-16** (complaint).
17. **Before Content Intelligence:** G-05a, G-09, **G-17**, and a §9 conversion source.
18. **Before Next-Best-Action:** all of the above plus G-02 and a second converged
    channel.
19. **Next implementation gate:** see §22 gate 1 — and it should include **G-16**,
    because a CHECK extension is cheap now and a migration against live evidence later
    is not.
20. **Explicitly deferred:** §23.

---

## 22. Recommended Implementation Sequence

| # | Gate | Scope | Closes | Why here |
|---|---|---|---|---|
| **1** | **Email provider-event observability** | authenticated SNS route (copy the WhatsApp verify-enqueue-200 and payments verify-record precedents); normalization; the correlation resolver; `complaint` added to the delivery/outcome vocabularies; route-auth allowlist entry | **G-05a, G-05b, G-16** | smallest unit that makes anything measurable; ingestion boundary already exists; include G-16 while the CHECK is cheap to extend |
| **2** | **Engagement message tenant hardening** | `organization_id` + composite FKs + predicates at the five sites; assess **G-19** | **G-04**, G-19 | **must precede inbound**, which multiplies external-provenance ids |
| **3** | **Inbound email** | SES receipt, MX on an inbound subdomain, parsing, correlation, `platform='email'` threads and messages, `replied` ingestion, out-of-office and automated classification | **G-09**, part of G-17 | first real conversation; needs 1 and 2 |
| **4** | **Unsubscribe → suppression** | explicitly authorized governance change; person-keyed; live-row uniqueness; audit | **G-06**, G-21 | compliance exposure grows the moment 3 lands |
| **5** | **Outcome → lifecycle producer** | deterministic transitions only; AI recommendations queued for ratification | **G-02** | cheapest high-value intelligence |
| 6 | Reply sentiment representation | extend outcome vocabulary; advisory confidence | **G-17** | needs 3 |
| 7 | WhatsApp convergence onto the shared boundary | route WhatsApp statuses through normalized ingestion | **G-18** | separate gate; do **not** attempt during 1 |
| 8+ | Engagement / Deliverability / Content Intelligence, then NBA, then post-sale | — | G-07, G-10, G-11, G-14, G-03, G-12 | downstream consumers |

**Smallest safe next gate: #1.** It is additive, needs no new table, reuses an
ingestion boundary that is already production-grade, and is the only gate whose absence
makes everything after it unmeasurable. Its one schema touch — adding `complaint` — is
a CHECK extension, and doing it now avoids migrating live evidence later.

---

## 23. Explicit Non-Goals

Not built, not designed, not attempted here: Deliverability Intelligence, Content
Intelligence, Next-Best-Action, Engagement Intelligence, post-sale/customer
intelligence, WhatsApp/SMS/Voice channel work (including G-18 convergence), a second
conversation model, channel-specific lifecycle or identity models,
`provider_message_id` on `outreach_attempts`, any Common Outreach governance change
(including the unsubscribe wire — separately authorized), any Workflow or Execution
semantic change, scoring weight changes, an event bus, open/click tracking,
`meeting_booked` inference from reply text, tenant sending domains, SES or DNS
configuration, webhook deployment, feature-flag changes, and any fix to G-04, G-05,
G-06, G-09 or the newly found G-16 through G-21.

---

## 24. Gate Status

**READY FOR OWNER DECISION.**

**Success criterion answered.** An outbound outcome becomes canonical evidence
because `dispatch.ts` already writes `outreach_delivery_evidence` for every outcome,
carrying `provider`, `provider_message_id`, `task_id` and `attempt_id`. A provider
event or inbound reply becomes canonical evidence by: authenticating at the route;
normalizing to a `FeedbackEvent`; resolving `(company_id, provider,
provider_message_id)` to a `task_id` through the existing index — carrying the tenant in
the predicate, accepting multiple rows, and failing closed if they disagree; and calling
`ingestFeedback`, which already enforces two database-level idempotency keys, keeps the
delivery and business axes separate, treats duplicates as success, and never lets an
observation drive a task into an active state. From there the task resolves to a
canonical person through the 040 handoff, the event becomes an `engagement_message` on
an `engagement_thread` with `platform='email'`, and ratified outcomes become lifecycle
evidence in the append-only ledger. Suppression stays a governance fact; sentiment
stays an intelligence fact; and nothing may guess a tenant, a person or a conversation.

**The minimum to make intelligence learn from real signals** is §22 gates 1–3 plus
G-16: the provider-event producer, the correlation resolver, `complaint`
representation, engagement tenant hardening, and inbound email. After that, Engagement
Intelligence and Lifecycle Intelligence can operate; Deliverability needs G-16;
Content additionally needs G-17 and a conversion evidence source; Next-Best-Action
needs a second converged channel.

**The finding that should change the plan:** WhatsApp already runs a complete parallel
observability stack that never touches `outreach_delivery_evidence` or
`ingestFeedback`. The silo this architecture exists to prevent is already half-built.
Email's producer must therefore be written as a **channel-neutral ingestion boundary**
from its first line, even though only Email will use it at first.

**Production status: PRODUCTION UNTOUCHED.** No provider call, no email, no DNS, no
SES, no webhook deployment, no migration, no flag change, no production read.

**Repository status: READ-ONLY CHARACTERIZATION — NO SOURCE, SCHEMA, MIGRATION OR TEST
FILE CHANGED.** This report is the only file added. Verified by hash:
`feedbackIngestion.ts 432397a242bd1eb1`, `dispatch.ts 4cee6514d36c371e`,
`governance.ts 5982e2eb5a1f4199`, `storage.ts b1bd8e67651a7231`,
`workflowStore.ts 27c53b4f55984059`; HEAD `7febdb28`, tracked-modified 60,
migrations 434.

**No implementation is authorized by this gate.**
