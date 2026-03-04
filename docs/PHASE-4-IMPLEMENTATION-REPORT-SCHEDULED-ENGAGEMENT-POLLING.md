# PHASE 4 IMPLEMENTATION REPORT — SCHEDULED ENGAGEMENT POLLING

## 1. Files created

| File | Purpose |
|------|--------|
| `backend/queue/jobProcessors/engagementPollingProcessor.ts` | Job processor: selects published posts (30-day window, batch 50), calls `ingestComments(post.id)` per post with try/catch, returns summary. |
| `backend/queue/workers/engagementPollingWorker.ts` | Worker process: consumes `engagement-polling` queue, concurrency 1, invokes processor. |
| `backend/scheduler/schedulerService.ts` | Defines `enqueueEngagementPolling()` (adds job to `engagement-polling`). |
| `backend/scheduler/cron.ts` | Registers engagement polling trigger every 10 minutes. |
| `backend/queue/bullmqClient.ts` | Defines `engagement-polling` queue and `getEngagementPollingWorker()`. |

(All of the above already existed; no new files were added for Phase 4.)

---

## 2. Queue registration details

- **Queue name:** `engagement-polling`
- **Default job options:** `attempts: 1`, `removeOnComplete: true`, `removeOnFail: true`
- **Worker:** `getEngagementPollingWorker()` — processes jobs with concurrency 1, dynamic import of `processEngagementPollingJob` from `engagementPollingProcessor.ts`
- **Job name:** `poll` (added by `enqueueEngagementPolling()` with payload `{}`, optional `jobId: engagement-poll-${Date.now()}`)

---

## 3. Cron schedule used

- **Trigger:** Every 10 minutes.
- **Implementation:** In `backend/scheduler/cron.ts`, `runSchedulerCycle()` runs on the main cron interval (default 60s). Inside it, `lastEngagementPollingEnqueue` is used so that `enqueueEngagementPolling()` is called only when `Date.now() - lastEngagementPollingEnqueue >= ENGAGEMENT_POLLING_INTERVAL_MS` (10 * 60 * 1000 ms).
- **Effect:** At most one engagement-polling job is enqueued per 10-minute window. No duplicate check on the queue; ingestion is idempotent.

---

## 4. Polling selection criteria

- **Table:** `scheduled_posts`
- **Filters:**
  - `status = 'published'`
  - `platform_post_id IS NOT NULL`
  - `published_at >= now() - 30 days`
- **Order:** `published_at` descending
- **Limit:** 50 posts per run (BATCH_SIZE)
- **Note:** `is_active = true` is not applied in the query to avoid assuming the column exists (no schema change). If the column exists, it can be added in a later change.

---

## 5. Failure isolation behavior

- Each post is processed in a try/catch around `ingestComments(post.id)`.
- A single failure does not stop the loop; `failures_count` is incremented and the processor continues.
- Processor returns `EngagementPollingResult`: `total_processed`, `total_ingested_comments`, `failures_count`.
- Log line: `[engagementPolling] total_processed=… total_ingested_comments=… failures_count=…`
- Job options: `attempts: 1` — no BullMQ retry; the next cron run will enqueue a new job.

---

## 6. Verified flow

1. **Post published** — `publishProcessor` (or other path) sets `scheduled_posts.status = 'published'`, `platform_post_id` and `published_at` populated.
2. **Polling runs** — Every 10 minutes, cron calls `enqueueEngagementPolling()`; a job is added to `engagement-polling`.
3. **Worker runs** — `engagementPollingWorker` (or any process that started `getEngagementPollingWorker()`) picks the job and runs `processEngagementPollingJob()`.
4. **Comments ingested** — Processor selects up to 50 posts (published, with `platform_post_id`, in last 30 days), then for each calls `engagementIngestionService.ingestComments(post.id)` (fetch + normalize + persist).
5. **Evaluation triggered** — Inside `ingestComments`, when `ingested > 0`, the existing code calls `evaluatePostEngagement(scheduled_post_id)` (engagementEvaluationService). No changes were made to engagementEvaluationService or to that call.
6. **Queue updated** — Job completes; BullMQ marks it complete and removes it (`removeOnComplete: true`). No queue_jobs or other DB tables are written by the engagement polling job itself.

No modifications were made to engagementEvaluationService, AI queue, publishProcessor, or DB schema. Only the automation of engagement ingestion (polling job, queue, worker, cron) is in scope and is already implemented.
