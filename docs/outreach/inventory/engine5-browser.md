# Engine 5: Browser Automation inventory

Refs: recovery branch `feat/orchestration-recovery` dc7f2ae3 (`C:/tmp/orch-recovery`, clean), `origin/main` 5025f51d. Read-only. Nothing was executed: no jest, no browser, no database, no production or provider access.

Line numbers are for the recovery branch unless prefixed `main:`.

## 0. Honest status

**There is a real browser engine, and it is not the adapter.** Three separate things are called "browser":

| # | Thing | What it really is | Status |
|---|---|---|---|
| A | `orchestration/browserEngineAdapter.ts` | A pure refusal stub. Claims no channel, imports nothing, answers every request `unsupported` + `needs_human` | Correct by design; it counts as zero capability |
| B | `rpaWorker/*` (Playwright) | Real server-side headless Chromium code that performs **reply and like** on 5 platforms using one stored per-org browser session. Reached only through the community executor (`runRpaExecution`) | Implemented; **never verified against any real platform**; safety hardening is branch-only |
| C | Chrome extension (`/api/extension/*`) | Server-side half is real (lease, claim, result). The client that performs the action is **not in this repo and not on this machine** | Server half only; the performing code cannot be inspected |

**Answers to the brief's direct questions:**

- **Is RPA really a transport for community actions?** Yes. Both B and C are execution modes of one engine: `executeAction` switches on `api | rpa | browser | manual` (`communityAiActionExecutorRuntime.ts:646-706`). **No second execution path should be built, and the browser adapter should stay a refusal stub.** If journey access is ever wanted, it goes through the existing `community` adapter.
- **The prior report's conclusion holds, but three of its stated reasons are now wrong, and one thing is missed.** See section 9.
- **What the prior report misses:** RPA is already reachable from a journey, indirectly. `classifyCommunityAction` refuses `rpa` only for DMs (`communityEngineAdapter.ts:149`). A linked `reply` or `like` row with `execution_mode='rpa'` passes to `executeAction` (`:772`), which runs `runRpaExecution`. Today this is fenced only by the community identity-link blocker, not by anything in the browser adapter. This is the most important fact for the coordinator.
- **Does a deployed process run this?** The deployed worker has the means: `railway.json` builds `Dockerfile.worker`, which installs Chromium (`:50`), and the co-located scheduler runs `rpaRetryQueueFlush` every 90s (`cron.ts:243,871-898`). Whether any action has ever run in production could not be determined, because production was out of scope. The queries that would settle it are in section 10.
- **Production hazard:** `origin/main` carries the **unhardened** RPA path. All safety commits (c9ab8fbe, 9eac466d, 1b96251f, b3b9f929) are ancestors of the branch and **not** of main (`git merge-base --is-ancestor` results). See GAP-01.

## 1. Capability table

"Fake" below means Playwright, the database or both were injected or mocked. No test launches a browser against a platform: `communityExecutionSafety.rpa.test.ts:12` says so explicitly ("No real browser is launched").

