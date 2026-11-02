# Outreach Management Platform: architecture and implementation proposal

Status 2026-11-03. **A proposal for the owner's review. Nothing in it is built.** The evidence is in `AUDIT.md` alongside this file. Broad implementation waits until the owner has reviewed the scope and settled who owns each shared contract, as the brief requires.

The principle is to compose what exists. The platform is mostly a set of user interfaces and services over models that are already tested on real PostgreSQL but unused. The proposal adds **no new registry, no new ledger, no new workflow engine, no new prospect store, no new conversation store and no new status enum**. It proposes **no new tables in the first two waves**.

## 1. Reuse map

| Need | Build on | Do not use |
|---|---|---|
| LLM calls, model routing, cost control | `runCompletionWithOperation` (gateway), always through `runBilledAiCompletion` | `/api/ai/gpt-chat`, `/api/ai/claude-chat` |
| Generation | `content/runtime/generationRuntime.ts` as a pure generator (`persist:false`), over `generateMasterContentFromIntent` and `buildPlatformVariantsFromMaster` | `unifiedContentGenerationEngine`, `contentWriterCapability` |
| Conversational edit | `campaignContentAssistService` command-and-proposal pattern, generalised | `/api/content/improve-draft`, the dead chat components |
| Brand and company context | `resolveBrandVoice`, `companyContextBlock`, regulated-industry context, grounding guard | — |
| Social channel rules | `platformAdaptationProfiles.ts` | The four other rule sets, for new work |
| Drafts, versions, approval, audit | Canonical `content`, `content_variant`, `content_revision`, `content_approval_history` (owner switches persistence on for outreach types) | `content_assets`, a new outreach-message table |
| Personalization | 041-D allow-list, generalised into a PI-owned approved-attribute read with provenance | Copying person data into outreach |
| Person context | `getProspectDetail` sections plus `individualIntelligence` facts | `leadIntelligenceReadApi` (dormant) |
| Audience | `prospect_lists` → `campaignSelectionService` → `campaignEnrollment`, paged by `readAudiencePage` | LC-301 `audiences`, `gtm_campaigns` |
| Campaign | `prospect_campaigns` | `campaigns` (social), `gtm_campaigns`, `outreach_plans` |
| Sequence | workflows, `execution_*`, sweeper, adapters, `journeyApprovalPreview` | The content plan hierarchy |
| Inbox and replies | `engagement_threads`/`messages`, `/engagement` UI, `engagementAiAssistantService` with the F5 gate | `/engagement-inbox`, `responseOrchestrator`, the `engagement_response` path |
| Reporting | `journeyReport.ts`, `journeyEvents.ts` | New analytics tables |
| Readiness | Contract declarations + `channelRefusal` + PI `providerCapabilityModel` + `connectionState` + W4 status | `channelCapabilityModel` as written, `PROVIDER_CATALOG`, `commandCenterReadinessService` |
| Email | WS-3 transport and ledger, W4 sending domains, SES webhook stack, unsubscribe | Global `EMAIL_FROM` as a tenant sender, SES v1 for outreach |
| Billing | `reserveCreditsForWork` / confirm-to-actual / release; `deductCreditsAwaited` with a multiplier; `logUsageEvent` with a real cost | Any new usage table; usage rows with no cost |
| Governance | `contact_governance_records`, `mayContact`, `channelPermissionFact`, `channelRefusal` | `outreach_suppressions`, `suppression_entries`, `consent_records` as recipient consent |

## 2. Target architecture and ownership

```
              Prospect Intelligence (owns people, accounts, lists, facts, lifecycle)
                   │ audience pages, approved attributes, person context (read-only)
                   ▼
 ┌──────────────── Outreach Management (owns what to say, channel config, execution) ─────────────┐
 │  Content Intelligence     Campaign & Reply Authoring UI     Channel & Provider Setup            │
 │  (brief → draft → edit →  (campaign builder, inbox,         (domains, senders, accounts,        │
 │   validate → approve)      approvals, previews)              readiness, deliverability)         │
 │            │ approved content revision                              │ readiness read             │
 └────────────┼────────────────────────────────────────────────────────┼───────────────────────────┘
              ▼                                                        ▼
        AI Orchestration (owns when and whether: journeys, decisions, approvals, consent gate,
                          kill switches, retries, credits/quotas coordination)
              │ authorized EngineStepContext (contract 0.2.0)
              ▼
        Engines: WS-3/email · WhatsApp · social publish · community · browser  [SMS, voice: contract only]
              │ normalized results, usage, events
              ▼
        Ledgers that exist: outreach ledger, execution_engine_requests, engagement threads, credit ledger
```

