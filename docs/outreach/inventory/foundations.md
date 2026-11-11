# Cross-engine foundations inventory

Ref: `feat/orchestration-recovery` dc7f2ae3 (worktree `C:/tmp/orch-recovery`), baseline `origin/main` 5025f51d. All paths are relative to that tree. Every "on main" statement came from `git cat-file -e origin/main:<path>` or `git ls-tree origin/main`.

**Method limits.** Read-only. Nothing was run, so no test result here is mine. Test results quoted are from `docs/orchestration/VERIFICATION-AND-BLOCKERS.md` at f7ff85d0 and were not repeated. Production was not read. Owner workstream labels are **inferences** from directory, code headers and the common brief, unless a header states the owner.

## READ FIRST: the worktree moved during this inventory

**The recovery worktree is no longer clean, and I did not change it.** `git status` at 01:37 shows 12 modified files and 6 new ones, with mtimes from 01:31 onward, so another session is working there now. HEAD is still dc7f2ae3.

- **This report describes committed HEAD dc7f2ae3.** All line numbers were pinned with `git show HEAD:` or `git grep HEAD`. My early reads were taken from disk before the edits began. Files read from disk later were checked against HEAD where they are cited.
- **New, uncommitted:** `orchestration/executionContract.ts`, `engineCapabilities.ts`, `journeyEvents.ts`, `journeyExit.ts`, `journeyGovernance.ts`, `pages/api/execution-instances/[id]/events.ts`.
- **Modified, uncommitted:** all adapters, `engineAdapters.ts`, `journeyPolicy.ts`, `individualIntelligence.ts`, `journeyReport.ts`, the sweeper, `workflowStore.ts`, two execution-instance routes.
- **By their headers, they address** F-1 (three identities), F-2 (journey events as a read view), F-12 (central channel refusal) and part of F-9 (`creditMetered`). I only read those headers. I did not review or verify them, and this report does not assess them. If that work is the coordinator's, treat the matching gaps as being addressed, and re-check F-5 and the SMS/voice conflicts against it.
- `docs/orchestration/contract/`, named in the new contract header, does not exist on disk at the time of this check.

## 0. Headline findings

1. **There is no engine / provider / action separation.** Engine identity exists (`ENGINE_NAMES`). Outreach provider identity does not exist as a registry, only as free text on results and rows. Execution action type does not exist on the contract at all. The channel stands in for all three, and `buildAdapterRegistry` allows exactly one adapter per channel.
2. **`orchestrationEventService` and `orchestrationEventSubscriptions` are not journey infrastructure.** They are CKRE-004 knowledge-refresh code (`orchestrationEventSubscriptions.ts:1-8`, commit 4d432222). Neither the sweeper nor any adapter imports them. Journey events currently have no event model. The decision log is the only durable journey record.
3. **No correlation ID crosses the engine contract.** `EngineStepContext` and `EngineResult` have none (`engineAdapters.ts:69-98`), and a grep of `engineAdapters.ts`, the sweeper, `dispatch.ts`, `whatsappBroadcastService.ts` and WS-3 telemetry finds no `correlationId`.
4. **Usage and credit are absent from outreach.** A grep for `credit|deduct` in WS-3 dispatch and quota, the WhatsApp service and adapter, and the email engine returns nothing. `journeyReport.ts:16-17` says no engine records a per-action cost. Messaging providers are also absent from `PROVIDER_CATALOG`, and no email or WhatsApp path calls the cost governor.
5. **Several memory and doc claims are stale or wrong**, listed in section 9. The main ones:
   - Integration Hub phases 1-4 are committed and on main (33288cd2). `C:/tmp/r1-ctx` no longer exists.
   - The discovery registry is no longer empty.
   - `suppression_entries` is not write-dead.
   - `channelCapabilityModel` still says WhatsApp has no inbound path.

---

## 1. Capability table

Vocabulary: **Main** = on origin/main. **Branch** = recovery branch only. "PG" = real PostgreSQL suite, per the record doc. "Fake" = unit suite with injected fakes.

