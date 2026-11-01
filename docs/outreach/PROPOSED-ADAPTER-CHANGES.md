# Proposed changes to orchestration-owned files

Not applied. These files have open work under the orchestration owner, so they go there once contract v0.1 commits. Diffs are against dc7f2ae3 and may need re-basing.

## 1. WhatsApp: settle a send-time block (required with B-17)

Without this, a journey whose send was blocked stays in `wait`, even after the switch clears, because the status is terminal. It never completes wrongly.

`whatsappEngineAdapter.ts`, in `fromRecipient`, before `case 'failed':`

```diff
+      case 'blocked_send_control':
+        return settle(ctx, 'submitted', 'failed', result(status, 'needs_human', 'a send-time control refused the message; nothing was sent', broadcastId));
```

## 2. Community: G-6, G-7, GAP-02

Patch: `proposals/community-adapter.patch` (`git apply --check` passed at dc7f2ae3). Test: `proposals/orchestrationCommunityAdapterGates.test.ts.txt`, 13 tests on a fake DB; against the current adapter 10 fail and 3 controls pass; against a patched copy all 13 pass.

- **G-6:** use the engine's own claim, which refuses a cancel-requested row. Caveat: such a row returns `action_moved`/`wait` on every sweep and the step never settles. It may need an explicit `needs_human` check first; that is not in the patch.
- **G-7:** ask the engine's DM policy before the claim, so a refused DM doesn't consume the approved row. These tests change: `orchestrationCommunityAdapter.test.ts:237` and `:622`, `orchestrationCommunityIdentityLink.test.ts:514`.
- **GAP-02:** refuse `mode === 'rpa'` for journeys until the acting account is proven. Browser mode and the API-to-browser fallback (G-10) remain unbound. Rows already `submitted` return before the classifier.

Patched copy, 5 adapter suites: 150 pass, and only the 3 named tests fail.

## 3. Social: G-5, adapter reads the retry state

Not run. `socialPostAdapterSafety.test.ts:205` lists permitted imports and probably needs `publishRetryState` added.

`socialPublishEngineAdapter.ts`:

```diff
 import { classifyScheduledPost, type ScheduledPostFacts } from './socialPostPublicationStatus';
+import { classifyPostQueueJobs, isRetryStateColumnMissing, type PostRetryClass } from '../../queue/publishRetryState';
```
```diff
   readCampaign(campaignId: string): Promise<{ company_id: string | null; status: string | null } | null>;
+  /** The post's queue_jobs rows. Throws when unreadable. */
+  readQueueJobs?(scheduledPostId: string): Promise<ReadonlyArray<{ status?: unknown; retry_state?: unknown; error_code?: unknown }>>;
 }
```
```diff
     return { company_id: s(r.company_id), status: s(r.status) };
   },
+  async readQueueJobs(scheduledPostId) {
+    const withState = await ownedDbTable('queue_jobs').select('status, retry_state, error_code').eq('scheduled_post_id', scheduledPostId);
+    const res = withState.error && isRetryStateColumnMissing(withState.error)
+      ? await ownedDbTable('queue_jobs').select('status, error_code').eq('scheduled_post_id', scheduledPostId)
+      : withState;
+    if (res.error) throw readFailure('queue jobs');
+    return (res.data ?? []) as Array<{ status?: unknown; retry_state?: unknown; error_code?: unknown }>;
+  },
 };
```
```diff
       let accountOrg: string | null = null;
+      let queueRetryClass: PostRetryClass | undefined;
       try {
         ...
         if (row && row.campaign_id) campaign = await deps.readCampaign(row.campaign_id);
+        if (row && row.status === 'failed' && deps.readQueueJobs) queueRetryClass = classifyPostQueueJobs(await deps.readQueueJobs(row.id));
       } catch {
```
```diff
         campaign_status: campaign ? campaign.status : undefined,
+        queue_retry_class: queueRetryClass,
       };
```

`socialPostPublicationStatus.ts`: add `readonly queue_retry_class?: 'LIVE' | 'UNKNOWN' | 'TERMINAL';` to `ScheduledPostFacts`, and:

