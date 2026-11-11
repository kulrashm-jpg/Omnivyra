# Engine 3: Social Publishing inventory

Inspected read-only. Primary tree `C:/tmp/orch-recovery` at `dc7f2ae3`; production baseline `origin/main` at `5025f51d`. No npm, jest, tsc, network, Docker, env file or provider access. No test was run by me: every "passes" below is someone else's recorded claim, and every defect below comes from reading code, not executing it.

**Tree moved during this inspection.** At 01:32:21 IST on 2026-11-02 someone else modified the tree (`git status` now shows 8 modified files and 4 new ones, including `engineCapabilities.ts` and `executionContract.ts`). It was not me. HEAD is still `dc7f2ae3`. File:line references are to the committed revision. In `socialPublishEngineAdapter.ts` the working copy is shifted by +1 or +2 lines (one import, one `capabilities:` field). The new `SOCIAL_PUBLISH_CAPABILITIES` declaration (`engineCapabilities.ts:44-53`) is uncommitted, and I read it only as a statement of intent.

## 0. Honest status

- **The engine is real and on main.** The publish queue, the worker, the per-post claim and the uncertain-outcome protocol are all on main. `git diff --quiet origin/main HEAD` over `publishNowService.ts`, `publishProcessor.ts`, `backend/adapters`, `lib/campaign`, `pages/api/social` and `pages/api/scheduler` reports identical.
- **The orchestration adapter is on the branch only, and it only reads.** It publishes nothing. Its cron is not scheduled and is off by default (`pages/api/cron/workflow-execution-progression.ts:24-28`).
- **Personalized one-to-one outreach: NO.** See section A. This engine must not be counted as a person-level channel.
- **Provider verification: none found in the repo.** Adapters are tested with a recording `axios` double. The worker was exercised against real PostgreSQL with a **fake provider** (Closure-014B C4). Whether any platform has ever accepted a post from this code in production cannot be settled from the repo, and I was barred from querying production.

## A. Key question: does the queue support personalized one-to-one outreach?

**No, at every layer.**

| Layer | Evidence |
|---|---|
| Data model | `ScheduledPost` has account, platform, content, media and time; no recipient, person, prospect or personalization field (`backend/db/queries.ts:40-62`). |
| Job | `PublishJobData` is `{scheduled_post_id, social_account_id, user_id}` (`publishProcessor.ts:88-92`). |
| Adapters | `grep -E "recipient\|prospect_id\|person_id\|lead_id\|personaliz\|contact_id"` over `backend/adapters/*.ts`, `publishProcessor.ts`, `publishNowService.ts`, `threadPublishOrchestrator.ts`, `scheduledPostsStore.ts`: zero hits. |
| Provider calls | All are public feed or media creation endpoints (section 2). None takes an addressee. |
| Idempotency | Post-level compare-and-set, "at most once" per row (`publishNowService.ts:380`). N people cannot mean N sends. |
| Orchestration | `social_post` is defined as "PUBLIC, tenant-wide ... not addressed to anyone" (`socialPostStepContract.ts:10-11`) and is exempt from contact frequency (`journeyPolicy.ts:176-181`). |
| Where 1:1 would live | DMs are not in this engine. Every DM send is refused: `AUTHORITATIVE_DM_MAPPING_SOURCE = null` (`dmDispatchSafety.ts:55`; rationale `:11-27`). |

**Contradiction:** `lib/engagementCapabilities.ts:96,102,108,114` labels DM `status: 'api_verified', mode: 'browser'`, while `dmDispatchSafety.ts` refuses all of them and `communityEngineAdapter.ts:113` lists DM as supported given an explicit target. Reading the matrix alone overstates DM. Engine 2 / Community should reconcile this.

**Also not to be confused:** `content` (share a resource with a prospect) has no adapter here (`socialPostStepContract.ts:6-9`). The `whatsappAdapter` and `publishContent` methods in `backend/services/platformAdapters/` are a separate connector family, used by ingestion and connection tests (`engagementIngestionService.ts:158`, `pages/api/social-accounts/verify-config.ts:156`).

## B. What an orchestration journey can legitimately ask

| Ask | Legitimate? | Today |
|---|---|---|
| Observe one released post's status | Yes | **Done.** Adapter reads and classifies. Real PostgreSQL test exists; I did not run it. |
| Have a released post publish on schedule | Yes, but no request is needed: the engine does it on its own clock | Done by the engine (`schedulerService.ts:83-89`, delayed job from `boltScheduleBlockProcessor.ts:1104-1110`). |
| Cause a publication when a journey reaches a step | Only under an owner decision (section C) | **Missing by design:** `SOCIAL_POST_TRIGGER_UNSUPPORTED` (`socialPostPublicationStatus.ts:63-67`). |
| Attribute post-level or campaign-level engagement to a journey | Yes | **Missing.** Data exists (below) but no link from it to a journey. `journeyResponses.ts:7-10` reads WS-3 and WhatsApp only. `grep scheduled_post\|platform_post_id\|post_analytics` over `journey*.ts`, `workflowExecution/`, `enrollment.ts`, `campaignEnrollment.ts` hits only channel lists. |
| Attribute a post's engagement to a named person | Not honestly today | Commenter identity is scraped and unverified: `engagement_authors` is tenant-less, `identity_claims` writers all record 'unverified' (`dmDispatchSafety.ts:16-19`). Needs the same authoritative mapping DMs lack. |

