# Outreach completion with Content and Engagement Intelligence: initialization report

Status at 2026-11-03. This is the report the programme asks for before any code changes, and **no code has been changed**. It builds on the inventory in [`AUDIT.md`](AUDIT.md), the proposal in [`ARCHITECTURE-PROPOSAL.md`](ARCHITECTURE-PROPOSAL.md), and the engine report in [`../README.md`](../README.md). Those findings are still valid at this HEAD, so they are cited here rather than repeated.

The owner decisions in §4 of the mandate are taken as recorded: Content Platform ownership, `prospect_campaigns`/`prospect_lists` as canonical, human approval by default, both email sender models, and Outreach owning ingestion. This report does not ask for them again.

How to read the evidence: **read** means I read the code at the cited line this session. **Recorded** means it comes from the earlier inventories or audit, which were produced by agents and spot-checked by me.

## 1. Repository, branch and HEAD (read)

| Item | Value |
|---|---|
| Programme branch | `integration/outreach-engines-20261102` in `C:/tmp/outreach-integration`. The working tree is clean |
| HEAD | `eec0117d`, which is docs only. **The code under test is `d682ab13`.** It merges orchestration `c74404c7` (contract 0.2.0; code at `019b6de5`) into the five engine branches |
| `origin/main` | `5025f51d`, checked against the remote with `ls-remote`. It is unchanged and is an ancestor of HEAD |
| Orchestration branch | `feat/orchestration-recovery` at `15dc63c0`. The only commit after `c74404c7` is docs recording our T2. Nothing new needs merging |
| `C:/virality` | On `preserve/creator-canonical-template-pool`, dirty, and owned by other work. **Not used** |
| Pushed, merged, deployed | Nothing |

The mandate's report values `21f62238` and `3aa5205a` are superseded. T2 was re-run at `d682ab13` with contract 0.2.0, with these results:
- Real schema: 71/71 suites, 1488 passed.
- Gates: all pass.
- Jest: 60 failures, every one in the baseline and none new.
- T3: not run.

## 2. Which earlier fixes are present (on this branch only, not on `main`)

| Engine | Commit | Present |
|---|---|---|
| WS-3 email | `9c93fe42` | G-1, G-3, G-4, G-7, G-8, G-9a |
| WhatsApp | `0bd12963` | WA-5, WA-6, WA-11, WA-13, WA-20, B-17 |
| Social | `fc41fac3` | **G-1 cron authorization**, G-2, G-3, G-4, G-11 |
| Community | `ea0fe5bd`, `ae5f5242` | G-8, governance checked before the claim. G-6, G-7 and GAP-02 were applied by orchestration (`96c12e8b`) |
| Browser | `4322048b` | GAP-09, GAP-10, GAP-11, GAP-13, GAP-14 |
| Contract 0.2.0 | `019b6de5` | `holdOnly`, `not_begun`, `broadcast_unreadable` |

## 3. Outstanding defects and production risks

**Live on `main` by code reading. Production use has not been measured.**

| Risk | Fixed on this branch? | Containment recommendation |
|---|---|---|
| `process-scheduled-posts` publishes without `authorizePostPublish` | Yes (social G-1) | Backport as its own small PR on `main` (needs push approval) |
| RPA: re-runs after a possible submit, plaintext sessions, replayable tokens | Partly (GAP-09..14). **GAP-03 is open: replies can falsely report `executed`** | If production has any RPA sessions, disable RPA dispatch until owner decision #3 |
| Community: falls back from the API to the browser; random ids; the reaper fails possibly-sent rows | Partly | Same measurement first |
| WhatsApp: no send-once claim; silent status failures | Status failures are fixed; send-once is not (L-4) | Unreachable while WA-1 returns 400. **Fixing WA-1 makes it reachable, so send-once must land first** |
| **New this session:** an auto-reply execution path outside the automation safety contract | No | See below. Production use is not measured |