| # | Capability | Classification | State | Where | Exact location and symbols | Migrations | Tests | Ancestry |
|---|---|---|---|---|---|---|---|---|
| 1a | Engine identity and adapter registry | IMPLEMENTED — INTEGRATION REQUIRED | integrated; flag off, cron unscheduled | Branch | `orchestration/engineAdapters.ts:65` `ENGINE_NAMES`, `:261` `buildAdapterRegistry`; `workflowProgressionSweeper.ts:213-218` `realAdapters` | 20261230000000, 20261231000001 | `orchestrationEngineContract.test.ts` (reads the SQL CHECK; fake); `orch_engines_real` (PG) | Branch commits, not on main |
| 1b | Authorable channel vocabulary | IMPLEMENTED — INTEGRATION REQUIRED | duplicated (TS + SQL) | Branch | `workflows/workflowStore.ts:98` `WORKFLOW_STEP_CHANNELS`; SQL copy in `wf_publish` at `20261231000004:110` | 20261227000000, 20261231000004 | `orch_campaign_targets` (PG) | Branch |
| 1c | WS-3 transport registry | IMPLEMENTED AND VERIFIED for internal; email only with a recording provider | integrated | Main, extended on branch | `leadOutreachExecution/transport.ts`, `transportRegistry.ts:37` | 20260913000000, 20260914000000 | `ws3Milestone5a/5b` (fake), `pi_email_send_path_041a` (PG, recording provider) | Main + branch diff |
| 1d | Outreach channel capability model | PARTIALLY IMPLEMENTED | stale; not read by any dispatch path | Main | `leadOutreachExecution/channelCapabilityModel.ts`; **its only importer is its own test** (`git grep -l`) | none | `piChannelCapabilityModel.test.ts` (no DB) | Main |
| 1e | Data-provider capability model | IMPLEMENTED — NOT VERIFIED (externally) | integrated, Integration Hub | Main | `integrations/providerCapabilityModel.ts:112,287` | none | `phase2CapabilityModel.test.ts` | 33288cd2 on main |
| 1f | Discovery provider registry | IMPLEMENTED — NOT VERIFIED | integrated; one provider | Main | `prospectDiscovery/providerRegistry.ts:58`, `adapters/index.ts:46`, called at `pages/api/prospect-sources/discovery.ts:140` | 20261121000000 | `phase4ApolloDiscovery.test.ts` (mock) | Main |
| 1g | Provider cost catalog and governor | IMPLEMENTED AND VERIFIED for intelligence calls (inference from the wiring in its header; not re-checked) | integrated; does not cover messaging | Main | `providers/providerCatalog.ts:88`, `providerCostGovernor.ts:38,123` | `cost_events` 20260522 | not inspected | Main |
| 1h | Social publisher routing | IMPLEMENTED — NOT VERIFIED here | integrated; outside orchestration | Main | `backend/adapters/platformAdapter.ts`, `backend/services/platformRegistryService.ts` | `social_accounts` etc. | not inspected (engine agents) | Main |
| 2a | Sweeper and dispatch | IMPLEMENTED AND VERIFIED, on PG only | integrated; off | Branch | `workflowProgressionSweeper.ts:299` registry, `:372-377` unsupported, `:456` `adapter.execute`; `pages/api/cron/workflow-execution-progression.ts:62` | 20261228* | `orch_journey_lifecycle`, `orch_response_matrix`, `orch_engines_real` (PG, providers stubbed) | Branch |
| 2b | Engine request ledger | IMPLEMENTED AND VERIFIED, on PG only | integrated | Branch | table in 20261230000000; used by WhatsApp, social, community, browser adapters | 20261230000000, 20261231000001 | `orch_engines_real` (PG) | Branch |
| 2c | Journey decision record | IMPLEMENTED AND VERIFIED, on PG only | integrated | Branch | `journeyDecisionLog.ts` | 20270120000000 | `orch_journey_lifecycle` (PG) | Branch (f7ff85d0 lineage) |
| 2d | Journey exit (`journeyResponses`) | PARTIALLY IMPLEMENTED | integrated; hard-coded to two engines | Branch | `journeyResponses.ts:43-48` port, `:30` `JOURNEY_EXIT_OUTCOMES` | none of its own | `orch_response_matrix` (PG) | Branch |
| 2e | Feedback to PI (`journeyFeedback`) | PARTIALLY IMPLEMENTED | integrated; WS-3 + WhatsApp only | Branch | `journeyFeedback.ts:50,98` | `prospect_lifecycle_transitions` on main | `orch_journey_lifecycle` (PG) | Branch |
| 3a | Delivery and business outcome model | IMPLEMENTED AND VERIFIED for WS-3 on PG | integrated, WS-3 only | Main | `leadOutreachExecution/types.ts:61`, `feedbackIngestion.ts`; `outreach_outcomes.task_id NOT NULL` | 20260910000000, 20260915000000 | `ws3Milestone7Feedback` (fake), `orch_response_matrix` (PG) | Main |
| 3b | Journey lifecycle event model | MISSING | n/a | n/a | No event type, no outbox, no version field for journey or engine events. See section 3 | none | none | n/a |
| 3c | Correlation convention | PARTIALLY IMPLEMENTED | exists at request level; not on the contract | Main | `requestContext.ts:96`; `executionAuditService.ts:17` | n/a | not inspected | Main |
| 4a | Tenant provider credentials | IMPLEMENTED — NOT VERIFIED against a provider | integrated for PI; no outreach consumer | Main | `integrationCredentialService.ts:231,293,322`; `enrichment/providers/credentials.ts`; `apiHandlers/prospects/leadSourceCredentials.ts` (A3P); `pages/api/prospect-sources/credentials.ts` | 20260677, 20261014000000 | `integration_credentials` (PG), `piA3mTenantCredentials`, `piA3pLeadSourceCredentialApi` | Main |
| 4b | Social/WhatsApp OAuth tokens | IMPLEMENTED — NOT VERIFIED here | competing store | Main | `backend/auth/tokenStore.ts`; `social_accounts` incl. `phone_number_id` | 20260625 | not inspected | Main |
| 4c | Platform provider accounts | IMPLEMENTED — NOT VERIFIED here | platform-owned, separate domain | Main | `providerAccountService.ts`, `providerCredentialResolver.ts` | 20260509 | not inspected | Main |
| 4d | Encryption | IMPLEMENTED — NOT VERIFIED here | shared | Main | `auth/credentialEncryption.ts:22` `requireEncryptionKey`; AES-256-GCM | n/a | not inspected | Main |
| 4e | Step-up for credentials | IMPLEMENTED — INTEGRATION REQUIRED | platform-level only; UI fix not on this branch | Main (policy); a4f52cbc not ancestor of HEAD | `security/stepup/StepUpPolicyRegistry.ts:89-90`; `OUTREACH_PLATFORM_MANAGE` used by `pages/api/super-admin/outreach/activate.ts` | n/a | `providerCredentialStepUp.dom.test.tsx` on a4f52cbc | a4f52cbc only touches `ApiCatalogSection.tsx` + a DOM test |
| 5a | Connection state for OAuth connections | IMPLEMENTED — NOT VERIFIED here | integrated, social + analytics | Main | `integrations/connectionState.ts`, `healthProbeService.ts`, `oauthLifecycleScheduler.ts` | 20260625 | not inspected | Main |
| 5b | Config-derived provider health | IMPLEMENTED — NOT VERIFIED here | integrated; no messaging entries | Main | `providers/providerHealthService.ts` (no live probe, in-process timestamps) | none | not inspected | Main |
| 5c | CMS integration health | IMPLEMENTED — NOT VERIFIED here | separate, CMS only | Main | `integrationHealthService.ts`, `pages/api/integrations/[id]/health.ts`, `pages/api/cron/integration-health-sweep.ts` | 20260677/78 | not inspected | Main |
| 5d | Engine availability model | MISSING | n/a | n/a | `EngineAdapter` has no health or availability method; the sweeper asks nothing before `execute` | none | none | n/a |
| 6a | Canonical contact governance | IMPLEMENTED AND VERIFIED on PG | integrated, 4 evaluation paths | Main | `prospectIdentity/contactGovernance.ts:213` `mayContact`, `contactGovernanceWriter.ts:163`, `contactGovernanceEvaluation.ts:246` | 20261003000000, 20261126000000 | `li3_contact_governance`, `li3d_governance_writer` (PG) | Main |
| 6b | `outreach_suppressions` | IMPLEMENTED — NOT VERIFIED; no writer | parked read (fail-closed input) | Main | read only at `governanceService.ts:198` | 20260912000000 | `ws3Milestone4Governance` (fake) | Main |
| 6c | `suppression_entries` | PARTIALLY IMPLEMENTED | legacy, still written by operator route | Main | `execution/suppressionService.ts:124,566` | 20260727030000 | not inspected | Main |
| 6d | Positive consent | MISSING | n/a | n/a | `consent_records` is OAuth/capability consent (`suppressionService.ts:41-43`). No per-person, per-channel opt-in store found | none | none | n/a |
| 6e | WhatsApp STOP to governance | IMPLEMENTED — NOT VERIFIED over real HTTP | integrated | Branch | `whatsappOptOut.ts`; `whatsappWebhookProcessor.ts:103-105` | none | `whatsappStopOptOut` (fake), `orch_engines_real` (PG) | e652d356 lineage |
| 7a | Credit ledger and wallet | IMPLEMENTED — not re-verified here | integrated; no outreach consumer | Main | `creditExecutionService*.ts` `executeWithCredits`, `creditDeductionService.ts` (utilities only) | 20260321, 20260322, 20260631, 20260634 | not inspected | Main |
| 7b | Enrichment/discovery cost port | IMPLEMENTED — NOT VERIFIED | integrated, PI only; tenant-funded | Main | `enrichment/providers/cost.ts`, `enrichment/productionPorts.ts:80,101` | 20261015, 20261016, 20261121 | `a7_provider_call_state` (PG) | Main |
| 7c | Outreach usage/credit | MISSING | n/a | n/a | Empty grep; `journeyReport.ts:16-17` | none | none | n/a |
| 7d | Outreach quota | IMPLEMENTED AND VERIFIED for DB layer; Redis stubbed | integrated, WS-3 only | Main | `leadOutreachExecution/quota.ts`; `dispatch.ts:40,271,313,355,376`; `daily_limit_*` on `outreach_governance_config` | 20260912000000 | `ws3Milestone5a` (fake) | Main |
| 7e | WhatsApp rate limiter | IMPLEMENTED — NOT VERIFIED | separate two-layer limiter | Main | `whatsappRateLimiter.ts` | `database/whatsapp_system.sql` (outside the chain, per B-10) | not inspected | Main |
| 7f | GTM execution quota | PARTIALLY IMPLEMENTED | dry-run only | Main | `execution/executionQuotaService.ts` | n/a (Redis) | not inspected | Main |
| 7g | Provider token buckets | IMPLEMENTED — not re-verified | LLM planner only (inference from Redis key prefix and pool wording) | Main | `providerTokenBucket.ts`, `distributedProviderTokenBucket.ts` | none | not inspected | Main |
| 8a | HTTP idempotency | IMPLEMENTED — not re-verified | integrated; 44 importing files | Main | `middleware/withIdempotency.ts:236,240,246` | 20260420, 20260916000000 | `withIdempotencyCallerScoping`, `withIdempotencyStaleLock` | Main |
| 8b | Per-task execution idempotency | IMPLEMENTED AND VERIFIED on PG | integrated | Branch (+ WS-3 on main) | ledger unique key; `outreach_bridge_handoffs`; `outreach_attempts_unique`; `TransportRequest.idempotencyKey` | 20261230000000, 20261229000000, 20260910000000 | `orch_engines_real`, `orch_response_matrix` (PG) | Mixed |
| 8c | Uncertainty handling | IMPLEMENTED AND VERIFIED on PG for WhatsApp; fake for community | integrated | Branch; PI ledger on main | ledger `uncertain`; `communityEngineAdapter.ts:534-597`; `dispatch.ts:67,237` `blocked_prior_attempt`; `enrichment/attempts.ts` `PROVIDER_CALL_STATES` | 20261230000000, 20261016000000 | `orch_engines_real`, `a7_provider_call_state` (PG) | Mixed |
| 8d | Retry utilities | scattered; no shared outreach utility | duplicated | Main | see section 8 | n/a | n/a | Main |
| 9a | Webhook verification | scheme-specific; no shared helper for provider webhooks | duplicated | Main | see section 3.3 | n/a | `wp3SesWebhook`, `wp3SesCertificateFetch` (no real SNS) | Main |
| 9b | Event normalization | IMPLEMENTED — NOT VERIFIED over real provider HTTP | one per provider | Main (SES), Main+Branch (WhatsApp) | `providerEvents/sesEventNormalizer.ts`, `sesProviderEventIngestion.ts`, `whatsappWebhookProcessor.ts` | 20260915000000 | `orch_response_matrix`, `orch_engines_real` (PG) | Mixed |
| 10a | Journey analytics | IMPLEMENTED AND VERIFIED on PG; no cost | derived read | Branch | `journeyReport.ts` | none | `orch_journey_lifecycle` (PG) | Branch |
| 10b | WS-3 feedback summary | IMPLEMENTED — not re-verified | integrated | Main | `leadOutreachExecution/feedbackSummary.ts:28` | none | not inspected | Main |
| 10c | WhatsApp counters | MOCKED / FAKE in effect | RPCs undefined in repo (B-11) | Main | `whatsappBroadcastService.ts:386,469` | none | none | Main |
| 10d | Outcome-to-campaign attribution | MISSING for outreach | website attribution exists separately | Main | `lead_attribution*`, `attribution_handoff*`, `attributionResolverService.ts`, `attributionReportingService.ts` are website/lead | 20260677, 20260701004000 | not inspected | Main |
| 11a | Global journey switch | IMPLEMENTED AND VERIFIED on PG | off | Branch | `pages/api/cron/workflow-execution-progression.ts:62` | n/a | not inspected | Branch |
| 11b | WS-3 global + tenant control | IMPLEMENTED AND VERIFIED | integrated; **no application writer** | Main | `governanceService.ts:120-123,152,177`; `governance.ts` `evaluateKillSwitch` | 20260912000000 | `ws3Milestone4Governance` (fake), `orch_response_matrix` (PG) | Main |
| 11c | GTM execution control | PARTIALLY IMPLEMENTED | duplicated; dry-run path only | Main | `execution/executionControlService.ts` | 20260727030000 | not inspected | Main |
| 11d | Feature flags per org | IMPLEMENTED — unused by outreach | available | Main | `featureFlagService.ts`; `feature_flags` | 20260522 | `a10FeatureFlagMetadata` | Main |
| 11e | Org controls | IMPLEMENTED — billing/org use | separate | Main | `orgControlService.ts`, `billing/orgFinancialControlService.ts`; `org_controls` | 20260518 | not inspected | Main |
| 12 | SMS and Voice | MISSING | vocabulary only | Main + Branch | section 11 | none | forbids-only tests | n/a |

