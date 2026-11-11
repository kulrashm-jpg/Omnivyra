# Outreach Management Platform: current-state audit

Status 2026-11-03. Read-only audit of `integration/outreach-engines-20261102` (code at d682ab13 = origin/main 5025f51d + orchestration recovery c74404c7, contract 0.2.0 + the five engine branches). Nothing was built, run against a provider, or changed outside this folder.

**How this was produced.** Six read-only audits ran in parallel: content and AI services; campaigns, inbox and UX; email; billing; registries, contracts and governance; PI audience and conversation context. Each cited `path:line` it read. I re-checked by hand the claims that change a decision: the AI cache tenant scoping, the wallet self-heal, the SES diagnostic logging, the L-3 scheduler path and the L-4 enqueue path. The rest is agent-read and not independently re-verified. Old root-level `*_COMPLETE.md` files were not treated as evidence.

**Bottom line.**
- **The execution backbone for outreach exists.** It runs from `prospect_lists` and `prospect_campaigns`, through workflows and `execution_*`, to the five engine adapters and `journeyReport`, and it is tested on real PostgreSQL. **It has no user interface at all.**
- **No engine produces AI-written outreach content.** Email fills nine approved fields deterministically. WhatsApp sends approved templates by name. Community text comes from an external service.
- **A reusable AI content core exists but is aimed at social and long-form content.** It is the gateway, the generation runtime, brand voice, and the edit-command pattern.
- **The repository holds many competing models:** six campaign entities, two audience models, four reply generators, four approval stores, at least seven template stores, seven status vocabularies, five kill switches and three suppression stores. The main risk for this programme is adding an eighth of something.

## 1. Current-state evidence inventory

### Content and AI
- **Gateway.** `aiGatewayProvidersOps.ts:645` `runCompletionWithOperation` is the single LLM entry. It handles abuse guard, plan-tier model, cost block, bring-your-own key, request merging, token limits, cache and usage logging. Routing is in `aiModelRouter.ts`.
- **Charging.** Credits are taken only through `billing/runBilledAiCompletion.ts`, which has five callers. The gateway's own billing guard only observes unless `BILLING_REQUIRE_AI_HANDLE=true`. `/api/posts/generate`, `/api/threads/generate`, `/api/content/regenerate`, `/api/content/improve-draft` and `/api/ai/generate-content` charge nothing.
- **Generation core.** `contentGeneration/blueprintGenerator.ts:670` `generateMasterContentFromIntent`; `platformVariantGenerator.ts:926` `buildPlatformVariantsFromMaster`. The convergence seam is `content/runtime/generationRuntime.ts` with its contract at `runtime/contracts.ts:135-175`; `persist:false` makes it a pure generator. It is behind flags that all default OFF. Content types are fixed to post, thread, blog, article and story.
- **Conversational edit.** `campaign/campaignContentAssistService.ts:14-41` has twelve edit commands (shorten, more executive, better CTA and so on). It is billed and grounded in company context, and returns proposals only. UI: `components/planner/ContentWorkspace.tsx`. Draft state is held in the client and nothing keeps chat history on the server.
- **Brand and context.** `brand/resolveBrandVoice.ts`, `lib/content/companyContextBlock*`, the regulated-industry prompt context and the grounding guard.
- **Channel formatting.** `lib/content/platformAdaptationProfiles.ts` covers 10 social platforms only. Nothing formats or validates email, WhatsApp, SMS or a voice script.
- **Versioning and approval.** Legacy `content_assets` is live and ungated. The canonical `content`, `content_variant`, `content_revision` and `content_approval_history` tables exist, but writes to them are blocked by default (`canonicalPersistencePolicy.ts`).
- **Outreach content today.** `emailEngine/emailContentGenerator.ts:119-159` fills `{{field}}` placeholders from the 041-D allow-list (`:37-40`, nine `unified_persons` columns). It refuses `unauthorized_personalization` and `personalization_missing`. WhatsApp sends a template by name with no parameters. Community `suggested_text` comes from the external Omnivyra service (`communityAiOmnivyraService.ts`).
- **Voice.** `ChatVoiceButton` posts to `/api/voice/transcribe` (speech to text). `TTSPlayer` uses the browser's speech API. Nothing generates or places calls.