**The new auto-reply finding (read):**
- `pages/api/response/generate.ts:76` calls `orchestrateResponse` with a caller-supplied `execute`.
- `backend/services/responseOrchestrator.ts:97-132` then calls `communityAiActionExecutor.executeAction` when two conditions hold: a `response_rules.auto_reply` rule matches, and an active playbook exists.
- It does not pass through `automation/automationService.ts`. That service is the one with the audited 7-step contract: kill switch, org enablement, action allow-list, confidence, learned uplift, an atomic daily limit, and "no audit, no automation".
- The executor is the L-3 choke point, so the L-3 fix covers consent on this path too. Whether the executor then refuses for lack of acting-account proof outside a journey is not yet established.

**Production measurements this needs (all read-only, none run).** I need your authorization, because the Supabase CLI initialises a login role in production before the first query:
1. Row counts in `rpa_sessions`, `rpa_retry_queue` and `rpa_auth_token_redemptions`.
2. Community actions with status `executed` in the last 90 days.
3. `response_rules` rows with `auto_reply = true`.
4. `engagement_system_controls` rows and their `auto_reply_enabled` values (the code default is `true`).
5. The names, not the values, of `USE_MOCK_PLATFORMS`, `RPA_SCREENSHOT_DIR` and `LEAD_OUTREACH_EXECUTION_DISABLED` on Vercel and Railway.

**Still open, with no change since the README:**
- L-3 and L-4.
- WA-1, WA-2, WA-3.
- B-7 and `proveActingAccount`.
- GAP-03 and GAP-17.
- E-1..E-5 and retention.
- Complaint stored as `delivered` (`providerEvents/sesEventNormalizer.ts`).
- Unsubscribe writes no outcome.
- `increment_wa_usage` is undefined.
- `outreach_outcomes.task_id` is NOT NULL.

## 4. Gateway bypass and cache isolation (read at this HEAD)

- **Bypass routes are still present.**
  - `pages/api/ai/gpt-chat.ts:80` calls `api.openai.com` directly.
  - `pages/api/ai/claude-chat.ts:240` calls `api.anthropic.com` directly.
  - No UI imports either route (recorded).
- **Cache.**
  - `aiResponseCache.ts:339-343`: `EXACT_ONLY_OPS` holds only `generateMasterContent`, `generatePlatformVariants` and `generateContentVariant`.
  - `engagement_reply_suggestions` (`engagementAiAssistantService.ts:341`), `conversationTriage` and `conversationMemorySummary` are not in it. They can therefore near-match within a tenant at Jaccard 0.80. They are never matched across tenants.
  - Fix: personalised and conversation operations **bypass the cache entirely**. Exact-only is not enough here, because the recipient must not be inferable from a hit, and two recipients can produce the same prompt when context is thin.
  - Owner: Platform AI. Coordination request C-AI-1, §13.

## 5. Content Platform

- Canonical tables exist: `content`, `content_variant`, `content_revision` and `content_approval_history`.
- **Writes to them are blocked by default** (`canonicalPersistencePolicy.ts`).
- Legacy `content_assets` is live and ungated.
- `generationRuntime` (`persist:false`) is behind flags that default OFF, and its content types are fixed to post, thread, blog, article and story.
- **The accountable Content Platform owner is not named in the repo.**
- `C:/virality` is on a creator canonical-template branch. Whether that work touches these tables has to be confirmed before anyone writes to them.

## 6. AI Gateway and generation routes

- Entry point: `aiGatewayProvidersOps.ts:645` `runCompletionWithOperation`. Charging: `billing/runBilledAiCompletion.ts`.
- These engagement operations already go through the gateway (read):
  - `engagement_reply_suggestions`;
  - `conversationTriage` (`conversationTriageService.ts:127-133`);
  - `conversationMemorySummary` (`conversationMemoryService.ts:104-109`).
- Unbilled generation routes (recorded): `/api/posts/generate`, `/api/threads/generate`, `/api/content/regenerate`, `/api/content/improve-draft`, `/api/ai/generate-content`.

## 7. Conversation and inbox infrastructure (read unless marked)