---

## 2. Map of providers and adapters (item 1)

### 2.1 The three identities today

| Axis | Exists? | Where | Weakness |
|---|---|---|---|
| **Engine identity** | Yes, closed | `ENGINE_NAMES = ws3, whatsapp, social_publish, community, browser` (`engineAdapters.ts:65`); CHECK excludes `ws3` (20261231000001) | A new engine needs a code edit, a migration and a test update. The test ties them (`orchestrationEngineContract.test.ts:30-37`). The test reads one named migration file, so a later widening migration would have to change the test too |
| **Provider identity (outreach)** | No registry | Free text: `TransportResult.provider` (`transport.ts`), `outreach_outcomes.provider`, `social_accounts.platform`, `resolveProviderMessage(event.provider, ...)` | SES and Meta are implied by the code. Nothing declares them, and they appear in neither `PROVIDER_CATALOG` nor `providerCapabilityModel` entries with `engagement` (`channelCapabilityModel` header states no entry declares it) |
| **Execution action** | No | `EngineStepContext` has only `channel` and `step` (`engineAdapters.ts:69-80`); `outreach_tasks.kind/action` are free text; community actions have their own vocabulary | An engine infers the action from the channel. `WorkflowStep` has no action field (`workflowStore.ts:177-205`) |

**Channel-to-adapter is 1:1.** `buildAdapterRegistry` throws if two adapters claim one channel (`engineAdapters.ts:261-270`). `browser` claims no channel. A channel not in the map becomes the decision `unsupported` and the step stays ready (`workflowProgressionSweeper.ts:372-377`). So provider routing can only live inside an engine, and a tenant cannot choose between two engines for a channel.

### 2.2 Every registry found

| Registry | Location | Owner (inferred) | Holds | Consumers | One source for engines? |
|---|---|---|---|---|---|
| `ENGINE_NAMES`, `buildAdapterRegistry` | `orchestration/engineAdapters.ts` | Orchestration ("integration owner", `:62-64`) | Engine, channel | Sweeper, contract kit, tests | **Yes, for engine identity.** Needs capability and action data |
| `WORKFLOW_STEP_CHANNELS` | `workflows/workflowStore.ts:98` + `wf_publish` SQL | Orchestration | Authorable channels | Validator `:553`, contract tests | **Yes, for authorable channels.** Must stay separate from "engine exists" |
| `transport.ts` / `transportRegistry.ts` | `leadOutreachExecution/` | Outreach (WS-3) | Channel to transport, process-global, last registration wins (`transportRegistry.ts:19-25`) | `dispatch.ts`, `outreachBridgeStore.ts:288` | Inside WS-3 only. Competes as an SMS/voice seam |
| `CHANNEL_CAPABILITIES` | `leadOutreachExecution/channelCapabilityModel.ts` | Outreach/PI | send, deliveryReceipt, inboundReply, callDisposition, per channel | Tests | **Best existing shape for channel capability**, but stale and missing channels (section 9) |
| `PROVIDER_CAPABILITIES`, `OPERATIONAL_VERIFICATIONS` | `integrations/providerCapabilityModel.ts:112,287` | PI (Integration Hub) | Four independent layers; `engagement` kind declared | `dataSourceCatalogue.ts`, hub pages | **Best existing shape for provider state.** No outreach provider entered. Requires owner agreement |
| `ACQUISITION_SOURCES` | `enrichment/providers/sources.ts:163` | PI | Tenant provider identity, auth mode, funding | A3P, capability model | PI scope. Closed list validates credential writes, so an outreach provider cannot store a tenant key through A3P until added |
| `enrichment/providers/registry.ts` | | PI | Enrichment adapters | PI executor | No |
| `prospectDiscovery/providerRegistry.ts` | | PI | Discovery fetchers | Discovery executor | No. Its header still says it ships empty (section 9) |
| `leadIngestion/registry.ts` | | PI | Pure translators | Ingestion | No |
| `PROVIDER_CATALOG` | `providers/providerCatalog.ts:88` | Platform | Quota, cost, timeout, retry; categories have no messaging | Governor, health | **Yes for spend metadata**, if messaging is added. Owner decision |
| `aiGatewayCapabilities.ts:65` `PROVIDER_CAPABILITIES` | | Platform AI | LLM capabilities | AI gateway | No. **Same export name as the hub's model**, a naming hazard |
| `llmProviderService.ts`, `intelligence/providerRegistry.ts`, `companyIntelligence/providers/registry.ts`, `companyProfile/grounding/registry/providerRegistry.ts`, `evidencePlatform/providers/providerRegistry.ts`, `creator/rendering/providers/renderProviderRegistry.ts` | | Intelligence/Creator | Non-outreach | Own domains | No |
| `payments/orchestrator/providerRegistry.ts`, `billing/payments/paymentProviderAdapter.ts` | | Billing | Two payment registries | Payments | No. A separate duplicate pair, out of scope |
| `cms/registry.ts`, `connectors/listeningConnectorRegistry.ts`, `lib/integrations/integrationCatalog.ts`, `integrations/dataSourceCatalogue.ts`, `pages/api/social-platforms/registry.ts` | | Various | CMS, listening, onboarding presentation | Own domains | No |
| `platformRegistryService.ts` + `platform_registry` | | Social | Social-platform capability flags, in-memory fallback | Social, community | Provider data for the social engine only |
| `backend/adapters/platformAdapter.ts` | | Social publishing | Publisher dispatch. Direct imports, no factory | Publish queue | The social engine's internal routing |
| `executionEngines/index.ts`, `orchestration/routing/executionRoutingEngine.ts`, `orchestration/distributed/workflowStepRegistry.ts` | | Content | Creator/text engines, content routing, distributed queue steps | Content | **Not outreach.** Name collisions; the contract must not reuse these words loosely |

### 2.3 Transports and senders

| Sender | Provider | Reached by | Identity recorded |
|---|---|---|---|
| `leadOutreachExecution/emailTransport.ts` + `emailEngine/*` | SES through edge function `supabase/functions/send-transactional-email` (inference: the send function in the tree; provider wiring belongs to the email inventory) | WS-3 dispatch | `TransportResult.provider` |
| `internalTransport.ts` | Platform | WS-3 dispatch | `internal_work_item` |
| `whatsappBroadcastService.ts` | Meta | Adapter, plus main's broadcast route | `social_account`, broadcast rows |
| `execution/emailExecutionConnector.ts` | None, dry-run | `executionBridge.dispatchGuarded`, `pages/api/lead-intelligence/execution.ts` | Audit row |
| `emailService.ts`, `emailJobsService.ts` | Transactional | Account mail, ungoverned by design (`emailService.ts:40-60`) | Not outreach |

`sendingDomains/*` (20261220000000, tenant sending domains) has **no reference** from `leadOutreachExecution` or `emailEngine` (empty grep). Tenant sender identity is not connected to outreach sending.

---

## 3. Routes, queues, workers, events, accounting, other ways in

### 3.1 Sweeper and dispatch (item 2)

`POST /api/cron/workflow-execution-progression` (CRON_SECRET, then `WORKFLOW_ORCHESTRATION_ENABLED`, `:62`) calls `sweepWorkflowExecutionProgression`. No `vercel.json` entry, per runbook line 1117. Order per run:

`advance_execution_plan` → `unsupported` check (`:372`) → facts → journey exit → implicit channel permission and `when` conditions → frequency (`:441-449`) → `adapter.execute` (`:456`) → settle → `recordJourneyDecisions` → `feedRecentOutcomesToLifecycle`.

- **The only call to `execute`** in production code is `:456`. The `:209` hit is the lazy community wrapper.
- **Tenants** come only from `outreach_governance_config.enabled = true` (`:272-280`). A kill-switched tenant is still swept, and the engine refuses.
- **Dispositions**: `completed`, `skipped`, `wait`, `needs_human`. `failed` is never chosen.

**`execution_engine_requests`**