| Component | Owner | New or extended |
|---|---|---|
| Content Intelligence service (`backend/services/outreachContent/`) | Outreach, with the Content owner reviewing changes to the generation runtime | New service composing existing pieces |
| Channel content profiles (email, WhatsApp, SMS, social, community, voice script): formatter + validator, pure functions | Outreach | New modules |
| Outreach content types in the canonical content model | Content owner (schema), Outreach (use) | Extend the content type check |
| Approved-attribute read with provenance | PI | Extends 041-D and `source_assertions` |
| Person conversation read model (read-only view) + runtime thread-to-person writer | PI (identity writer), Engagement (view) | New view, no new store |
| Inbound email into `engagement_threads` | Outreach (ingest) + Engagement (store) | New ingest path |
| Campaign builder UI over `prospect_campaigns`, lists, workflows | Outreach (UI); PI and Orchestration own the APIs | New UI |
| Approval queue UI over existing stores | Outreach (UI); Orchestration (approval semantics) | New UI |
| Channel readiness read | Orchestration (contract type), PI (provider model entries), Outreach (values) | Additive |
| Email setup and deliverability | Outreach | Wires W4, adds metrics and auto-pause |
| Channel charging | Billing (catalogue), Outreach (callers), Orchestration (`ExecutionUsage`) | Catalogue rows and callers |

Boundaries the design keeps: Outreach never decides the next channel or timing; it publishes readiness and executes an authorized request. Orchestration never formats content or calls a provider. PI never stores campaigns or drafts. **Generating a draft never sends: the content service has no import path to any engine**, and a test pins that.

## 3. Shared contract changes (only those actually needed)

Each needs its owner's agreement before it is written.

| ID | Change | Why | Reuse | Owner | Touches | Proof of completion |
|---|---|---|---|---|---|---|
| SC-1 | Channel readiness read type, derived. Maps to Available / Configuration required / Unhealthy / Unsupported / Deferred / Requires approval **without a new enum**. Composes the declaration, `channelRefusal`, provider configuration, `connectionState` and W4 status | Orchestration must know whether a channel can execute; Outreach must say so honestly | `executionContract.ts` error classes, PI `providerCapabilityModel` statuses | Orchestration (`virality-c7`) for the type; PI for provider entries | `executionContract.ts`, `providerCapabilityModel.ts` | Contract test: each of the six states produced from fixtures; `mocked` providers never read as Available |
| SC-2 | Provider declarations reference PI's provider model (`engagement` entries for SES and Meta Cloud API) | Outreach providers are free strings today | `providerCapabilityModel.ts` | PI | Same files | Declaration check fails on an unknown provider id |
| SC-3 | A journey step can reference an approved content revision instead of a free `instruction` (J-5) | Campaign content must be authored, versioned and approved, then executed unchanged | `workflowStore` step definition, canonical `content_revision` | Orchestration (step schema), Content (revision) | `workflowStore.ts`, publish CHECK SQL | Real PG: a step executes exactly the approved revision; an edited draft does not change a running journey |
| SC-4 | Store for outcomes from engines other than WS-3 (G-4) | WhatsApp, community and social outcomes have nowhere to go | `outreach_outcomes` (relax `task_id` or link `execution_engine_requests`) | Orchestration + Outreach | Migration | Real PG: a WhatsApp reply appears in `journeyReport` |
| SC-5 | Webhook verification contract and test kit (written, not a framework) | Every new provider repeats this | SES and Meta routes | Orchestration (contract), Outreach (routes) | Docs + test kit | Both existing routes pass the kit |
| SC-6 | Channel vocabulary: `phone` or `voice`; STOP and do-not-call scope across channels | Twelve enums disagree | — | **Owner decision first**, then PI and Orchestration | Listed in `AUDIT.md` §3 | One spelling everywhere; governance tests per channel |

Not needed: new states (contract 0.2.0 has them), a new registry, idempotency or correlation changes (they exist), or a new event system (`journeyEvents.ts` is the view).

## 4. Data model and migration impact