| Piece | Where | Reuse for Engagement Intelligence |
|---|---|---|
| Conversation store | `engagement_threads`, `engagement_messages` | **The** store. WhatsApp inbound writes here (recorded). Email inbound does not exist |
| Thread memory | `conversationMemoryService.ts`: summary per thread, last 10 messages, rebuilt every 5 messages | Context retrieval: summary and history |
| Classifier 1 | `conversationTriageService.ts`, with 6 community-shaped categories → `engagement_thread_classification` | Extend; do not add a fourth classifier |
| Classifier 2 | `engagementConversationIntelligenceService.ts`: intent, sentiment, lead signal | Overlaps classifier 1 |
| Classifier 3 | `responsePolicyEngine.ts`: 11 intents mapped to response templates | Overlaps both |
| Suggestions | `engagementAiAssistantService.ts`: `suggested_replies` and `tone_variants`, through the gateway | Base for the 2–3 alternatives |
| Autonomy | `automation/automationService.ts` (audited 7-step gate); `automationConfigStore.auto_reply_enabled` (default `false`); `engagementGovernanceService.auto_reply_enabled` (default **`true`**); `response_rules.auto_reply` | **Three switches for one decision.** Mode 3 should build on `automationService` |
| UI | `/engagement` (InboxDashboard, ThreadView, ReplyComposer, AISuggestionPanel, assignment, reply lock). `/engagement-inbox` and `/whatsapp/inbox` are competing (recorded) | `/engagement` only |

None of the three vocabularies has STOP, unsubscribe, out-of-office, wrong recipient, meeting request or support request. STOP, unsubscribe and complaint must stay **deterministic** (keyword and provider-event governance first), with classification only as a label afterwards.

## 8. Campaign and audience models

`prospect_campaigns` and its targets, plus `prospect_lists` with `readAudiencePage`, are canonical by owner decision. Both are tested on real PostgreSQL and have no UI.

The competing models stay untouched until a migration and preservation plan is approved: `gtm_campaigns`, LC-301 `audiences`, `outreach_plans` and the dry-run bridge.

## 9. Approval and authorization

- Orchestration owns approval and execution authorization: `execution_tasks` approval, `journeyGovernance.channelRefusal`, `journeyPolicy.channelPermissionFact`, and `contact_governance_records` through `prospectIdentity/contactGovernance.ts`.
- Four approval stores exist (AUDIT §3).
- The response route above authorizes execution outside Orchestration. That is a boundary violation to fold back in, not a pattern to copy.

## 10. Billing

- `apply_credit_reservation` is the only ledger writer, and `runBilledAiCompletion` is the charging wrapper.
- There are no channel credit actions; C-1 (channel prices) is open.
- `featureRegistry` has gaps and the credit CI guard is not wired (AUDIT §4). No second ledger will be created.

## 11. Content Intelligence boundary

- **Outreach builds** `lib/outreach/channelContent/`. It holds one profile, formatter and validator per channel: email, WhatsApp, community, SMS and voice script. Social is not rebuilt; it reuses `platformAdaptationProfiles.ts`. It also builds the campaign-to-content-revision link.
- **Content Platform owns** `content`/`content_revision`/approval history, generation (`generationRuntime`), brand voice and the edit commands. Outreach needs **new content types** added to it, not a new store.
- **Personalisation:** only through the 041-D allow-list (`emailContentGenerator.ts:37-40`), never raw PI rows, with the cache bypassed.
- **Generation never imports an engine.** A test enforces this.

## 12. Engagement Intelligence boundary

A shared capability with no store of its own:
- It reads `engagement_*`, the thread memory and PI's `getProspectDetail`.
- It writes classifications to `engagement_thread_classification`, one vocabulary for all channels.
- It returns suggestions.
- It never sends.

The send path for a chosen reply depends on the reply's origin:
- **A journey reply** goes through Orchestration authorization, then the channel formatter, then the engine.
- **A non-journey inbox reply** goes through the existing `/api/engagement/reply`, which gains the formatter, the governance check and approval.

Mode 3 is an Orchestration-owned policy evaluated by `automationService` (one switch). It escalates whenever any gate fails.

## 13. Shared contracts and coordination requests