| Capability | Classification | State | Where | File:line, symbols | Migrations | Tests | Ancestry |
|---|---|---|---|---|---|---|---|
| Browser orchestration adapter | IMPLEMENTED AND VERIFIED (as a refusal only) | disabled | branch only | `browserEngineAdapter.ts:115-131` `createBrowserAdapter`; allowlists empty `:54,57,60`; registered `workflowProgressionSweeper.ts:216` | none needed | `browserEngineAdapter.test.ts` (fake); `realschema/orch_engines_real.test.ts:388-399` (**real PG**, refusal only) | 84a2a469, branch yes, main no |
| Playwright runner | IMPLEMENTED — NOT VERIFIED | integrated | main (unsafe version); hardened on branch | `rpaPlaywrightRunner.ts:155-275` `runRpaScript` | n/a | `communityExecutionSafety.rpa.test.ts` (fake Playwright) | c9ab8fbe branch only for hardening |
| Reply (5 platforms) | IMPLEMENTED — NOT VERIFIED; post-condition vacuous | integrated | main + branch | `rpaPlatformScripts.ts:30-265` `replyScripts` | n/a | Fake only; selectors never checked against a live DOM | old on main; `commit` flags c9ab8fbe |
| Like (5 platforms) | IMPLEMENTED — NOT VERIFIED; wrong-target risk | integrated | main + branch | `rpaPlatformScripts.ts:267-412` `likeScripts` | n/a | Fake only | as above |
| share / follow / schedule / DM by RPA | MISSING | n/a (refused) | n/a | Refused: `rpaWorkerService.ts:166-168`, `rpaTargetUrlPolicy.ts:35-39`, `rpaPlatformScripts.ts:427`; DM `communityAiActionExecutorContracts.ts:604-606` | n/a | `communityExecutionSafety.targets.test.ts` (fake) | n/a |
| Target URL policy | PARTIALLY IMPLEMENTED (host only, not path) | integrated | branch only | `rpaTargetUrlPolicy.ts:77-126` `validateRpaTarget`; callers `rpaWorkerService.ts:196`, runner `:158` | n/a | `communityExecutionSafety.targets.test.ts` (pure) | c9ab8fbe; file absent from main (`git cat-file -e` fatal) |
| In-process queue | IMPLEMENTED — NOT VERIFIED | integrated | main unsafe; branch safe | `rpaTaskQueue.ts:24-29,31-56`; main `main:rpaTaskQueue.ts:27-36` retries any failure and any throw | none (memory only, lost on restart) | `.rpa.test.ts:205-241` (fake) | c9ab8fbe |
| Durable retry | IMPLEMENTED — NOT VERIFIED on real PG | integrated | main unsafe; branch safe | `rpaRetryQueue.ts:50-104` `enqueueRpaRetry`, `:142-179` claims, `:190-294` flush; `rpaWorkerService.ts:122-132` `runClaimedRetryAction` | 20260528 (table), 20261231000002 (claim) | `communityExecutionSafety.retryQueue.test.ts` (mocked DB) | c9ab8fbe |
| Per-org admission | IMPLEMENTED — NOT VERIFIED | integrated | main + branch | `rpaQueueState.ts:80-99,141-199,272-283`; cron `:815-839` | 20260529 | No dedicated real test found | on main |
| Session encryption | IMPLEMENTED — NOT VERIFIED on real PG | integrated | branch only; **main stores plaintext** | `rpaSessionStore.ts:121-141,151-170,222-277`; main `main:rpaSessionStore.ts:57,104,121` | 20260527; 20261231000010 | `rpaSessionSecurity.test.ts`, `rpaLegacySessionInvalidation.test.ts` (mocked) | 9eac466d, 1b96251f |
| Session account identity | MISSING | n/a | n/a | `rpa_sessions` has no account or owner column (20260527:35-47) | gap | none | n/a |
| Session liveness / login-wall detection | MISSING | n/a | n/a | Only `expires_at` and decryptability are checked (`rpaSessionStore.ts:205-220`). Runner has no logged-out check | n/a | none | n/a |
| Session capture | PARTIALLY IMPLEMENTED; no UI, client absent | parked | main + branch | Routes in section 3; `rpaSessionImporter.ts:56-91`. No component, hook or page calls `/api/rpa/*` (`git grep` empty) | 20261231000005 (redemptions) | `rpaSessionSecurity.test.ts`, `rpaAuthTokenRedemptionPrune.test.ts` (mocked) | 9eac466d, b3b9f929 |
| RPA auth tokens | IMPLEMENTED — NOT VERIFIED on real PG | integrated | branch hardened; main replayable | `rpaAuthTokens.ts:72-87` issue, `:89-121` verify, `:169-219` consume; main uses `verifyRpaAuthToken` only | 20261231000005:340 | as above | 9eac466d |
| Cancellation | IMPLEMENTED — NOT VERIFIED | integrated | main + branch | `pages/api/rpa/cancel.ts`; `rpaCancellationChecker.ts:17-42`; runner `:72-74,266-268` | `cancel_requested_at` column (migration not traced) | `.rpa.test.ts:154` (fake) | on main; classified c9ab8fbe |
| Screenshot evidence | PARTIALLY IMPLEMENTED | integrated | main + branch | runner `:224-247`; `rpaArtifactStore.ts:63-119`; prune `:126-147`, cron `:926-942` | 20260527:77-149 | `sec91EStorageObjects.test.ts` (not opened; no real-storage evidence found) | d8ab3c0d on main |
| Outcome classification (`may_have_acted`) | IMPLEMENTED — NOT VERIFIED on real browser | integrated | branch only | `rpaWorkerService.ts:30-44`; runner `:191-208,249-258,265-269`; executor `Contracts.ts:621-672` | 20261231000002 (`uncertain`) | `.rpa.test.ts`, `.executor.test.ts` (fake) | c9ab8fbe |
| Stuck-row reaper | IMPLEMENTED — NOT VERIFIED here | integrated | branch only | `cron.ts:750` `reap_community_ai_action_leases`; 20261231000005:88 | 20261231000005 | `extensionDispatchSafety.*` (not opened). Real-PG status is Engine 4's to report | 9eac466d |
| Human review of `uncertain` | MISSING | n/a | n/a | Notification only (`Runtime.ts:741-757`). `git grep "'uncertain'" pages components` hits only the extension routes. `listStaleRpaRetryClaims` is reduced to a count (`rpaRetryQueue.ts:398`) | n/a | none | n/a |
| Extension server side | IMPLEMENTED — INTEGRATION REQUIRED | integrated | main; hardened on branch | `pages/api/extension/commands.ts`, `action-result.ts`, `dispatch/renew.ts`; RPC `claim_community_ai_browser_command` | 20261231000005:229 | `extensionDispatchSafety.routes.test.ts` (not opened; no real-PG evidence found). Source-dependent suites **skip** without `OMNIVYRA_EXTENSION_ROOT` | 9eac466d |
| Extension client | BLOCKED BY EXTERNAL DEPENDENCY | parked | **nowhere** | `backend/tests/helpers/extensionSourceRoot.ts:4-5`: "NOT in this repository". See section 3.4 | n/a | n/a | n/a |
| `redditRpaHandler` | MOCKED / FAKE in effect | superseded | main + branch | `rpaWorker/redditRpaHandler.ts:34-71`; `ensureSession` empty `:25-27`; zero callers | n/a | none | dead |
| `redditDiscoveryRpa` | IMPLEMENTED — NOT VERIFIED | parked (no caller) | main + branch | `redditDiscoveryRpa.ts:43-67`; only `discoverUsersFromRpa` calls it, and that has no caller in pages, cron, workers or services | n/a | none | dead; unvalidated `source_url` |
| `networkActionCandidateService` rpa branch | PARTIALLY IMPLEMENTED | parked (no importer found) | main + branch | `:19`, `:155` `target_id = profile_url` | n/a | none | a `like` at a profile URL would hit the wrong target if revived |

