# Omnivyra shared integration contract, v0.1.0

**Status: proposed.** Implemented on the local branch `feat/orchestration-recovery`. Not merged, not deployed, and `WORKFLOW_ORCHESTRATION_ENABLED` stays off. The PI lead has not reviewed sections A and B. The Outreach lead has agreed the ownership split in section D.

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

Orchestration's own lifecycle calls (`feedWhatsAppReplyToLifecycle`, `ensureProspectLifecycleOpen`) use `derived` with a null actor, compatible with rule 5 by code reading. Human-origin outcomes reach PI's writer through `outcomeInterpreter`. Not yet run against that branch.

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
| No personal data | Codes only; `evidence`, `transport_response` and message content are never read |

**Cursor limit.** A row that arrives late with an earlier `occurredAt`, as a provider event can, sorts before an existing cursor. A consumer needing completeness re-reads from the start and dedupes on `eventId`.

**Types:** `prospect.lifecycle_changed`; `journey.enrolled`, `.terminated`, `.completed`; `decision.recorded`; `approval.requested`, `.granted`, `.rejected`; `execution.requested`, `.started`, `.accepted`, `.failed`, `.cancelled`; `delivery.confirmed`, `.failed`, `.bounced`, `.complained`; `response.replied`, `.unsubscribed`, `.rejected`, `.other`; `outcome.recorded`.

`JOURNEY_EVENT_VERSION` is bumped when a field's meaning changes, not when an optional field is added. Only `response.replied` is positive engagement. A STOP, an unsubscribe, a bounce and a complaint never are.

**Mandate events with no separate type.** `prospect discovered`, `qualified` and `updated` appear as `prospect.lifecycle_changed` from enrollment on; before enrollment they belong to PI. `approval.requested` is declared but not emitted yet: approvals expose only decisions. `execution.failed` and `.cancelled` are declared, while failures surface today as `decision.recorded` with a code.

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

## Compatibility register

| Contract | Version | Consumers | Status |
|---|---|---|---|
| Execution contract | 0.1.0 | Five adapters | Implemented; merge with Outreach branch pending |
| Event view | event version 1 | `events` route | Implemented |
| Capability declarations | 0.1.0 | `checkCapabilityDeclaration`, Outreach fixtures | Implemented |
| PI lifecycle writer | Unversioned | Sweeper feed, opener | In use; actor validation pending |

**Rules.** A breaking change bumps the major version, and `checkCapabilityDeclaration` then refuses a mismatched declaration. Adding an optional field bumps the minor. Changes are recorded here with the commit.