| Aspect | Value |
|---|---|
| States | `requested`, `submitting`, `submitted`, `completed`, `skipped`, `failed`, `uncertain` |
| Engines CHECK | `whatsapp`, `social_publish`, `community`, `browser`. Excludes `ws3` |
| Idempotency | `UNIQUE (organization_id, execution_task_id)` |
| Constraints | `submitted`/`completed` require `external_ref`; `detail` ≤ 500 chars |
| Trigger guard | Identity immutable, `external_ref` set once, settled states do not move. "Settled" includes `uncertain` |
| Open states | Partial index on `requested`, `submitting`, `submitted` |
| Not stored | Recipient, content, provider, cost, correlation, delivery status |

**Consequence of the guard.** An `uncertain` request can never be resolved in place. A human settlement that later proves delivery has nowhere to be recorded on this row.

**Decision log.** `execution_journey_decisions`, append-only, unique on `(organization_id, execution_instance_id, decision_key)`, key `planStep|decision|outcome`. Decisions: `executed`, `skipped`, `deferred`, `waiting`, `needs_human`, `unsupported`, `exited`. Written after the sweep, best effort. Recording never gates (`journeyDecisionLog.ts:9-11`).

**`journeyResponses`** reads only WS-3 outcomes and WhatsApp inbound. Its port (`:43-48`) has a method named per engine, so every new responding channel changes the shared port. Unreadable throws, which yields no contact that sweep (fail closed).

**`journeyFeedback`.** WS-3 is keyed on the row with a 72 h window and 100 per sweep. WhatsApp replies have no outcome row because `outreach_outcomes.task_id` is NOT NULL against `outreach_tasks`, and only replies to a live journey are seen (`journeyFeedback.ts:9-12`). Late replies on non-WS-3 channels are therefore lost to PI.

### 3.2 Lifecycle, events, correlation (item 3)

| Model | Location | Scope | Version field | Reusable for engines? |
|---|---|---|---|---|
| Task status, 17 values | `types.ts:30-48` | WS-3 | `execution_runtime_version` on the row | Mapping source |
| Delivery axis | `types.ts:61-70` | WS-3 | `FEEDBACK_VERSION` | **Best delivery vocabulary.** Keeps `sent_unverified` apart from `delivered` |
| Business axis | `types.ts:80-95` | WS-3 | `FEEDBACK_SCHEMA_VERSION = 1` (`feedbackSummary.ts:28`) | **Best outcome vocabulary.** Storage requires a WS-3 task |
| `FAILURE_CLASSES` | `failureTaxonomy.ts` | WS-3, closed | none | **Best error classification.** Not on `EngineResult` |
| `EngineResult` | `engineAdapters.ts:82-91` | All engines | none | Shared, thin; `outcome` is free text |
| Provider call state | `enrichment/attempts.ts` | PI | none | **Best uncertainty vocabulary**; `prospectDiscovery/contract.ts:48` rejects an `ambiguous` state on purpose |
| `orchestrationEventService` | `orchestrationEventService.ts` | CKRE knowledge | `SIGNUP_EVENT_SCHEMA_VERSION` reused | **No.** Eleven knowledge events, writes to `capability_audit_log` |
| `orchestrationEventSubscriptions` | same dir | CKRE | none | **No.** Pure table of knowledge/integration triggers |
| `orchestration/events/*` | same dir | Content assets, SSE, Redis stream | stream id | **No.** `AI_ASSET_*` events |
| `integrationEventService` | `integrationEventService.ts` | Connections; fail-soft | none | Possibly for connection timeline only |
| `domain_events`, `canonical_events` | 20260615, 20260421 | Not traced for outreach | not read | Not assessed. **I found no outreach producer in the files read; this is not proof of absence** |

**Outbox.** No outbox table was found by name search (`*outbox*`, `*event_log*`, `*event_stream*`). The migration list search was capped at 40 rows, so that scan of `*_events` tables is partial. Durable journey events: none. Consumers poll the source tables.

**Correlation.**

- `requestContext.ts:96-98` derives it from `x-correlation-id`, falling back to `requestId`.
- `withIdempotency` sets it from `requestId`.
- `resolveCrawlCorrelationId` is reused by knowledge orchestration (`orchestrationEventService.ts:58`).
- `dispatchGuarded` takes an optional `correlationId` (`executionBridge.ts:23`).
- Community execution tables have `correlation_id` columns (20260524).
- The journey path has none. `executionTaskId` is the natural key today (**inference**).

### 3.3 Inbound webhooks (item 9)

| Route | Provider | Verification | Helper | Dedup | Normalizer | Main? |
|---|---|---|---|---|---|---|
| `pages/api/webhooks/ses.ts` | AWS SNS / SES | RSA certificate signature, cert URL allow-rule, TopicArn allow-list, timestamp window; raw body; no bypass | `providerEvents/snsSignature.ts` `verifySnsSignature` | `feedbackIngestion` unique on provider event id | `sesEventNormalizer.ts` | Yes (96768805) |
| `pages/api/whatsapp/webhook/index.ts` | Meta | `X-Hub-Signature-256` HMAC, local `verifySignature` `:48`; GET verify token constant-time `:26` | Local | BullMQ `jobId = sha256(body)`; **returns 200 even on enqueue failure, and a shed enqueue is only logged** (`:105-114`) | `backend/queue/jobProcessors/whatsappWebhookProcessor.ts` | Route yes; processor changed on branch |
| `pages/api/stripe/webhook.ts` | Stripe | `verifyStripeWebhookSignature` | `payments/stripeWebhookService.ts:89` | Provider events | Own | Yes |
| `pages/api/webhooks/payments/[provider].ts` | Razorpay, Cashfree | Adapter `verifyWebhookSignature` | `payments/orchestrator/*Adapter.ts` | Idempotent fulfilment | Own | Yes |
| `pages/api/billing/settlement-webhook/[provider].ts` | Sandbox settlement | `verifyProviderWebhookSignature` | `billing/payments/paymentWebhookVerifier.ts` | Settlement state | Own | Yes |
| `pages/api/webhooks/razorpay-staging.ts` | none | Disabled stub | n/a | n/a | n/a | Yes |
| `pages/api/internal/{cms-reconciliation,lead,revenue}-webhook*` | Internal | RBAC + HMAC in body; `webhookSecurityService.verifyWebhookSignature` | **Generic shared HMAC helper** | `event_id` / `dedupe_key` | Own | Yes |
| `pages/api/extension/events*` | Browser extension | HMAC session, nonce, timestamp; **nonce map is in-process** (`extensionSessionService.ts:150-166`, `seenRequestNonces`) | `extensionSessionService` | Nonce | Own | Yes |
| `pages/api/community-ai/webhooks.ts` | **Not inbound** | Tenant-scoped CRUD of outbound webhook config | n/a | n/a | n/a | Yes |

**No shared provider-webhook helper exists for outreach.** `webhookSecurityService` is a good primitive for plain HMAC-hex but takes a string and is used by internal handoffs and `replayIngressService` only. Two-provider normalization has one `provider` parameter in `resolveProviderMessage` and `ingestFeedback`, which is the existing seam. `webhook_events` (20260677) has no writer among `backend` and `pages` files (grep showed billing references to a different table only).

### 3.4 Usage and credit

No outreach action debits or records cost. Enrichment and discovery use a **tenant-funded** port (`enrichment/productionPorts.ts:80,101`). The credit action list has no outreach, WhatsApp, email-send or SMS action in `activityEconomyCatalog.ts` or `creditDeductionService.ts` (empty grep). `voice_per_minute` is a voice interaction action (`creditDeductionService.ts:52`), and is not telephony (**inference** from its label and from no telephony code existing).

### 3.5 Ways to reach engines other than the adapter

| Path | Engine | Gate |
|---|---|---|
| `pages/api/super-admin/outreach/activate.ts`, `approve.ts` | WS-3 | Step-up, platform authority |
| `leadOutreachRecoverySweep.ts` | WS-3 | `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED` |
| `pages/api/lead-intelligence/execution.ts` | GTM bridge | Dry-run; also a suppression writer |
| Main's WhatsApp broadcast route | WhatsApp | Own auth (not inspected) |
| Publish queue, `publishNowService` | Social | Own |
| `pages/api/community-ai/actions/execute.ts`, `engagement/reply`, `like`, extension | Community | Own |

Engine-specific detail belongs to the per-engine inventories.

---

## 4. Compliance matrix, shared layer as a whole