### Reactive engagement
- **Conversation store.** `engagement_threads` and `engagement_messages` (System 1). The WhatsApp webhook processor writes inbound messages here. Email replies never arrive: there is no Reply-To and no SES inbound.
- **UI.** `/engagement` uses `InboxDashboard`, ThreadView, ReplyComposer, AISuggestionPanel, assignment and reply lock. A second inbox, `/engagement-inbox`, sits on another table and is not in the navigation. `/whatsapp/inbox` posts replies that `/api/engagement/reply` refuses, because WhatsApp is not in `lib/engagementCapabilities.ts:70-79`.
- **Reply generators.** There are four:
  - `engagementAiAssistantService.ts:417-470`: thread history and company profile, plus the F5 actionability gate.
  - `/api/engagement/generate-response`: queues `engagement_response` to `unifiedContentGenerationEngine.generateEngagementResponse`, which returns a hard-coded placeholder (`:865-869`).
  - `responseOrchestrator`: has no UI.
  - `/api/engagement/refine-suggestion`.

  `replyGenerationService` is dormant.
- **Person context.** `getProspectDetail` (`apiHandlers/prospects/prospectIntelligenceRead.ts:294`) is the best single PI read. `orchestration/individualIntelligence.ts` returns gating facts only, never values.
- **Cross-channel history.** No per-person conversation read model exists. Nothing at runtime writes `engagement_threads.unified_person_id`; it is set only by a backfill migration and a merge function. New threads and WhatsApp threads are therefore invisible to the person timeline.

### Campaigns, audience and sequences
- **Outreach campaign.** `prospect_campaigns` and its targets (`20261226000000`, `20261231000000`), with selection and enrolment under `pages/api/prospect-campaigns/*`. Tested on real PostgreSQL in `orch_campaign_targets`. No UI calls it.
- **Audience.** `prospect_lists` (LISTS-001, keyed on `canonical_leads`), with the `readAudiencePage` seam, which has no callers. It competes with LC-301 `audiences`, which is keyed by text lead key and feeds `gtm_campaigns`. Both call themselves canonical, and neither has a UI.
- **Sequence.** `workflows`, `workflow_versions`, `execution_instances`, `execution_plan_steps`, `execution_tasks` and `execution_engine_requests`. No UI. Step content is only the step `instruction`; the template entity (J-5) is deferred.
- **Social content campaigns.** `campaigns`, the planner, BOLT and `scheduled_posts`. These are content-shaped. The `prospect_campaigns` migration records in writing why it does not reuse them.
- **Analytics.** `orchestration/journeyReport.ts` is the right read model and has no UI. `outreach_outcomes.task_id` is NOT NULL, so outcomes from engines other than WS-3 have nowhere to go.

### Channels, providers and governance
- **Live registry.** `ENGINE_NAMES` / `buildAdapterRegistry` (`engineAdapters.ts:68,292`), together with `engineCapabilities.ts`. Every external provider is declared `verification:'mocked'`.
- **Unwired or out-of-domain models.**
  - `channelCapabilityModel.ts`: test-only, and stale.
  - `providerCapabilityModel.ts`: PI's four-layer model. It has an `engagement` kind that no provider uses yet.
  - `PROVIDER_CATALOG` and `providerHealthService`: LLM, SEO and analytics providers only.
  - `platform_registry`: social only.
  - `pages/integrations/outreach.tsx`: static copy.
- **Gates.** `journeyGovernance.channelRefusal` and `journeyPolicy.channelPermissionFact` fail closed. `outreach_governance_config` has no application writer: enabling a channel is script-only.
- **Suppression.** `contact_governance_records` is canonical and verified for email and WhatsApp. SMS and voice targets would be casefolded rather than phone-normalised (`contactGovernanceRepository.ts:57-61`). No store records a recipient's positive consent; `consent_records` holds a tenant's consent to an integration and must not be read as recipient consent.
- **Webhooks.** SES/SNS and the Meta webhook each verify, deduplicate and store durably before acknowledging, each in their own way. There is no shared contract.