## 2. Playwright and puppeteer census, separated

| Category | File | Role | Authenticated? | Acts toward a person? |
|---|---|---|---|---|
| **Product action** | `rpaWorker/rpaPlaywrightRunner.ts`, `rpaEnv.ts` | The only live acting path | Yes, stored session | **Yes** |
| Dead product | `rpaWorker/redditRpaHandler.ts` | Unreferenced | No | Would, but no session |
| Crawler, internal | `networkExpansion/rpaDiscoveryHandlers/redditDiscoveryRpa.ts` | Scrapes usernames; no caller | No | No |
| Crawler, deployed | `ads/adsAcquisitionRunner.ts:39-40`, `ads/adsTransparencyBrowserClient.ts`, scheduler `adsAcquisitionScheduler.ts` | Ad transparency acquisition. `adsTransparencyBrowserClient.ts:13` deliberately does **not** reuse the RPA session model. Flag `ADS_TRANSPARENCY_ACQUISITION_ENABLED` | No | No |
| Rendering | `export/htmlToPdfRenderer.ts:33-34` | PDF; Playwright or paths | No | No |
| Rendering | `puppeteer-core` + `@sparticuz/chromium`: `next.config.js:33-48`, `pages/api/reports/[reportId].ts:461` | Vercel PDF export | No | No |
| Soak only | `creatorRenderDurableQueue.ts:195-209`, `scripts/run-bullmq-soak.ts` | Chromium launch under load | No | No |
| Test / tooling | `tests/auth/authTestHarness.ts`, `scripts/run-auth-integrity-tests.js`, `scripts/validate-super-admin-analytics-e2e.ts`, `scripts/perf/journey.ts`, `.github/workflows/auth-integrity.yml`, `docs/beta-testing.md` | E2E on our own app | Own app only | No |
| Not a browser user | `leadIntelligenceEngine/visitorContext.ts:83` (UA regex), `betaMockRenderProvider.ts:9` (comment), `reportCardServiceAssembly.ts:440` (comment) | False positives from search | n/a | No |

No stealth, proxy, fingerprint or anti-detection code was found in `rpaWorker/*`. The runner launches default headless Chromium (`:195-196`), which on the deployed path runs from a Railway datacentre IP (inference from the Dockerfile and worker layout).

## 3. Routes, queues, workers, accounting, reachability

### 3.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/rpa/auth/start` | User + `enforceCompanyAccess` + `MANAGE_CONNECTORS` on branch (`:51-65`). **Main: company access only** (`main:start.ts:48`) | Issues token + login URL |
| `POST /api/rpa/auth/save-session` | Bearer token, single-use on branch (`:62`). **Main: replayable, stores client `account_tier`** (`main:save-session.ts:57,63`) | Stores storageState |
| `POST /api/rpa/auth/complete` | As above (`:73`) | Stores extension capture via `importSessionCapture` |
| `GET /api/rpa/auth/callback` | Token verify only, no consume (`:35`) | Status read; never returns blob |
| `POST /api/rpa/cancel` | Company access, **no role check** (`:34`) | Stamps `cancel_requested_at` |
| `POST /api/community-ai/actions/execute` | `EXECUTE_ACTIONS` role (`:44-48`). Accepts client `execution_mode`, including `rpa`, overriding the row (`:106`) | Main entry that can select RPA |
| `/api/extension/*` | `requireExtensionAuth` (token + HMAC) | Engine 4 detail |

There is **no route to delete or disconnect a session**: `deleteRpaSession` (`rpaSessionStore.ts:309`) has no caller.

### 3.2 Queues, workers, crons

| Item | Where | Note |
|---|---|---|
| In-process queue | `rpaTaskQueue.ts` | Serial per process; `startRpaWorker` is called per task (`rpaWorkerService.ts:224`) |
| `rpa_retry_queue` | `rpaRetryQueue.ts` | Row only for provably-not-acted deferrals on the branch. 5 attempts, backoff capped at 120 min, 50 per tick (`RPA_FLUSH_MAX_TASKS_PER_TICK`) |
| `rpaRetryQueueFlush` | `cron.ts:871-898`, 90s | `scheduleWorker` has no intent gate in its body (`cron.ts:448-482`). Registered in the cron snapshot test |
| `rpaBackpressureObserver` | `cron.ts:815-839`, 60s | `rpa_queue_state` |
| `rpaArtifactPrune` | `cron.ts:926-942`, 6h | 7-day retention |
| Lease / executing reaper | `cron.ts:750` | Branch: moves to `uncertain` |
| `assertRpaEnvReady` | `rpaEnv.ts:80`, re-exported `rpaWorkerService.ts:55` | **No caller**; the "worker startup gate" comment is dead |

### 3.3 Where it actually runs (deployment)