| Field | Status | Where or from what |
|---|---|---|
| Engine identifier | **Satisfied** | `EngineAdapter.engine`, `EngineResult.engine`, ledger `engine`, decision `engine` |
| Capability declaration | **Mappable, partial** | `adapter.channels` only. Mappable from `CHANNEL_CAPABILITIES` once corrected, and `providerCapabilityModel` for provider state |
| Supported channels and action types | **Channels satisfied; action types missing** | `channels`, `WORKFLOW_STEP_CHANNELS`. No action field in context, step or result |
| Authorization context | **Missing as a field** | Doc comment says each engine's gates decide. Mappable from `execution_mode`, `requires_approval`, `outreach_decisions`, WS-3 approval log. WhatsApp `hasApproval` is hard-coded false (`whatsappEngineAdapter.ts:167`), by design |
| Tenant and prospect references | **Satisfied** | `organizationId`, `subject`, `personId` |
| Workflow and journey references | **Partial** | `executionInstanceId`, `executionTaskId`, `planStepId` on context; workflow id and version only through the snapshot, and not on the result |
| Recipient or destination | **Missing by design at contract level** | Engines resolve it. Ledger deliberately stores none. `TransportRequest.recipient` exists inside WS-3 |
| Rendered content or action payload | **Partial** | `step.instruction` for email; `email_outreach_content_evidence`; social step reference. No general payload |
| Idempotency key | **Satisfied by convention** | `executionTaskId`; `TransportRequest.idempotencyKey` is deterministic for WS-3. Not a named field on the contract |
| Correlation ID | **Missing** | Mappable from `executionTaskId` or a new field; request context is unavailable in a cron sweep beyond the route's own id |
| Execution request | **Satisfied** | `EngineStepContext`; ledger row for non-WS-3; handoff for WS-3 |
| Execution result | **Satisfied, thin** | `EngineResult` |
| Delivery status | **Missing on the contract** | Mappable from WS-3 `DeliveryStatus` and WhatsApp recipient status; not on `EngineResult` |
| Error classification | **Partial** | Consequence-based via disposition and `reason` code. `FailureClass` exists in WS-3, not on the result |
| Retryability | **Implicit** | Disposition `wait` means provably not acted; `needs_human` + `uncertain` means never retried. No field |
| Usage and credit information | **Missing** | Nothing to map from in outreach |
| Outcome event | **Missing as an event** | Poll-based: `outreach_outcomes`, `engagement_messages`. No common outcome store |
| Audit metadata | **Partial** | Decision log, `outreach_decisions`, `capability_audit_log` via `logSecurityEvent`. Actor absent on journey rows; no shared audit fields |

---

## 5. Status mapping, shared vocabularies

| Source | REQUESTED | AUTHORIZED | QUEUED | EXECUTING | ACCEPTED | DELIVERED | FAILED | RETRY_REQUIRED | CANCELLED | REJECTED |
|---|---|---|---|---|---|---|---|---|---|---|
| Ledger `state` | `requested` | none | none | `submitting` | `submitted` (engine took it, **not** provider acceptance) | none | `failed` | none | none | none |
| WS-3 task | `pending`, `awaiting_approval` | `approved` | `queued` | `dispatching` | `sent` | `delivered` | `failed` | none | `cancelled`, `expired` (approximate) | `rejected` |
| Delivery axis | none | none | `queued` | `dispatched` | `sent_unverified` | `delivered`; `confirmed` for internal only | `bounced`, `failed` | none | `expired` | `suppressed` |
| Transport outcome | none | none | none | none | `accepted` | none | `provider_error`, `transport_error` when proved after the call | same two when provably before the call | none | `rejected`, `disabled` |
| Disposition | none | none | none | none | none | none | none | `wait`, only when provably not acted | none | none |

**No honest mapping:**

| Status | Why |
|---|---|
| Ledger and result `uncertain`; transport `timeout` | **Must not map to FAILED or RETRY_REQUIRED.** The contract forbids auto-retry because the action may have happened. The target list has no such state. Proposal for the coordinator: add `UNCERTAIN`, or carry it as a separate flag beside the status |
| `needs_human` | A settlement instruction, not an execution state. It can accompany several statuses |
| Ledger `completed` | Means the step settled. Depending on the engine it is ACCEPTED or DELIVERED. For social publish it means "observed published" |
| Ledger or disposition `skipped` | "No suitable action for this person, or a human declined", so CANCELLED and REJECTED are both partly true. A separate `SKIPPED` would be honest |
| Disposition `wait` | Covers awaiting approval, in flight and deferred, which map to different target statuses |
| WS-3 `paused`, `escalated`; `retried`, `resumed`, `reassigned` | First two are resting states with no target. The last three are transitions, never observed resting (`types.ts:25-28`) |
| Decision `deferred`, `waiting`, `unsupported`, `exited` | Journey decisions, belonging to orchestration, not engine statuses |
| Business axis (`replied`, `opened`, ...) | An orthogonal axis by design. It must not be folded into these ten |

**AUTHORIZED** is recorded nowhere common. Only WS-3 has it. **RETRY_REQUIRED** is not emitted by anything.

---

## 6. Gap register

Shared-contract, migration, registry and dispatch fixes are **proposals for the coordinator only**.

| ID | Gap | Sev | Evidence | Smallest fix extending existing code | Touches shared? | Decision needed? |
|---|---|---|---|---|---|---|
| F-1 | Engine, provider, action not separated | High | section 2.1 | Add optional `provider` and `actionType` to `EngineResult` and `EngineStepContext`; keep the channel-keyed map | Shared contract | Coordinator |
| F-2 | No journey event model or correlation | High | section 3.2; `EngineResult` | Use `executionTaskId` as correlation, add a field to context and result. Do not reuse CKRE event service | Shared | Coordinator |
| F-3 | Non-WS-3 outcomes have no common store; late replies lost | High | `outreach_outcomes.task_id NOT NULL`; `journeyFeedback.ts:9-12` | Generalize the `JourneyResponsePort` per adapter; outcome store choice needs a design | Shared, likely migration | Coordinator; PI |
| F-4 | Journey response port is hard-coded per engine | Medium | `journeyResponses.ts:43-48` | Optional `responses()` on the adapter, port aggregates | Shared | Coordinator |
| F-5 | Implicit channel permission covers only email and WhatsApp | **High** | `journeyPolicy.ts:156-162`. **Any new contact channel gets no pre-check at sweep level, and docstring treats a null as "contacts nobody"** | Derive from a channel declaration; fail closed on unknown contact channel | Shared | Coordinator |
| F-6 | Channel lists are copied: TS, SQL `wf_publish`, ledger CHECK, `CHANNEL_CAPABILITIES`, `KNOWN_CHANNELS`, `OutreachChannel` | Medium | sections 11 and 8 | Contract test across lists, as already done for `ENGINE_NAMES` | Test only, then shared | Coordinator |
| F-7 | `CHANNEL_CAPABILITIES` is stale on the branch | Medium | `channelCapabilityModel.ts:204-217` vs webhook + adapter | Correct WhatsApp entries; add missing channels with evidence | Engine-local-ish, shared by consumers | Outreach owner |
| F-8 | Outreach providers undeclared | Medium | section 2.1 | Add `engagement` entries to `providerCapabilityModel` with `executable`, no verification entry | Registry | PI + Outreach owners |
| F-9 | No usage or credit | High for commercial launch | section 3.4; `journeyReport.ts:16-17` | Decide funding first. PI's tenant-funded port is the pattern to copy | Shared | **Owner** |
| F-10 | Tenant credentials not used by outreach; WhatsApp in `social_accounts`, SES platform-wide (inference from email transport) | Medium | section 10, item 4 | Decide per provider. `integration_credentials` + A3P for API-key providers | Shared | **Owner** |
| F-11 | No app writer for `outreach_governance_config` | High for rollout | Only `scripts/ws3-*` write it; `leadOutreachActivation.ts:36` says production has none | Governed admin route | Shared | **Owner** (B-6 related) |
| F-12 | Kill-switch coverage uneven | High | B-17: queued WhatsApp ignores later kill switch; `execution_controls` unused by live paths despite header | Common `channelRefusal` helper from `whatsappEngineAdapter.ts:169-176` | Engine-local per engine; shared if extracted | Coordinator |
| F-13 | `uncertain` cannot be resolved in the ledger | Medium | Guard trigger in 20261230000000 | Add append-only settlement record rather than loosen guard | Migration | Coordinator |
| F-14 | No engine availability or health | Medium | `EngineAdapter` shape | Optional `availability(org)`, reading `connectionState` for OAuth providers | Shared | Coordinator |
| F-15 | Positive consent missing; no quiet hours | **High legally for SMS/WhatsApp marketing** | section 10, item 6; `contactGovernance.ts:34` | None without a decision. Deny-list only today | Migration | **Owner, counsel** |
| F-16 | WhatsApp webhook acks after failed or shed enqueue, so the event is lost | **High: a lost STOP** | `pages/api/whatsapp/webhook/index.ts:105-114` | Return 5xx on failure so Meta retries. **Needs an owner choice: the comment at `:109` says the ack is deliberate, to avoid replaying a partly queued payload, and the route's jobId dedup may already make a retry safe.** `safeEnqueue`'s shed branch needs reading before any change | Engine-local | Outreach owner |
| F-17 | Extension nonce is per-process | Low-Medium | `seenRequestNonces` | Redis, if multi-instance | Engine-local | Community owner |
| F-18 | STOP is channel-scoped to WhatsApp only | Medium | `whatsappOptOut.ts` | Policy decision, not a bug | Shared policy | **Owner** |
| F-19 | Sending domains not connected to outreach | Medium | Empty grep | Resolve sender in the email path | Engine-local | Email owner |
| F-20 | `suppression_entries` global sentinel has no canonical equivalent; `outreach_suppressions` `lead` scope has no equivalent | Medium | `governanceService.ts:40-48`; `suppressionService.ts:21-38` | Retirement gates exist in `contactGovernanceEvaluation.ts` | Migration | **Owner** |
| F-21 | Tenant sweep cap and unsupported-channel behaviour | Medium | B-22 | Already registered | Dispatch | Orchestration |