### Email
- **Send path.** `leadOutreachExecution/emailTransport.ts` is behind a flag that is off. The request carries no From, no Reply-To and no configuration set. The edge function `send-transactional-email` uses one platform `EMAIL_FROM` and one `SES_CONFIGURATION_SET`. Its temporary diagnostics log only region names (I checked); they should still go.
- **Tenant sending domains (W4).** These are **merged on main as PR #304** (my earlier memory said "uncommitted"; that was wrong): `sendingDomains/*`, `/api/sending-domains`, `tenant_sending_domains`. What is missing:
  - nothing creates the per-tenant configuration sets;
  - `runSendingDomainRefresh` has no caller;
  - `validateSender` is not wired into sending;
  - there is no UI and no remove route;
  - there is no custom MAIL FROM, so SPF does not align.
- **Not built at all:** mailboxes, domain provisioning, warm-up, reputation metrics, auto-pause, open and click tracking, reply ingestion, and a postal address in the footer.
- **Events.** SES Delivery, Bounce, Complaint and Reject are ingested. **A complaint is stored as evidence `delivered`**, because there is no complaint status. Open, Click and DeliveryDelay are dropped. An unsubscribe writes a governance record but no `unsubscribed` outcome, so the journey timeline never shows it.
- **Unsubscribe.** Token, route, one-click and headers are implemented. The keys are not provisioned.

### Billing
- **Ledger.** One ledger: `credit_transactions` plus the `organization_credits` wallet, written only by the SQL function `apply_credit_reservation`, which is idempotent and locks the wallet row. The function's behaviour has no real-schema test.
- **Charging API.** `executeWithCredits`; `reserveCreditsForWork` with `confirmCreditReservationToActual` or `releaseCreditReservation`; and `deductCreditsAwaited` with a multiplier.
- **No outreach charging.** No channel has a credit action or a `credit_cost_config` row. `voice_per_minute` exists but nothing charges it. Community execution logs usage with no cost, which `logUsageEvent` refuses.
- **No add-ons.** There is no add-on or managed-service kind in checkout; it accepts `subscription` or `topup` only.
- **Plan limits.** Three resources only. WhatsApp hard-codes its own `free/pro/enterprise` limits and calls `increment_wa_usage`, which no migration defines.
- **Wallet self-heal.** The rebuild path in `creditProjectionReconciler.ts` is the gated self-heal kept after the 2026-07-09 incident (bf7261d6). It runs only when the wallet row is missing or negative, and refuses to overwrite a healthy row. It is not an outreach concern.

## 2. Capability matrix (existing against required)

Owner is the domain that should own the capability under the boundaries in the brief, section 8. Verification is the strongest evidence that exists: real PG = disposable PostgreSQL test; unit = mocks.