| Change | Needed for | Migration | Wave |
|---|---|---|---|
| Add outreach content types to the canonical content type check; enable persistence for them | Drafts, versions, approval | Yes (CHECK widen) + flag | 2 |
| Complaint state for email evidence | Truthful tracking | Yes (CHECK widen) | 1 |
| Unsubscribe written as an `unsubscribed` outcome | Timeline | No (code) | 1 |
| Runtime writer of `engagement_threads.unified_person_id` | Conversation history | No (column exists) | 2 |
| Inbound email threads (`platform='email'`) | Reactive email | Check whether the platform column is constrained; widen if so | 2 |
| Non-WS-3 outcome store (SC-4) | Analytics | Yes | 2 |
| Credit actions per channel (`credit_cost_config` rows; registry entries) | Charging | Yes (rows), after C-1 | 3 |
| Add-on checkout kind, if sold as money | Domains, mailboxes, managed services | Yes (CHECK widen) | 3 |
| `plan_limits` channel resources | Entitlements | Rows only | 3 |
| `increment_wa_usage` or removal of its call | WhatsApp usage | Yes, or code | 1 |
| L-3, L-4 | Safety | No | 1 |
| `execution_engine_requests` engine CHECK for SMS and voice | Only when SMS or voice is authorized | Yes | Deferred |

Each migration goes through one migration coordinator per wave (see §11), with a 14-digit version, a rollback, and a real-schema replay. None is applied anywhere real without authorization.

## 5. User experience and interaction flows

The experience is one **Outreach** area with five surfaces. Channel differences are controls inside these surfaces, not separate apps. It is not seven channel apps.

1. **Create.** A conversational brief runs on the left and a live channel preview on the right. It starts from an objective. The AI proposes the audience from PI lists, a brief, content per chosen channel and variants. Edits are commands plus free text ("shorter", "address the price objection", "less salesy"). Each turn produces a proposal the user accepts into the draft, following the `ContentWorkspace` pattern. The validators run on every change and show channel faults: subject length, a missing unsubscribe footer, an unfilled personalization field, a WhatsApp template parameter mismatch, the SMS segment count.
2. **Campaigns.** `prospect_campaigns` with list and ICP selection (preview with exclusion reasons), the sequence (workflow steps referencing approved content, SC-3), the schedule and the approval route. This sits in the same navigation as social content campaigns but is a separate type.
3. **Inbox.** The existing `/engagement`, extended with email and WhatsApp. The thread view adds a person panel (PI context) and a journey panel (which campaign, step and prior sends). The AI suggestion panel uses Content Intelligence with conversation context. It says when context is missing and asks for it, and it never invents a price, capability or commitment: the prompt allows only facts from approved sources, and the validator flags any price or date not in them.
4. **Approvals.** One queue over the existing stores: WS-3 `awaiting_approval`, orchestration `needs_human`, community `pending`. It approves the content revision and the send separately.
5. **Channels and health.** Setup for sending domains (W4 records and status), senders, connected accounts and WhatsApp numbers. Readiness per channel comes from SC-1, and deliverability metrics and recommendations sit here.