**Safe without an owner decision:** nothing shared. The only self-contained items are the doc corrections in F-7 and adding a list-consistency test in F-6, and each still needs its owner's agreement under the ownership rule.

---

## 7. External dependencies, by name only

`WORKFLOW_ORCHESTRATION_ENABLED`, `CRON_SECRET`, `LEAD_OUTREACH_EXECUTION_DISABLED`, `LEAD_OUTREACH_EMAIL_ENABLED`, `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED`, `ENCRYPTION_KEY`, `PHONE_HASH_SALT`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `GTM_EXECUTION_ENABLED`, `GTM_LIVE_SEND`, `PROVIDER_GOVERNOR_KILL_SWITCH`, `PROVIDER_KILL_<ID>`, `PROVIDER_GOVERNOR_DRY_RUN`, plus the SNS topic allow-list setting used by the SES route (name not read). External: SES configuration, SNS subscription, edge function deployment, Meta app and WhatsApp business number, Redis. Owner decisions: B-1 through B-22 in `VERIFICATION-AND-BLOCKERS.md`.

---

## 8. Duplicates and competing implementations

Recommendations only. Nothing was changed.

| Concern | Competitors | Recommended canonical | Why |
|---|---|---|---|
| Dispatch path | Sweeper + adapters; WS-3 dispatcher; `executionBridge.dispatchGuarded` | **Sweeper for journeys, WS-3 dispatcher as an engine.** Retire the bridge eventually | Bridge is permanently dry-run and refuses all but email |
| Suppression | `contact_governance_records`, `outreach_suppressions`, `suppression_entries` | **`contact_governance_records`** | Six writers, all paths. Respect the existing retirement gates; do not add dependencies on the other two |
| Approval | WS-3 approval log, `execution_approvals`, WhatsApp `hasApproval` false, `TENANT-JOURNEY-APPROVAL-DESIGN.md` (unbuilt) | **WS-3 approval API until the tenant design is decided** | B-6 is an owner decision |
| Kill switch | `outreach_governance_config`, `execution_controls`, `LEAD_OUTREACH_EXECUTION_DISABLED`, `GTM_*`, `PROVIDER_KILL_*` | **`outreach_governance_config` + `LEAD_OUTREACH_EXECUTION_DISABLED`** for contact; governor for spend | Live gates already use them |
| Channel capability | `adapter.channels`, `CHANNEL_CAPABILITIES`, `transportRegistry`, `platform_registry` | **`adapter.channels` for dispatch; correct and extend `CHANNEL_CAPABILITIES` for facts** | Its header's separation of facts is sound. Assert consistency by test |
| Provider state | `providerCapabilityModel`, `PROVIDER_CATALOG`, `providerHealthService`, `dataSourceCatalogue`, `enrichment/providers/registry` | **`providerCapabilityModel` for state, `PROVIDER_CATALOG` for spend** | Its header already draws this line |
| Request ledger | `execution_engine_requests`, `outreach_bridge_handoffs` | **Keep both.** WS-3 has a per-task record. A contract view can union them | Migrating WS-3 adds risk with no gain (inference) |
| Decision record | `execution_journey_decisions`, `outreach_decisions`, `execution_audit*`, `capability_audit_log` | **Decisions for journeys, `outreach_decisions` for gates** | Different questions. Migration header explains |
| Events | CKRE service, content SSE events, `integrationEventService`, `domain_events`, `canonical_events` | **None fits; no canonical journey event exists.** Assess `domain_events` before adding anything | I did not read `domain_events` usage |
| Failure taxonomy | `FAILURE_CLASSES`, `AiError`, disposition + reason, `apolloErrors` | **Disposition for consequence, `FAILURE_CLASSES` as the class** | Different axes, complementary |
| Webhook HMAC | `webhookSecurityService`, local WhatsApp `verifySignature`, three payment verifiers | **`webhookSecurityService` for plain HMAC. SNS stays separate.** WhatsApp's `sha256=` prefix is already handled by that helper | **`verifyWebhookSignature` compares as hex and accepts `sha256=`, so it looks directly usable. Takes string; WhatsApp signs raw bytes (inference: utf8 conversion should be checked before any swap)** |
| Rate limits | `quota.ts`, `whatsappRateLimiter`, `executionQuotaService`, `backend/utils/rateLimiter.ts`, `lib/auth/rateLimit.ts`, `lib/shield/rateLimiter.ts` | **`quota.ts` pattern for contact quotas**; others remain domain-local | DB is truth, Redis is optimization |
| Tenant credentials | `integration_credentials` provider path, `social_accounts`, `community_ai_platform_tokens` | **`integration_credentials` for API keys; `social_accounts` for OAuth** | Existing design intent |
| Credit | `creditExecutionService` vs `creditDeductionService` | Already resolved: mutations via the former | File headers |
| Same names, different things | `orchestrationEventService`, `executionEngines/`, `PROVIDER_CAPABILITIES` (2), `withIdempotency` (2), `verifyWebhookSignature` (several), `routing/executionRoutingEngine` | Pick distinct contract names | Reduces wrong-import risk |

---

## 9. Claims the code contradicts

| Claim | Source | What the code shows |
|---|---|---|
| Integration Hub 1-4 uncommitted in `C:/tmp/r1-ctx` | Memory, task brief | 33288cd2 on origin/main; directory does not exist |
| Discovery registry empty | Memory; `prospectDiscovery/providerRegistry.ts:4` header | Apollo registered through `adapters/index.ts:46-56` when `/api/prospect-sources/discovery` runs |
| Three stores, two write-dead | Memory, task brief | One is write-dead (`outreach_suppressions`). `suppression_entries` is written at `suppressionService.ts:566`. The canonical store has six callers |
| "This table has never held..." and "ZERO rows" comments | Various headers | Unmeasured; depends on production |
| "`execution_controls` is the one control layer every path consults" | `executionControlService.ts:4` | Only the dry-run bridge and its route |
| "Every outbound connector MUST consult `isSuppressed`... no other suppression logic" | `suppressionService.ts:4-5` | Live paths use B, C, D; that file's own later note and `contactGovernanceEvaluation.ts` say so |
| WhatsApp: no transport means "nothing receives a callback", "no inbound path" | `channelCapabilityModel.ts:216-217` | `pages/api/whatsapp/webhook/index.ts` and its processor exist, on main and more so here |
| "Four paths evaluate contact governance" | `contactGovernanceEvaluation.ts:63` | Fifth on branch: `individualIntelligence.ts:97` |
| `mayContact`: "NOTHING CALLS IT YET" | `contactGovernance.ts:21` | Stale; many callers |
| Orchestration subscribes via `orchestrationEventSubscriptions` | Implied by name | CKRE knowledge only |

---

## 10. Foundations by topic: one-source verdicts (items 4, 5, 6, 7, 8, 10, 11)

### Item 4. Tenant credentials

| Store | Holds | Encryption | Tenant binding | Consumers | One source? |
|---|---|---|---|---|---|
| `integration_credentials` provider path (`company_id`, `provider_key`, `credential_key`; partial unique index) | Tenant API keys | AES-256-GCM, `SECRET_CONFIG_KEYS` | Direct | A3P, PI resolver | **Yes, for tenant API keys.** Service-role only. The header says "later phases will add data-source and outreach providers to this same store". `api_key`, `webhook_secret` are already secret keys |
| `integration_credentials` connection path | Website/CMS | Same | Three-hop check | CMS | CMS only |
| `social_accounts` + `tokenStore` | OAuth, WhatsApp `phone_number_id` | AES-GCM (`tokenStore`, per comment in `credentialEncryption.ts`) | `company_id` | Publish, WhatsApp, journey responses | **Keep for OAuth/social.** Not worth merging |
| `community_ai_platform_tokens` | Community tokens | Not checked | Tenant (table in `database/`, outside the migration chain) | Community connectors | Community-engine inventory |
| `api_provider_accounts`, `external_api_sources` | Platform keys | Field-level; legacy plaintext flagged | Platform | Report providers | **Platform only.** Must not serve tenants (`enrichment/providers/credentials.ts` rule: no env fallback) |
| `platform_oauth_configs` | Platform OAuth clients | `credentialEncryption` | Platform | OAuth | Platform only |
| `extension`, RPA sessions | Browser sessions | HMAC / encrypted | User | Community, browser | Engine-local |

**A3P.** `apiHandlers/prospects/leadSourceCredentials.ts`, route `pages/api/prospect-sources/credentials.ts`. Closed list from `ACQUISITION_SOURCES`, `operational: false` always returned, no provider contact. **Reusable control plane**, after widening its provider source.

