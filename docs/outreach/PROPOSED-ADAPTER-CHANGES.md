# Proposed changes to orchestration-owned files

Applied by the orchestration owner as 96c12e8b, and T2 passes with them: the WhatsApp send-time block (B-17), community G-6 with an explicit `cancel_requested`/`needs_human` check, G-7, GAP-02, and the G-15 and GAP-15 comments. The original copies are in `proposals/`, kept as a record.

Two items remain: G-5 and the acting-account design.

## Social: G-5, adapter reads the retry state

Not applied, not run. Optional: a failed post that will retry reads as failed to a journey until this lands. `socialPostAdapterSafety.test.ts:205` lists permitted imports and probably needs `publishRetryState` added. Diffs are against dc7f2ae3 and may need re-basing.

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

## Designed, not written: acting-account proof (community G-1)

Needs a migration, to be agreed with orchestration before it is written.

- **Reuses:** `social_accounts` (`id`, `platform_user_id`, `company_id`, `user_id`, `connection_state`, `last_live_check_*`, `granted_scopes`), `community_ai_actions.approved_by/approved_at/acting_user_id`, `user_company_roles`, `tokenStore.getToken(id)`, the `healthProbeService` whoami URL map, `consent_records`. No new table and no new OAuth flow.
- **Migration:** add `community_ai_actions.acting_social_account_id` (FK) and `acting_platform_user_id` (snapshot set at approval); add one engagement capability to the `consent_records` CHECK.
- **Check:** read-only `proveActingAccount(row)` next to `proveActionPerson`, at link time and at execution, before the claim. Refuses when: the tenant is not exact (no `company_id` NULL rows), the account is inactive or disconnected, the id is synthetic, the id differs from the snapshot, the approver may not act for the account, or consent is absent.
- **Token:** read the pinned account, never `resolveSocialAccountIdForOrg`. Compare the live provider id to the snapshot before acting: a failed read waits, a mismatch refuses. Store the actor in `execution_result`.
- **Modes:** journeys are API-only until this exists. RPA and extension sessions have no account identity, and a self-report would be client-asserted, not proof.
- **Do not** use `attested_engagement_identities`, or write `subject_platform_oauth` from a tenant callback, because that evidence asserts the prospect consented.
- **Other entry points that check neither proof:** `pages/api/community-ai/actions/execute.ts:221`, `pages/api/engagement/reply.ts:833`, `pages/api/engagement/like.ts:178`, `pages/api/engagement/message/bulk-like.ts:163`, `backend/services/bulkEngagementService.ts:278`, `backend/services/automation/automationService.ts:254`, `backend/services/communityAiAutoRuleService.ts:521`, `backend/services/responseOrchestrator.ts:132`, `backend/services/communityAiScheduler.ts:430`, `backend/services/rpaWorker/rpaWorkerService.ts:125`. Also `pages/api/extension/commands.ts:158-165`, which offers queued work to any session in the org.