1. **Web plane (Vercel).** `executeRpaTask` runs in the API route. `rpaEnvReady` tries to launch Chromium; `healthServer.ts:93-94` says Vercel carries only `@sparticuz/chromium`, which cannot run this. Inference: the probe fails, and the task defers to `rpa_retry_queue`.
2. **Worker plane (Railway).** `railway.json` builds `Dockerfile.worker`, whose `CMD` is `dist/backend/workers/main.js`, and Chromium is installed at `:50`. `CRON_SERVICE_MODE` defaults to `colocated` (`workers/main.ts:639`). So the deployed worker flushes retries, and that is where the browser really runs.
3. `Dockerfile.cron` skips the browser and its header says it is not deployed. If the split (`worker-only`) is ever enabled, `flushRetries` would run in an image with no Chromium, and RPA would silently stop draining: `rpaWorkerService.ts:74-78` skips the tick. Hazard noted, not current.

**Isolation:** one new browser and context per task, closed in `finally` (`:195-197,270-274`). Concurrency goes through `withHeavyJobSlot`, shared with AI and render jobs (`rpaWorkerService.ts:148`). The Chromium process shares the worker's container, environment and service-role credentials: no OS sandbox boundary or per-tenant process was found. The executor's timeout does not kill a run: `withTimeout` (`Contracts.ts:513-523`) only stops waiting, and the browser keeps going while the row is marked `uncertain`. That is correctly classified, but the run can still complete afterwards.

**How a row reaches RPA:** only by explicit `execution_mode='rpa'`. Auto-resolution never picks it (`Contracts.ts:414-435`: api, else browser). Writers: `execute.ts:106` (client-supplied), `playbookEvaluator.ts:63` when `api_allowed` is false and `rpa_allowed` is true, consumed (inference from the variable name; the assignment was not traced) by `communityAiOmnivyraService.ts:195` and `communityAiAutoRuleService.ts:336`. `PlaybookEditor.tsx:50` defaults `rpa_allowed` to false. `resolveExecutionMode` comment at `:410-412` claims a fallback "api → browser → rpa", but code never falls back to rpa: the comment is wrong.

**Usage/credits:** `checkUsageBeforeExecution` on `automation_executions` (`Runtime.ts:623-635`) and `recordUsage` on success (`:725`). No credit deduction specific to a browser run was found. Chromium cost is not metered per action. On the branch, `uncertain` does not call `recordUsage` (`:741-757`), so a possibly performed action is not counted.

**Events:** `community_ai_execution_metric_events` (`execution_mode='rpa'`, read by `rpaQueueState.ts:124-133`), notifications and webhooks (`Runtime.ts:710-757`), `logCommunityAiActionEvent` (`Runtime.ts:539,553`). No RPA-specific orchestration outcome event exists.

### 3.4 Extension source

**Not on this machine; provenance not recorded.** Evidence:

- `backend/tests/helpers/extensionSourceRoot.ts:4-5`: not in this repo, "deliberately not vendored: its licence/provenance is not recorded here".
- Earlier hard-coded path, from `git show b3b9f929`: `C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/...`. `/c/Users` holds only `lenovo` plus system folders, so no `Admin` user exists here.
- Bounded `find` for `*chrome ext*`, `*chrome-extension*`, `background.js`, `resultContract*` under `/c/tmp`, `/c/Users`, `/c/virality`, `/c/omnivyra-archive`: nothing. `manifest.json` hits were unrelated (Unity packages, a creator-review folder).
- `git log --all -- '*/serviceWorker.js' 'extension/manifest.json' 'shared/resultContract.js'`: empty. `git grep` at HEAD for `manifest_version`, `chrome.runtime`, `chrome.cookies.getAll`: empty.
- `OMNIVYRA_EXTENSION_ROOT` is unset in this shell.
- `modules/extension/` is **not** the client. It is a server-side TS module with an in-memory repository. A `grep` for `modules/extension` under `pages`, `backend`, `lib` found no importer. It competes in name only (section 8).

**Limits of this search:** bounded depth, and drives other than C: were not checked. A copy may exist off-machine. Consequence: all extension "performs X" claims below are unverifiable. Tests against its source skip rather than pass.

## 4. Action table

Applies to the branch. On `origin/main` the RPA rows are worse: see GAP-01.

**Authorized by**, for all RPA rows: a human or automation calling the community executor, gated by kill switch, `require_human_approval`, `requiresApproval`, playbook, plan limit (`Runtime.ts:528-635`). `executeRpaTask` itself authorizes nothing. **Approver identity is not carried into the run:** `RpaTask` has no user field (`rpaWorkerService.ts:11-19`).

**Whose session**, for all RPA rows: the single row per (org, platform), meaning **whoever last uploaded it**. It is not the approver and not `acting_user_id`: that field is written (`reply.ts:845`, `like.ts:190`, `bulkEngagementService.ts:298`) but no RPA or extension dispatch code reads it. `git grep` in `commands.ts`, `action-result.ts` and `rpaWorker/` finds only a passthrough at `rpaWorkerService.ts:111`.

