# ENG-001 — ENGAGEMENT & LIFECYCLE INTELLIGENCE ARCHITECTURE

**Mode:** characterization / architecture gate. READ-ONLY. No implementation.
**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`, 434 migrations.
**Gate status:** see §26.

---

## 1. Executive Summary

Omnivyra can maintain one canonical identity, one lifecycle, one engagement history
and one orchestration model across Email, WhatsApp, SMS, Social and Voice. The
architecture does not need to be invented — **three of the four hardest pieces already
exist in channel-neutral form**, and the main risk is not building the wrong thing but
failing to notice what is already right.

**What already exists, channel-neutral:**

1. **`identity_claims`** is a genuine multi-channel identity surface: `claim_type ∈
   {email, phone, domain, external_profile, external_id}` with a CHECK requiring
   `platform` to be non-null exactly for the two external types, plus
   `verification_state`, `confidence`, `evidence`, `observed_at`, `revoked_at`. A
   WhatsApp number, a LinkedIn profile and a voice-reachable phone are all already
   expressible. It is runtime-reachable from `identityResolutionService` and eight
   `prospectIdentity/*` modules. **IMPLEMENTED (data model + runtime path).**
2. **`WORKFLOW_STEP_CHANNELS`** already names ten channels — `email, linkedin, phone,
   whatsapp, sms, github, discord, slack, community, content` — and `workflowStore.ts`
   comments that it is "deliberately NOT narrowed to the two channels Outreach
   currently has." Workflow is already channel-neutral. **IMPLEMENTED.**
3. **`transportRegistry`** is "the ONE place that decides which channels are
   dispatchable", a process-global keyed `Map` with exactly one transport per channel,
   where registration makes a channel "routable, not live". Adding a channel engine is
   a registration, not a redesign. **IMPLEMENTED.**

**What is genuinely missing:**

4. **The intelligence layer does not exist at all.** No engagement intelligence, no
   content intelligence, no deliverability intelligence, no next-best-action. **GAP.**
5. **The lifecycle has no post-sale half and no engagement-driven producer.**
   `pi.lifecycle.1` has seven pre-sale states and **zero callers outside its own
   module**. **GAP.**
6. **Business outcomes are unwritable**, because `ingestFeedback` has no caller — so
   every intelligence signal the layer would learn from is currently unobtainable.
   **GAP, and it is the gating one.**

**The single most important conclusion:** the first implementation gate must be
**outcome observability** (inbound + provider events), not intelligence. Every
capability in §6–§10 learns from signals that cannot currently be recorded. Building
intelligence before the signals exist would produce a layer trained on nothing.

---

## 2. Current Architecture

Evidence-classified inventory of the thirty components named in the brief.

| # | Component | Canonical owner | Channel | Status |
|---|---|---|---|---|
| 1 | Company Profile | company profile services | neutral | IMPLEMENTED |
| 2 | Tenant ICP | `prospect_icp_versions` (via `20261012000000_d1_tenant_icp_model`) | neutral | IMPLEMENTED |
| 3 | Ratified ICP | ratified ICP versions; only score evaluations + ratified versions are safe to reference | neutral | IMPLEMENTED |
| 4 | Prospect Intelligence | `prospectIntelligenceRead` + enrichment chain | neutral | IMPLEMENTED |
| 5 | MarketPulse | `market_pulse_findings`, `market_pulse_finding_actions`, `market_pulse_automation_settings`, `market_analyses`, `market_pulse_items_v` | neutral | **PARTIALLY IMPLEMENTED** — tables and a finding/action loop exist, but in prospect intelligence MarketPulse is a catalogued enrichment source with `available: false` (`prospectIntelligenceRead.ts:751-752`) |
| 6 | `canonical_leads` | PI ingestion | neutral | IMPLEMENTED — `company_id`, `user_id`, `source`, `qualification_score`, `external_lead_key`, `lead_status`, `unified_person_id`; `FORCE ROW LEVEL SECURITY` |
| 7 | `unified_persons` | identity resolution | neutral | IMPLEMENTED — `company_id`, `primary_email`, `primary_phone`, `external_keys` jsonb, `account_id`, `source_of_truth`, `source_priority`; `status ∈ {active, merged, suppressed, archived}`, `merged_into_id`, merge-coherence + no-self-merge CHECKs, composite FK `(id, company_id)` |
| 8 | `prospect_accounts` | account resolution | neutral | IMPLEMENTED — `organization_id`, `domain_normalized`, `merged_into_id`, `status`, `confidence` |
| 9 | `source_records` | `20261002000000_li2_source_records` | neutral | IMPLEMENTED (data model); consumer breadth UNVERIFIED |
| 10 | `source_assertions` | LI attribute surface | neutral | IMPLEMENTED (data model); consumer breadth UNVERIFIED |
| 11 | `identity_claims` | identity resolution | **neutral — the multi-channel spine** | IMPLEMENTED + runtime path |
| 12 | Contact governance / suppression | `outreach_suppressions`, `mayContact`, `20261003000000_li3_contact_governance` | neutral | IMPLEMENTED |
| 13 | Engagement | `engagement_*` | **social-only in code** | PARTIALLY IMPLEMENTED |
| 14 | `engagement_threads` | engagement services | `platform` text, **no CHECK** | PARTIALLY — schema permits any platform; zero `'email'` in code |
| 15 | `engagement_messages` | engagement services | `platform` text, **no CHECK**; `platform_message_id text NOT NULL`, `direction`, `parent_message_id`, `raw_payload` | PARTIALLY — **no `organization_id` column**; tenant scope is transitive via `thread_id` |
| 16 | Common Outreach | `leadOutreachExecution/*` (22 modules) | **neutral** | IMPLEMENTED, FROZEN |
| 17 | Workflow | `workflows` | neutral | IMPLEMENTED, FROZEN |
| 18 | Workflow Version | `workflow_versions`; one published; resolve-once-then-pin | neutral | IMPLEMENTED, FROZEN |
| 19 | Execution Instance | `execution_instances`; `uq_execution_instances_active` on (org, campaign, workflow, subject) | neutral | IMPLEMENTED, FROZEN |
| 20 | Execution Plan | `execution_plans`, 1:1 per Instance from the pinned version | neutral | IMPLEMENTED, FROZEN |
| 21 | Execution Plan Step | `execution_plan_steps` | neutral | IMPLEMENTED, FROZEN |
| 22 | Execution Task | `execution_tasks` | neutral | IMPLEMENTED, FROZEN |
| 23 | 040 Outreach Bridge | `outreach_bridge_handoffs`, keyed `execution_task_id` UNIQUE | neutral (refuses unsupported channels pre-write) | IMPLEMENTED, FROZEN |
| 24 | Email Engine | `emailEngine/*` (5 modules) | **email-specific** | IMPLEMENTED, FROZEN |
| 25 | Email content evidence | `email_outreach_content_evidence` — `organization_id`, `outreach_attempt_id`, `rendered_subject`, `rendered_body`, `personalization_inputs`, `content_source` | email-specific | IMPLEMENTED |
| 26 | `outreach_attempts` | Common Outreach | neutral | IMPLEMENTED — `company_id` **text**, `task_id`, `attempt_number`, `channel`, `transport`, `governance_version`, `outcome`, `idempotency_key`. **No `provider_message_id`** |
| 27 | `outreach_delivery_evidence` | Common Outreach | neutral | IMPLEMENTED — `provider`, **`provider_message_id`**, `provider_event_id`, `source ∈ {provider_webhook, provider_poll, manual, import, derived, internal}`, `delivery_status` (9 values incl. `sent_unverified`, `delivered`, `bounced`); **UNIQUE `(company_id, provider, provider_message_id)`** |
| 28 | Provider identities / credentials | `integration_credentials` + `20261014000000_pi_tenant_credential_ownership` — `company_id` + `provider_key` + `credential_key`, `one_owner` CHECK, partial unique index, `encrypted_value`, `rotated_at` | neutral | **PARTIALLY** — a tenant-owned credential path exists; no email provider identity uses it yet |
| 29 | Tenant-owned sending domains | — | email-specific | **NOT FOUND** — zero `sending_domain`, `sender_identity`, `reply_to`, `mail_from`, `return_path` for email anywhere in `backend`, `pages`, `supabase/*`. All hits are social (X `in_reply_to_tweet_id`, social `raw_payload.sender_name`) |
| 30 | Future channel engines | `transportRegistry` is the extension point | — | CHARACTERIZED |

---

## 3. Canonical Identity Spine

```
source → ingestion → identity resolution → canonical person → canonical account
                                                    ↓
                                         lifecycle → engagement → outcome
```

**Canonical person:** `unified_persons.id`, tenant-scoped by `company_id`.
**Canonical account:** `prospect_accounts.id`, tenant-scoped by `organization_id`;
`unified_persons.account_id` is the person→account edge.
**`canonical_leads`** is the PI prospect record, carrying `unified_person_id`. It is
**not** a second person — and note separately that legacy `leads` is a *different
entity* (web-form/visitor attribution), not a `canonical_leads` duplicate.

**Duplicate resolution — IMPLEMENTED.** `unified_persons` deduplicates by **two
tenant-scoped unique indexes (email and phone)**, with `status`, `merged_into_id`, a
merge-coherence CHECK (`status='merged'` ⇔ `merged_into_id IS NOT NULL`), a
no-self-merge CHECK, and a composite FK on `(id, company_id)` so a merge can never
cross tenants. `person_duplicate_candidates` holds candidates by reference and "never
copies a payload, so there is exactly one" authoritative record. `prospect_accounts`
carries the same `merged_into_id` lineage.

**Multi-channel association — the key answer.** `identity_claims` is the canonical
place where a person acquires channel identities:

| Channel | Representation | Available today |
|---|---|---|
| Email | `claim_type='email'`, `platform` NULL | yes |
| Phone / SMS / Voice | `claim_type='phone'`, `platform` NULL | yes |
| WhatsApp | `claim_type='phone'` (the number) or `external_id` + `platform='whatsapp'` | yes — **OWNER DECISION** which |
| LinkedIn / social | `claim_type='external_profile'` + `platform='linkedin'` | yes |
| Account domain | `claim_type='domain'` | yes |

The CHECK `identity_claims_platform_rule` enforces that `email/phone/domain` carry no
platform and `external_profile/external_id` must carry one — so the model cannot drift
into ambiguity. `normalized_value` must be lowercase; `confidence ∈ [0,1]`;
`verification_state ∈ {unverified, verified, rejected}` with a coherence CHECK; and
`revoked_at` allows withdrawal without deletion.

**Multiple email addresses.** `unified_persons.primary_email` is a single column and
is the *authoritative send address* (A-041 ratified: no alternate table, no
verification flag, fail closed). Additional addresses belong in `identity_claims` as
further `email` claims — **but note the tenant-scoped unique index on email means one
address maps to one person per tenant**, which is the dedup guarantee and must not be
weakened to accommodate alternates.

**Where a second identity system could accidentally appear — four real risks:**

- **G-01 `unified_persons.external_keys` jsonb.** `identityResolutionService` matches
  on it (`matchedBy: 'email' | 'phone' | 'external_keys' | 'created'`, `.contains(...)`).
  The presence of `externalIdentityDualWrite.ts` and `externalIdentityShadow.ts`
  indicates a migration toward `identity_claims` is in progress. If channel identities
  are written to `external_keys` instead of `identity_claims`, that jsonb becomes a
  competing identity store with no CHECKs, no verification state and no provenance.
- **Social `engagement_threads.platform_thread_id` + `contact_id`.** A social thread
  can reference a contact without resolving to `unified_person_id`, creating a
  platform-local person.
- **Channel provider ids** (a WhatsApp wa_id, a Twilio number SID) stored on a channel
  engine's own table rather than as an `identity_claim`.
- **`outreach_tasks.lead_id`** is an *intelligence key*, not `leads.id`, and must never
  be FK'd — treating it as an identity would create a fifth person notion.

**Tenant ownership** is enforced by `company_id`/`organization_id` NOT NULL on every
identity table, `FORCE ROW LEVEL SECURITY` on `canonical_leads`, composite FKs on the
person merge path, and tenant-first reads. **One person may legitimately hold many
channel identities**; the authoritative relationship is
`person → account (0..1) → lifecycle`, with engagement hanging off the person.

---

## 4. Lifecycle Model

**Authoritative owner — IMPLEMENTED:** `prospect_lifecycle_transitions`, an
**append-only ledger** (PI-ADR-004) with `state`, `previous_state`, `is_initial`, a
typed evidence citation whose kind is closed and CHECKed, an idempotency/debounce
anchor, `prospect_lifecycle_state_valid`, `prospect_lifecycle_initial_shape`
(`is_initial ⇒ previous_state IS NULL`) and `uq_prospect_lifecycle_initial`. State
model: `backend/services/prospectLifecycle/stateModel.ts`.

```
PROSPECT_LIFECYCLE_VERSION = 'pi.lifecycle.1'
identified → qualified → engaged → nurture → meeting_scheduled
                                 → not_interested → closed_disqualified
```

`PROSPECT_STATES_NOT_MODELLED` deliberately excludes `outreach_active`, `suppressed`,
`outreach_ready`, `no_response`, `candidate` — execution status is **not** lifecycle,
which is the correct separation and must be preserved.

**Level:** person/prospect-level, keyed to the PI prospect. Account-level lifecycle
**NOT FOUND**. Lifecycle cannot currently differ by account relationship.

**Two other lifecycles exist and must not be confused with it:**

- `opportunity_lifecycle_states` — keyed `opportunity_feed_item_id`, nine states
  (`detected, triaged, reviewing, qualified, monitoring, outreach_planned, converted,
  dismissed, archived`). This is an **opportunity-feed-item** lifecycle, a different
  axis, not a customer lifecycle.
- A **17-state per-task lifecycle** that PI-ADR-002 explicitly forbids PI to write.

**G-02 — lifecycle has no engagement-driven producer. GAP, HIGH.** A repository-wide
search for importers of `prospectLifecycle/*` returned **no callers outside the module
itself** (the only table-level writer found besides the module is
`campaignSelectionService`). So today: engagement activity does **not** move lifecycle;
`engaged` is reachable in the vocabulary but nothing transitions into it from a reply.

**G-03 — no post-sale lifecycle. GAP, HIGH for the stated product vision.** The
brief's target (`Opportunity → Customer → Adoption → Expansion → Advocacy`) has no
representation. `pi.lifecycle.1` ends at `meeting_scheduled`.

**Recommended answers to §5's questions** (all require ratification):
events that *should* cause transitions are reply, positive reply, meeting booked,
unsubscribe and an elapsed-no-response window. Deterministic: unsubscribe,
`not_interested` from an explicit decline, `no_response` by elapsed rule (already the
`DERIVED_BUSINESS_OUTCOMES` pattern). AI-recommended, human-ratified: `qualified`,
`engaged` strength, and every post-sale transition — because each carries commercial
consequence. Lifecycle *should* influence channel selection, content, frequency and
next-best-action, and **must never silently influence suppression** — suppression is a
consent fact, lifecycle is a relationship assessment, and collapsing them would let a
scoring change revoke or grant consent.

---

## 5. Engagement Model

**Can `engagement_*` become the canonical cross-channel history? Yes — with two
additive changes, and no second conversation model.**

`engagement_threads`: `platform`, `platform_thread_id`, `unified_person_id`,
`contact_id`, `organization_id`, `unread_count`, `assigned_to`, `reply_lock_user_id`,
`reply_lock_expires_at`, `window_expires_at`, `root_message_id`.
`engagement_messages`: `thread_id`, `platform`, `platform_message_id text NOT NULL`,
`message_type`, `parent_message_id`, `content`, `raw_payload`, `direction`, `status`,
`platform_created_at`, `platform_parent_id`, `sentiment_score`.
`ai_message_drafts`: `generated_text`, `edited_text`, `status`, `created_by`,
`approved_by`, `approved_at`, `sent_at`.

**Neither `platform` column carries a CHECK** — only
`engagement_platform_preferences.platform` has one (non-blank). So `'email'`,
`'whatsapp'`, `'sms'`, `'voice'` are all schema-permissible today. Every code path,
ingestion and UI is nonetheless social-only (zero `'email'`), and
`engagement_messages.sync_source` is constrained to `omniverva | platform_sync`.

| Requirement | Verdict |
|---|---|
| represent Email / WhatsApp / SMS / Social / Voice threads | **yes**, `platform` is unconstrained |
| represent all channels' messages | **yes**; voice needs a transcript convention in `content`/`raw_payload` — CHARACTERIZED, not designed |
| map provider message ids | **yes** — `platform_message_id` is already `text NOT NULL` |
| map outbound execution | **GAP** — nothing links a message to an attempt (§11) |
| map inbound replies | **GAP** — no inbound path exists at all |
| continue a conversation across many events | **yes** — `parent_message_id`, `root_message_id`, `platform_parent_id` |
| one person, several concurrent channel threads | **yes** — threads key on `(platform, platform_thread_id)` under one `unified_person_id` |
| unified cross-channel relationship view | **GAP** — requires a person-level aggregation that does not exist |
| additive changes or sufficient? | **additive only** |

**G-04 — `engagement_messages` has no `organization_id`. GAP, HIGH (security).** Tenant
scope is transitive through `thread_id → engagement_threads.organization_id`. The
target architecture requires `email_message.organization_id` to be tenant-consistent;
today that is an unstated join invariant. Either add the column or enforce the
invariant explicitly — an unstated join is how cross-tenant leaks happen.

**Competing models, all present in the baseline:** `gtm_messages` (message library,
exactly one reader, `campaignService`, no writer UI), `email_events` + `email_jobs`
(transactional/invite path, bound to `job_id`/`invitation_id`, read only by an admin
delivery route — **not** the outreach evidence model), `outreach_decisions`,
`ai_message_drafts`. **None of these should become the conversation model.**

---

## 6. Engagement Intelligence

**Status: GAP — the layer does not exist.** No module computes engagement strength,
channel preference, content performance, timing, frequency saturation, next channel,
stop recommendation, relationship progression or conversion propensity.

What exists as raw material:

| Signal | Where | Status |
|---|---|---|
| attempt history, channel, transport, outcome | `outreach_attempts` | IMPLEMENTED |
| delivery status, provider, provider event | `outreach_delivery_evidence` | IMPLEMENTED (schema); no webhook producer |
| business outcomes (`replied`, `unsubscribed`, `meeting_booked`, `converted`, `rejected`, `no_response`) | `feedbackIngestion`, `feedbackSummary` | **BLOCKED — `ingestFeedback` has no caller** |
| response/conversion grouping | `feedbackSummary`: `RESPONSE_TYPES = ['replied','rejected','unsubscribed']`, `CONVERSION_TYPES = ['meeting_booked','converted']` | IMPLEMENTED (consumer exists, producer does not) |
| social engagement signals, sentiment | `engagement_messages.sentiment_score`, campaign signals | PARTIALLY (social only) |
| ICP fit / priority score | `SCORING_RULES_VERSION = 'pi-score.1'` | IMPLEMENTED |

**G-05 — the gating gap.** `UNOBSERVABLE_BUSINESS_OUTCOMES = ['opened','clicked',
'meeting_booked']` and `DERIVED_BUSINESS_OUTCOMES = ['no_response']`. Note that
`meeting_booked` is simultaneously a `CONVERSION_TYPE` and **unobservable** — so
conversion itself cannot be measured today. Combined with `ingestFeedback` having no
caller, **no engagement intelligence can be trained on anything.** This is why §23
sequences observability first.

---

## 7. Technical Deliverability Intelligence

**Status: GAP — and the one DNS primitive that exists points the wrong way.**

`emailAuthService` reads a **prospect's** SPF and DMARC as an inbound intelligence
signal, and explicitly does not probe DKIM ("selector-specific, no generic lookup").
`company_domains` is the tenant's **website** domain with its own verification model
(`verification_status ∈ {unverified, pending, verified, admin_override}`,
`verification_method ∈ {dns, http, admin_override}`, `verification_token`,
`verified_at`, `override_reason` required for override). Neither is a sending posture.

**Signals required for adaptive recommendations, and where each should live:**

| Signal | Source | Owner |
|---|---|---|
| domain verification, DKIM, SPF, DMARC, custom MAIL FROM, alignment | DNS + provider identity state | sending-domain model (future) |
| provider sending limits, sandbox state, provider restrictions | provider account | provider identity (future) |
| bounce rate, complaint rate, delivery failures | `outreach_delivery_evidence` (`bounced`, `failed`; `source='provider_webhook'`, `provider_event_id`) | Common Outreach, **needs the webhook producer** |
| suppression status | `outreach_suppressions` | Common Outreach — IMPLEMENTED |
| recent sending history, volume | `outreach_attempts` | Common Outreach — IMPLEMENTED |
| engagement performance | §6 | Engagement Intelligence |
| recipient quality | PI enrichment + ICP | Prospect Intelligence |
| domain age / reputation indicators | external | **UNVERIFIED** — no such source in repo |
| warm-up state | — | **NOT FOUND** |

**Recommendation.** A distinct **Deliverability Intelligence** component, reading
(never writing) delivery evidence, attempts, suppression and sending-domain state, and
emitting advisory recommendations only. **No universal `X/day` rule.** The adaptive
form is a per-sender budget derived from authentication completeness, provider limit,
observed bounce and complaint rates, recent volume and warm-up age — with the
important honesty that **until the webhook producer exists, every reputation input is
null**, so early output must say "insufficient evidence" rather than guess. Volume
enforcement stays in Common Outreach's existing quota, which is already person- and
tenant-keyed; the intelligence recommends the number, governance enforces it.

---

## 8. Content / Engagement Intelligence

**Status: PARTIALLY IMPLEMENTED — generation exists, evaluation and learning do not.**

Reusable today: `/api/engagement/{ai-suggestion, generate-response, reply}` →
`backend/adapters/engagement/responseAdapter.generateEngagementResponse`, whose
`engagement_type` vocabulary already includes `'outreach_response'`;
`ai_message_drafts` already models generated → edited → approved → sent with approver
and `sent_at`; UI patterns exist (`engagement-inbox.tsx`, `SuggestWithAIPanel.tsx`).
**Do not build a second content-generation architecture.**
UNVERIFIED: whether `responseAdapter` accepts `platform='email'` at runtime.

**Missing: every evaluative capability.** Subject relevance/clarity/length/spam-risk/
open propensity, body ICP-relevance/value-proposition/credibility/CTA/readability/
sales-language — **NOT FOUND**, none of it exists.

**Personalization inputs available now:** company intelligence, prospect intelligence,
ICP and ratified ICP version, lifecycle stage (readable), account context, campaign and
workflow context. MarketPulse is available as a tenant-side findings loop but is
`available: false` as a prospect enrichment source. Prior conversation is available for
social only.

**Learning loop — BLOCKED by G-05.** Delivery, replies, positive/negative replies,
meetings, conversions, unsubscribes, bounces and complaints are all modelled and none
is currently recordable.

**Recommended split:** deterministic = personalization substitution, suppression and
compliance checks, length and link checks. AI-generated = subject and body drafts.
AI-recommended = channel, timing, variant choice. **Human-approved (mandatory)** = any
first send to a new person, any lifecycle transition with commercial consequence, any
sender configuration change. Automatically optimized = nothing, until G-05 closes.

---

## 9. Next-Best-Action / Next-Best-Channel

**Status: GAP — does not exist.** Required signals: lifecycle state, engagement
history per channel, channel availability (does the person hold a verified claim for
that channel?), ICP fit and priority score, suppression and consent per channel,
quota headroom, approval policy, and campaign/workflow context.

**Ownership — the responsibility split must not collapse:**

```
Engagement & Lifecycle Intelligence   RECOMMENDS   (what next, which channel, when)
Engagement Orchestrator               TRANSLATES   (recommendation → Instance/Workflow)
Workflow                              EXECUTES     (steps, timing, progression)
Common Outreach                       PERMITS      (kill switch → … → transport)
Channel Engine                        TRANSPORTS   (render, provider, evidence)
```

**Grain:** person-level for contact decisions (consent and quota are person-keyed);
account-level for account-based plays. Both, with person-level authoritative for any
decision that results in contacting a human.

**Human approval stays mandatory** wherever the existing approval authority already
requires it — the autonomy model (`HUMAN | ASSISTED | AUTONOMOUS` on Workflow/Step) is
dispatch permission, and an intelligence recommendation must never upgrade autonomy.

---

## 10. Prospect-first / Message-first convergence

```
Prospect-first:  prospect → AI create/suggest → edit → review ─┐
Message-first:   message → select prospects/list → personalize → review ─┤
                                                                        ▼
                                            EXECUTION INSTANCE  ← convergence point
                                                                        ▼
                                  Execution Plan → Step → Task → 040 → Common Outreach
                                                                        ▼
                                                        Channel Engine → Provider
```

**The convergence point is the Execution Instance**, because it is the first object
that is durable, tenant-scoped, governed, idempotent (caller `Idempotency-Key` via the
existing `withIdempotency` middleware) and already produces a Plan from a pinned
Version. Neither entry point may resolve its own sender, call a provider, or bypass a
gate. **No parallel message-sending engine.**

The one real friction, already identified: `uq_execution_instances_active` is keyed
`(org, campaign, workflow, subject)`, so a repeat one-off to the same subject under the
same workflow collides. **OWNER DECISION** (carried from W2-P).

---

## 11. Inbound architecture

```
provider inbound event → provider message identity → tenant → canonical person
     → engagement thread → engagement message → AI interpretation
     → suggested responses → human selection/edit → outbound execution
```

**Correlation — the authoritative key.** `outreach_delivery_evidence.provider_message_id`,
under **UNIQUE `(company_id, provider, provider_message_id)`**, added by
`20260914000000_ws3_external_dispatch.sql`. A reply's `In-Reply-To`/`References` header
quotes the id SES returned on send (made available by A-O), so a lookup against that
unique index yields **exactly one tenant and one delivery**. Tenant isolation is
therefore a property of the key, not of application logic — which is the strongest
form available.

**Explicit correction.** `outreach_attempts` has **no `provider_message_id` column**;
it carries `idempotency_key` only. Earlier W1 and W2 statements that placed the
MessageId on `outreach_attempts` were wrong. The authoritative location is
`outreach_delivery_evidence.provider_message_id`.

`outreach_delivery_evidence` already anticipates this path: `source='provider_webhook'`
and `provider_event_id` exist in the CHECK vocabulary. **The schema is ready; the
producer is absent** — `ingestFeedback` has no caller and `pages/api/webhooks/` holds
only payments and razorpay-staging.

**Future channels fit the same model** because the key is `(tenant, provider,
provider_message_id)`, which every channel provider supplies. WhatsApp and SMS carry
richer delivery receipts; Social inbound is already partly ingested; Voice would
correlate on a call id and attach a transcript.

**Minimum information to correlate a reply reliably:** the quoted provider message id;
failing that, the tenant-scoped recipient address plus the thread; failing that,
**fail closed** — an uncorrelated inbound message must never be attached to a guessed
person or tenant.

---

## 12. Channel architecture

```
Engagement & Lifecycle Intelligence   (GAP)
            ↓
Engagement Orchestrator               (GAP)
            ↓
Common Outreach                       (IMPLEMENTED, FROZEN, channel-neutral)
            ↓
┌────────────┬──────────┬──────────┬──────────┬──────────┐
│ EmailEngine│ WhatsApp │   SMS    │  Social  │  Voice   │
│IMPLEMENTED │   GAP    │   GAP    │ PARTIAL  │   GAP    │
└────────────┴──────────┴──────────┴──────────┴──────────┘
            ↓
Providers
```

**Responsibility allocation — the load-bearing table of this report:**

| Responsibility | Common Outreach | Channel Engine | Engagement Intelligence | Workflow | Provider adapter |
|---|---|---|---|---|---|
| kill switch, suppression, DNC | **owns** | — | reads | — | — |
| region restriction | **owns** | — | reads | — | — |
| eligibility, approval, autonomy | **owns** | — | recommends | declares per step | — |
| rate limit / quota | **owns** | — | recommends budget | — | — |
| transport selection | **owns** (registry) | — | — | names channel | — |
| recipient resolution | — | **owns** | — | — | — |
| content render | — | **owns** | recommends content | — | — |
| sender/identity resolution | — | **owns** | — | — | — |
| content evidence | — | **owns** | reads | — | — |
| delivery evidence | **owns** | writes | reads | — | reports |
| inbound evidence | — | **owns** ingestion | interprets | — | delivers |
| engagement mapping | — | writes | **owns** interpretation | — | — |
| analytics / lifecycle signals | — | — | **owns** | — | — |
| step timing, progression, settlement | — | — | — | **owns** | — |
| provider API, credentials | — | — | — | — | **owns** |

**No channel engine may bypass Common Outreach governance.** The structural guarantee
already exists: `transportRegistry` is the single place a channel becomes dispatchable,
`dispatchInternalOutreachTask` is channel-generic and resolves the transport from
`task.channel`, and the 040 bridge refuses unsupported channels **before** writing.
A-E already retired the one legacy direct path.

**Channel-specific items that must stay in the engine, not in governance:** message
format and limits, template/approval regimes external to Omnivyra (WhatsApp template
approval, 10DLC registration for SMS), session windows (`window_expires_at` already
exists on `engagement_threads` — a WhatsApp 24-hour window precedent), and consent
semantics that differ by channel. The last is subtle: **channel consent is a
governance fact and belongs in suppression**, even though its *acquisition* is
channel-specific.

---

## 13. Email reference architecture

Email is the reference implementation and should be read as the template.

```
Workflow Version (channel='email', execution_mode) → Execution Instance → Plan → Step → Task
   → sweeper: assert ready → ensureHandoff → outreach_bridge_handoffs → outreach_tasks
   → Common Outreach: kill_switch → suppression → region → eligibility/approval → rate_limit → transport
   → Email Engine: context → recipient → render → content evidence (pre-send, immutable)
   → emailTransport → send-transactional-email (type 'lead_outreach') → SES → MessageId
   → outreach_delivery_evidence.provider_message_id
   → outcome 'sent' → A-K settles step 'completed'
```

Tenant sending rules carried forward from W2-P and **not changed here**:
`EMAIL_FROM` is the platform/certification identity only; a tenant send must never
silently fall back to it; sender resolution happens at the Execution Instance within
the email execution context, fail-closed; sender evidence is captured per attempt.
Sending domain, sender identity, display name, Reply-To and MAIL FROM remain
**NOT FOUND** in the codebase and are future additive work.

**What generalizes to other channels:** the pre-send immutable content evidence keyed
on the *attempt* (not the authoring route), the bridge, the governance order, settlement
on dispatch, and the provider-message-id correlation key. **What does not:** rendering,
recipient resolution, provider auth, and identity verification — these are rightly
per-engine.

---

## 14. Workflow interaction

Workflow semantics are **unchanged** by this gate.

| Layer | Decides |
|---|---|
| Workflow Definition / Version | what the sequence is, per-step channel, relative delay, instruction, `execution_mode`, `requires_approval`. One published version; resolve-once-then-pin |
| Execution Instance | that *this* subject is being run now, under a pinned version |
| Plan / Step / Task | the durable materialization; `execution_tasks` is the unit the bridge consumes |
| Step progression | relative-delay readiness, idempotent advance; skip advances the chain; first step anchors on run start |
| 040 bridge | materialization, not permission; refuses unsupported channels pre-write |
| Common Outreach | whether contact is permitted |
| Channel engine | how the message is produced and transmitted |
| Engagement Intelligence | **recommends** which workflow/channel/timing to use next — it never writes step state |
| Lifecycle Intelligence | **observes** outcomes and records transitions |

**Constraint discovered and worth stating plainly:** the frozen 032 step definition
recognises exactly `channel`, `delay_after_previous_hours`, `instruction?`,
`execution_mode`, `requires_approval?` — `workflowStore.ts` builds a narrowed object,
so **unknown keys are stripped**. Any new per-step concept (a sender, a content
reference, a branch condition) requires extending that definition, as 040 did for
`execution_mode` (store `22d388aaf7a9b3fe → 27c53b4f55984059`, migration unchanged).
That is the established, safe precedent. **No channel-specific Workflow engine.**

---

## 15. ICP / MarketPulse / PI interaction

```
Company Profile → Tenant ICP → (ratified ICP version) → Market Intelligence
      → Prospect Intelligence → Prospect Qualification → [Engagement Intelligence]
      → [Next Best Action] → Engagement Outcome → [Lifecycle Intelligence]
```
Bracketed layers are GAPs.

| Layer | Owns | Consumes | Produces |
|---|---|---|---|
| Company Profile | tenant self-description | website, crawl, grounding | profile facts |
| Tenant ICP | ICP definition + ratified versions | company profile | ICP version (immutable once ratified) |
| MarketPulse | `market_pulse_findings`, actions, automation settings | market analyses | findings and recommended actions |
| Prospect Intelligence | prospect attributes, enrichment, evidence | sources, claims, enrichment providers | prospect intelligence surface |
| Qualification | `prospect_icp_qualifications`, score evaluations | ICP version + prospect intelligence | qualification + priority score |
| Engagement Intelligence (GAP) | engagement interpretation | attempts, delivery, outcomes, threads | engagement state, NBA |
| Lifecycle Intelligence (GAP) | transitions | outcomes + engagement | ledger rows |

**Scoring stays authoritative and unduplicated.** `SCORING_RULES_VERSION = 'pi-score.1'`
is confirmed at `backend/services/intelligence/canonical/scoring.ts:44`. The weights
stated by the brief — Intent 35 / Opportunity 30 / Urgency 20 / ICP 15 — are taken as
authoritative; I confirmed `BUYING_WEIGHT = 0.35` in `buyerIntentIntelligenceService.ts:11`
and the comment at `scoring.ts:24` that "Prioritization WEIGHTS live inside" the
prioritization module, but **I did not read all four weights in one place —
UNVERIFIED as a set.** Separately, `METHOD_WEIGHT = {deterministic: 1.0,
probabilistic: 0.8, ai_reasoned: 0.7}` governs evidence agreement and is a different
axis from the four priority weights. **No duplicate scoring engine may be created.**

**Feedback direction — GAP.** Engagement outcomes do not currently update prospect
intelligence or scoring; `prospect_score_evaluations` records evaluations, and only
score evaluations and ratified ICP versions are safe to reference historically
(membership, qualification and curation actively destroy selection history).

---

## 16. Customer / Account / Expansion intelligence

**Status: GAP — entirely absent.** No product adoption, engagement health, account
health, expansion, cross-sell, upsell, renewal-risk, advocacy or referral intelligence
exists for prospects-turned-customers. `platform_usage_events` exists and is a
plausible adoption-signal source — **UNVERIFIED** as to whether it carries the needed
grain.

**Recommended classification — a combination, with clear ownership:**

| Capability | Grain | Owner |
|---|---|---|
| product adoption | account + person | Account Intelligence (new), reading usage events |
| engagement health | person, rolled to account | Engagement Intelligence |
| account health | account | Account Intelligence |
| expansion / cross-sell / upsell | account | Account Intelligence + ICP |
| renewal risk | account | Account Intelligence |
| advocacy / referral | person | Engagement Intelligence |
| the state itself | account *and* person | Lifecycle Intelligence |

**The decisive architectural point:** post-sale must **extend `pi.lifecycle.1`, not
fork it**, and must attach to the **same `unified_persons` / `prospect_accounts`
spine**. A separate customer table would create the second CRM this gate exists to
prevent. Since the lifecycle ledger is append-only and version-tagged
(`PROSPECT_LIFECYCLE_VERSION`), adding post-sale states is a vocabulary extension
under a new version — the cleanest available path. **Account-level lifecycle is new
and needs its own ratification.**

---

## 17. Governance

The frozen sequence applies to **every** channel:

```
kill switch → suppression → region → eligibility/approval → rate limit → transport
   → channel-specific resolution (recipient, sender, render) → provider
```

| Control | Status |
|---|---|
| DNC / suppression (`outreach_suppressions`, canonical `mayContact`, fail-closed; recipient/lead/task/channel scopes) | IMPLEMENTED |
| region restriction | IMPLEMENTED |
| eligibility + approval (additive composition, existing authority) | IMPLEMENTED |
| autonomy `HUMAN | ASSISTED | AUTONOMOUS` — dispatch permission only | IMPLEMENTED |
| rate limit / quota, person- and tenant-keyed, daily | IMPLEMENTED; no hourly, no ramp |
| channel availability (`transportRegistry`; `enabledChannels` per tenant; `suppression.channel_not_enabled`) | IMPLEMENTED |
| unsubscribe | **PARTIAL** — a modelled outcome, unwritable, no link, **and it does not feed suppression** (deliberately out of prior scope: "an ingestion path that can add suppressions is a governance change") |
| complaint | **GAP** |
| sender restrictions | **NOT FOUND** |
| lifecycle restrictions | **GAP** |

**No channel may invent a governance bypass.** `G-06`: unsubscribe not feeding
suppression is a compliance exposure that grows the moment inbound exists — it should
be closed as part of the observability gate, as an explicit governance change.

---

## 18. Tenant Isolation

| Asset | Mechanism | Status |
|---|---|---|
| identity (person, account, claims, duplicates) | `company_id`/`organization_id` NOT NULL; composite FK `(id, company_id)` on merges; `FORCE ROW LEVEL SECURITY` on `canonical_leads`; tenant-scoped unique indexes on email and phone | IMPLEMENTED |
| prospects, lists, curation, campaigns, targets | tenant columns throughout | IMPLEMENTED |
| engagement threads | `organization_id` | IMPLEMENTED |
| engagement messages | **transitive only via `thread_id`** | **G-04 GAP** |
| execution chain | tenant columns; the 040 handoff is UNIQUE on `(organization_id, outreach_task_id)` and read tenant-first | IMPLEMENTED |
| delivery evidence | `company_id` (**text**, a type asymmetry against uuid tenants elsewhere — do not paper over it in a join) | IMPLEMENTED |
| content evidence | `organization_id` uuid + uuid-to-uuid DB guard | IMPLEMENTED |
| sender domains / provider identities | — | NOT FOUND (future; must be tenant-scoped, with a composite guard so a sender cannot reference another tenant's domain) |
| lifecycle | tenant-scoped ledger | IMPLEMENTED |
| intelligence | — | future; must be tenant-scoped at creation |

**Drishiq Labs is NOT a privileged tenant.** It is the legal owner of Omnivyra and is
subject to every rule above. I found no owner/company special case anywhere in the
identity, engagement, outreach, workflow or email chain, and none may be introduced —
including for sending domains, where Drishiq Labs must verify its own domain like any
other tenant. No tenant may read another tenant's prospects, people, accounts,
conversations, messages, senders, domains, credentials, provider identities, delivery
evidence, intelligence or lifecycle.

---

## 19. Canonical Event Model

No event bus is proposed and none was created. Classification only.

| Event | Status | Where |
|---|---|---|
| `prospect_created` / `prospect_updated` | IMPLEMENTED (implicit — row state, not an event) | `canonical_leads` |
| `identity_resolved` | IMPLEMENTED (implicit) | `identityResolutionService` |
| `icp_qualified` | IMPLEMENTED (implicit) | `prospect_icp_qualifications` |
| `outreach_planned` | IMPLEMENTED | Plan/Step/Task creation |
| `outreach_approved` | IMPLEMENTED | approval authority |
| `message_prepared` | IMPLEMENTED | content evidence (pre-send) |
| `message_sent` | IMPLEMENTED | attempt outcome `sent` + delivery evidence |
| `delivery_confirmed` / `delivery_failed` / `bounce` | **schema ready, producer MISSING** | `outreach_delivery_evidence` |
| `complaint` | **MISSING** | — |
| `opened` / `clicked` | **UNOBSERVABLE** by declaration | `UNOBSERVABLE_BUSINESS_OUTCOMES` |
| `replied` / `positive_reply` / `negative_reply` | `replied` modelled but unwritable; sentiment split **MISSING** | `feedbackIngestion` |
| `meeting_booked` | modelled, **UNOBSERVABLE**, yet a `CONVERSION_TYPE` | `feedbackSummary` |
| `opportunity_created` / `customer_converted` | `converted` modelled; opportunity axis is the separate `opportunity_lifecycle_states` | — |
| `adoption_signal` / `expansion_signal` | **MISSING** | — |
| `unsubscribe` | modelled, unwritable, **not wired to suppression** | — |
| `suppression` | IMPLEMENTED | `outreach_suppressions` |
| `lifecycle_transition` | IMPLEMENTED (ledger) but **no engagement-driven producer** | `prospect_lifecycle_transitions` |

**Should become canonical later:** delivery, bounce, complaint, reply and sentiment,
unsubscribe, lifecycle transition, adoption and expansion.
**Should remain channel-specific:** provider receipts, session windows, template
approval states, transcripts.

---

## 20. Data Ownership Matrix

| Capability | Canonical owner | Reads | Writes | Tenant scoped | Channel neutral |
|---|---|---|---|---|---|
| Company Profile | company profile services | website, crawl, grounding | profile | yes | yes |
| ICP | tenant ICP + ratified versions | company profile | ICP versions | yes | yes |
| MarketPulse | `market_pulse_*` | market analyses | findings, actions | yes | yes |
| Prospect Intelligence | PI services | sources, claims, enrichment | prospect surface | yes | yes |
| Identity | `unified_persons`, `prospect_accounts`, `identity_claims` | sources, ingestion | canonical identity, merges | yes | **yes** |
| Lifecycle | `prospect_lifecycle_transitions` | outcomes (future) | transitions | yes | yes |
| Engagement | `engagement_threads` / `_messages` | provider inbound, outbound execution | threads, messages | yes (messages transitively — G-04) | **yes by schema**, social-only in code |
| Engagement Intelligence | **GAP** | attempts, delivery, outcomes, threads, lifecycle, ICP | derived state, NBA | must be | yes |
| Workflow | `workflows`, `workflow_versions`, execution chain | definitions | plans, steps, tasks, settlement | yes | **yes** |
| Common Outreach | `leadOutreachExecution/*` | governance config, suppression, quota | tasks, attempts, delivery evidence | yes | **yes** |
| Email Engine | `emailEngine/*` | handoff, person, content | content evidence, transport call | yes | no (email) |
| WhatsApp / SMS / Social / Voice Engine | **GAP** (registry is the extension point) | — | — | must be | no |
| Deliverability Intelligence | **GAP** | delivery evidence, attempts, domain state, provider limits | advisory recommendations | must be | no (per channel) |
| Content Intelligence | `responseAdapter` + `ai_message_drafts` (generation only) | PI, ICP, lifecycle, history | drafts | yes | yes |
| Provider adapter | per provider | credentials | provider calls | yes (credentials) | no |
| Delivery evidence | `outreach_delivery_evidence` | provider events | delivery rows | yes | **yes** |
| Conversation | `engagement_*` — **the only one** | — | — | yes | yes |
| Customer / Account Intelligence | **GAP** | usage, engagement, lifecycle | account state | must be | yes |

---

## 21. Architectural Gaps

| ID | Gap | Current state | Evidence | Consequence | Sev | Owner | Blocks target? | Schema? | Service? | Deferrable? |
|---|---|---|---|---|---|---|---|---|---|---|
| **G-05** | **Outcome observability** | `ingestFeedback` has no caller; `pages/api/webhooks/` holds only payments; `opened`/`clicked`/`meeting_booked` declared unobservable | `feedbackIngestion.ts`, `types.ts` `UNOBSERVABLE_BUSINESS_OUTCOMES` | **every intelligence layer has nothing to learn from** | **CRITICAL** | Common Outreach + channel engines | **YES** | no (evidence schema ready) | yes | **no** |
| G-02 | Lifecycle has no engagement producer | no importer of `prospectLifecycle/*` outside the module | repo-wide search | lifecycle never reflects engagement; `engaged` unreachable from a reply | HIGH | Lifecycle Intelligence | yes | no | yes | no |
| G-04 | `engagement_messages` lacks `organization_id` | tenant scope transitive via `thread_id` | baseline schema | cross-tenant leak risk on an unstated join invariant | HIGH (security) | Engagement | yes | **yes** (additive) | yes | no |
| G-07 | No Engagement Intelligence layer | nothing computes engagement state | §6 | no NBA, no channel choice, no optimization | HIGH | new component | yes | likely | yes | after G-05 |
| G-03 | No post-sale lifecycle | `pi.lifecycle.1` ends at `meeting_scheduled` | `stateModel.ts` | customer/adoption/expansion unrepresentable | HIGH | Lifecycle Intelligence | for the full vision | vocabulary + version | yes | yes |
| G-08 | No tenant sending domain / sender identity | zero `sending_domain`/`sender_identity`/`reply_to`/`mail_from` for email | repo-wide search | tenants cannot send as themselves; replies cannot route to them | HIGH | Email + platform | for Email product | yes | yes | no |
| G-09 | No inbound path, any channel | no inbound route; no MX | `pages/api/webhooks/` | no conversation, no reply, no AI reply | HIGH | channel engines | yes | no (threads exist) | yes | no |
| G-06 | Unsubscribe not wired to suppression | modelled outcome, unwritable, deliberately unwired | `WS3-OPERATIONS.md` | compliance exposure once inbound exists | HIGH | Common Outreach (governance change) | no | no | yes | no |
| G-01 | `external_keys` vs `identity_claims` duality | both exist; dual-write + shadow modules present | `identityResolutionService.ts`, `externalIdentityDualWrite.ts` | channel identities could land in an unconstrained jsonb → second identity store | MED | Identity | risk, not blocker | eventual | yes | yes |
| G-10 | No deliverability intelligence | only prospect-side SPF/DMARC reading, DKIM unprobed | `emailAuthService` | tenant cannot be told whether its domain is ready | MED | Deliverability Intelligence | no | likely | yes | yes |
| G-11 | No content evaluation / learning | generation exists; scoring and learning do not | §8 | no optimization, no spam-risk insight | MED | Content Intelligence | no | likely | yes | yes |
| G-12 | No Customer/Account Intelligence | absent; `platform_usage_events` grain UNVERIFIED | §16 | no expansion, no renewal risk | MED | new component | for post-sale vision | yes | yes | yes |
| G-13 | No cross-channel unified relationship view | threads are per-platform | §5 | no single relationship picture | MED | Engagement Intelligence | no | no | yes | yes |
| G-14 | No Engagement Orchestrator | nothing translates a recommendation into an Instance | §9 | intelligence cannot act | MED | new component | after G-07 | no | yes | yes |
| G-15 | Sender restrictions / lifecycle restrictions absent from governance | not modelled | §17 | a suspended sender or lifecycle state cannot gate contact | LOW–MED | Common Outreach | no | yes | yes | yes |

No gap was fixed.

---

## 22. Decisions Required

1. **Is Engagement the canonical cross-channel conversation/history layer?**
   Recommend **YES** — extend `engagement_*`; `platform` has no CHECK, so it is already
   permissive. Never a second conversation model.
2. **Is lifecycle a shared cross-channel lifecycle?** Recommend **YES**, one
   `prospect_lifecycle_transitions` ledger. Channel activity is *evidence for* a
   transition, never its own lifecycle.
3. **Is Engagement Intelligence a distinct layer above channel execution?** Recommend
   **YES**, read-mostly, recommendation-only, writing no execution state.
4. **One canonical person/account identity across channels?** Recommend **YES** —
   `unified_persons` + `prospect_accounts`, with `identity_claims` as the channel
   identity surface. Decide specifically **how WhatsApp is claimed** (`phone` vs
   `external_id` + `platform='whatsapp'`); recommend `phone` plus an `external_id`
   claim when a provider-specific id exists.
5. **Where does next-best-action live?** Engagement & Lifecycle Intelligence
   (recommends); the Orchestrator translates; Workflow executes.
6. **Where does deliverability intelligence live?** A distinct component reading
   delivery evidence and sending-domain state; **enforcement stays in Common Outreach
   quota**.
7. **Where does content intelligence live?** Above the channel engines, reusing
   `responseAdapter` and `ai_message_drafts`. No second generator.
8. **Where does customer/expansion intelligence live?** Account Intelligence, on the
   same identity spine, with lifecycle extended rather than forked.
9. **Where does cross-channel orchestration live?** A new Engagement Orchestrator
   between Intelligence and Common Outreach. It must not govern or transport.
10. **Does Common Outreach remain the governance authority?** **YES — unchanged.**
11. **Does Workflow remain the execution authority?** **YES — unchanged.**
12. **Do channel engines remain transport/execution authorities?** **YES**, and they
    must stay behind `transportRegistry`.
13. **How do inbound events enter the canonical model?** Provider event → correlate on
    `(company_id, provider, provider_message_id)` → thread → message; **fail closed**
    when uncorrelated.
14. **How do outbound provider ids map to Engagement?** Via
    `outreach_delivery_evidence.provider_message_id` mirrored to
    `engagement_messages.platform_message_id`. **Not** `outreach_attempts`.
15. **When do lifecycle transitions occur?** On ratified outcome events, debounced by
    the writer (the ledger deliberately permits `state = previous_state`).
16. **Which signals are recommendations vs automatic?** Automatic: unsubscribe,
    suppression, `no_response` by elapsed rule. Recommended: everything commercial.
17. **Where is human ratification mandatory?** First contact with a new person,
    commercial lifecycle transitions, sender configuration changes, and any autonomy
    increase.
18. **How does Email become the template?** By generalizing four things only — the
    bridge, the governance order, pre-send attempt-keyed evidence, and provider-id
    correlation. Rendering, recipient and sender resolution stay per-engine.
19. **Minimum architecture before WhatsApp/SMS/Social/Voice?** G-05 outcome
    observability, G-04 message tenant column, G-09 one inbound path proven end-to-end
    on Email, and channel consent in suppression. Without these, each new channel
    becomes a silo by default.
20. **What should explicitly NOT be built?** See §24.

---

## 23. Recommended Future Implementation Sequence

Dependency-ordered. The ordering principle: **observability before intelligence**,
because every intelligence capability learns from signals that cannot currently be
recorded.

| # | Gate | Layer | Closes | Why here |
|---|---|---|---|---|
| **1** | **Outcome observability** — provider event ingestion into `outreach_delivery_evidence` (`source='provider_webhook'`, `provider_event_id`), giving `ingestFeedback` its first caller; plus unsubscribe → suppression as an explicit governance change | provider integration + analytics | **G-05**, G-06 | nothing downstream can learn without it; schema is already ready |
| 2 | Engagement message tenant column + the attempt↔message linkage | schema | **G-04**, part of G-13 | security, and it is the join every later layer depends on |
| 3 | Email inbound + `platform='email'` threads | inbound | **G-09** | proves the inbound model once, on the governed channel |
| 4 | Tenant sending domain + sender identity + resolution | schema + channel execution | **G-08** | required before real tenant volume; W2-P characterized it |
| 5 | Lifecycle producers from outcomes | lifecycle | **G-02** | first intelligence that is cheap and high-value |
| 6 | Engagement Intelligence v1 (engagement state, channel performance) | intelligence | **G-07** | first point where signals exist to learn from |
| 7 | Deliverability Intelligence | intelligence | **G-10** | needs bounce/complaint history from gate 1 |
| 8 | Content Intelligence (evaluation + learning) | intelligence | **G-11** | needs reply/conversion data |
| 9 | Engagement Orchestrator + NBA | architecture + intelligence | **G-14** | needs 6, 7, 8 |
| 10 | Second channel (WhatsApp or SMS) via `transportRegistry` | channel execution | — | proves the template; silo-free only after 1–3 |
| 11 | Post-sale lifecycle + Account Intelligence | lifecycle + intelligence | **G-03**, G-12 | extends, never forks |
| 12 | Optimization (warm-up, ramp, automatic variant selection) | optimization | G-15 | last; needs every signal above |

**Smallest safe next implementation gate: #1, outcome observability.** It is additive,
needs no new schema (the evidence table already carries `provider`,
`provider_message_id`, `provider_event_id` and a `provider_webhook` source), it unblocks
the largest number of gaps, and it is the only gate whose absence makes everything
after it unmeasurable. **It should be scoped alongside the W2-A/W1 provider work, not
after the intelligence layer.**

---

## 24. Explicit Non-Goals

Must NOT be built: a second conversation or message model (including any
email-specific thread table); a second lifecycle (post-sale extends
`pi.lifecycle.1`); a channel-specific identity system (channel identities are
`identity_claims`); a second scoring engine (`pi-score.1` remains authoritative,
weights unchanged); a channel-specific Workflow engine; any direct-to-provider path
bypassing Common Outreach; a per-channel suppression or consent store; an event bus
(not yet); warm-up or reputation management (gate 12); open/click tracking (declared
unobservable — do not fabricate); a Customer Intelligence system in this gate; any
Drishiq Labs privilege; and any silent fallback from a tenant sender to the platform
sender or `EMAIL_FROM`.

Also not goals now: WhatsApp/SMS/Social/Voice providers, DNS or SES configuration, an
AI composer or reply assistant, UI of any kind, speculative adapters or abstractions.

---

## 25. Final Architecture Diagram

Legend: `[✓]` exists · `[~]` partially implemented · `[+]` future extension point ·
`[!]` architectural gap

```
                        COMPANY PROFILE  [✓]
                              │
                              ▼
                         TENANT ICP  [✓]  (+ ratified versions [✓])
                              │
                              ▼
                        MARKETPULSE  [~]  (tables + findings loop ✓;
                              │            prospect enrichment available:false)
                              ▼
                   PROSPECT INTELLIGENCE  [✓]
                              │
                              ▼
            CANONICAL PERSON / ACCOUNT  [✓]
            unified_persons · prospect_accounts
            identity_claims  [✓ channel-neutral spine]
            (external_keys duality  [!] G-01)
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │   ENGAGEMENT & LIFECYCLE             │
            │          INTELLIGENCE                │
            │                                      │
            │ • engagement intelligence   [!] G-07 │
            │ • content intelligence      [~] gen  │
            │                                 only │
            │ • deliverability            [!] G-10 │
            │ • lifecycle intelligence    [~] ledger
            │                             ✓, no    │
            │                             producer │
            │                             [!] G-02 │
            │ • next-best-action          [!] G-07 │
            └──────────────┬───────────────────────┘
                           │
                           ▼
              ENGAGEMENT ORCHESTRATOR  [!] G-14
                           │
                           ▼
                  COMMON OUTREACH  [✓ FROZEN]
         kill switch → suppression → region →
         eligibility/approval → rate limit → transport
                           │
        ┌──────────────────┼───────────────────┐
        ▼                  ▼                   ▼
   WORKFLOW [✓]      GOVERNANCE [✓]      CHANNEL ENGINE
   FROZEN            unsubscribe→         via transportRegistry [✓]
   10 channels       suppression [!] G-06        │
   named [✓]                                    │
        ┌───────────┬───────────┬───────────┬───┴──────┐
        ▼           ▼           ▼           ▼          ▼
      EMAIL      WHATSAPP      SMS       SOCIAL      VOICE
      [✓]         [!]          [!]        [~]         [!]
   sender/domain                       inbound
   [!] G-08                            partial
        │           │           │           │          │
        └───────────┴───────────┴───────────┴──────────┘
                           │
                           ▼
                 PROVIDER / NETWORK  [✓ email: SES]
                           │
                           ▼
              DELIVERY / RESPONSE
      outreach_delivery_evidence [✓ schema]
      UNIQUE (company_id, provider, provider_message_id) [✓]
      provider_webhook producer  [!] G-05  ← THE GATING GAP
                           │
                           ▼
                 ENGAGEMENT  [~]
      engagement_threads [✓] · engagement_messages [✓]
      platform has NO CHECK → email permissible [✓]
      no organization_id [!] G-04 · no attempt link [!]
      inbound path [!] G-09
                           │
                           ▼
            LIFECYCLE INTELLIGENCE  [~]
      prospect_lifecycle_transitions [✓ append-only ledger]
      pi.lifecycle.1, 7 pre-sale states [✓]
      no post-sale states [!] G-03
                           │
                           ▼
              NEXT BEST ACTION  [!] G-07/G-14
                           │
                           ▼
      CUSTOMER / EXPANSION / ADVOCACY / REFERRAL  [!] G-12
```

---

## 26. Gate Status

**READY FOR OWNER DECISION.**

**Success criterion answered.** Omnivyra maintains one canonical prospect/customer
relationship through `unified_persons` + `prospect_accounts`, with `identity_claims`
as the already-channel-neutral surface on which a person acquires an email address, a
phone number, a WhatsApp identity, a social profile and a future voice-reachable
number. One lifecycle ledger (`prospect_lifecycle_transitions`, `pi.lifecycle.1`,
append-only) records relationship state, extended for post-sale rather than forked.
One engagement history (`engagement_threads` / `engagement_messages`, whose `platform`
column carries no CHECK and is therefore already multi-channel) records every
conversation, correlated to outbound execution through
`outreach_delivery_evidence.provider_message_id` under its tenant-scoped unique index.
One intelligence layer sits above execution and **recommends**; one Orchestrator
translates; Workflow **executes**; Common Outreach **governs** every channel through
the single frozen gate order; and channel engines **transport**, each reachable only by
registering with `transportRegistry`, which is the one place a channel becomes
dispatchable. Email is the reference implementation of that stack, and the four things
that generalize from it are the bridge, the governance order, pre-send attempt-keyed
evidence, and provider-id correlation.

**What this gate changes about the plan.** The intelligence layer is not the next thing
to build. **Outcome observability is** — because `ingestFeedback` has no caller,
`opened`/`clicked`/`meeting_booked` are declared unobservable, and `meeting_booked` is
simultaneously the conversion signal. Until provider events can be recorded, every
capability in §6–§10 would be built on nothing.

**Production status: PRODUCTION UNTOUCHED.** No provider call, no DNS, no AWS/SES, no
deployment, no flag change, no migration, no production read.

**Repository status: READ-ONLY CHARACTERIZATION.** No source, schema, migration, API,
UI or test file was created, edited or deleted. This report is the only file added, as
required by §25. Verified by hash: `governance.ts 5982e2eb5a1f4199`,
`dispatch.ts 4cee6514d36c371e`, `workflowStore.ts 27c53b4f55984059`,
`emailSendPath.ts 93de4f27df09e29c`,
`send-transactional-email/index.ts be613b99153a4032`; HEAD `7febdb28`,
tracked-modified 60, untracked 88 (89 with this report), migrations 434.

**No implementation is authorized by this gate.**