| ID | Change | Accountable owner | Needed for |
|---|---|---|---|
| SC-3 | A journey step references `content_revision_id` instead of free text | Orchestration (`virality-c7`) | Campaign content association |
| SC-4 | An outcome store for engines other than WS-3 (`outreach_outcomes.task_id` nullable, or a sibling table) | Orchestration and Outreach | Unsubscribe outcome; WhatsApp and community outcomes |
| SC-6 | Channel vocabulary; `phone` vs `voice`; STOP scope | Orchestration | SMS and voice compatibility |
| SC-7 (new) | One message-classification vocabulary, with the deterministic governance categories pinned | Engagement owner, then PI for lifecycle mapping | Phase 4 |
| C-CP-1 | Allow outreach content types in canonical persistence; channel metadata on `content_variant` | Content Platform (owner to be named) | Phase 3 |
| C-AI-1 | Bypass the cache for personalised and conversation ops; route or remove `gpt-chat`/`claude-chat` | Platform AI | Phase 1 |
| C-BL-1 | Channel credit actions | Billing | Before any charged send |
| C-PI-1 | A runtime writer of `engagement_threads.unified_person_id`; a recipient-consent store | PI | Cross-channel context; Mode 3 |
| L-4 settle | The WhatsApp adapter maps `uncertain` after an ambiguous enqueue | Orchestration | L-4 |

SC-1, SC-2 and SC-5 (readiness read, provider declarations and webhook kit) are not needed until Channels & Health, in Phase 2 or later. No coordination request has been sent yet; each needs your go-ahead to go to its owner.

## 14. Parallel agents and worktrees

- Each agent gets **its own worktree and branch** cut from `eec0117d`, with node_modules junctioned and **never `npm` in a worktree**.
- Typecheck runs one at a time (4 CPU / 16 GB).
- Only the coordinator (me) edits shared files: contract, registry, migrations, `queueBackpressure.ts`, `aiResponseCache.ts`. Agents propose those edits as patches.

| Agent | Worktree, branch | Phase 1–2 scope | Blocked parts |
|---|---|---|---|
| A Email | `C:/tmp/omp-email`, `outreach/email-truth-*` | Complaint state, unsubscribe outcome (after SC-4), remove SES diagnostics | Sender models wait for C-BL-1 and the SES setup; reply ingestion needs SES inbound (an account action) |
| B WhatsApp | `C:/tmp/omp-wa`, `outreach/wa-l4-*` | L-4 reconcile, per-recipient send-once claim, then WA-2, WA-1, WA-3 in that order | WA-3 needs a connect flow, which is an account action |
| C Social | `C:/tmp/omp-social-main`, `fix/cron-authorize-publish` **from `main`** | Backport G-1 | Push needs approval |
| D Community | `C:/tmp/omp-community`, `outreach/community-l3-*` | L-3 executor recheck; `proveActingAccount`; fold `/api/response/generate` execute into `automationService` | Recipient proof is a product decision (B-7) |
| E Browser | `C:/tmp/omp-browser`, `outreach/browser-certainty-*` | GAP-03 honest status, session-at-rest encryption | All of it waits for decision #3 (is RPA allowed?) |
| F Content | `C:/tmp/omp-content`, `outreach/channel-content-*` | Channel profiles, formatters, validators (new files only) | Canonical persistence waits for C-CP-1 |
| G Engagement | none in Phases 1–2 | Writes the SC-7 draft only | Code waits for SC-7 and C-AI-1 |

## 15. Files and database objects expected to change (Phases 1–2)