Available attribution material: `post_analytics_polls` (scheduled at +15 min and +24 h, `analyticsNormalizationService.ts:155`, drained by the daily cron so the +15 min poll is not honoured in practice; inference from `analytics-ingestion.ts` being daily); comment ingestion by post (`engagementIngestionService.ts:593`); `leadDetectionService.ts:219,247` carries `scheduled_post_id`; `trackingLinkService.ts:53-56` sets `utm_source/medium/campaign/content` at campaign and slot grain, no journey or person.

## C. From observe-only to an orchestration-requested publish that keeps the approval model

**First, what the approval model actually is.** The contract says a released row "is the engine's own approved publishing object" (`socialPostStepContract.ts:18-20`). The code is weaker than that:

1. Release does not require `campaigns.status='approved'`; `release.ts` has no such check (only `approved_count` at :415,:496). `approve.ts:46` writes that status, but no gate in the release path reads it (I searched release.ts only; the campaign stage check is `stageBefore === 'draft'`).
2. Release needs only `requireCampaignAccess`; the route's own comment says so (`release.ts`, draft-only block).
3. A slot with **no** workspace copy is eligible and the scheduler generates its text (`campaignRelease.ts:20-23`). Such text reaches a platform with no human reading it.
4. Rows are inserted `status='scheduled'` outside the seam: `pages/api/scheduler/schedule.ts:480`, `activity-workspace/schedule.ts:220`, `creatorRowScheduler.ts:276`, `boltContentJobProcessor.ts:731`, plus the legacy `pages/api/social/post.ts`.
5. `scheduled_posts` carries no approver or approval provenance (searched migrations touching the table for `approved_by|approval_id`: none).

So "released" means "a user with access scheduled it", not "a human approved this copy". The adapter cannot tell an approved row from a generated one. **That matters little while the step only observes. It is decisive once a step can trigger.**

**Second, an adapter header claim to correct.** `socialPublishEngineAdapter.ts:12-17` says `publishNow` needs a verified acting user that a task lacks. Half true: the safety-net cron already calls it with `post.user_id` under a cron secret and no verified user (`process-scheduled-posts.ts:152-156`), and the queue path uses the row's `user_id` too. The missing actor is therefore **not** the blocker. The real blockers are: one object versus N tasks, no approval provenance, and no held state.

**Smallest path that extends existing code (proposal; coordinator and owner own it):**