| Action | Platform | Code that really performs it | How it knows it succeeded | Safe for a journey? |
|---|---|---|---|---|
| reply | linkedin | `rpaPlatformScripts.ts:30-92`; commit at submit click. Candidates include generic `button[type="submit"]` and role `/post\|submit/i` | Any of `.comments-comment-item`, `.comments-comment-list`, `article .ql-editor:empty` (`:82-90`). **Vacuous:** satisfied by any existing comment | **No.** False `executed`; no reply id; path not validated |
| reply | facebook | `:94-129`; Enter on first textbox | `[role="article"]` (`:123-127`). **Vacuous:** the post itself matches (inference) | **No.** Same; first-textbox targeting |
| reply | instagram | `:131-170` | `ul li:last-child` (`:164-168`). **Vacuous:** any list | **No.** Same |
| reply | twitter | `:172-214` | `article[role="article"]` (`:208-212`). **Vacuous.** `extract_platform_id` takes the first status link (`:202-206`), most likely the **target's** id, not the reply's (inference) | **No.** False `executed` with a misleading `platform_id` |
| reply | reddit | `:216-264`; `fill` only on textarea | `[data-testid="comment"]` (`:258-262`). **Vacuous** | **No.** Same |
| like | linkedin | `:268-302`; guarded against the already-liked state | `aria-pressed="true"` or Unlike. Specific, but not scoped to the post | **No.** Guard can move the click to a **different** element: if the post is already liked, the first unpressed match may be a comment's Like (inference from selectors) |
| like | facebook | `:304-336` | Pressed, or `[aria-label*="Liked" i]` | **No.** Same wrong-target risk |
| like | instagram | `:338-361` | `svg[aria-label="Unlike"]` | **No.** Same (inference) |
| like | twitter | `:363-383` | `button[data-testid="unlike"]`. An unlike anywhere on the page satisfies it | **No.** Same: an already-liked tweet moves the click to a reply (inference) |
| like | reddit | `:385-411` | Pressed upvote | **No.** Same class of risk (inference) |
| share, follow, schedule | all | **None** (refused) | n/a | **No.** Does not exist |
| dm | all (RPA) | **None** (`RPA_DM_NOT_SUPPORTED`) | n/a | **No.** Does not exist |
| reply_comment, like_message | per matrix (`lib/engagementCapabilities.ts:89-127`) | **Extension client, not in this repo** | Client's self-report: `result.confirmed === true` gives `executed`, else `sent_unverified` (`action-result.ts:251-252`). Holder + lease checked | **No (via this engine).** Performing code unavailable; offered to **any** extension session in the org (`commands.ts:161` filters by org only), so it acts as whichever member's browser polls first. Engine 4 owns it |
| dm steps: open_thread, continue_thread, start_new_dm, search_user | linkedin, facebook, instagram, twitter | Extension client, absent | Same | **No.** Every DM send is refused by binding product decision (`dmDispatchSafety.ts:4-8,44-46`) |
| sync_dm_inbox, sync_comments_inbox | per matrix | Extension client, absent | Same | No outbound act; read-only ingest; Engine 4 |
| create_post | per matrix | Extension mapping only; `validateAction` excludes `post_create` (`Contracts.ts:294`) | n/a | **No.** Executor refuses the action type |
| Username scrape (reddit) | reddit | `redditDiscoveryRpa.ts`; no caller | n/a | **No.** Not an action; dead code |

**Bottom line: zero actions are safe to expose today.** Even with all engine gaps closed, this is **not** engineering-only. Repo evidence: `WP8_LINKEDIN_FEASIBILITY_DECISION.md:106-120` quotes LinkedIn User Agreement §8.2 ("Use bots or other unauthorized automated methods") and says `:448-449` that "authenticated-session reuse" is "out of bounds, permanently". That decision was written for ad-library acquisition, not engagement, so whether it extends to RPA is an **owner decision**. But `rpaWorker` is authenticated-session reuse on the same platform, and I found no record reconciling the two. The other four platforms' terms were not checked (no network).

## 5. Compliance matrix (18 contract fields)

Assessed for adapter A, and for B reached through the community adapter, the only legitimate route.

| Field | Adapter A | B via community adapter |
|---|---|---|
| engine identifier | Satisfied: `engine:'browser'` | Satisfied as `community`; `execution_mode:'rpa'` is sub-engine |
| capability declaration | Satisfied (empty allowlists) | **Missing.** `SUPPORTED_COMMUNITY_ACTIONS` is per-connector and ignores mode; only DM+RPA is refused. Mappable from `RPA_PLATFORM_URL_POLICY` |
| supported channels / action types | Satisfied (none) | Satisfied in code: `RPA_PLATFORM_URL_POLICY`; reply, like, 5 platforms |
| authorization context | N/A | Mappable: `approved_at`, playbook. **Approver identity not carried** into `RpaTask` |
| tenant / prospect refs | Tenant checked; no prospect | Tenant: yes. Prospect: only via the journey link table, not RPA |
| workflow / journey refs | In ctx, unused | Community adapter holds them; RPA has none |
| recipient / destination | N/A | `target_id` as URL. **Host-checked only.** Nothing maps a person to a post URL |
| content / payload | N/A | `suggested_text`/`final_text`. Satisfied |
| idempotency key | N/A, pure function | `action_id` + `execution_engine_requests`, claim CAS. **No platform-side dedupe:** no pre-check that the reply already exists |
| correlation ID | N/A | `execution_correlation_id` on row; **not passed** to `saveRpaArtifact`, though it accepts one (runner `:228-236`) |
| execution request | Satisfied (shape) | Mappable: `RpaTask` |
| execution result | Satisfied | Satisfied: `RpaResult` |
| delivery status | Missing, by design | **Missing.** No delivery notion; `executed` means a selector matched |
| error classification | `reason` | Partial: free-string codes + `may_have_acted`. No logged-out or blocked class |
| retryability | Satisfied (never) | Satisfied on branch: `isInProcessRetryable`, `deferred`, `uncertain` |
| usage / credit | N/A | Partial: `automation_executions` count; no browser cost; `uncertain` unmetered |
| outcome event | None | Partial: metric events, notification, webhook. No journey-level inbound outcome (reply, ack) from RPA |
| audit metadata | Satisfied (reason) | Partial: `logCommunityAiActionEvent`, screenshot on the normal path only. **Session owner not recorded**, no login audit row beyond the nonce table |