```diff
   'publish_failed',
+  'publish_retrying',
```
```diff
   if (status === 'failed') {
+    // A delivery is still coming (BullMQ backoff, or a live queue row). Unknown stays with a person.
+    if (f.queue_retry_class === 'LIVE') {
+      return { outcome: 'publish_retrying', disposition: 'wait', reason: 'the engine will attempt this post again' };
+    }
```

## 4. Header comments: G-15, GAP-15

`socialPublishEngineAdapter.ts`:

```diff
- *     (backend/services/publishNowService.ts:180, :522) needs a verified acting
- *     USER, which an execution task does not carry, and it does NOT evaluate the
- *     publish authorization predicate (publishNowService.ts:303: authorization
- *     stays at the route/worker layer). Calling it from a journey would bypass
- *     that gate and pull the post off the time it was RELEASED for.
+ *     (backend/services/publishNowService.ts:180, :522) does NOT evaluate the
+ *     publish authorization predicate (publishNowService.ts:303: authorization
+ *     stays at the route/worker layer). Calling it from a journey would bypass
+ *     that gate and pull the post off the time it was RELEASED for. The acting
+ *     user is not the blocker: the cron and the queue both use the row's user_id.
+ *     The blockers are one object versus N tasks, no approval provenance on the
+ *     row, and no held state.
```

`browserEngineAdapter.ts`, replacing lines 17-27 (the allowlists stay empty):

```
 *       It also cannot meet the adapter contract (re-read against this branch;
 *       origin/main 5025f51d lacks the hardening and is worse):
 *         - success is not proof: reply post-conditions match elements that may
 *           already exist, and a like's is not scoped to the post;
 *         - the target URL is checked by host only (before and after navigation),
 *           not by path, so any page on the platform's host passes;
 *         - one stored session per (org, platform), whoever last uploaded it;
 *           no account identity, no logged-out detection, approver not carried;
 *         - cancellation is keyed on a `community_ai_actions` row id;
 *         - a journey step carries no target (post URL) and nothing maps a
 *           person to one.
 *       RPA stays reachable through the `community` adapter (execution_mode='rpa'
 *       on reply/like); this adapter refusing does not close that route.
```

## 5. Designed, not written: acting-account proof (community G-1)

Needs a migration, to be agreed with orchestration before it is written.

- **Reuses:** `social_accounts` (`id`, `platform_user_id`, `company_id`, `user_id`, `connection_state`, `last_live_check_*`, `granted_scopes`), `community_ai_actions.approved_by/approved_at/acting_user_id`, `user_company_roles`, `tokenStore.getToken(id)`, the `healthProbeService` whoami URL map, `consent_records`. No new table and no new OAuth flow.
- **Migration:** add `community_ai_actions.acting_social_account_id` (FK) and `acting_platform_user_id` (snapshot set at approval); add one engagement capability to the `consent_records` CHECK.
- **Check:** read-only `proveActingAccount(row)` next to `proveActionPerson`, at link time and at execution, before the claim. Refuses when: the tenant is not exact (no `company_id` NULL rows), the account is inactive or disconnected, the id is synthetic, the id differs from the snapshot, the approver may not act for the account, or consent is absent.
- **Token:** read the pinned account, never `resolveSocialAccountIdForOrg`. Compare the live provider id to the snapshot before acting: a failed read waits, a mismatch refuses. Store the actor in `execution_result`.
- **Modes:** journeys are API-only until this exists. RPA and extension sessions have no account identity, and a self-report would be client-asserted, not proof.
- **Do not** use `attested_engagement_identities`, or write `subject_platform_oauth` from a tenant callback, because that evidence asserts the prospect consented.
- **Other entry points that check neither proof:** `pages/api/community-ai/actions/execute.ts:221`, `pages/api/engagement/reply.ts:833`, `pages/api/engagement/like.ts:178`, `pages/api/engagement/message/bulk-like.ts:163`, `backend/services/bulkEngagementService.ts:278`, `backend/services/automation/automationService.ts:254`, `backend/services/communityAiAutoRuleService.ts:521`, `backend/services/responseOrchestrator.ts:132`, `backend/services/communityAiScheduler.ts:430`, `backend/services/rpaWorker/rpaWorkerService.ts:125`. Also `pages/api/extension/commands.ts:158-165`, which offers queued work to any session in the org.
