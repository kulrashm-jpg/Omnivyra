# IMPLEMENTATION REPORT — CANONICAL PUBLISH UNIFICATION

## 1. Files Modified

- **Created:** `backend/services/publishNowService.ts`
- **Modified:** `pages/api/social/publish.ts`
- **Modified:** `backend/services/socialPlatformPublisher.ts`

## 2. What Changed

- **publishNowService.ts added:** Minimal “publish now” helper that accepts `scheduled_post_id`, `social_account_id`, `user_id`; performs idempotency check (already published → return success); calls `publishToPlatform(scheduled_post_id, social_account_id)` from `backend/adapters/platformAdapter`; on success uses `updateScheduledPostOnPublish`, `recordPostAnalytics`, `logActivity`, `checkAndCompleteCampaignIfEligible`; on failure uses `updateScheduledPostOnFailure` and `categorizeError`. No duplicate publish logic—reuses `platformAdapter` and `backend/db/queries` only.

- **pages/api/social/publish.ts:** Removed import and use of `socialPlatformPublisher.publishScheduledPost`. Now uses `getScheduledPost` from `backend/db/queries` (to obtain `social_account_id` and `user_id`), and for non–dry_run calls `publishNow()` from `publishNowService`. Dry_run is handled in the route (returns `DRY_RUN` payload without calling publish). Response shape preserved (`status`, `external_post_id`, `message`, `timestamp`). Still calls `updatePostPublishStatus` from `scheduledPostsStore` for client-visible status.

- **socialPlatformPublisher.ts:** File kept intact. Added file-level JSDoc `@deprecated` stating publishing moved to platformAdapter pipeline and to use `publishNowService.publishNow()` or queue + platformAdapter. Added `@deprecated` on the internal `publishToPlatform` and on the exported `publishScheduledPost`. No removal of code; tests that still call `publishScheduledPost` continue to work.

## 3. Canonical Publish Flow After Change

**Scheduled (unchanged):**

```text
schedulerService.findDuePostsAndEnqueue()
   → queue_jobs + BullMQ
   → publishProcessor.processPublishJob(job)
      → getScheduledPost / idempotency / campaign readiness
      → publishToPlatform(scheduled_post_id, social_account_id)   [platformAdapter]
      → updateScheduledPostOnPublish / recordPostAnalytics / logActivity / checkAndCompleteCampaignIfEligible
```

**Super-admin “publish now” (updated):**

```text
POST /api/social/publish { post_id, dry_run?: false }
   → getScheduledPost(post_id)
   → publishNow({ scheduled_post_id, social_account_id, user_id })
      → getScheduledPost (idempotency: already published → return)
      → publishToPlatform(scheduled_post_id, social_account_id)   [platformAdapter]
      → updateScheduledPostOnPublish / recordPostAnalytics / logActivity / checkAndCompleteCampaignIfEligible
   → updatePostPublishStatus (scheduledPostsStore)
   → response
```

So: **all publish flows** (scheduled and super-admin) now go through **platformAdapter.publishToPlatform()**.

## 4. Deprecated Paths

- **`backend/services/socialPlatformPublisher.publishScheduledPost()`** — Marked `@deprecated`. No API or app code calls it for publishing anymore; only integration tests still invoke it for tests of that module.
- **`backend/services/socialPlatformPublisher.ts`** internal **`publishToPlatform(platform, payload, apiConfig)`** — Marked `@deprecated`. Only used by the deprecated `publishScheduledPost()`.

## 5. Verification Notes

- **Scheduled publishing:** Unchanged. `schedulerService`, `publishProcessor`, `platformAdapter`, and queue job shape were not modified. Existing scheduled posting still works as before.
- **Super-admin publish:** Now goes **API → publishNowService → platformAdapter**. No call to `socialPlatformPublisher.publishScheduledPost()` from any API route.
- **No duplicate publish implementation:** The only code path that performs the actual platform API call for publish is `backend/adapters/platformAdapter.publishToPlatform()` (used by both the queue processor and `publishNowService`).
- **DB, tokens, adapters, Community AI, queue:** No schema changes, no token system changes, no adapter refactor, no Community AI changes, no queue logic modifications.
- **Tests:** `social_platform_publisher.test.ts` and `social_platform_config.test.ts` still import and call `publishScheduledPost`; they exercise the deprecated module and remain valid; no test changes were required for this unification.