| Change | Files | Database |
|---|---|---|
| L-3 | `backend/services/communityAiActionExecutor*.ts` | none |
| L-4 and send-once | `whatsappBroadcastService.ts`, `queue/queueBackpressure.ts` (coordinator), WhatsApp adapter (via c7) | `whatsapp_broadcast_recipients.status` is TEXT with no CHECK as read in `database/whatsapp_system.sql:238`. A `sending` value probably needs no migration; the migration chain is to be confirmed |
| WA-1, WA-2, WA-3 | the three POST routes (`enforceRole` companyId), `auth/metaAuthService.ts:65-73,201-233` | WA-3 writes `social_accounts.phone_number_id`/`waba_id` (existing columns) |
| Complaint state | `providerEvents/sesEventNormalizer.ts`, evidence writer | possibly a status CHECK; confirmed before writing |
| Unsubscribe outcome | `unsubscribeService.ts` | depends on SC-4 (one migration, coordinator) |
| Cache isolation | `aiResponseCache.ts` (coordinator, with Platform AI agreement) | none |
| Gateway bypass | `pages/api/ai/gpt-chat.ts`, `claude-chat.ts` | none |
| Auto-reply path | `responseOrchestrator.ts`, `pages/api/response/generate.ts` | none |
| Cron backport | `pages/api/cron/process-scheduled-posts.ts` (on `main`) | none |
| Formatters and validators | new `lib/outreach/channelContent/*` | none |

No migration is written in Phase 1. Any migration in Phase 2 comes from the coordinator, uses one number, and is replayed on real PostgreSQL. **None is applied anywhere real.**

## 16. Sequence

1. **Phase 0 remainder.** Run the authorized production measurements and send the coordination requests.
2. **Phase 1, in parallel.** Agent C backport; Agent D L-3 and the auto-reply fold-in; Agent B L-4 and send-once; Agent A complaint state; C-AI-1 cache and bypass. Agent E waits for decision #3.
3. **Phase 2.** WA-2 → WA-1 → WA-3. Unsubscribe outcome after SC-4. Channel formatters and validators. Campaign → content revision after SC-3.
4. **Phase 3.** Content Intelligence, after C-CP-1.
5. **Phase 4.** Engagement Intelligence, after SC-7 and C-PI-1.
6. **Phases 5–7.** Then Phase 5 cross-channel demos at the verified level only, Phase 6 the SMS and voice contract tests (extending `outreachFutureEngineCompatibility`), and Phase 7 T1, T2 and a T3 plan.

## 17. T1 and T2 acceptance

**T1, for each change:**
- A test that fails without the fix.
- Typecheck through `npm run typecheck`, never bare tsc.
- Targeted lint.
- Migration quality.

**Specific T1 proofs:**
- **L-3:** an opt-out after approval means no platform call via the scheduler, the retry flush or the manual route.
- **L-4:** each enqueue outcome is mapped; an ambiguous one is never re-enqueued.
- **Send-once:** two workers produce one Meta call.
- **Cache:** two recipients with identical prompts get no hit; different tenants get no hit.
- **Formatters:** length, encoding and segmentation, required fields, and refusal of personalisation outside the allow-list.
- **Generation:** the content module does not import an engine.

**T2:**
- Real-schema suites, same harness: 71+ suites green, with the new suites added.
- Whole-repo jest shows no failure outside the 60 baseline failures.
- typecheck-ci, the worker typecheck, route-auth, route-policy, migration-quality and schema-drift all pass.
- **L-4 on real PostgreSQL:** a lost acknowledgement gives exactly one Meta call across retries.
- **L-3 on real PostgreSQL:** the refusal is recorded.
- The `orch_contract_journey` email journey still passes end to end.

T3 is not in scope without authorization. A recording provider remains a recording provider.

## 18. Owner decisions still required (new or still open)

1. Authorize the read-only production measurements in §3.
2. **Is RPA session reuse allowed at all?** (README decision #3). This blocks Agent E.
3. Name the accountable Content Platform owner, and confirm whether the creator canonical-template work touches `content_*`.
4. Which single switch governs Mode 3? I recommend `automationService` plus its config. Should `engagementGovernanceService.auto_reply_enabled` stop defaulting to `true`?
5. Which suppression applies to community actions not tied to a known person?
6. Recipient proof for community (B-7).
7. Approve the cron backport as a separate PR to `main`. That needs a push.
8. E-1..E-5 and retention (with counsel); dead-letter retention for WhatsApp payloads.
9. C-1 channel prices.
10. Social: what one post means for N people in a journey.
11. An OMNI Story so commits can carry `Governed-By`.
12. Approve sending the coordination requests in §13 to their owners.