| # | Step | Touches | Owner? |
|---|---|---|---|
| 0 | Fix G-1 (safety-net cron skips authorization) first, or a paused campaign still publishes | Engine | No |
| 1 | **Decide N→1 semantics.** A step runs per person; subjects are only `lead` and `prospect`, "adding a third is a contract change" (`subjectRef.ts:21-25`). Options: first task to reach it wins; a cohort threshold; or a campaign-level trigger outside the per-person step. Inference: a public post fired by one individual's progress is a weak product shape; I would ask the owner before building it | Contract | **Yes** |
| 2 | **Held, approved state.** Publishers select `status='scheduled'`, so any other status is inert. `draft` exists (`boltScheduleBlockProcessor.ts:916`) and no draft→scheduled writer exists (search found none), but `draft` currently means dry-run and must not be overloaded. Add a distinct hold with approver, time and content hash; only a human approval creates it, from approved workspace copy only (stricter than the seam: generated "no copy" rows excluded) | Migration (`chk_status` or columns) | **Yes** |
| 3 | **One engine entry**, e.g. `requestHeldPostRelease`: CAS hold→`scheduled` with the content hash re-checked, then `enqueueScheduledPostAt` using the row's own `user_id`. Worker then runs `authorizePostPublish`, claim, readiness and the uncertain protocol unchanged. **Never call `publishNow` or `publishToPlatform` from a journey** | Engine-local plus a test | No, after 1 and 2 |
| 4 | Do **not** reuse the release route as is: it flips the campaign to `active`, sets blueprint state and takes the scheduler lock (`release.ts`, update block) — whole-campaign side effects a person's step must not cause | n/a | n/a |
| 5 | Step contract: add `mode: 'await' \| 'request'` to `ALLOWED_KEYS` (`socialPostStepContract.ts:58`) and a new `CREATE OR REPLACE` of `publish_workflow_version` | Shared contract, migration | Coordinator |
| 6 | Adapter: `held`→call entry→`wait`; then existing classifier. Ledger: `execution_engine_requests` stays per task; N rows naming one post are acceptable because the CAS, not the ledger, decides the winner (this softens the header's "cannot express" at `:21-26`; losers simply observe) | Adapter, capability declaration, engine CHECK already includes `social_publish` | Coordinator |
| 7 | Cancellation: cancelling a journey withdraws nothing already released; an unreleased hold stays with the campaign owner | Policy | Owner |
| 8 | Workflow-level authorization: who may author a step that can publish. Reuse `published_by` on the version, plus a capability | Shared | Owner |
| 9 | Verification: real worker plus cert fake on real PostgreSQL, then a provider sandbox per platform, then one production post | External | **Yes** |

Thread roots stay `thread_unsupported` in the first version.

## 1. Capability table

"Engine" rows are identical on main and branch unless stated. "Unit" = jest with mocked Supabase and mocked provider.

| Capability | Classification | State | Where | File:line, symbols | Migrations | Tests | Ancestry |
|---|---|---|---|---|---|---|---|
| Publish router | IMPLEMENTED — NOT VERIFIED | integrated | main | `platformAdapter.ts:65` `publishToPlatform` | n/a | `universalPublishContract.test.ts` (unit) | on main |
| LinkedIn, X, YouTube, TikTok, Pinterest publishers | IMPLEMENTED — NOT VERIFIED (provider) | integrated | main | section 2 | n/a | unit, axios double (e.g. `xAdapterMediaContract`) | on main |
| Instagram publisher | IMPLEMENTED — NOT VERIFIED (provider) | integrated | main | `instagramAdapter.ts:301,490` | n/a | `instagramPublishReadiness.test.ts` (recording axios), `instagramPublishIntegrity` | `consolidate/instagram-publish-readiness` e2d7e09f IS an ancestor of main (PR #308 efacd3b2) |
| Facebook publisher | PARTIALLY IMPLEMENTED | integrated | main | text and link only; image is sent as `payload.link`; video refused (`facebookAdapter.ts:436,465`) | n/a | `facebookPagePublishIntegrity` (unit) | on main |
| Spotify publisher | IMPLEMENTED — INTEGRATION REQUIRED | disabled (unreachable) | main | code calls real API (`spotifyAdapter.ts:74,102`) but platform is not in the registry, so `publishToPlatform` returns `PLATFORM_NOT_REGISTERED` first (`platformContentValidator.ts:81-88`) | n/a | none found | on main |
| StarMaker, Suno | MOCKED / FAKE (stub) | disabled | main | `API_NOT_AVAILABLE` (`starmakerAdapter.ts:93-98`, `sunoAdapter.ts:92-97`); also unreachable as above | n/a | n/a | on main |
| Reddit, Threads, WhatsApp, Blog via this path | MISSING | registered with no adapter | main | in `PLATFORM_CAPABILITY_REGISTRY`, no `case` in `platformAdapter.ts:218-255` (G-2) | n/a | n/a | n/a |
| Mock mode | MOCKED / FAKE | active if env set | main | `USE_MOCK_PLATFORMS` returns `mock_*` ids (`linkedinAdapter.ts:73-81`, all adapters); no production refusal in `config/env.schema.ts:284-288` (G-3) | n/a | `.env.test` | on main |
| Cert fake publisher | MOCKED / FAKE (guarded) | integrated | main | `certFakePublisher.ts`; refuses outside loopback cert stack | n/a | `closure014CertFakePublisher.test.ts` | on main |
| OAuth connections | IMPLEMENTED — NOT VERIFIED | integrated | main | `pages/api/auth/{linkedin,x,facebook,instagram,youtube,tiktok,pinterest,spotify}` | baseline `social_accounts` | unit in parts | on main |
| Token storage, encryption | IMPLEMENTED — NOT VERIFIED | integrated | main | AES-256-GCM in `social_accounts` (`tokenStore.ts:66,83,124,190`) | n/a | unit | on main |
| Token refresh, reauth parking | IMPLEMENTED — NOT VERIFIED | integrated | main | `platformAdapter.ts:153-212`, `markSocialAccountNeedsReauth`, `socialAccountTokenRefreshJob` (`cron.ts:131`) | n/a | unit | on main |
| Content and media preparation | IMPLEMENTED — NOT VERIFIED | integrated | main | `validatePublishReadiness` (`publishProcessor.ts:613`), `refreshDurableMediaBeforePublish` :648, `refreshScheduledPostMediaFromRefs` :655, `xMedia.ts`, `linkedinMediaUpload.ts`, `mediaCover.ts`, `youtubeThumbnail.ts` | 20260677, 20260809 | `publishMediaHonesty` (unit) | on main |
| BOLT generate-and-schedule | IMPLEMENTED — NOT VERIFIED | integrated | main | `pages/api/bolt/execute.ts`, `boltPipelineService*`, `boltContentJobProcessor.ts:731`, `boltScheduleBlockProcessor.ts:916,1104` | 20260506, 20260725 | unit | on main |
| Campaign release seam | IMPLEMENTED — NOT VERIFIED | integrated | main | `lib/campaign/campaignRelease.ts:129`, `pages/api/campaigns/[id]/release.ts` | n/a | `campaignRelease.test.ts`, `campaign_release_seam.test.ts` | on main |
| `scheduled_posts` | IMPLEMENTED AND VERIFIED (schema on real PG only) | integrated | main | statuses `chk_status`: draft, scheduled, publishing, published, failed, cancelled, blocked (`20260808_thread_publish_states.sql:52-60`) | 20260808 and others | `orch_engines_real.test.ts` inserts real rows | on main |
| Scheduling and enqueue | IMPLEMENTED — NOT VERIFIED | integrated | main | `schedulerService.ts:63`, `schedulerPostQueueControl.ts:80,449,656` | 20261009000000 unique live job | `schedulerDuplicateGuardIntegrity`, `schedulerQueueCancellation` (unit) | on main |
| Publish worker | IMPLEMENTED AND VERIFIED (real worker, real PG, **fake provider**) | integrated | main | `publishProcessor.ts:109`, `startWorkers.ts:200`, queue opts attempts 3, backoff 60s (`bullmqClient.ts:733-743`) | n/a | `publishProcessorPostLevelIdempotency` (unit); Closure-014B C4 PASS (`docs/security/CLOSURE_014B_LOCAL_VALIDATION_RESULTS.md:72,103-135`; note the committed launcher could not start, D-14B-3) | on main |
| Post-level claim | IMPLEMENTED AND VERIFIED (same caveat) | integrated | main | `claimScheduledPostForPublish` `publishNowService.ts:380`, release :455 | no migration | `publishNowPostLevelIdempotency` | on main |
| Direct publish (button) | IMPLEMENTED — NOT VERIFIED | integrated | main | `pages/api/social/publish.ts:282`; owner check, capability :75, authorization :206 | n/a | `social_publish_authorization.test.ts` | on main |
| Safety-net cron direct publish | PARTIALLY IMPLEMENTED | integrated, gate missing | main | `pages/api/cron/process-scheduled-posts.ts:152` (G-1) | n/a | no test of the gate found | on main |
| Sweeper of stuck `publishing` | IMPLEMENTED — NOT VERIFIED | integrated | main | `pages/api/cron/sweep-stuck-publishing.ts`; vercel every 5 min | n/a | unit: `publishDuplicateWindowCrons`, `publishThreadUncertainOutcome`. Not mentioned in the C4 record | on main |
| Uncertain-outcome protocol | IMPLEMENTED AND VERIFIED (real PG, fake provider) | integrated | main | `publishOutcome.ts:175,236,284` | no migration | `publishOutcomeClassification`, `publishUncertainWriterGuards`, C4 | on main |
| Human reconciliation | IMPLEMENTED AND VERIFIED (cert, real step-up) | integrated | main | `publishOutcomeReconciliation.ts`, `pages/api/super-admin/publish/reconcile.ts` | n/a | `publishReconcileRoute`, C4 :133 | on main |
| Durable retry state (`fix/publish-retry-state`) | IMPLEMENTED — INTEGRATION REQUIRED (migration apply) | **integrated as cherry-pick** | main | `publishRetryState.ts:65,93,133`; `publishProcessor.ts:86,243,307` | **20261202000000**, tolerated if absent (`:51`) | `publishRetryStateReliability` (81 cases, mocked) | see below |
| Retry-aware blueprint guard | IMPLEMENTED — NOT VERIFIED | integrated as cherry-pick | main | `campaignBlueprintService.ts:12,276` | n/a | unit | see below |
| Provider reconciliation scan | IMPLEMENTED — NOT VERIFIED | integrated, telemetry only | main | `pages/api/cron/reconcile-recent-publishes.ts`; `providerReconciliation/providers/{facebook,instagram,linkedin,twitter}` | n/a | not checked | on main |
| Analytics at publish | MOCKED / FAKE | integrated | main | `publishProcessor.ts:842-855` records zeros, "TODO" | n/a | n/a | on main |
| Analytics polls | IMPLEMENTED — NOT VERIFIED | integrated | main | `schedulePostPolls`; `platformAnalyticsIngester.ts` (LinkedIn, IG, X, YouTube, Threads, TikTok, Pinterest, Facebook); cron 02:00 | `post_analytics_polls` has **no CREATE in `supabase/migrations`**, only `database/analytics-ingestion-schema.sql` | not checked | on main |
| Engagement comment ingestion | IMPLEMENTED — NOT VERIFIED | integrated | main | `engagementPollingProcessor.ts`, `ingestComments` `engagementIngestionService.ts:593` | n/a | `backend/scripts/engagementPhase1Validation.js` | on main |
| Journey attribution | MISSING | n/a | nowhere | section B | n/a | n/a | n/a |
| Orchestration adapter (observe) | IMPLEMENTED AND VERIFIED (real PG) by report; PARTIALLY IMPLEMENTED against the contract | integrated, disabled by flag | **branch only** | `socialPublishEngineAdapter.ts:116`; wired `workflowProgressionSweeper.ts:51,215` | 20261231000001 (engine CHECK), **20261231000004** (channel), both unapplied per file header | fake: `socialPublishEngineAdapter` (20), `socialPostAdapterSafety` (19), `socialPostStepContract` (13). Real PG: `orch_engines_real.test.ts:305-345` | 9c0e893d, 31bccc68 on branch; `feat/orch-adapter-social` b330120d, `feat/social-publish-contract` c21771d4, `test/social-post-contract-review` d85200f2 are superseded refs (not ancestors) |
| Requested publish from a step | MISSING | n/a | nowhere | `SOCIAL_POST_TRIGGER_UNSUPPORTED` | n/a | n/a | n/a |
| Thread observation | MISSING | deliberately refused | branch | `socialPostPublicationStatus.ts:81-83` | n/a | unit | branch |
| Usage and credit on publish | MISSING | n/a | n/a | no `credit` hit in `publishProcessor`, `publishNowService`, `platformAdapter`, `release.ts`, `social/publish.ts`. Generation is metered separately (`boltContentJobProcessor.ts:309,339`). `creditMetered: false` in the uncommitted declaration agrees | n/a | n/a | n/a |
| Authority layer `orchestration/publishing/` | IMPLEMENTED — NOT VERIFIED | **not this engine; SHADOW by default** | main | see below | n/a | none found by name or by `enforceSchedulerEligibility` | 4c16340f, on main |

**Retry branch answer.** `fix/publish-retry-state` 0f1aaad1 and `fix/blueprint-guard-retry-aware` d809d930 are **not ancestors** of main or the branch, yet **their content is on main**: `git patch-id --stable` is identical for 0f1aaad1 ≡ 488311e9 (`b17f2d6b`) and d809d930 ≡ 1226b55d (`ae888bf8`), and both of those are ancestors of main. The migration `20261202000000_queue_jobs_retry_state.sql` and its rollback are on main. `git cherry origin/main` marks both `-` (equivalent commit upstream), so treat the two refs as **superseded**. Main has since extended `publishRetryState.ts` (+51 lines) and `retry.ts`. The memory entry calling this "LOCAL" is stale.
**Applied in production?** Not determinable here. `CLOSURE_014B:143` says "unapplied ... per earlier reports, production". The code runs without it, but then exhaustion is invisible (O-1, `:180`).

**`backend/services/orchestration/publishing/` is not the outreach engine and shares only a name.** It is the "Phase-2" CMS and scheduler authority over `daily_content_plans`: `index.ts:1-6` "SHADOW-default (diff-only)". Mode comes from `ORCHESTRATION_GENERATION_CUTOVER`, defaulting to SHADOW (`generationCutoverManager.ts:32-35`). Consumers: `structuredPlanSchedulerExecWeeklyB.ts:323,341`, `repurpose-and-schedule.ts:129,133`. A grep shows no `scheduled_posts` access in that directory. It neither publishes nor is related to `socialPublishEngineAdapter`. `index.ts` of the parent exports both senses of "orchestration", which invites confusion. Do not route journeys through it.

## 2. Providers and adapters

Route: `publishToPlatform` → validator → cert fake check → account → token → refresh → adapter. Real-code does not mean provider-verified.

| Platform | Reality | Entry | Provider API |
|---|---|---|---|
| LinkedIn | Real | `linkedinAdapter.ts:68` | `POST api.linkedin.com/rest/posts` (:232), version `202608` pinned in 3 places (:66); media via `/rest` (`linkedinMediaUpload.ts:111`) |
| X | Real, native reply chain | `xAdapter.ts:72` | `POST api.twitter.com/2/tweets` (:93,:196); `api.x.com/2/media/upload` (`xMedia.ts:57`) |
| Instagram | Real; image and Reels; silent carousel refused | `instagramAdapter.ts:301` | `graph.facebook.com/v22.0/{ig}/media` (:210,:246), `GET` container status (:124), `/media_publish` (:282), permalink (:183) |
| Facebook | **Partial**: Page text and link; image is passed as `link` (:436), not uploaded; video refused (:465) | `facebookAdapter.ts:311` | `POST graph.facebook.com/v22.0/{page}/feed` (:340,:495) |
| YouTube | Real | `youtubeAdapter.ts:348` | Resumable `googleapis.com/upload/youtube/v3/videos` (:249-273), metadata `PUT` (:304,:448), thumbnails (`youtubeThumbnail.ts:60`) |
| TikTok | Real, `FILE_UPLOAD` | `tiktokAdapter.ts:210` | `open.tiktokapis.com/v2/post/publish/video/init/` (:104), upload `PUT` (:160), `/status/fetch/` (:186) |
| Pinterest | Real | `pinterestAdapter.ts:105` | `api.pinterest.com/v5/pins` (:147), `/v5/boards` (:66,:85) |
| Spotify | Real code, **unreachable** | `spotifyAdapter.ts:121` | `api.spotify.com/v1/users/{id}/playlists`, `/playlists/{id}/tracks` (a playlist, not a post) |
| StarMaker, Suno | **Stub** | `API_NOT_AVAILABLE` | None |
| Reddit, Threads, WhatsApp, Blog | **No publish `case`** | n/a | n/a (blog goes through CMS, section 8) |

The user-facing gate `VERIFIED_PUBLISH_PLATFORMS` (`lib/engagementCapabilities.ts:182`) covers linkedin, facebook, instagram, twitter, youtube, tiktok, pinterest. It marks all of them `api_verified`; that word is a code-path label, not evidence of a provider test. The gate is applied at `social/publish.ts:75`; I found no call in `publishProcessor`, `publishNowService` or `publishReadinessValidator`. Facebook `post_create` `api_verified` overstates, given no real image or video upload.

Note: `chk_platform` in `database/comprehensive-scheduling-schema.sql:698` allows only 5 platforms. Its presence in production is unknown, and a search of `supabase/migrations` found no such constraint.

## 3. Reach: routes, queues, workers, crons, events, credit

**Other ways to reach the engine than the adapter (all live, none via orchestration):**
- Scheduling: `POST /api/campaigns/[id]/release`, `/api/campaigns/[id]/schedule-structured-plan`, `/repurpose-and-schedule`, `/api/bolt/execute`, `/api/scheduler/schedule`, `/api/schedule/posts*`, `/api/schedule/reschedule`, `/api/activity-workspace/schedule`, `[id]/reschedule`, `[id]/unschedule`; legacy `/api/social/post` ("LEGACY ENGINE - DO NOT EXTEND").
- Immediate: `POST /api/social/publish`.
- Recovery: `POST /api/scheduler/retry`, `/api/super-admin/publish/reconcile`.

**Queue and workers:** BullMQ `publish` (`bullmqClient.ts:733`), consumer `startWorkers.ts:200`, also standalone `queue/workers/publishWorker.ts`, `backend/workers/main.ts` references the pipeline, `prodConsumed: true` (`workerTopologyManifest.ts:63`). Per-tenant lease cap 5 (`publishProcessor.ts:141-148`). `posting` queue exists at `bullmqClient.ts:591`; I did not establish whether it has a consumer.

**Crons:** in-process `findDuePostsAndEnqueue` safety net (`cron.ts:1079`), working-hours gated. Vercel: `process-scheduled-posts` `0 3 * * *`, `sweep-stuck-publishing` `*/5`, `reconcile-recent-publishes` `*/10`, `analytics-ingestion` `0 2 * * *` (`vercel.json`). `workflow-execution-progression` is **not** scheduled.

**Event producers:** `logActivity 'post_published'` and `'post_publish_failed'` (`publishProcessor.ts:879,1020`), `createUserNotification` (:1031), `schedulePostPolls` (:864), `notifyExperimentAssetPublished` (:815), `checkAndCompleteCampaignIfEligible` (:890), `queue_job_logs`. **Nothing emits an orchestration event** (`grep orchestrationEvents` over publisher files: none). The adapter polls.

**Provider responses:** `PublishResult` holds only id, url, time and error (`platformAdapterTypes.ts`). Raw bodies are not persisted; `queue_jobs.result_data` holds id and url (`publishProcessor.ts:826-831`). `reconcileRow` snapshots hold later reads.

**Credit:** no metering at publish (section 1).

## 4. Compliance matrix: 18 contract fields

| Field | Status | Where / from what |
|---|---|---|
| Engine identifier | Satisfied | `engine: 'social_publish'` (`adapter:121`), `ENGINE_NAMES` (`engineAdapters.ts:65`) |
| Capability declaration | Mappable; **uncommitted** | `SOCIAL_PUBLISH_CAPABILITIES`; `channels` committed. Platform list only in `lib/engagementCapabilities.ts` |
| Supported channels and action types | Satisfied for `social_post`/observe | `SOCIAL_PUBLISH_CHANNELS` |
| Authorization context | Partial | Tenant checked (`adapter:149-156`); the row's `authorizePostPublish` re-evaluated; no approver provenance exists (section C) |
| Tenant and prospect references | Tenant satisfied; prospect deliberately unused | `ctx.organizationId` vs `social_accounts.company_id`. A test confirms the subject does not affect the read (`socialPostAdapterSafety.test.ts:436`) |
| Workflow and journey references | Satisfied in the context | `EngineStepContext` ids; not persisted by this adapter (no ledger row) |
| Recipient or destination | Mappable as destination only | Row's `social_account_id` and `platform`. **No recipient: never will be** |
| Rendered content or action payload | Mappable, engine-owned | Row `content`, `media_urls`; adapter deliberately carries none and only tests `has_content` |
| Idempotency key | Not applicable now; missing if requested | Pure read. Engine key is `scheduled_posts.id` by CAS. `executionIdempotencyKey` (uncommitted) would be per task |
| Correlation ID | Mappable | `executionCorrelationId` from instance and step (uncommitted). Not on the post or `queue_jobs` |
| Execution request | **Missing** | Observe only. `execute` is a read |
| Execution result | Satisfied | `EngineResult` |
| Delivery status | Partial | `outcome`; publish acceptance only. Public post has no delivery |
| Error classification | Satisfied | `classifyScheduledPost`; engine `error_code`, `classifyPublishAttempt` |
| Retryability | Partial | `disposition`; `queue_jobs.retry_state` **not read**, so a post in BullMQ backoff reports `publish_failed` (`socialPostPublicationStatus.ts:127-131`) |
| Usage and credit | **Missing** | No metering; honest zero |
| Outcome event | **Missing** | None emitted; polled on each sweep. No journey event for engagement |
| Audit metadata | Partial | Decision log of sweeper; engine `queue_job_logs`, `logActivity`. No link between them except `externalRef` = post id |

## 5. Status mapping

Engine fact → contract state. The adapter maps nothing yet; `normalizeEngineResult` (uncommitted) may not know these outcomes, so the coordinator should test them.

| Contract | Engine fact | Honest? |
|---|---|---|
| REQUESTED | None: step requests nothing | **No honest mapping** today. Would be hold-release request |
| AUTHORIZED | `authorizePostPublish` passes at read time on `scheduled` | Weak: predicate, not approval evidence |
| QUEUED | `scheduled` with a live `queue_jobs` row (`pending`), or `awaiting_publication` | Yes, though the adapter does not read `queue_jobs` |
| EXECUTING | `publishing` with `PUBLISH_CLAIMED:` or `PUBLISH_CALL_STARTED` | Yes |
| ACCEPTED | `platform_post_id` set, `published` | Yes: the provider returned an id |
| DELIVERED | None | **No honest mapping.** A public post has no addressee. Do not map `published` to it. `provider reconciliation` only confirms existence |
| FAILED | `failed` with `retry_state='exhausted'` and a classified code | Yes, if `retry_state` exists |
| RETRY_REQUIRED | `failed` with `awaiting_retry` is automatic; `PUBLISH_RECONCILED_NOT_PUBLISHED` needs a person to retry | Partial; adapter reports all as `publish_failed` |
| CANCELLED | `cancelled` | Yes |
| REJECTED | `blocked`, `draft`, gate codes `PUBLISH_BLOCKED_*`, `not_released`, `reference_not_found`; `CAPABILITY_*` on a job | Yes |
| (uncertain) | `PUBLISH_OUTCOME_UNCERTAIN`, `PUBLISH_CALL_STARTED`, `published` without an id | **Must not map to FAILED or RETRY_REQUIRED.** Keep last known state with certainty `uncertain` |

Also `thread_unsupported`, `read_failed` and `reference_missing` have no state of their own; they are refusals or not-acted-yet.

## 6. Gap register

| Id | Gap | Sev | Evidence | Smallest fix | Scope | Owner? |
|---|---|---|---|---|---|---|
| G-1 | **Safety-net cron publishes with no authorization predicate.** A `scheduled` post on a paused or inactive campaign is published at 03:00 UTC, even though queue path, scheduler and button all check. Selects `campaign_id`, never uses it. `publishNow` deliberately does not check | **High** | `process-scheduled-posts.ts:61-63,152`; `publishNowService.ts:303-306`. No test found. Static reading; not executed. Did not establish whether pausing cancels rows; `cancelScheduledPostQueueEntry` callers do not include a campaign pause route | Fetch campaign statuses, call `authorizePostPublish` in the loop as `schedulerService.ts:218` does | **Engine-local** | No |
| G-2 | Registered platform with no adapter becomes **falsely uncertain**: `dispatched = true` precedes the `switch`, so `Unsupported platform` lacks `not_sent` and classifies `ambiguous`, requiring human reconciliation of something never sent | Med | `platformAdapter.ts:217,253-254,266`; `publishOutcome.ts:243-246` | Move flag into cases or return `not_sent` in `default` | **Engine-local** | No |
| G-3 | `USE_MOCK_PLATFORMS` has no production refusal, and a mock id reads as `published`, completing journey steps. The cert fake has strict guards; this does not | Med | `config/env.schema.ts:284-288`; adapters | Refuse at config load when `NODE_ENV=production` or a deployment marker is set. Production value unchecked | **Engine-local** | Prod value: owner |
| G-4 | Definite rejection retried despite `retryable:false`; `queue_jobs.attempts` stays 0 (recorded O-1) | Low | `CLOSURE_014B:141-143,180` | `UnrecoverableError` for `not_sent` or non-retryable | Engine-local | No |
| G-5 | Adapter ignores `retry_state`; a post in backoff shows `needs_human` for 1-2 minutes | Low | `socialPostPublicationStatus.ts:127-131` | Add read of `queue_jobs` and `classifyPostQueueJobs` → `wait` | Engine-local (adapter file) | No |
| G-6 | Approval claim overstated; no provenance on row | High if triggering; Low now | Section C | Correct the comment now; hold with approver if triggering | Comment local; column is migration | Owner for design |
| G-7 | No requested publish | Product | Section C | Section C | Shared, migration | **Yes** |
| G-8 | No engagement attribution, no outcome event | Med | Section B | Read-only `post_id`→engagement view by journey link | Shared event contract | Coordinator |
| G-9 | Migrations 20261231000001 and 000004 unapplied; 20261202000000 prod state unknown | Med | Headers; `CLOSURE_014B:143` | Runbook order | Migration | Owner |
| G-10 | Facebook capability label `api_verified` but no image upload or video | Med | Section 2 | Label `post_create` partial, or implement `/photos`, `/videos` | Engine-local (shared map read by UI) | Product |
| G-11 | Publish capability matrix is enforced only by the button | Low | Section 2 | Call in worker | Engine-local | No |
| G-12 | At-publish analytics writes zeros; may read as real zero engagement | Low | `publishProcessor.ts:842-855` | Remove the write or mark as placeholder | Engine-local; verify readers first | No |
| G-13 | `post_analytics_polls` has no migration in `supabase/migrations` | Med | `git grep` result | Add idempotent migration after checking production | Migration | Owner |
| G-14 | No provider sandbox verification on any platform | High for claims | Section 0 | Per-platform sandbox run | External | **Yes** |
| G-15 | Adapter header overstates "verified user" as the blocker | Low | Section C | Comment fix | Engine-local | No |

## 7. External dependencies (names only)

- Credentials: `LINKEDIN_CLIENT_ID/SECRET`, `TWITTER_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET`, `YOUTUBE_CLIENT_ID/SECRET` in `config/env.schema.ts`. TikTok, Pinterest and Spotify were not matched by my schema grep, so their variable names are undetermined here (see `backend/auth/oauthCredentialResolver.ts`).
- Encryption and infrastructure: `ENCRYPTION_KEY`, `REDIS_URL`, `CRON_SECRET`.
- Flags: `WORKFLOW_ORCHESTRATION_ENABLED`, `USE_MOCK_PLATFORMS`, `PUBLISH_GUARD_MODE`, `DURABLE_MEDIA_REFS`, `ORCHESTRATION_GENERATION_CUTOVER`, `CERT_ENV`, `CERT_FAKE_PUBLISHER`.
- Platform permissions (from adapter headers, not verified): LinkedIn posts API product approval; Meta Page and Instagram publishing permissions and App Review; YouTube `youtube.upload`, quota; TikTok Content Posting API audit; Pinterest API access; X API tier.
- Webhooks: **none** in this engine. Status comes from the provider's synchronous answer; analytics and comments are polled.

## 8. Duplicates and competing implementations

| Item | Nature | Verdict |
|---|---|---|
| Three publish paths: queue, `publishNow` via cron, `publishNow` via button | Share claim, router and outcome protocol. **Gate differs (G-1)** | Keep; fix the gate |
| `backend/services/socialPlatformPublisher.ts` | Second `publishToPlatform`, `@deprecated`; no importer found by `socialPlatformPublisher'` outside tests | Superseded |
| `backend/services/platformAdapters/*` `publishContent` | Separate connector family, used for ingestion and config tests; not reached by the publish route | Parallel; do not route publishing here |
| `backend/services/publishingJobService.ts`, `publishReconciliationService.ts`, table `publishing_jobs`, `scripts/run-publishing-worker.ts` | **CMS and blog** publishing with `provider_response` columns, polled from `workers/main.ts:680`. Different domain, similar names | Not a duplicate; do not confuse |
| `orchestration/publishing/` | Content-plan authority, shadow | Not this engine |
| `orchestration/distributed/domain/production/productionCampaignHooks.ts`, `bullmqJobIdParity.ts` | Injected `publishPost` hook, a content-addressed job id builder; a second idempotency idea | Scaffold: status not established; do not extend without inspection |
| `backend/integration/publishIntegration.ts` | Post-publish helpers; the processor inlines the same calls. No importer found | Likely dead (inference) |
| `pages/api/social/post.ts` | Legacy schedule writer | Superseded by its own header |
| `feat/orch-adapter-social`, `feat/social-publish-contract`, `test/social-post-contract-review` | Pre-integration refs of adapter work | Superseded by 31bccc68, 9c0e893d |

## Doc and memory versus code

- `docs/orchestration/VERIFICATION-AND-BLOCKERS.md:12` "cannot publish per person": correct, but it states the blocker as per-person only. Approval provenance and held state are also missing.
- `TENANT-JOURNEY-APPROVAL-DESIGN.md:33` "Social publish needs none, because it observes a post approved elsewhere": overstated (section C); fine only while observe-only.
- `socialPostStepContract.ts:18-20`: overstated (section C).
- `publishRetryState.ts`, `publishOutcome.ts` comments: consistent with code.
- Memory "retry d809d930 LOCAL": stale; content is on main.

## Brief compliance note

A recursive filename-only `grep -rln USE_MOCK_PLATFORMS .` scanned `.env*` files in the tree and listed `.env.test`. No value was printed or read by me, but it went closer to the "do not open `.env*`" rule than intended.

## What I could not determine

- Whether production has `retry_state` applied, whether `USE_MOCK_PLATFORMS` is set, and whether any real post has gone out. All need production access, which this brief forbids.
- Whether a campaign pause cancels its scheduled rows (searched callers of `cancelScheduledPostQueueEntry`; none is a pause route, but a separate update could exist). This affects G-1's blast radius.
- Whether `posting` queue has a consumer, and whether `/api/scheduler/schedule` restricts `platform` to adapter-backed values (affects G-2's reach).