| Capability | Existing implementation | Reusable components | Gaps | Owner | Dependencies | Verification | Classification |
|---|---|---|---|---|---|---|---|
| AI model access and routing | `aiGatewayProvidersOps.ts:645`, `aiModelRouter.ts` | All of it | No channel or recipient notion | Platform AI | Provider keys | unit | IMPLEMENTED — NOT VERIFIED |
| AI usage charging | `runBilledAiCompletion.ts` (5 callers) | Hold, run, partial confirm | Several generation routes unbilled; enforcement flag off | Billing | C-1 | unit | PARTIALLY IMPLEMENTED |
| Generation core | `generationRuntime.ts`, `blueprintGenerator.ts:670`, `platformVariantGenerator.ts:926` | Pure-generator mode, stages, originality | Five fixed content types; runtime flags off | Content | Gateway | unit | IMPLEMENTED — INTEGRATION REQUIRED |
| Conversational editing | `campaignContentAssistService.ts:14-41`, `/api/campaign-content/assist` | Command and proposal pattern, billing, grounding | Single-shot; no server-side session; social-only commands | Content (Outreach extends) | Gateway | unit | PARTIALLY IMPLEMENTED |
| Brand voice and company guidance | `resolveBrandVoice.ts`, `companyContextBlock*` | Yes | Voice only, no outreach rules | Brand / Content | — | unit | IMPLEMENTED — NOT VERIFIED |
| Channel formatting and validation | `platformAdaptationProfiles.ts` (10 social) | Social profiles | Email, WhatsApp, SMS, voice script missing | Outreach | — | unit (social) | MISSING for outreach channels |
| Personalization allow-list | `emailContentGenerator.ts:37-40,86-103` (041-D) | The only approved-attribute notion; refuses unknown or missing fields | Email only; no provenance at render; deterministic | PI (list), Outreach (render) | `unified_persons` | real PG (email journey) | PARTIALLY IMPLEMENTED |
| Field provenance | `attributeAuthority*`, `sourcePrecedence.ts`, `source_assertions` | Per-observation source and confidence | No read API giving value + source + confidence | PI | — | real PG `li1_attribute_surface` | IMPLEMENTED — INTEGRATION REQUIRED |
| Templates and blocks | 6 stores + `gtm_messages`; `whatsappTemplateService.ts:61-224` | WhatsApp template submission | None used by any generator | Content / Outreach | — | partial | IMPLEMENTED — NOT VERIFIED (fragmented) |
| Variants and quality evaluation | `platformVariantGenerator`, `content/qualityEngine.ts` | Variant and quality pattern | Social and long-form criteria only | Content | — | unit | IMPLEMENTED — NOT VERIFIED |
| Content versioning, approval, audit | `content_assets` (live); `content`/`content_revision`/`content_approval_history` (writes off) | Canonical model | Canonical writes blocked; outreach uses `outreach_approvals` | Content | Persistence flag | unit | PARTIALLY IMPLEMENTED |
| AI-written outreach content | None in any engine | — | Everything | Outreach | All of the above | — | MISSING |
| AI cache safety for personalised text | `aiResponseCache.ts:40,437-457`: near-match is tenant-scoped, Jaccard 0.80 | Exact-only mode (`isExactOnlyOp`) | Within one tenant, a similar request could be served another recipient's text | Platform AI | — | none | Risk to close before any personalised generation |
| Conversation store | `engagement_threads`/`messages`; WhatsApp inbound writer | Assignment, reply lock, triage | No email inbound; no runtime person link | Engagement | Inbound email | real PG (upsert targets only) | PARTIALLY IMPLEMENTED |
| Inbox UI | `/engagement` (System 1) | Thread view, composer, AI panel | WhatsApp reply refused; System 2 duplicate | Engagement | — | unit | IMPLEMENTED — NOT VERIFIED |
| AI reply suggestion | `engagementAiAssistantService.ts:417-470` + 3 others | F5 gate, thread memory | No PI facts, no journey context, no email or WhatsApp; one path is a placeholder | Engagement → Outreach content | Person context | unit | PARTIALLY IMPLEMENTED (fragmented) |
| Person context for AI | `getProspectDetail:294`; `individualIntelligence.ts` | State-wrapped sections | Heavy; no approved-field projection | PI | — | unit | IMPLEMENTED — NOT VERIFIED |
| Cross-channel conversation per person | none | `journeyEvents.ts` "one view, no second log" pattern | Read model and runtime thread-to-person writer | PI + Engagement | Inbound email | — | MISSING |
| Intent, sentiment, STOP | `engagementConversationIntelligenceService`, `whatsappOptOut.ts` | STOP to governance writer | No reply classifier for WS-3; STOP scope WhatsApp-only | Engagement / Outreach | — | real PG (STOP) | PARTIALLY IMPLEMENTED |
| Outreach campaign entity | `prospect_campaigns` + targets | Tenant-safe FKs, preview, immutable targets | No UI; no paused or completed states | PI / Orchestration | ICP, lists | real PG `orch_campaign_targets` | IMPLEMENTED — INTEGRATION REQUIRED |
| Audience selection | `prospect_lists`, `readAudiencePage`, `campaignSelectionService` | Seam, ICP evaluator | No UI; competes with LC-301 `audiences` | PI | `canonical_leads` | real PG | IMPLEMENTED — INTEGRATION REQUIRED |
| Sequences and journeys | workflows + `execution_*`, sweeper, adapters | Versioned definitions, per-step state, approval preview | No authoring UI; no step-content entity (J-5) | Orchestration | Engines | real PG (4 suites) | IMPLEMENTED — INTEGRATION REQUIRED |
| Outbound approval | `outreach_approvals` (super-admin route only), `execution_approvals` (dry-run), community status | CAS approval, `CommunityActionsView` tabs | No tenant approval route or queue | Orchestration (+ owner decision) | — | unit | PARTIALLY IMPLEMENTED |
| Outreach analytics | `journeyReport.ts`, `feedbackSummary.ts` | Right read model | No UI; outcomes outside WS-3 have no store | Orchestration + Outreach | G-4 | real PG | IMPLEMENTED — INTEGRATION REQUIRED |
| Channel readiness | `engineCapabilities.ts`, `providerCapabilityModel.ts`, `connectionState.ts`, `channelRefusal` | Together they express all six target states | No derived read; outreach providers not in PI's model | Orchestration (contract) + PI (model) | — | unit | PARTIALLY IMPLEMENTED |
| Tenant and channel enablement | `outreach_governance_config`, `channelRefusal` | Gate | No app writer | Orchestration + WS-3 | — | real PG | IMPLEMENTED — INTEGRATION REQUIRED |
| Recipient consent | none (`consent_records` means something else) | — | Everything | Owner + counsel | — | — | MISSING |
| Webhook handling | `pages/api/webhooks/ses.ts`, `pages/api/whatsapp/webhook/index.ts` | Both patterns | No shared contract | Outreach (per engine) | — | unit | IMPLEMENTED (no contract) |
| Email send | `emailTransport.ts`, edge function | Port, fail-closed outcomes, evidence | No per-tenant From or configuration set; flag off; never sent for real | Outreach | SES production access | real PG, recording provider | IMPLEMENTED — INTEGRATION REQUIRED |
| Sending domains and DNS | W4 `sendingDomainService.ts`, `sesV2IdentityAdapter.ts`, `checkEmailAuth` | Nearly all | Configuration sets, refresh cron, `validateSender` wiring, UI, MAIL FROM, DMARC parsing | Outreach | AWS | unit | IMPLEMENTED — INTEGRATION REQUIRED |
| Mailboxes, domain provisioning, warm-up | none | — | All | Outreach | Owner decision | — | MISSING |
| Limits and capacity | `quota.ts`, `evaluateRateLimit` | Reserve-and-reconcile | Not per domain or mailbox; SES quota not read | Outreach | — | unit | PARTIALLY IMPLEMENTED |
| Reputation and auto-pause | `health.ts` (accept rate only), kill switches | Kill switch | Bounce and complaint rates, thresholds, auto-pause | Outreach | Events | — | MISSING |
| Email event tracking | `ingestSesEvent`, `outreach_delivery_evidence`, `outreach_outcomes` | Canonical ledger with provider ids and provenance | Complaint stored as delivered; open and click missing; unsubscribe not an outcome; replies manual only | Outreach | Configuration-set events | unit + real PG | PARTIALLY IMPLEMENTED |
| Unsubscribe | Token, route, RFC 8058, headers | Yes | Keys not provisioned | Outreach | Keys | unit | IMPLEMENTED — INTEGRATION REQUIRED |
| Compliance footer | Unsubscribe link only | — | Postal address, sender identity | Outreach + counsel | Counsel | — | MISSING |
| Email erasure and retention | Design only | — | E-1..E-5 | Owner + counsel | RC erasure migrations | — | BLOCKED (decision) |
| WhatsApp | Broadcast service, journey adapter, webhook | Send path, STOP, webhook | WA-1/2/3, L-4, no send-once claim, `increment_wa_usage` missing, 3 send paths | Outreach | Meta, tenant approval (B-6) | real PG, Meta stubbed | PARTIALLY IMPLEMENTED |
| Social publishing | Publishers for 6 platforms + Facebook partial; journey observes only | Publish, authorization | Cron authorization fix branch-only; G-5 | Outreach | Platform permissions | real PG, fake provider | IMPLEMENTED — INTEGRATION REQUIRED |
| Community engagement | Executor, scheduler, adapter (refuses) | Claim, F5, approvals | L-3, B-7, acting-account proof, usage refused | Outreach | Identity decisions | refusal paths real PG | PARTIALLY IMPLEMENTED |
| Browser automation | RPA worker under community | Hardened on branch | GAP-03, GAP-17 legal, no account identity | Outreach | Owner decision | fakes | IMPLEMENTED — NOT VERIFIED |
| SMS | Contract fixtures only | Contract shapes | All runtime | Outreach | Vendor, counsel | fixture unit test | MISSING (contract-compatible) |
| Voice | Speech-to-text input only; fixtures | Contract shapes, `/api/voice/transcribe` | All runtime | Outreach | Vendor, counsel | fixture unit test | MISSING (contract-compatible) |
| Credit ledger | `apply_credit_reservation`, `executeWithCredits`, reserve/confirm | Single idempotent writer | Behaviour has no real-schema test | Billing | — | grants-only real PG | IMPLEMENTED — NOT VERIFIED |
| Channel charging | none | `reserveCreditsForWork`, `deductCreditsAwaited(multiplier)` | Credit actions, catalogue rows, registry entries | Billing + Outreach | C-1 | — | MISSING |
| Separately priced services | Checkout `subscription`/`topup` only | `billing_price_overrides` keyed by SKU | No add-on kind | Billing | Owner decision | — | MISSING |
| Per-channel plan limits | `plan_limits` (3 resources) | Mechanism | Channel resources; WhatsApp hard-codes its own plan names | Billing | — | unit | PARTIALLY IMPLEMENTED |