**One visible state model** for anything outbound: Draft → Approved → Scheduled → Queued → Submitted → Accepted → Delivered (only from a provider report) → Failed / Cancelled, plus **Uncertain** (the contract's `certainty`), shown as "may have been sent: needs review". It is a display mapping over the contract states, not a new stored enum.

## 6. Real-time voice architecture (design only)

Voice is four separate planes. Only the first and the last can reuse the normal content path.

| Plane | What it does | Runs on |
|---|---|---|
| 1. Strategy authoring | Objective, permitted claims, disclosure script, objection library, escalation and exit rules, compiled into a **call plan** (a canonical content type) | Content Intelligence, approved like any content |
| 2. Pre-call preparation | Personalizes the call plan from approved attributes and person context; pre-renders the opening and fallbacks to audio | Content Intelligence + text-to-speech, before dialling |
| 3. Real-time runtime | One live conversation | A dedicated voice runtime service, never the campaign workflow |
| 4. Post-call | Transcript, summary, disposition, outcome event, governance writes | Content Intelligence + contract events |

The runtime turn loop is designed for bounded latency:
- Streaming speech-to-text with end-of-turn detection; streaming text-to-speech; barge-in cancels playback.
- Each turn first runs **deterministic guards**, which need no model call:
  - an opt-out or do-not-call phrase ends the call politely and writes a governance record;
  - "am I talking to a bot" triggers the approved disclosure;
  - leaving the objective's scope escalates or closes the call.
- Then **one bounded model call**: small model, the call plan plus a rolling summary plus the last few turns, a hard timeout and a token cap. On timeout the runtime plays a pre-rendered fallback from the plan. It never waits indefinitely.
- Every turn records the transcript segment, the guard decision, the model, latency and fallback use, for audit.
- **Latency targets are not invented here.** The budget is measured from end of speech to first audio and set from vendor sandbox measurements in the spike. The design goal is that no turn waits on anything except one streaming model call.
- The runtime sits behind a vendor-neutral `VoiceSessionPort`. Model calls go through the gateway transport layer, so metering and keys stay central. Charging is per minute through `deductCreditsAwaited` with a multiplier, under a **new** action key, because `voice_per_minute` already means voice interaction.
- Constraints: no unsupported promises (plan-only claims), no identity misrepresentation (mandatory disclosure), opt-out honoured within the call, and nothing outside the authorized objective.

No voice code is proposed for this phase. A runtime spike needs separate authorization, a vendor choice and counsel's answers on recording consent and calling rules.

## 7. Billing and usage impact

- **No second ledger.** Every charge goes through `apply_credit_reservation` via the existing API.
- **Per send** (email, WhatsApp, SMS): reserve before dispatch with `reserveCreditsForWork`, using the reference attempt or execution-request id so retries never double-charge. Confirm on provider acceptance; release when nothing was sent. An uncertain send stays held until a person resolves it.
- **Per publish or community action:** fixed price through `executeWithCredits` at execution.
- **Voice minutes and SMS segments:** `deductCreditsAwaited` with a multiplier after the fact.
- **AI drafting and replies:** `runBilledAiCompletion` with existing or new content actions.
- **Back to orchestration:** engines fill `ExecutionUsage` from the settlement result.
- **Separately priced services** (domains, mailbox infrastructure, managed services) are an owner choice: credits (works today with catalogue rows) or money add-ons (a checkout kind migration). Entitlements use new `plan_limits` resource keys. Neither couples to one provider.
- Provider cost is logged with a real cost through `logUsageEvent` (`external_api`), never as a cost-less row.
- **Blocked on C-1** (prices, refunds, when enforcement switches on). Nothing charges until the owner sets prices.

## 8. Security, consent, suppression and approval

- **Generation never sends.** The content service imports no engine; a test pins the import closure.
- **Personalization:** only approved attributes, read live, with the values used recorded as evidence (as `email_outreach_content_evidence` does). The prompt receives no other person data. Personalised operations are exact-match-only or uncached in the AI cache.
- **Context in prompts:** cross-thread and cross-channel message text enters a prompt only if the owner allows it (retention questions E-1 and E-4 are open). Until then, only the current thread is used.
- **Governance:** the orchestration gate and engine send-time checks stay. The new rule from L-3 applies everywhere: **recheck governance immediately before execution, at every entry point.**
- **Consent:** no recipient positive-consent store exists. SMS and voice cannot start without one (owner and counsel).
- **Approvals:** AI-written content needs human approval before first use, at least until the owner sets a policy. Tenant-level approval needs a route; today only a platform super-admin can approve WS-3.
- **Identity:** community actions stay refused until both the acting account and the recipient are proven (B-7). Browser actions stay refused until session-reuse RPA is allowed (GAP-17).
- **Webhooks:** verify first, store durably before acknowledging, deduplicate, and never treat an event as positive engagement by default (SC-5).
- **Route auth and policy gates** apply to every new route; the existing `check-route-auth` and `check-route-policy` gates are in T2.

## 9. L-3, L-4 and B-7

**L-3, community action after an opt-out.** I re-read `communityAiScheduler.ts:395-445`. The scheduler claims `approved → executing` and calls `executeAction`. The manual route and the RPA retry flush also reach the executor, according to the scheduler's own comment and `communityAiActionExecutorRuntime.ts:178`. The other entry points listed under B-7 still have to be checked one by one.
- **Fix:** a governance recheck inside the community executor, immediately before any platform call, using the canonical `mayContact` on the person behind the action. If it refuses, the action is skipped with the reason recorded and nothing is sent. If governance is unreadable, the action waits. If an action came from a journey and its person cannot be resolved, it is refused. One choke point covers every entry point that reaches the executor. Any that bypass it get the same check.
- **Open question for the owner:** which suppression applies to tenant community actions that are not tied to a known person, such as replying to a comment on the tenant's own post.
- **Owner:** Outreach (community engine).
- **Proof:** a real-schema test where an opt-out is recorded after approval. The scheduler, the retry flush and the manual route each refuse, with no platform call.
- **Must land before B-7 is lifted.**

**L-4, lost WhatsApp queue acknowledgement.** `whatsappBroadcastService.ts:253` uses a **deterministic job id**, `wa-batch-<broadcast>-<n>`. `enqueueOrThrow` throws on `failed`/`unavailable` even when Redis may hold the job.
- **Fix:** after an ambiguous throw, look the job up by its id. If it exists, it is queued. If it is absent and the error is ambiguous, the request settles **uncertain**, not failed, and is never re-enqueued automatically.
- **Send-once claim:** add a per-recipient claim (`pending → sending` compare-and-set) before the Meta call. This closes the earlier "no send-once claim" finding. A recipient in `sending` without a `wamid` after a timeout goes to a person.
- **Reconciliation:** later sweeps read recipient statuses and `wamid`s.
- **Owner:** Outreach (WhatsApp engine). The adapter's settle mapping changes through `virality-c7`.
- **Proof:** unit tests for each enqueue outcome, and a real-schema test where a lost acknowledgement produces exactly one Meta call across retries.

**B-7, verified community identity.** This stays a blocker. The legitimate write path is the acting-account proof designed in `../PROPOSED-ADAPTER-CHANGES.md` (pin `social_accounts`, snapshot the platform user id at approval, compare live before acting), plus an owner decision on recipient proof. **Never** have a tenant OAuth flow write `subject_platform_oauth`; that would forge consent evidence. Ten other entry points need the same proof.

## 10. Dependency map and sequence

```
Wave 0  Owner decisions (§12)  ─────────────────────────────────────────────┐
Wave 1  L-3 · L-4 · email truth fixes · channel content profiles · readiness read (SC-1/2)
           │                          │                     │
Wave 2  Canonical content for outreach (SC-3) · conversation read model + thread-person writer
        · inbound email · approval queue UI · campaign builder UI · Content Intelligence service
           │
Wave 3  Charging (after C-1) · deliverability metrics + auto-pause · reply AI with person context
        · analytics UI over journeyReport (SC-4) · W4 wiring to sending (after sender decision)
           │
Wave 4  SMS foundation docs/fixtures · voice design spike (separate authorization)
        Any real provider send = T3, separately authorized
```

| Workstream from the brief | Wave | Blocked by |
|---|---|---|
| 1 Shared content intelligence | 1 (profiles), 2 (service, persistence) | Content owner on runtime flags and canonical persistence |
| 2 Campaign and engagement UX | 2 | Audience and campaign canonical decision |
| 3 Email account, domain, deliverability | 1 (fixes), 3 (wiring) | Sender model, AWS setup, configuration sets |
| 4 Email campaign lifecycle | 2–3 | SC-3, E-1..E-5, postal address |
| 5 WhatsApp + L-4 | 1 | B-6 before any WA-1/2/3 |
| 6 Social publishing | 1 (cron fix backport), 3 | N-to-1 semantics decision |
| 7 Community + L-3 | 1 | B-7 for enabling |
| 8 Browser | After GAP-17 decision | Owner, legal |
| 9 SMS foundation | 4 | Vendor, consent |
| 10 Voice design | 4 | Separate authorization |
| 11 Cross-channel intelligence, analytics, billing | 3 | C-1, SC-4 |

## 11. Parallel-agent ownership plan

One owner per shared item. Agents work in separate worktrees, never in the same physical tree. Typecheck runs one at a time (the machine has 4 CPUs and 16 GB). Shared files change only through their owner.

| Shared item | Single owner |
|---|---|
| `executionContract.ts`, `engineAdapters.ts`, `*EngineAdapter.ts`, sweeper, journey files | Orchestration (`virality-c7`) |
| `providerCapabilityModel.ts`, approved-attribute read, thread-to-person writer, `contact_governance*` | PI |
| Generation runtime, canonical content schema, persistence policy | Content owner (to be named by the owner) |
| Credit catalogue, feature registry, checkout kinds | Billing |
| `engagement_threads`/`messages` schema, `/engagement` UI shell | Engagement |
| Migrations in a wave | One migration coordinator per wave |
| Engines, channel profiles, Content Intelligence service, Outreach UI | Outreach (this workstream) |

| Wave-1 agent | Worktree branch | Touches | Shared-item requests |
|---|---|---|---|
| L-3 fix | `outreach/l3-community-governance` | Community executor | None |
| L-4 fix | `outreach/l4-whatsapp-reconcile` | Broadcast service, recipient claim | Adapter settle via c7 |
| Email truth fixes | `outreach/email-tracking-truth` | Complaint state, unsubscribe outcome, diagnostics removal | One migration via coordinator |
| Channel content profiles | `outreach/channel-content-profiles` | New pure modules + tests | None |
| Readiness read | Contract proposal only | — | SC-1 to c7, SC-2 to PI |

## 12. Acceptance criteria (T1 / T2 / T3)

Evidence is labelled by kind: unit and component, contract, real PostgreSQL, provider sandbox, real provider, production.

| Workstream | T1 (unit, contract) | T2 (real PG + gates) | T3 (authorized only) |
|---|---|---|---|
| Content intelligence | Each channel validator refuses its known faults; generation never imports an engine; personalised operations uncached; unfilled field refused | Approved revision persisted with history; a step executes exactly that revision | Model quality review on real tenants (human-rated) |
| Reactive replies | Missing context produces a question, not invented facts; price or date not in sources is flagged | Inbound WhatsApp and email reach the thread and the person view | Real inbound from a test mailbox and number |
| Campaign UX | Component tests for the state display mapping | Create → select → enrol → approve → execute on the recording provider | Pilot tenant |
| Email | Complaint state; unsubscribe outcome; `validateSender` refuses | SES event replay produces the right states; domain refresh scheduled | SES sandbox, then a real send to a seed list |
| WhatsApp L-4 | Each enqueue outcome mapped; send-once claim | Lost acknowledgement gives one Meta call | Meta test number |
| Community L-3 | Executor refuses after opt-out | Scheduler, retry flush and manual route refuse with no call | None until B-7 |
| Readiness | Six states from fixtures; mocked is never Available | Readiness from real governance rows | — |
| Billing | Reserve, confirm, release per channel, idempotent per attempt | Ledger behaviour test of `apply_credit_reservation` (missing today) | Production after C-1 |

T2 is the existing chain: real schema, typecheck, route auth and policy, migration quality, schema drift, whole-repo jest against the baseline. The full chain runs per wave merge, not per small change.

## 13. Owner decisions, ordered by what they unblock

1. **Content:** name the Content owner; switch canonical persistence on for outreach types, or choose another store.
2. **Canonical models:** `prospect_campaigns` and `prospect_lists` as the outreach campaign and audience; retire `gtm_campaigns`, LC-301 `audiences`, W5 `executionBridge` and `outreach_plans`.
3. **Approvals:** who approves at tenant level, per step or per campaign; may AI-written content ever send without human approval.
4. **Email:** sender model (tenant domain, platform fallback, mailboxes ever?), who reads replies, E-1..E-5, postal address, open and click tracking, per-tenant or shared configuration sets.
5. **C-1:** prices, refunds, enforcement timing; add-ons as credits or money; canonical plan keys.
6. **Channel vocabulary and STOP scope:** `phone` or `voice`; does a STOP on one channel block others; recipient consent store.
7. **Conversation context in prompts:** may other threads and channels be used, with what retention.
8. **Reply generator:** keep `engagementAiAssistantService` as the one path; retire the others.
9. **Community recipient proof (B-7)** and **session-reuse RPA (GAP-17).**
10. **WhatsApp tenant approval (B-6)** before WA-1/2/3.
11. **Voice:** scripts only, or real calls; vendor; recording consent.
12. **Governed path:** an OMNI Story per wave before merge; only a human can create one.

## 14. Deferred or blocked

| Item | State | Unblocks with |
|---|---|---|
| Any real send, publish, call or community action | Blocked | Owner authorization per channel (T3) |
| SMS execution | Deferred | Separate authorization, vendor, consent store |
| Voice execution | Deferred | Separate authorization, vendor, counsel |
| Community execution | Blocked | B-7, L-3 |
| Browser actions | Blocked | GAP-17, GAP-03 |
| WhatsApp journey sends | Blocked | B-6, then WA-1/2/3, L-4 |
| Real email | Blocked | Sender model, AWS production access, configuration sets, E-1..E-5, postal address, unsubscribe keys |
| Mailboxes, domain purchasing, warm-up | Deferred | Owner product decision |
| Open and click tracking | Deferred | Privacy and counsel decision |
| Channel charging | Blocked | C-1 |
| Provider availability and webhook contract | Undecided | Contract owner (SC-1, SC-5) |
| Production measurement (RPA rows, community executions, mock-platform flag) | Not done | Owner authorization |
| Release | NO-GO | T2 was green with providers stubbed. That is not production readiness |