**Integration Hub 1-4.** Committed as 33288cd2, which is an ancestor of origin/main. `C:/tmp/r1-ctx` is absent (`ls` error). Status: on main. Apollo discovery has no real call (`providerCapabilityModel.ts:165-169`).

**Step-up.** `StepUpPolicyRegistry.ts` is the source for platform capabilities (`INTEGRATION_PLATFORM_OAUTH_MANAGE`, `OUTREACH_PLATFORM_MANAGE`). a4f52cbc is a super-admin UI wiring fix, is **not** an ancestor of the recovery branch, and touches no shared backend file. A3P's tenant-level path has its own authorization. I did not confirm whether it requires step-up.

### Item 5. Health

| Model | Vocabulary | Live? | Scope |
|---|---|---|---|
| `connectionState.ts` | 9 states | Yes, `healthProbeService` probes | `social_accounts`, `analytics_integrations`. **`PROBE_ENDPOINTS` has no WhatsApp entry** |
| `providerHealthService` | connected, awaiting_credentials, disabled, killed, degraded, not_integrated | Config only; last success is in-process | Catalog providers |
| `integrationHealthService` | healthy, warning, degraded, failed, reauth_required | Yes | CMS |
| `pages/api/engagement/platform-health.ts` | Not read | | Engagement |

**Recommended as source:** `connectionState` for OAuth connections, `providerCapabilityModel` layers for "can it run". No model covers SES, or WhatsApp phone quality as health.

### Item 6. Consent and suppression

**Stores, confirmed by reading every reference:**

| Store | Writers | Readers | Verdict |
|---|---|---|---|
| `contact_governance_records` | `recordContactGovernance` only, called from `suppressionService:545`, `feedbackIngestion:386`, `unsubscribeService:94`, `personErasure:206`, `sesProviderEventIngestion:110`, `whatsappOptOut:104` | Paths A, B, C, D, sweeper | **Canonical.** Channel is free text, `*` covers future channels, 9 closed types, append-only, tenant FK |
| `outreach_suppressions` | **None** in `backend` or `pages` | `governanceService.ts:198` only | Write-dead, but read is a fail-closed input |
| `suppression_entries` | `suppressionService.addSuppression:566`, reached through `pages/api/lead-intelligence/execution.ts` | Path A | **Not write-dead.** Legacy mirror. Memory and the brief are out of date on this. Production row counts: header claims zero, unmeasured by me |
| `consent_records` | `consentLedgerService.ts` | Capability, compliance | **Different domain.** OAuth/capability consent |

**Evaluation paths.** `contactGovernanceEvaluation.ts:61-80`:

- Path A `isSuppressed`: dry-run bridge and operator route.
- Path B governance: live WS-3 dispatch.
- Path C `prospectOutreach/readiness.ts:395`.
- Path D `leadIntelligenceReadService.ts:955,972` and `whatsappBroadcastService.ts:300`.
- **New on branch:** `individualIntelligence.ts:97`, the sweeper's pre-check, a fifth caller not named in that contract comment.

**How each signal reaches eligibility:**

| Signal | Route | Governance written | Eligibility effect |
|---|---|---|---|
| Email unsubscribe link | `pages/api/outreach/unsubscribe.ts` → `unsubscribeService` | `unsubscribe`, `*`, target and person | Sweeper `email_permitted`, Path B at send |
| `unsubscribed` feedback | `feedbackIngestion:386` | `unsubscribe`, person; scope channel by default | Same, plus journey exit |
| Hard bounce | SES → `sesProviderEventIngestion:110` | `bounce_hard`, address, `email` | Next email skipped |
| Complaint | Same | `complaint`, address + person, `*` | All channels |
| WhatsApp STOP | Webhook → processor `:103` → `whatsappOptOut` (branch only) | `unsubscribe`, `whatsapp`, target | Processor send gate; sweeper; journey exit; PI closed |
| WhatsApp failure or complaint | No governance write found in the files read | none | **None** |
| Operator suppress | `lead-intelligence/execution.ts` | Canonical + legacy | Paths A and B via canonical |
| Erasure | `personErasure:198-206` | Enforceable instructions are re-anchored before revocation | Continues to block |

**Not implemented:** quiet hours and contact fatigue (`contactGovernance.ts:34`, plus a search that found nothing relevant). No positive opt-in store. Frequency policy exists only inside a workflow version (`min_hours_between_actions`), and only across completed plan steps for a subject.

### Item 7. Quotas, usage, credits

| Layer | Implementation | Owner | Verdict |
|---|---|---|---|
| Credit mutation | `creditExecutionService`, `executeWithCredits`; 80 references | Platform | **Canonical if outreach debits.** Never rebuild wallets from deltas (memory rule) |
| Tenant-funded egress | `enrichment/providers/cost.ts` | PI | **Pattern for tenant-paid providers** |
| Spend per provider | `providerCostGovernor`, `recordCost` → `cost_events` | Platform | Fail-open on budget errors by design (`:21-23`), which is unsuitable as a contact gate |
| Usage ledger | `usageLedgerService.ts`; `usage_events`, `unified_transactions` | Platform | Financial telemetry; rejects unknown action keys |
| Usage telemetry | `customer_usage_events` via `usage/*` | Customer success | Not financial |
| Outreach quota | `quota.ts`, Redis over DB; DB is truth | WS-3 | **Best pattern for per-engine send quota** |
| WhatsApp limiter | `whatsappRateLimiter.ts` | Outreach | Fits Meta tiers; stays engine-local |
| GTM quota | `executionQuotaService.ts` | GTM | Duplicate, dry-run only |
| Sending-domain limit | `sendingDomains/sendingDomainRateLimit.ts` | W4 | Domain API operations (inference from the path; not read) |
| Publishing/platform limits | `platformRateLimitService.ts` | Social | Engine-local |
| Token buckets | `providerTokenBucket`, `distributedProviderTokenBucket` | AI | Not outreach |

### Item 8. Idempotency, retry, uncertainty

| Concern | Implementation | Verdict |
|---|---|---|
| HTTP write dedupe | `withIdempotency`. **Confirmed: only POST, PUT, PATCH, DELETE by default, GET passes straight to the handler with no key (`:240,246`).** Requires a resolved caller (`401` otherwise), so not usable for webhooks or crons | Canonical for authenticated mutations; not for engines |
| Engine action dedupe | Ledger `UNIQUE` + claim `requested → submitting` | **Canonical for non-WS-3** |
| WS-3 dedupe | Bridge unique per task, compare-and-set claim, `outreach_attempts_unique`, deterministic provider key | Keep |
| Inbound dedupe | `feedbackIngestion` unique indexes (logical and provider-event); `sourceEventKey` for PI lifecycle | **Canonical pattern** |
| Request-level, engagement | `engagementRequestIdempotency.ts`, 20261231000008 | Engine-local |
| Others | `billingIdempotencyService`, `boltExecuteIdempotency`, `boltScheduleIdempotency`, `creator/enterpriseGovernanceLocking.withIdempotency` (same name, different API), `persistence/supabaseIdempotencyStore` | Domain-local; **name collision** on `withIdempotency` |
| Retry | `lib/retryJitter`, `ai/safety/providerRetryPolicy`, `aiGatewayProvidersRetry`, `content/runtime/retryPolicy`, `integrationHealthRetry`, `queue/publishRetryState`, `enrichment/retryConsumer`, `leadOutreachRecoverySweep`, `engagementDispatchRecoveryService`, BullMQ backoff | No shared outreach retry. `classifyProviderError` and `retryJitter` are pure and reusable |
| Timeouts | `EMAIL_TIMEOUT_MS = 15_000` (`emailTransport.ts:48`), `ProviderDescriptor.timeoutMs`, `safeFetch`, `fetchProduction` | Per caller. **`timeout` treated as `needs_human`** by the WS-3 adapter |
| Circuit breaker | `intelligence/circuitBreaker.ts` | Report providers only |
| Uncertainty | Contract: may have acted → `needs_human`, `uncertain`, never auto-retried (`engineAdapters.ts:36-43`). WS-3 `blocked_prior_attempt`; PI `provider_call_state` | **Contract text is canonical; `provider_call_state` is the best data model** |

### Item 10. Analytics and attribution

`journeyReport.ts` is the one per-workflow read, derived, no store, no cost (`pages/api/workflows/[id]/report.ts`). `feedbackSummary.ts` serves WS-3. WS-3 metrics flow through HARDEN-001 (`telemetry.ts`) with bounded labels. WhatsApp counters depend on undefined RPCs (B-11, re-confirmed: called at `:386,:469`, and the record doc says catalog empty). Website attribution tables (`lead_attribution*`, `attribution_handoff*`) answer a different question. No table attributes an outreach outcome to a campaign or revenue. **Verdict: extend `journeyReport`; do not create an analytics store.**

### Item 11. Kill switches and enablement