## 3. Duplicates and conflicts register

| Area | Competing items | Recommendation |
|---|---|---|
| Campaign entities (6) | `campaigns` (social), `prospect_campaigns`, `gtm_campaigns`, `whatsapp_broadcasts`, `outreach_plans`, `customer_activation_outreach` | `prospect_campaigns` is the outreach campaign. Leave `campaigns` for social content. Retire `gtm_campaigns` and `outreach_plans` (owner). A WhatsApp broadcast becomes an engine behind a journey step, not a campaign |
| Audience (2) | `prospect_lists` vs LC-301 `audiences` | `prospect_lists` (keyed on canonical identity, tested on real PG). Owner retires or bridges LC-301 |
| Sequence (2, plus a name collision) | workflows/`execution_*` vs the content plan hierarchy; "orchestration" names both | Journeys are workflows. Rename or document the content-side "orchestration" views |
| Dispatch stacks (2) | WS-3 + engines vs W5 `executionBridge` (email, dry-run, own approvals and suppression) | Retire W5 (owner) |
| Approvals (4) | `outreach_approvals`, `execution_approvals`, `community_ai_actions.status`, content approval | One approval queue reading the existing stores, no new store |
| Reply generators (4) | `engagementAiAssistantService`, the `engagement_response` placeholder, `responseOrchestrator`, `refine-suggestion` | Keep the first, behind Outreach content intelligence. Retire the placeholder path |
| Inboxes (3 UIs) | `/engagement`, `/engagement-inbox`, `/whatsapp/inbox` | `/engagement` only |
| Templates (7+) | `content_templates`, `block_templates`, `strategy_templates`, creator templates, `whatsapp_templates`, `response_templates`, `gtm_messages` | Outreach templates live in the canonical content model; `whatsapp_templates` stays as Meta's approval mirror |
| Content models (2) | `content_assets` vs `content`/`content_revision` | Canonical model (Content owner decides the switch) |
| Status vocabularies (7) | channelCapabilityModel, providerCapabilityModel, providerHealth, connectionState, integrationCapabilities, `outreach.tsx`, contract error classes | No new enum. Derive readiness from the contract and PI's model; delete or derive `channelCapabilityModel` |
| Channel names (12+ enums) | `phone` vs `voice` vs `call`; `social` vs `social_post`; no `community` in the capability model | Owner decides `phone` or `voice`, then one change per listed file |
| Kill switches (5) | `LEAD_OUTREACH_EXECUTION_DISABLED` + config, `GTM_*` + `execution_controls`, `GLOBAL_AUTOMATION_DISABLED`, provider kill flags, billing kill switch | Keep the orchestration gate plus engine switches; retire `GTM_*` with W5 |
| Suppression (3) | `contact_governance_records`, `outreach_suppressions`, `suppression_entries` | Canonical only; legacy stores already prohibited for new dependencies |
| WhatsApp send paths (3) | Broadcast service, journey adapter, `platformAdapters/whatsappAdapter.ts` (environment-variable recipient) | Journey adapter over the broadcast service; retire the platform adapter |
| Plan models | `plan_limits`, WhatsApp `PLAN_LIMITS` (free/pro/enterprise), WS-3 config limits | `plan_limits` for entitlements; engine config for operational caps |
| Credit action lists (2) | `creditDeductionService.ts` (48) vs `featureRegistry.ts` (25) | Billing reconciles; channel actions go into both |
| Person-to-thread link (3) | `unified_person_id` (backfill only), `contact_id` → contact, WhatsApp phone key | One runtime writer (PI identity) |
| Account connection pages (2) | `/community-ai/connectors` vs `/social-platforms` | Owner picks one |