## 6. Status mapping

| Target | Maps from | Honest? |
|---|---|---|
| REQUESTED | `pending` / engine request `requested` | Yes |
| AUTHORIZED | `approved` + `approved_at` | Yes |
| QUEUED | `approved` + `rpa_retry_queue` row | Yes. **The in-process queue has no persisted state**, so it cannot be observed |
| EXECUTING | `executing` | Yes |
| ACCEPTED | RPA `executed` for **like** at best | Weak: state selector, not scoped. RPA never emits `sent_unverified`, though it should for replies |
| DELIVERED | **No honest mapping** | RPA has no delivery signal. Reply `executed` must not map here |
| FAILED | `failed` with `may_have_acted:false` | Yes |
| RETRY_REQUIRED | `deferred` (worker retries itself) | Yes |
| CANCELLED | `RPA_CANCELLED` + `may_have_acted:false`, stored as `failed` | Yes, by error code; no dedicated status |
| REJECTED | `skipped`, `blocked`, policy `failed` (`RPA_TARGET_*`, playbook); adapter's `unsupported` | Yes |
| *(none)* | **`uncertain`** | **No honest target.** It is not FAILED (may have acted), not RETRY_REQUIRED (must never retry), not ACCEPTED. The vocabulary needs a review state, or an explicit `needs_human`. Coordinator decision |

## 7. Retry and error behavior

**Branch: sound in design, verified against fakes only.**

- `commitStarted` is set immediately before the submit interaction, after the element resolves (runner `:85,191-208`).
- Failures before it are `may_have_acted:false` and may retry. Failures after are `uncertain` and never retried. Throws and unknowns default to may-have-acted (`rpaResultMayHaveActed`, `rpaWorkerService.ts:43-44`).
- Retry passes back through the executor (`:122-132`) after two CAS claims, so the gates are re-applied.

**Weak spots:**

1. **A vacuous post-condition makes the classifier's best case wrong.** A submit that did nothing still reports `success:true`, so the row becomes `executed`. The safety work prevents duplicates but not false success.
2. A logged-out session surfaces as `SELECTOR_NOT_FOUND`, `may_have_acted:false`, and a retry. Nothing marks the session stale. `last_verified_at` is stamped at save though nothing is verified (`save-session.ts:80`, `complete.ts:87`).
3. Post-navigation host is unchecked. Validation is pre-`goto` only (`:158,200`); a redirect is followed and typing continues (inference from code; no `page.url()` check).
4. Error text from Playwright is stored in the result (`:269`) and may carry the URL. Low risk.

**Screenshots:**

- Taken only on the normal and post-condition-failed paths (`:224-247`), **not in `catch`**. A throw after commit, the case most needing evidence, leaves none.
- Screenshot failure does not affect the result, so `executed` can have no evidence.
- A local mirror is written unencrypted to `tmp/rpa-screenshots/<action_id>.png` (`:243-245`), with no prune.
- **Contradiction:** `rpaArtifactStore.ts:17-23` says no URL is persisted, but the runner returns the signed URL as `screenshot_url` and the executor stores it in `execution_result.response` (`Contracts.ts:658`, `Runtime.ts:189-193`). A 1-hour bearer URL lands in the row. Static trace; not run.
- **Nothing reads the evidence:** no route or component references `rpa_artifacts`, `screenshot_url` or `screenshot_path`; only prune touches them.

**Session handling:**

- **Overwrite:** silent upsert on (org, platform) (`rpaSessionStore.ts:259-271`). Replacing it changes the identity for **all queued and future actions**, including already approved ones, with no history. Who did it survives only in `rpa_auth_token_redemptions`, which is pruned 1h after token expiry (`rpaAuthTokens.ts:37`).
- **Cookie scope unchecked:** neither `looksLikeStorageState` (`save-session.ts:35-40`) nor `importSessionCapture` checks that cookies belong to the platform. Sealing any blob for any platform is accepted. `expires_at` is client-supplied and unparsed (`complete.ts:86`).
- A fail-open: `getRpaQueueState` returns READY when a row is missing (`rpaQueueState.ts:80-99`). `getCommunityAiPlatformPolicy` defaults to `execution_enabled:true`, `require_human_approval:false` (`communityAiPlatformPolicyService.ts:11-17`). Kill-switch absence therefore means enabled.

## 8. Providers, duplicates, external dependencies

### Provider and adapter map