| Level | Control | Enforced by | Writer |
|---|---|---|---|
| Platform, journeys | `WORKFLOW_ORCHESTRATION_ENABLED` | Cron route | Env |
| Platform, WS-3 and WhatsApp journeys | `LEAD_OUTREACH_EXECUTION_DISABLED` | `governance.ts`, `whatsappEngineAdapter.ts:170`; **`processBatch` does not (B-17)** | Env |
| Platform, email egress | `LEAD_OUTREACH_EMAIL_ENABLED` | `emailTransport.ts:42` | Env |
| Platform, recovery | `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED` | Sweep | Env |
| Platform, GTM | `GTM_EXECUTION_ENABLED`, `GTM_LIVE_SEND`, `execution_controls` | Bridge only | Operator route |
| Platform, providers | `PROVIDER_GOVERNOR_KILL_SWITCH`, `PROVIDER_KILL_<ID>`, `PROVIDER_GOVERNOR_DRY_RUN` | Governor | Env |
| Platform, autonomy | `autonomousFeatureFlag` | Autonomous crons | Env; unrelated |
| Tenant, enablement and channels | `outreach_governance_config.enabled`, `kill_switch`, `enabled_channels`, `restricted_regions`, `daily_limit_*` | Sweeper tenant list, Path B, WhatsApp adapter | **Scripts only** |
| Tenant, generic | `feature_flags`, `org_controls` | Not read by outreach (for `org_controls`, the only hits are billing and `orgControlService`) | Admin |

`execution_controls` header says "the ONE control layer every execution path consults" (`executionControlService.ts:4`). **Code contradicts it**: consumers outside `execution/` are only `pages/api/lead-intelligence/execution.ts`.

**Recommended single source for tenant and channel enablement:** `outreach_governance_config`. It already has `enabled_channels`, is default-deny, and sweeper tenant discovery reads it. Community's guard appears in its adapter header (`communityEngineAdapter.ts:48`) and is reported by that engine's inventory.

### Item 13. Migrations

**On the recovery branch only (23).** Every one is absent from origin/main (`git diff --name-status`). `RECOVERY-BASELINE.md` says nothing here is applied to any real database. Runbook: production status UNKNOWN, ledger desynced. I measured nothing.

| Version | File suffix | Relates to |
|---|---|---|
| 20261127000000 | `pi_prospect_lists` | Targeting. **Sorts before main files.** Memory says this family is live in prod from an unmerged branch; unverified here |
| 20261226000000 | `pi_prospect_campaigns` | Targets; references `outreach_outcomes` |
| 20261227000000 | `pi_workflow_definitions` | **SQL channel list** |
| 20261228000000 | `pi_execution_instances` | Runs |
| 20261228000001 | `pi_execution_plans` | Plans, tasks |
| 20261228000002 | `pi_execution_step_scheduling` | `advance_execution_plan` |
| 20261229000000 | `pi_outreach_bridge` | WS-3 per-task idempotency |
| 20261230000000 | `orchestration_engine_requests` | **Ledger** |
| 20261231000000 | `orchestration_campaign_targeting` | Enrollment |
| 20261231000001 | `orchestration_engine_requests_engines` | **Engine CHECK** |
| 20261231000002 | `community_execution_safety` | Community uncertainty |
| 20261231000003 | `community_journey_link` | Community + ledger |
| 20261231000004 | `social_publish_step_channel` | **Replaces SQL channel list** |
| 20261231000005 | `extension_dispatch_safety` | Browser dispatch |
| 20261231000006 | `community_identity_link` | Community |
| 20261231000007 | `identity_verification` | Community B-7 |
| 20261231000008 | `engagement_request_idempotency` | Engagement |
| 20261231000009 | `migration_rerun_safety` | Stack |
| 20261231000010 | `rpa_legacy_session_invalidation` | RPA |
| 20270113000000 | `outreach_bridge_handoffs_person_erasure_set_null` | D-2 unsigned |
| 20270120000000 | `orchestration_journey_decisions` | **Decision log** |
| 20270120000001 | `pi_email_content_evidence` | Email evidence; B-3 |
| 20270120000002 | `whatsapp_broadcast_recipient_unique` | Refuses on duplicates |

**On main, relevant (file present; production not measured by me):**

| Topic | Versions |
|---|---|
| WS-3 | 20260910000000, 20260911000000, 20260912000000, 20260913000000, 20260914000000, 20260915000000; 20261011000000 |
| Governance and purpose | 20261003000000, 20261126000000 |
| Legacy controls | 20260727030000, 20260727040000, 20261223000001 |
| Credentials and health | 20260677, 20260678, 20260509, 20260625, 20260693, 20261014000000 |
| PI ledgers | 20261015000000, 20261016000000, 20261119000000, 20261120000000, 20261121000000 |
| Lifecycle | 20261028000000, 20261029000000 |
| Idempotency | 20260420, 20260916000000 |
| Retry | 20261202000000 |
| Credit | 20260321, 20260322, 20260631, 20260634 |
| Attribution and usage | 20260701004000, 20260728, 20260805 |
| Sending domains | 20261220000000 |
| Community | 20260522, 20260523, 20260524, 20260525 |

Memory records 20261119000000, 20261120000000 and 20261202000000 as unapplied in production. **Older notes, not re-measured.**

**Outside the chain:** `database/whatsapp_system.sql` and `database/community_ai_platform_tokens.sql`. These are not replayed by migrations (B-10 for WhatsApp). Any contract migration touching them must probe first.

---

## 11. SMS and Voice (task item 12) (future only; no build proposed)

**What exists:**

| Item | Location | Meaning |
|---|---|---|
| `phone`, `sms` authorable | `workflowStore.ts:98-99`; SQL `20261231000004:110` | A published step can name them. It becomes `unsupported` and **stays ready forever** |
| Capability entries `sms`, `voice` | `channelCapabilityModel.ts:222-257` | Declared non-operational; `callDisposition` deliberately separated |
| `KNOWN_CHANNELS` `phone` only | `contactGovernance.ts:67` | `*` still blocks a future channel; the table's channel is free text |
| Target normalizer | `contactGovernanceRepository.ts:58` | Normalizes `phone` and `whatsapp`; **`sms` falls to casefold** |
| Advice only | `qualificationPlanning/channelIntelligence.ts:54-58`, `planningConfig.ts:82`, `types.ts:108-110`, `automationExecution/channelSequencer.ts:18` | Recommends; contacts nobody |
| Other enum mentions | `gtm_messages` CHECK (20260727020000), `database/step14`, step16 notification templates, `contactIntelligence/types.ts:50` | Not a sending path |
| Phone identity | `unified_persons.primary_phone`, `normalizePhone`, claim type `phone` | Reusable |
| Erasure | `erasurePlan.ts:79` | Maps `phone`, `whatsapp` only |
| Credit | `voice_per_minute`, `VOICE` class | Voice interaction; not telephony (inference) |
| CRM task type | `operations/operationalCoreService.ts:249` `'call'` | Task label only |
| Vendors | Twilio only in test "forbidden import" lists and one doc line (`docs/pmo/ENG-001-...md:150`). No Plivo, Vonage, Exotel or MSG91 in `backend`, `pages`, `lib`, migrations, `database` or `docs` | **No code, no dependency** |
| History | `git log --all -i --grep` hits are unrelated (voice notes transcription etc.). `git log --all --pickaxe-regex -S'[Tt]wilio\|[Pp]livo'` over `backend/services`, `backend/queue`, `pages/api`, `supabase/migrations`, `package.json`: exit 0, **zero commits** | |

**What they would plug into:** `ENGINE_NAMES` + ledger CHECK + contract test; `buildAdapterRegistry`; or a WS-3 `OutreachTransport` (`transport.ts` header invites it) with the `ws3` adapter's channel list; `recordContactGovernance`/`mayContact`; `integration_credentials`; a provider webhook using the SES pattern (verify → normalize → `ingestFeedback` or equivalent); `CHANNEL_CAPABILITIES`.

**What would conflict:**

1. **Two extension seams.** A WS-3 transport or a new engine, with different idempotency records and approval models. Needs a coordinator ruling. WS-3's `channels: ['internal','email']` is hard-coded (`engineAdapters.ts:181`).
2. **`channelPermissionFact` returns null for both**, read by its docstring as "contacts nobody". This is the most dangerous one: no sweeper pre-check (F-5). `JOURNEY_FACT_TYPES` has no `sms_permitted` or `phone_permitted`.
3. **Naming.** Authoring says `phone`; the capability model says `voice`; governance says `phone`. SMS and voice share a number but not a channel.
4. **Normalization.** A target-anchored `sms` record would be stored casefolded and would not match a `phone` form (F-5 sibling).
5. **Scope of STOP.** The WhatsApp keyword detector and `whatsapp` channel scope are engine-specific. Whether an SMS STOP blocks calls is an unmade policy decision.
6. **Port.** `JourneyResponsePort` has `whatsappReply` by name, and `outreach_outcomes.task_id` is NOT NULL.
7. **No consent, quiet hours or call disposition store.** Legal prerequisites for these channels, and owner/counsel decisions.
8. **Credit naming.** `voice_per_minute` already means something else.
9. **Unbounded waiting.** A journey with a `phone` or `sms` step blocks today at that step. Fixing this is B-22, regardless of SMS.
