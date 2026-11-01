# Engine 4: Community actions (reply, like, direct message)

Inventory, read-only. Primary tree `C:/tmp/orch-recovery`, `feat/orchestration-recovery` dc7f2ae3. Baseline `origin/main` 5025f51d. All paths are relative to that tree. No provider, database, test or typecheck was run: everything below is from reading code and git objects. "Real PG" and "fake" describe what the test files do, as read; I did not execute them.

## 0. Honest status

**Not executable through a journey, and the refusal is correct, but the recorded reason for it is wrong.**

The docs (`docs/orchestration/RECOVERY-BASELINE.md:51`, `VERIFICATION-AND-BLOCKERS.md:13,102` B-7) describe one blocker: "no writer for verified identity from OAuth evidence". The code shows two different problems, plus upstream data gaps.

| Question | Which account | Checked today? | Data available |
|---|---|---|---|
| Who RECEIVES the action (is this action about the journey's person?) | Prospect's platform account | **Yes**, `proveActionPerson` (`communityIdentityProof.ts:197-314`), at link time, by DB guard, and at execution | No writer of the accepted evidence |
| Who PERFORMS the action (which authorized account acts?) | Tenant's connected account | **No. Nothing checks this, on any path, on any ref** | Partly there in `social_accounts`, but never bound to an action |

**Direct answers to the critical questions**

1. **Which identity does the current proof check?** Only the recipient. `acting_user_id`, `social_accounts` and the token are never read by `communityIdentityProof.ts`, `communityJourneyLinkStore.ts` or `communityEngineAdapter.ts` (the adapter only copies `acting_user_id` through, `communityEngineAdapter.ts:188,215`).
2. **Is that the right one?** It is the right answer to "does this action concern this person", and it should stay. It does not answer the known blocker "which authorized account performs". Both are needed and they are separate proofs.
3. **Can an existing OAuth flow write `subject_platform_oauth`?** **No, and it must not.** Every existing flow is completed by a signed-in tenant user (`pages/api/community-ai/connectors/linkedin/callback.ts:92-110`: `requireManageConnectors`, then state user equals session user). Evidence field `subject_person_id` asserts the PROSPECT completed the consent (`verificationContract.ts:26-37`). A tenant callback writing it would forge the evidence. The contract says this itself at `verificationContract.ts:14-24`. Any plan to "wire the Integration Hub or connector callback as the writer" must be rejected.
4. **What are the existing OAuth flows the right source for?** The missing ACTING-account proof. No new OAuth is needed for that: `social_accounts` already stores provider-returned id, tenant, connecting user, scopes and connection state. See section 1.1.

**Even with both proofs built, a journey step still could not run,** because nothing in production code creates an eligible action (see G-3, G-4): the only writer of a reply/like/follow row with `discovered_user_id` has no caller, and API discovery returns hardcoded mock users.

## 0.1 Historical safety commits (waves 3-8)

The six SHAs are **not ancestors** of the branch or of main (`git merge-base --is-ancestor`), but all six are **integrated as rebased equivalents**. `git patch-id --stable` matches exactly for every pair, and each rebased commit is an ancestor of `feat/orchestration-recovery`. Parking them as "missing" would be wrong.

| Historical | On branch as | Patch-id | On origin/main |
|---|---|---|---|
| 38dd25de execution safety | c9ab8fbe | equal | No |
| c225660c extension/reaper | 9eac466d | equal | No |
| 006b131f idempotency, DM block | 1c328464 | equal | No |
| 7bc7bdb9 evidence contract | d26f9f05 | equal | No |
| 3e44bd3c person proof | de02b28d | equal | No |
| 89a4415a RPA invalidation | 1b96251f | equal | No |

**Defects still present on origin/main 5025f51d (read from `git show origin/main:<path>`).** These are in the production baseline, whatever the journey path does. Whether each is exercised live depends on production data, which I did not read.

| Defect on main | Evidence on main | Fixed on branch at |
|---|---|---|
| Any API failure falls back to browser, including a call that may have acted: duplicate-action path | `communityAiActionExecutorRuntime.ts:575` `if (!result.ok)` then `:586-593` | `communityAiActionExecutorRuntime.ts:678` requires `may_have_acted === false` |
| Connector failure, timeout and throw all reported `failed` (no `uncertain` status) | `communityAiActionExecutorContracts.ts:530-537, 548-554` | `communityAiActionExecutorContracts.ts:555-575, 586-596` |
| DMs not refused; reply route sends, LinkedIn target is heuristic | `pages/api/engagement/reply.ts:623,677-698,751,762` | `dmDispatchSafety.ts` (absent on main); `communityAiActionExecutorRuntime.ts:581-586`; `pages/api/engagement/reply.ts:508`; `pages/api/extension/commands.ts:222-263` |
| Instagram tier self-declared via row metadata; gate only on step `dm` | `rpaAccountTier.ts` (metadata fallback); `pages/api/extension/commands.ts:225-231` | `rpaAccountTier.ts`; `pages/api/extension/commands.ts:224-227` |
| Expired lease re-offered to any client | `pages/api/extension/commands.ts:174` | `pages/api/extension/commands.ts:158-165` |
| Reaper marks possibly-delivered rows `failed` | `supabase/migrations/20260713_fix_reap_lease_returning.sql:34,63,91` | `20261231000005` (unapplied) |
| Reply/like use a random action id: no idempotency across retries | `pages/api/engagement/reply.ts:614`; `pages/api/engagement/like.ts:126` | `engagementRequestIdempotency.ts`, `20261231000008` |
| Scheduler has no claim before executing | `communityAiScheduler.ts:394`, no claim in file | `communityAiScheduler.ts:416` |
| RPA sessions plaintext, filesystem fallback | `rpaSessionStore.ts:69,121` | `rpaSessionStore.ts` envelope, `20261231000010` |
| RPA target URL unchecked | `rpaTargetUrlPolicy.ts` absent | `rpaTargetUrlPolicy.ts` |

The branch fixes depend on unapplied migrations (the `uncertain` status CHECK is in `20261231000002`). They cannot ship separately from those migrations.

## 1. Capability table

| Capability | Classification | State | Where | File:line, symbols | Migrations | Tests | Ancestry |
|---|---|---|---|---|---|---|---|
| Adapter (one request per step, gates, mapping) | IMPLEMENTED — NOT VERIFIED (success path) | integrated | branch | `orchestration/communityEngineAdapter.ts:524-789` `createCommunityAdapter`; registered `workflowProgressionSweeper.ts:205-217` | 20261231000001 | `orchestrationCommunityAdapter.test.ts`, `orchestrationCommunityEngineSeam.test.ts` (fake deps); `realschema/orch_engines_real.test.ts:355-385` real PG, refusal only | on branch |
| Journey link store and route | IMPLEMENTED — INTEGRATION REQUIRED (only the refusal is verified on real PG) | integrated | branch | `communityJourneyLinkStore.ts:208-283`; `pages/api/execution-instances/[id]/community-link.ts` | 20261231000003, 000006, 000007 | `orchestrationCommunityJourneyLink.test.ts` (fake); real PG proves the DB refuses an unverified link | de02b28d |
| Recipient person proof | IMPLEMENTED — INTEGRATION REQUIRED | integrated | branch | `communityIdentityProof.ts:197-314` | 000006 guard | `orchestrationCommunityIdentityLink.test.ts` (fake port); success case exists only via fixture `helpers/communityIdentityFixture.ts:38` | de02b28d |
| Evidence contract | IMPLEMENTED — INTEGRATION REQUIRED | integrated | branch | `identityVerification/verificationContract.ts:54,110-137` | 000007 `:283` | `identityVerificationContract.test.ts` (pure, plus static SQL) | d26f9f05 |
| `subject_platform_oauth` writer | MISSING | none | nowhere | `git grep` finds only contract, proof comment, fixture, tests, migration; no ref has a writer (`git log --all -S` shows only rebases of 7bc7bdb9) | none | none | none |
| Operator attestation | IMPLEMENTED — NOT VERIFIED (no real-PG suite names it) | integrated, non-proving by design | branch | `identityVerification/attestationStore.ts`; `pages/api/identity-verification/attestations.ts` | 000007 | unit; not in realschema by name | d26f9f05 |
| Acting-account proof | MISSING | none | nowhere | see 1.1 | none | none | none |
| Tenant OAuth connect | IMPLEMENTED — INTEGRATION REQUIRED | integrated | main | `pages/api/auth/{linkedin,x,facebook,instagram,youtube}/callback.ts`; `pages/api/community-ai/connectors/{linkedin,reddit,meta,instagram}/callback.ts`; `backend/auth/tokenStore.ts:260` | baseline | not assessed against providers | main |
| Token resolution for action | PARTIALLY IMPLEMENTED (defect) | integrated | main | `platformTokenService.ts:45-71,141-169` | baseline | fake | main |
| Executor core | IMPLEMENTED — NOT VERIFIED | integrated | main, safety on branch | `communityAiActionExecutorRuntime.ts:311-760` | 000002 | `communityExecutionSafety.*.test.ts` (fake DB `helpers/communityExecutionFakeDb.ts`, or static SQL) | c9ab8fbe |
| Reply via API | IMPLEMENTED — NOT VERIFIED; BLOCKED BY EXTERNAL DEPENDENCY for proof | integrated | main | connectors, section 2 | none | fake fetch at most; no provider sandbox | main |
| Like via API | same, YouTube unsupported | integrated | main | connectors | none | same | main |
| DM | PARTIALLY IMPLEMENTED (browser only; refused by policy) | disabled | branch refuses; main sends | `dmDispatchSafety.ts:95-103`, `AUTHORITATIVE_DM_MAPPING_SOURCE = null` | none | `dmDispatchSafety.extension.test.ts` (fake) | 1c328464 |
| Browser extension dispatch | PARTIALLY IMPLEMENTED | integrated, no account identity | main; safety on branch | `pages/api/extension/commands.ts`, `action-result.ts`; extension source not in this repo (`OMNIVYRA_EXTENSION_ROOT`, `extensionSourceRootPortability.test.ts`) | 000005 | `extensionDispatchSafety.*`: fake routes, static SQL | 9eac466d |
| Claim RPC | IMPLEMENTED — NOT VERIFIED | integrated | branch | `20261231000005:…claim_community_ai_browser_command` | 000005 | static SQL contract only; migration header says run on disposable PG, not re-verified here | 9eac466d |
| Lease reaper | IMPLEMENTED — NOT VERIFIED (new body) | integrated | body on branch; older body main | `20261231000005`; cron `backend/scheduler/cron.ts:750`, 30 s `:235` | 000005, 000009 | static SQL | 9eac466d |
| RPA path | IMPLEMENTED — NOT VERIFIED | adapter's browser engine refuses; reachable via executor mode `rpa` | main; safety on branch | `rpaWorker/*`; `communityAiActionExecutorContracts.ts:599-673` | 000002, 000005, 000010 | fake | c9ab8fbe, 1b96251f |
| Community scheduler | PARTIALLY IMPLEMENTED | **not wired to a cron** | main | `communityAiScheduler.ts:80`; only caller `scripts/communityAiScheduler.ts:1`, no npm script (grep of `package.json`, `railway.json`, `vercel.json`) | none | `community_ai_scheduling.test.ts` | main |
| RPA retry flush | IMPLEMENTED — NOT VERIFIED | integrated | main; CAS on branch | `cron.ts:880-897`, 90 s `:243`; `rpaRetryQueue.ts:190,330` | 000002 | `communityExecutionSafety.retryQueue.test.ts` fake | c9ab8fbe |
| Request idempotency reply/like | IMPLEMENTED — NOT VERIFIED on real PG here | integrated | branch | `engagementRequestIdempotency.ts`; `pages/api/engagement/{reply,like}.ts` | 000008 | `engagementRequestIdempotencyDurable.test.ts` fake; migration test static | 1c328464 |
| Human approval | IMPLEMENTED — NOT VERIFIED | integrated | main | `pages/api/community-ai/actions/approve.ts:68-90` | baseline | `community_ai_rbac.test.ts` | main |
| Kill switch | PARTIALLY IMPLEMENTED (fails open) | integrated | main | `communityAiPlatformPolicyService.ts:11-17,60-65`; SQL `coalesce(...,true)` in claim RPC | baseline | fake | main |
| Company guardrails | PARTIALLY IMPLEMENTED (fails open, org scope) | integrated | main | `executionGuardrailService.ts:41-67` | baseline | fake | main |
| Playbook limits | IMPLEMENTED — NOT VERIFIED | integrated | main | `playbooks/playbookValidator.ts:164-190` | baseline | unit | main |
| Provider rate-limit handling | MISSING | none | nowhere | no 429 or `Retry-After` in `platformConnectors/*` or `communityAi*` (grep empty) | none | none | none |
| Network-action draft writer | MOCKED / FAKE upstream, uncalled | parked | main | `networkExpansion/networkActionCandidateService.ts:28,150-169`; no non-test caller | none | none found | main |
| Discovery of platform accounts | MOCKED / FAKE | parked | main | `networkExpansion/userDiscoveryService.ts:29-77` `mockDiscoverFrom*`; RPA variant omits `external_user_id` `:149-160`; no caller in `pages`, `scripts` | none | none | main |
| Community response read by journey | MISSING | none | nowhere | `orchestration/journeyResponses.ts:13-15` covers WS-3 and WhatsApp only; `journeyFeedback.ts` likewise | none | none | none |

### 1.1 The eight requested data classes

Smallest non-duplicating completion is in the last column. Anything touching a migration or the shared contract is a proposal for the coordinator.

| Class | What exists | Classification | Smallest non-duplicating completion |
|---|---|---|---|
| **(a) Verified account identity: ACTING** | `social_accounts.platform_user_id` from provider userinfo at connect (`connectors/linkedin/callback.ts:175-199`; `pages/api/auth/linkedin/callback.ts:144,217`). `connection_state`, `last_live_check_*` from whoami probes (`integrations/healthProbeService.ts:27-33`, `connectionState.ts:20`), but **the probe does not compare the returned id to the stored one** (grep of `platform_user_id` in the probe: none). Connectors already derive the real actor (`linkedinConnector.ts:8-22`, X `users/me` `twitterConnector.ts:36`) and discard it. Weaknesses: synthetic fallback `${platform}_${userId}` when userinfo fails (`tokenStore.ts:390`), `planning_*` rows (`platformTokenService.ts:224`), silent overwrite of `platform_user_id` on reconnect (`tokenStore.ts:314-339,371`). | PARTIALLY IMPLEMENTED | Extend: compare the provider id in the existing probe and refuse synthetic ids. A new read-only `proveActingAccount` next to `proveActionPerson`. **No new OAuth flow, no new table.** |
| **(a) Verified account identity: RECIPIENT** | `identity_claims` (20260920000000) `verification_state`, `evidence`; `community_ai_discovered_users.external_user_id`. All writers record `unverified` (`prospectIdentity/canonicalisation.ts:213,229`); no `UPDATE` to `verified` in code or migrations. | IMPLEMENTED — INTEGRATION REQUIRED, writer MISSING | **Owner decision** (see G-2). A person-facing flow, or the documented challenge path in `OPERATOR_CONFIRMATION_REQUIREMENTS`. Not a tenant OAuth writer. |
| **(b) Tenant ownership of the acting account** | `social_accounts.company_id`, `user_id`; `community_ai_platform_tokens.tenant_id, organization_id, connected_by_user_id`; `rpa_sessions.organization_id` with envelope tenant check; `user_company_roles`. **Defect:** resolver accepts `company_id.is.null` rows of any active member and takes the most recently updated (`platformTokenService.ts:52-68`). | PARTIALLY IMPLEMENTED | For actions, resolve by exact `company_id` only, and refuse when more than one account matches. Do not change the shared resolver for its other callers; add a pinned-account read. |
| **(c) Authorization provenance** | `connected_by_user_id`; `social_accounts.granted_scopes`, `granted_scopes_recorded_at`, `scope_version_hash` via `oauthScopePersistence.ts:59,105`, called from auth callbacks and Reddit connector, **not from the LinkedIn connector callback** (`connectors/linkedin/callback.ts:186-206`). `consent_records` exists, but its capability CHECK has no engagement capability: publish, listen, monitor_competitors, ingest_* (`baseline.sql:11487`). Connect audit is console only (`callback.ts:209`). | PARTIALLY IMPLEMENTED | Call `persistGrantedScopes` from the remaining connector callbacks; add one engagement capability to `consent_records` (migration, coordinator) and require an active grant in the acting proof. |
| **(d) Action eligibility** | `classifyCommunityAction` (`communityEngineAdapter.ts:129-163`), link statuses (`communityJourneyLinkStore.ts:61`), `enginePreflight` (`:363-415`), `validateAction`. Missing: an honest producer of a row carrying `discovered_user_id` plus a playbook (see G-3). | PARTIALLY IMPLEMENTED | Producer is a coordinator/owner question: draft from a real inbound engagement message whose author id came from the platform API. |
| **(e) Human approval** | `approved_at`, `approved_by`, CAS (`approve.ts:76-90`), role list `APPROVE_ACTIONS`, logged (`:129`). Approver is not shown or bound to the acting account. Adapter refuses unapproved and requires `approved_at` (`communityEngineAdapter.ts:716-743`). | IMPLEMENTED — NOT VERIFIED; integration required for account binding | Pin acting account at approval: the approval must name who will perform. |
| **(f) Execution status** | `community_ai_actions.status` with `executing`, `uncertain` (000002), `execution_result`, `execution_correlation_id`, `dispatch_lease_*`, `execution_engine_requests`, `community_ai_execution_metric_events`. Records no performing account. | IMPLEMENTED — NOT VERIFIED | Add the connector's returned actor id to `execution_result` (jsonb, no migration). |
| **(g) Response and outcome events** | Action side: logs (`communityAiActionLogService.ts:28`), metrics, notifications, webhooks. Inbound: `engagement_messages`, `engagement_threads`, extension events. **Not connected to a journey or person:** `journeyResponses.ts`, `journeyFeedback.ts`, `outreach_outcomes` have no community path. Browser-path completions emit **no usage, webhook or notification** (`action-result.ts` imports only persist and metric, `:48,361`, though `communityAiActionExecutorRuntime.ts:708-709` says it will). | PARTIALLY IMPLEMENTED | Add a community read to `journeyResponses.ts`, keyed on the bound action's thread and the claim's provider id. Emit the terminal events in `action-result.ts`. |
| **(h) Rate and platform policy** | Global `community_ai_platform_policy` (read failure and no row both mean enabled, 60 s cache). `execution_guardrails` (no row or read error allows; counts only `executed`, so `sent_unverified` and `uncertain` do not consume limits; org and platform scope, not per account; `executionGuardrailService.ts:56-63,73-79`). Playbook hourly/daily limits. `usageEnforcementService`. RPA admission. No provider rate-limit handling. No per-platform automation policy. Manual route is outside guardrails (`executionGuardrailService.ts:8`); reply/like routes do not call it. | PARTIALLY IMPLEMENTED | Journey path: treat unreadable policy or guardrail as `wait`, count `sent_unverified`/`uncertain`, add per-account scope once accounts are pinned. Per-platform automation permissibility is an owner/legal decision. |

### 1.2 Proposed acting-account design (proposal, not implemented)

Extends existing tables and functions only:

1. `community_ai_actions` gains `acting_social_account_id` and `acting_platform_user_id`, set at approval. Migration; coordinator owns it.
2. `proveActingAccount(action)`: tenant-exact, active, connected, non-synthetic id, id equal to the snapshot, approver may act for it, active consent. Returns an explicit refusal code, as `proveActionPerson` does. Runs at link and at execution, on the claimed row.
3. A pinned token read through the existing `tokenStore.getToken(id)`, rather than `resolveSocialAccountIdForOrg`.
4. Live compare: the provider's whoami id must equal the snapshot before acting, reusing the probe URL map. A failed read is `wait`; a mismatch refuses.
5. Journey steps are API-only until 1-4 exist. `rpa_sessions` has no account column (`baseline.sql:22505`) and extension sessions know only (user, org): `pages/api/extension/commands.ts:158-165` offers work to any session in the org and ignores `acting_user_id`. Whichever account is logged into that browser performs. A self-report from the extension would be client-asserted, not a proof.

## 2. Providers and adapters

Adapter chain: `workflowProgressionSweeper` → `communityEngineAdapter` → `executeAction` → `resolveExecutionMode` (declared mode, else `api` when a token exists, else `browser`, `communityAiActionExecutorContracts.ts:414-435`) → one of:

| Mode | Implementation | Acting identity |
|---|---|---|
| api | `platformConnectors/*` with `platformTokenService.getToken` | Org's most recently updated active account; not bound |
| rpa | `rpaWorker/rpaWorkerService.executeRpaTask`, `rpaPlatformScripts.ts` (reply, like on linkedin, facebook, instagram, twitter, reddit) | One opaque browser session per (org, platform) |
| browser | row queued, claimed by extension | Whatever the operator's browser is logged into |
| manual | `recordManualSimulation` returns `sent_unverified`, simulated; adapter refuses (`communityEngineAdapter.ts:144`) | Person |

| Platform | Reply | Like | Share / Follow | DM | Connector path (real provider never called in this audit) |
|---|---|---|---|---|---|
| LinkedIn | yes | yes | share | browser, refused | `api.linkedin.com/v2/socialActions/{urn}/comments`, `/likes`; actor from `/userinfo` |
| X/Twitter | yes | yes | share, follow | browser, refused | `api.twitter.com/2/tweets`, `/users/{id}/likes`, `/retweets`, `/following` |
| Facebook | yes | yes | share | browser, refused | Graph v22.0 `{target}/comments`, `/likes` |
| Instagram | yes | yes | none | browser, refused (tier unverified) | Graph v22.0 |
| Reddit | yes | yes | none | not in map | `oauth.reddit.com/api/comment`, `/api/vote` |
| YouTube | yes | none | none | unsupported | `youtube/v3/comments` |

`browserEngineAdapter.ts` claims no channel and refuses everything by design (`:54-60`).

## 3. Routes, workers, crons, events, usage, other entry points

**Operator routes:** `pages/api/community-ai/actions.ts` (list, schedule, skip `:329-343`), `actions/approve.ts`, `actions/execute.ts`, `connectors/*`, `discovered-users.ts` (updates only), `pages/api/execution-instances/[id]/community-link.ts`, `pages/api/identity-verification/attestations.ts`, `pages/api/engagement/{reply,like,cancel-queued}.ts`, `message/bulk-like.ts`, `thread/bulk-*`, `pages/api/rpa/{auth/*,cancel}.ts`.

**Extension:** `pages/api/extension/{commands,action-result,dispatch/renew,events/*,redeem,session,validate,bootstrap,health}.ts`. Dev bypass is refused in production (`extensionAuthMiddleware.ts:61-64`).

**Cron (`backend/scheduler/cron.ts`):** lease reaper 30 s `:750`, RPA retry 90 s `:880-897`, metric DLQ `:774`, rollup `:951`. Community scheduler is **not** in cron.

**Reached without the orchestration adapter, none of which checks either proof:** `pages/api/community-ai/actions/execute.ts:221`, `pages/api/engagement/reply.ts:833`, `like.ts:178`, `message/bulk-like.ts:163`, `bulkEngagementService.ts:278`, `automation/automationService.ts:254`, `communityAiAutoRuleService.ts:521`, `responseOrchestrator.ts:132`, `communityAiScheduler.ts:430`, `rpaWorker/rpaWorkerService.ts:125`. So "community refuses until identity is proven" holds only for journeys. These are the operating product, so this is a scope fact, not automatically a defect; the acting-account ambiguity applies to all of them.

**Producers of action rows:** `communityAiOmnivyraService.ts:234`, `engagementEvaluationService.ts:125` (no `discovered_user_id`), `networkActionCandidateService.ts:176` (sets it; no caller), `engagementIngestService.ts:102` (`comment_ingest`, adapter-unsupported; puts `author_id` in `discovered_user_id`, an FK to discovered users, inference: a likely namespace error), runtime auto-insert `communityAiActionExecutorRuntime.ts:385` (no `discovered_user_id`), idempotency fence `engagementRequestIdempotency.ts:567`.

**Usage:** `recordUsage` on terminal API/RPA only (`communityAiActionExecutorRuntime.ts:91-116,725`), `user_id: null`. Pre-check `checkUsageBeforeExecution('automation_executions')`. Browser completions are not metered (G-9). I found no credit deduction in the executor (grep of `credit|deduct`: none).

## 4. Compliance with the 18 contract fields

The `EngineResult` shape is `engine, outcome, disposition, reason, externalRef` (`engineAdapters.ts:82-91`).

| # | Field | Status | Where or from what |
|---|---|---|---|
| 1 | Engine identifier | Satisfied | `engine: 'community'`, `ENGINE_NAMES` |
| 2 | Capability declaration | Partly | `SUPPORTED_COMMUNITY_ACTIONS` (`:108-114`) overstates DM, not exposed in contract |
| 3 | Supported channels and action types | Satisfied for channels; Partly for types | `channels: ['community']`; types are adapter-local |
| 4 | Authorization context | **Missing** for acting account; Mappable for approval | `approved_by`, `approved_at`, `acting_user_id` |
| 5 | Tenant and prospect references | Satisfied | `ctx.organizationId`, `subject`, `personId`; link `person_id`, `identity_claim_id` |
| 6 | Workflow and journey references | Satisfied | `executionInstanceId`, `executionTaskId`, `planStepId` |
| 7 | Recipient or destination | Mappable | `target_id`, `discovered_user_id` |
| 8 | Rendered content or payload | Mappable | `final_text ?? suggested_text`; content is the stored action, not the step's |
| 9 | Idempotency key | Satisfied | `wf:${executionTaskId}` (`:777`), ledger uniqueness |
| 10 | Correlation ID | Satisfied | `correlation_id: ctx.executionTaskId` |
| 11 | Execution request | Satisfied | `execution_engine_requests` |
| 12 | Execution result | Partly | `EngineResult` plus `execution_result` jsonb; no acting account |
| 13 | Delivery status | **Missing** | Platforms give no delivery signal; only accepted (see section 5) |
| 14 | Error classification | Satisfied | by consequence, `may_have_acted`, `uncertain` |
| 15 | Retryability | Mappable | disposition plus `may_have_acted`; no explicit field |
| 16 | Usage and credit information | Partly | API/RPA only; not returned to orchestrator; no credit |
| 17 | Outcome event | **Missing** for journey | logs and metrics exist; no event consumed by the journey |
| 18 | Audit metadata | Partly | `community_ai_action_logs`, metric events, `linked_by`; no performing account; connect audit is console only |

## 5. Status mapping

| Target | Engine status | Note |
|---|---|---|
| REQUESTED | ledger `requested`; action `pending` | |
| AUTHORIZED | action `approved` with `approved_at` | Only human approval. Honest only once the acting account is bound |
| QUEUED | `pending` + browser + correlation id; `scheduled`; `deferred` (stored `approved`, in `rpa_retry_queue`) | |
| EXECUTING | `executing`, `dispatched`, `acknowledged`; ledger `submitting`, `submitted` | |
| ACCEPTED | `executed` (connector `success: true`; or extension `confirmed: true`, client-reported, `action-result.ts:29`); `sent_unverified` (2xx-like or unconfirmed) | Should be two grades of evidence. Adapter settles both `completed` |
| DELIVERED | **No honest mapping.** No provider receipt exists for reply, like or DM in this engine | Never synthesize it from `executed` |
| FAILED | `failed` with `may_have_acted: false` | Reaped `failed` on main is NOT this |
| RETRY_REQUIRED | **No honest mapping.** `deferred` retries itself; `uncertain` must never be retried | |
| CANCELLED | No dedicated status. `skipped` via `actions.ts:329` or dispatch recovery; `cancel-queued.ts:51` writes `failed`; `cancel_requested_at` is a flag | Partial and inconsistent |
| REJECTED | `blocked`, pre-dispatch `failed`/`skipped` gate refusals; human decline = `skipped` | No distinct human-rejected status |
| *(none in target list)* | **`uncertain`: may have acted, needs a person** | No honest target. The contract needs this word, or FAILED with retryable false and an uncertain flag. Coordinator decision |

## 6. Gap register

| ID | Gap | Sev | Evidence | Smallest fix extending existing code | Scope | Owner/external |
|---|---|---|---|---|---|---|
| G-1 | No proof of who performs; token is the org's latest account, including `company_id` NULL rows of any member | Critical | `platformTokenService.ts:52-68`; `communityIdentityProof.ts` never reads it | Design 1.2 | Migration, adapter, read path: coordinator | Owner confirms who may be an acting account |
| G-2 | Recipient evidence has no writer, and `subject_platform_oauth` needs the prospect to complete consent, implausible for cold prospects (inference) | Critical | `verificationContract.ts:21-24,54` | Do not wire tenant OAuth. Owner chooses: subject consent flow, or the challenge in `OPERATOR_CONFIRMATION_REQUIREMENTS`, or community stays limited to people who consent. If a flow is built, namespace must match too (G-5) | Contract, DB guard (`000007:283`): coordinator | **Owner decision**, lawful basis |
| G-3 | No live producer of eligible actions: only writer with `discovered_user_id` has no caller; `target_id` is a profile URL, which fails `target_actor_mismatch` for follow and is not a URN for like/reply; `suggested_text: null` fails reply; reply/like auto-insert omits the link | High | `networkActionCandidateService.ts:150-169`; `communityAiActionExecutorRuntime.ts:386-410` | Draft from a real inbound message, target and author from provider data | Shared with PI: propose | Owner |
| G-4 | Discovery is mock data; RPA discovery has no provider id | High | `userDiscoveryService.ts:29-77,149-160` | Replace mocks only when real sources are decided; **do not treat these ids as real** | Engine-local, but needs provider decisions | External |
| G-5 | Id namespaces may not match: claim value, `discovered_users.external_user_id`, provider OAuth id (Meta app-scoped; LinkedIn `sub`). The repo documents this exact confusion for authors | High (inference) | `20270106000000:21-29` | Define the namespace per provider before any writer | Contract | Provider docs |
| G-6 | Adapter's claim omits `cancel_requested_at` and `tenant_id`; a cancelled approved row can be claimed | Medium | `communityEngineAdapter.ts:497-502` vs `communityAiActionExecutorRuntime.ts:779-787` | Use `claimCommunityActionForExecution` | **Engine-local, safe** | No |
| G-7 | Adapter advertises DM and classifier accepts it, then claims, and engine refuses: approved row consumed to `failed` | Medium | `communityEngineAdapter.ts:113,148-158`; `communityAiActionExecutorRuntime.ts:581-586` | `classifyCommunityAction` calls `dmCommandChainRefusal`; fix stale header comments | **Engine-local, safe**; existing tests pinning DM support would change | No |
| G-8 | Network-expansion observation lock reads `primary_intent`, writer writes `type`: lock would not fire | Medium | `networkActionCandidateService.ts:162-164` vs `communityEngineAdapter.ts:371`, `communityAiScheduler.ts:137`, `communityAiAutoRuleService.ts:254`; same on main | Writer also sets `primary_intent` | **Engine-local, safe** (writer has no caller) | No |
| G-9 | Browser completions emit no usage, notification or webhook | Medium | `action-result.ts:48,361`; `communityAiActionExecutorRuntime.ts:708-709` | Emit on terminal transition | Engine-local; billing effect | Owner aware |
| G-10 | API "not connected" falls back to browser; unbound account performs | High | `communityAiActionExecutorRuntime.ts:678-703`; `communityAiActionExecutorContracts.ts:432-434` | Adapter refuses non-API modes for journeys until G-1, needs a no-fallback option | Engine-local; product choice | Owner nod |
| G-11 | Kill switch and guardrails fail open; limits ignore `sent_unverified`/`uncertain`; no provider rate-limit handling | High | `communityAiPlatformPolicyService.ts:60-65`; `executionGuardrailService.ts:56-63` | Fail closed for journeys only; widen counted statuses | Engine-local; changing defaults for others is owner's | Partly |
| G-12 | No community response in journey: a replying person keeps getting steps | High | `journeyResponses.ts:13-15` | Add a read | Shared module: coordinator | No |
| G-13 | Connector failures all `uncertain` unless explicit, and no connector sets `may_have_acted: false` for validation refusals such as `SUGGESTED_TEXT_REQUIRED` or `ACTION_TYPE_NOT_SUPPORTED`, so a definite refusal needs human review (grep of connectors) | Low | `communityAiActionExecutorContracts.ts:555-575`; `communityEngineAdapter.ts:516` lists codes that can no longer arrive that way for connector refusals | Connectors mark pre-request refusals | Engine-local, safe direction | No |
| G-14 | Real-PG coverage is refusal only; claim RPC, reaper and late result covered statically | Medium | `realschema` grep finds only `orch_engines_real.test.ts` | Add real-PG suite for those functions | Tests | No |
| G-15 | Migrations 20261231000002-10 unapplied; main keeps all section 0.1 defects | High | runbook, section 0.1 | Release sequencing | Coordinator | Owner |
| G-16 | Docs conflate the two identities | Medium | `RECOVERY-BASELINE.md:51,141`; B-7 | Reword: acting proof (buildable from existing data) vs recipient evidence (owner decision) | Docs | No |
| G-17 | Two meanings of "verified": bridge treats any active linked claim as verified; community requires verified state plus evidence | Medium | `prospectProvenance/bridge/verifiedIdentity.ts:17-24` vs `communityIdentityProof.ts:298-311` | Name them differently | PI ownership: propose only | No |

**Do not do:** simulate a success, set `verification_state` by hand or script, add an override flag to the link route, treat `identity_verification_attestations` or `attested_engagement_identities` as proof. `attested_engagement_identities` is negative evidence that deliberately has no OAuth join (`20270106000000:12-29`), so it is not the acting-account store.

## 7. External dependencies (names only)

OAuth app credentials resolved by `getOAuthCredentialsForPlatform` for LinkedIn, X, Facebook/Instagram/Threads (Meta), Reddit, YouTube. Requested scopes: LinkedIn `openid profile email w_member_social`; X `tweet.read tweet.write users.read like.write follows.write offline.access`; Reddit `identity read submit vote subscribe`; Meta and YouTube sets in their `auth.ts`. Instagram messaging scope is not requested (`dmDispatchSafety.ts:24-27`). Provider access tiers and app review are unverified here. Env: `ENCRYPTION_KEY`, `OMNIVYRA_EXTENSION_ROOT`, `RPA_SESSION_DIR`, `DEV_EXTENSION_AUTH_BYPASS`, `ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS`. The Chrome extension source and its release are outside this tree. Platform terms on browser automation are an owner/legal matter.

## 8. Duplicates and competing implementations

| What | Locations | Note |
|---|---|---|
| `persistExecutionResult`, `recordExecutionMetric` | `communityAiActionExecutorRuntime.ts:155` and `communityAiActionExecutorContracts.ts:179`, vs `communityAiExecutionResultService.ts:118,71` | Two copies, "must stay identical in meaning"; commands and action-result import different ones (`commands.ts:33,233`; `action-result.ts:48`) |
| Action claim | Adapter `:495-504`, `claimCommunityActionForExecution`, execute route `:158` | G-6 |
| `deriveHolderId` | `commands.ts:66`, `action-result.ts:143` | Must match |
| `loadHistoryMetrics` | `communityAiScheduler.ts:21`, `communityAiActionExecutorContracts.ts:356` | |
| Kill switch | TS service, SQL claim RPC | Same defaults, different cache |
| OAuth connect | `pages/api/auth/*`, `pages/api/community-ai/connectors/*` (X, YouTube share the auth callback); inline writers vs `dualWriteSocialAccount` | Do not add a third |
| Attestation | `identity_verification_attestations` (person), `attested_engagement_identities` (tenant-owned, negative) | Different purposes, keep apart |
| Adapter-layer browser | `browserEngineAdapter` refuses; the community engine can still reach RPA and browser | Coherent by design, but see G-10 |

## 9. Could not determine

Production rows, applied state of `execution_guardrails` or policy, and whether any actions exist with `discovered_user_id`: production is out of scope. Provider acceptance of any call: no sandbox used. Extension behaviour: source outside this tree. Whether unit suites pass: not run under the brief; docs claim they do. Whether the DB functions actually behave as read: only the `orch_engines_real` refusals are real-PG by inspection.