## 4. Defects found along the way

Not in scope to fix here. Each is recorded for its owner.

| Finding | Where | Effect | Owner |
|---|---|---|---|
| A complaint is stored as `delivered` evidence | SES ingestion | Complaints are invisible in delivery evidence; the governance record is still written | Outreach (email) |
| Email unsubscribe writes no outcome | `unsubscribeService.ts` | The journey timeline never shows it | Outreach (email) |
| `engagement_response` returns a placeholder after a credit check | `unifiedContentGenerationEngine.ts:865-869`, `contentGenerationProcessor.ts:540-556` | Users of `/engagement-inbox` get canned text, possibly charged | Engagement |
| `/api/content/regenerate` attributes AI cost to `UNKNOWN_ORG` and is unbilled | `contentAssetService.ts:79` | Usage misattributed | Content |
| `/api/ai/gpt-chat` and `/api/ai/claude-chat` bypass the gateway | `gpt-chat.ts:80`, `claude-chat.ts:240` | Unmetered, unguarded model calls if called (no UI importer) | Platform AI |
| Community usage events refused for having no cost | `communityAiActionExecutorRuntime.ts:91-115` | Usage missing; cost-anomaly noise | Outreach (community) |
| `increment_wa_usage` not defined in any migration | `whatsappRateLimiter.ts:105` | WhatsApp usage never counted | Outreach (WhatsApp) |
| `blog_generation`, `image_generation`, `video_generation`, `skeleton_command` have no registry entry | `featureRegistry.ts` | Would throw once credit enforcement is on (inferred) | Billing |
| Credit CI guard not run anywhere | `scripts/audit/no-direct-credit-deductions.ts` | Direct database-function calls go unnoticed | Billing |
| Personalised text could be near-matched within a tenant | `aiResponseCache.ts` | `engagement_reply_suggestions` may serve a similar thread's reply | Platform AI |
| `pages/integrations/outreach.tsx` copy is stale | `:63,122` | Says domains are not built; W4 exists | Outreach |
| Temporary diagnostics in the SES edge function | `send-transactional-email/index.ts:345-354,444-453` | Logs region names and hard-locks SES v1 to one region | Outreach (email) |