```
Journey -> sweeper -> browser adapter -> refusal (dead end, by design)
Journey -> sweeper -> community adapter -> executeAction
                                             |- api      -> platformConnectors/*
                                             |- rpa      -> executeRpaTask -> rpaPlaywrightRunner -> Chromium + rpa_sessions
                                             |- browser  -> pending row -> /api/extension/commands -> [external client] -> action-result
                                             '- manual   -> simulation, never acts
Non-journey: execute.ts, scheduler, auto rules, responseOrchestrator, automationService, engagement like/reply/bulk -> executeAction
```

Providers for RPA are the 5 platforms' web UIs only: no vendor. No Browserless or remote-browser service found.

### Duplicates

| Item | Relationship | Recommendation |
|---|---|---|
| RPA vs extension for reply/like | Two browser transports inside one engine, with different session owners (org blob vs a member's live browser) | Owner decides which survives. **Do not add a third** |
| `redditRpaHandler.ts` vs `rpaPlatformScripts` reddit | Stale duplicate: no session, no gates | Delete in a clean-up (proposal) |
| `modules/extension/*` vs `pages/api/extension/*` + `backend/services/extension*` | Parallel server implementation with in-memory repository; no importer found | Superseded; do not extend |
| `Dockerfile.cron` | Non-deployed split | Hazard only |
| `loadPlaywright` | 3 copies (`rpaEnv`, runner, `redditRpaHandler`) | Minor |
| Comment drift | `playbookEvaluator.ts:14` type omits `browser`, unlike executor | Minor |

### External dependencies, by name

`ENCRYPTION_KEY` (must match on web and worker per runbook `:775-777`), `RPA_AUTH_SECRET` or `AUTH_SECRET`, `RPA_FLUSH_MAX_TASKS_PER_TICK`, `RPA_SCREENSHOT_DIR`, `RPA_SESSION_DIR`, `CHROMIUM_PATH`, `HEAVY_JOB_CONCURRENCY`, `CRON_SERVICE_MODE`, `OMNIVYRA_EXTENSION_ROOT` (tests only), Supabase Storage bucket `rpa-artifacts`. No webhook exists. Platform permission: **each platform's terms for automated authenticated use**, not obtained or recorded. Extension source and its provenance.

## 9. Doc versus code contradictions

| Claim | Where | Reality on the branch |
|---|---|---|
| "re-runs a task after it may have acted: the in-process queue retries ANY non-success" | `browserEngineAdapter.ts:17-20` | **False on branch** (`rpaTaskQueue.ts:24-49`). **True on main** (`main:rpaTaskQueue.ts:27-36`) |
| "durable `rpa_retry_queue` retries up to 5 times with no cross-process claim, bypassing admission" | `:20-22` | **False on branch** (CAS claims, re-entry through executor). **True on main** |
| "the target URL is navigated verbatim; nothing checks it belongs to the platform" | `:24-25` | **False on branch** at host level. **True on main** (`main:runner:151`) |
| `executeRpaTask` carries none of the gates | `:14` | Still true of the function; the flush adds kill switch only |
| "a journey step carries no target ... nothing maps a person to one" | `:27` | Still true |
| "No RPA operation is safe to expose" | `VERIFICATION-AND-BLOCKERS.md:14` | Conclusion stands, reasons changed, and **it implies RPA is unreachable**. It is reachable through the community adapter |
| "No URL persisted" | `rpaArtifactStore.ts:17-23` | Signed URL persisted in `execution_result` |
| "most-trusted reachable mode: api → browser → rpa" | `Contracts.ts:410-412` | RPA is never auto-selected |
| Call `assertRpaEnvReady` from worker's main loop | `rpaWorkerService.ts:50-55` | No caller |
| "Successes delete the row; failures bump attempts" | `cron.ts:871-874` | Stale on branch: flush re-runs through executor, deletes after terminal status |
| `last_verified_at` | Routes | Nothing verifies anything |

The adapter's header cites audit base 4a7b17a0, which predates the hardening merged into this branch. Read against the live main, its hazards remain real. Read against the branch it describes, they no longer apply.

## 10. Gap register

| ID | Gap | Sev | Evidence | Smallest fix | Scope | Owner / external |
|---|---|---|---|---|---|---|
| GAP-01 | **Live main runs unhardened RPA:** re-runs post-submit, unvalidated URL, plaintext sessions plus plaintext file, replayable token, weaker role, retry bypasses kill switch and approval, and the flush shown at `main:rpaRetryQueue.ts:118-165` handles only the queue row, so (inference; `recordTerminalFailure` not read) a row can say `failed` while the worker later acts | **P0 if any RPA row or session exists in prod** | `main:rpaTaskQueue.ts:27-36`; `main:rpaWorkerService.ts:64-71`; `main:rpaRetryQueue` flush; `main:rpaSessionStore.ts:57,69,104,121`; `main:save-session.ts:57` | Merge the branch + migrations 20261231000002/05/10 per runbook. Before that, read-only counts on `rpa_sessions` by format, `rpa_retry_queue`, and `community_ai_actions` where `execution_mode='rpa'` (never select `storage_state` whole, runbook `:45`) | Coordinator | Owner: prod read + kill switch if rows exist |
| GAP-02 | RPA reachable from a journey via community adapter, undocumented | P1 | `communityEngineAdapter.ts:132-149,772` | One refusal in `classifyCommunityAction`: `mode === 'rpa'` gives `unsupported_mode:rpa`, for all action types, until owner decides | Engine 4 adapter; no contract change. **Coordinate** | No, fail-closed. Owner may later lift it |
| GAP-03 | False `executed` for all 5 reply scripts | P1 | Section 4 | Short term: `runRpaExecution` returns `sent_unverified` for reply. Long term: post-condition echoes the submitted text in a new comment node | Executor shared with Engine 4 | No for short term. Long term needs live DOM check |
| GAP-04 | Like can hit the wrong element | P1 | Section 4 (inference) | Scope to main post container, and refuse when already liked rather than moving on | Engine-local scripts | Needs sandbox account |
| GAP-05 | Path not validated: any page on the host, including messaging (inference), feeds, profiles | P1 | `rpaTargetUrlPolicy.ts:77-126` | Add per-platform post-path patterns; `isPlatformDmThreadUrl` shows the pattern | Engine-local | Patterns need verification |
| GAP-06 | No session owner or account identity; overwrite silently changes who acts | P1 | 20260527:35-47; `rpaSessionStore.ts:259-271` | Columns `connected_by_user_id`, `external_account_id`, plus audit row at save; block or re-approve queued actions on change | **Migration: coordinator** | Owner: per-org vs per-user model |
| GAP-07 | Approver and `acting_user_id` not bound to session | P1 | `rpaWorkerService.ts:11-19` | Depends on GAP-06 | Shared | Owner |
| GAP-08 | No logged-out/challenge detection; session never revoked | P1 | `rpaPlaywrightRunner.ts:200-209` | Post-`goto` check of host and login path, returning `RPA_SESSION_REAUTH` not-acted, and mark session `reauth_required` | Engine-local | Login path patterns need verification |
| GAP-09 | Redirect target unchecked | P2 | runner `:200` | Re-run `validateRpaTarget` on `page.url()` after `goto` and before commit | Engine-local | No |
| GAP-10 | No screenshot on throw after commit | P2 | runner `:224,265-269` | Best-effort screenshot in `catch` when `commitStarted` | Engine-local | No |
| GAP-11 | Signed URL persisted; local unencrypted mirror | P2 | Section 7 | Strip `screenshot_url` before persistence; drop mirror unless `RPA_SCREENSHOT_DIR` is set | Engine-local | No |
| GAP-12 | Evidence has no reader; no `uncertain` review surface | P2 | Section 7, capability table | Reuse a community actions view; sign on demand | UI / Engine 4 | Owner |
| GAP-13 | Cookie scope and `expires_at` unvalidated | P2 | `save-session.ts:35-40`; `rpaSessionImporter.ts:56-91` | Filter to platform domains with `hostMatchesDomains`; parse the date | Engine-local | No |
| GAP-14 | `last_verified_at` stamped falsely | P3 | `save-session.ts:80`; `complete.ts:87` | Write null at save; column is nullable (20260527:43) | Engine-local; check `platformHealth` reader | No |
| GAP-15 | Stale adapter header and doc misstatement | P2 | Section 9 | Comment-only correction; allowlists stay empty | Engine-local | No |
| GAP-16 | Extension client absent, provenance unknown | **P1 for browser mode** | Section 3.4 | Locate source, record licence, vendor or pin | External | **Owner** |
| GAP-17 | Platform-terms position unresolved | **P0 for any exposure** | `WP8_LINKEDIN_FEASIBILITY_DECISION.md:106-120,448-449` | Written owner decision per platform, or retire RPA | Decision | **Owner / legal** |
| GAP-18 | No session connect UI, no disconnect route | P2 | `git grep /api/rpa/` empty; `deleteRpaSession` no caller | Add a route only if RPA survives GAP-17 | Engine-local + UI | Owner |
| GAP-19 | No platform-side duplicate pre-check (crash between commit and write) | P2 | Runner; reply scripts | `uncertain` + no retry handles it; only needed if retried by a human | Note only | No |
| GAP-20 | Worker-only split silently stops RPA | P3 | `Dockerfile.cron:26,45`; `rpaWorkerService.ts:74-78` | Note in runbook if the split is enabled | Ops | No |
| GAP-21 | Dead code: handler, discovery, candidate service | P3 | Section 1 | Remove in clean-up | Engine-local | No |

**Could not determine:**

- Whether any `rpa_sessions` row or `execution_mode='rpa'` action exists in production (no production access).
- Whether selectors still match live platform DOMs (no network); all wrong-target and vacuous findings derive from reading selectors, marked as inference where they depend on page structure.
- Whether the extension exists anywhere off this machine.
- Whether migrations on main are applied in prod (out of scope; see runbook).
- I did not open `.env*` files.

## 11. Recommendation

1. **Do not widen the browser adapter and do not build a browser channel.** Keep it refusing, and fix its header.
2. **Close the side door** (GAP-02) so "journeys cannot reach RPA" becomes true in code instead of depending on the identity-link blocker.
3. **Get GAP-17 decided before any engineering beyond safety.** If the answer is no, retire `rpaWorker` action scripts rather than harden them. All of GAP-03 to GAP-08 become moot.
4. **Check GAP-01 first:** it is the only item that may be harming production today.
