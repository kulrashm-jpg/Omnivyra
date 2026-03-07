# BOLT Async Execution

BOLT (Build Campaign Blueprint) runs as an asynchronous background workflow. The UI returns immediately with a `run_id` and polls for progress.

## Platform Eligibility

BOLT derives available platforms from `company_profile` (`linkedin_url`, `facebook_url`, `instagram_url`, `youtube_url`, etc.). Only platforms with a configured URL are used for content distribution. When calling `generate-weekly-structure`, BOLT passes `eligible_platforms` so daily plans and scheduling respect company social presence.

## Stage Logging & Observability

Every stage logs to `bolt_execution_events` with:

- `run_id` – Correlation ID for full pipeline tracing
- `stage` – Stage name
- `status` – `started` | `completed` | `failed` | `aborted`
- `metadata` – `duration_ms`, `campaign_id`, `error_message`, stage-specific fields

Run summary fields (`bolt_execution_runs`) include:

- `themes_generated` – Strategic themes used
- `weekly_plan_items` – Weeks in plan
- `daily_slots_created` – Daily content slots
- `content_variants_generated` – Content pieces
- `scheduled_posts_created` – Scheduled posts
- `expected_content_items` – Planned content items (from daily distribution)
- `actual_posts_published` – Posts actually scheduled/published
- `engagement_score` – Aggregated engagement from performance signals (nullable)
- `conversion_score` – Aggregated conversions from performance signals (nullable)

## Event Traceability

`bolt_run_id` (same as `run_id`) is passed to `generate-weekly-structure` via request body and header `X-Bolt-Run-Id` for correlation. Downstream APIs can include this ID in logs for full pipeline tracing.

## Architecture

1. **POST /api/bolt/execute** – Creates a run record, enqueues a job, returns `run_id` immediately.
2. **Background worker** – Processes the pipeline: source-recommendation → ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan (optional).
3. **GET /api/bolt/progress?run_id=&lt;id&gt;** – Returns stage, status, progress_percentage for polling.
4. **UI** – Polls progress every 2.5 seconds and redirects when complete.

## Database

Run `database/bolt_execution.sql` in your Supabase SQL editor:

- `bolt_execution_runs` – Tracks each run (stage, status, progress, payload, `weeks_generated`, `daily_slots_created`, `scheduled_posts_created`).
- `bolt_execution_events` – Logs per-stage events.
- `bolt_single_active_run` – Unique partial index to prevent duplicate runs per campaign.

## Environment

- **REDIS_URL** – Required for the BOLT queue (same as other workers).
- **APP_URL** – Base URL for `generate-weekly-structure` calls from the worker (defaults to `http://localhost:3000` in dev). In production, set to your deployed URL.

## Running the worker

Start workers (includes BOLT) with:

```bash
npx ts-node backend/queue/startWorkers.ts
```

Or via PM2: `pm2 start backend/queue/startWorkers.ts --interpreter ts-node`

## Duplicate run prevention

Before creating a new run, the execute API checks for an existing run with the same `campaign_id` (or `payload.generatedCampaignId` for runs not yet past source-recommendation) and `status` in `('running', 'started')`. If found, it returns the existing `run_id` instead of creating a new run.

A unique partial index `bolt_single_active_run` on `(campaign_id) WHERE status = 'running'` enforces at most one active run per campaign at the database level.

## Idempotent stage design

Before executing any stage, the worker checks `bolt_execution_events` for an existing `completed` record for that stage. If found, the stage is skipped. This allows safe restarts and avoids duplicate work when a run is retried.

Per-week stages (`generate-weekly-structure-week-1`, etc.) are checked independently so partial runs can resume from the last incomplete week.

## Campaign state guard

Before each pipeline stage that uses a campaign, the worker verifies `campaign.status` is not `archived` or `deleted`. If invalid, the run is marked `aborted` with an error message and execution stops.

## Queue concurrency

The BOLT worker runs with `concurrency: 2` to limit AI workload and prevent system overload.

## Retry and timeout safeguards

- **ai/plan**: 120s timeout, 3 retries with exponential backoff (2s, 4s, 8s)
- **generate-weekly-structure** (per week): 90s timeout, 3 retries with exponential backoff

On timeout or retry exhaustion, the stage fails and the run is marked `failed`.

## Pipeline stages

| Stage | Description |
|-------|-------------|
| source-recommendation | Saves card to campaign (or creates campaign) |
| ai/plan | Generates plan via AI (weeks from execution_config) |
| commit-plan | Commits blueprint |
| generate-weekly-structure-week-1..N | Generates daily plans for each week (one stage per week) |
| schedule-structured-plan | Schedules posts (when outcomeView is campaign_schedule) |

## API responses

**POST /api/bolt/execute** (202):

```json
{
  "run_id": "<uuid>",
  "status": "started"
}
```

**GET /api/bolt/progress** (200):

```json
{
  "stage": "ai/plan",
  "status": "running",
  "progress_percentage": 40,
  "result_campaign_id": null,
  "error_message": null
}
```

When completed:

```json
{
  "stage": "schedule-structured-plan",
  "status": "completed",
  "progress_percentage": 100,
  "result_campaign_id": "<campaign-uuid>",
  "error_message": null,
  "weeks_generated": 12,
  "daily_slots_created": 84,
  "scheduled_posts_created": 42
}
```

## Campaign Learning Layer

The Campaign Learning Layer uses historical performance signals to improve future campaign planning. Performance data is stored in `campaign_performance_signals` and aggregated by `campaignLearningService` into company-level insights:

- **High-performing themes** – Themes that historically drive engagement
- **High-performing platforms** – Platforms where content performs best
- **High-performing content types** – Posts, blogs, stories, etc. that resonate
- **Low-performing patterns** – Themes/platforms/types to de-prioritize

These insights are passed to the recommendation engine and daily content distribution planner. The planner uses them to bias platform and content-type distribution toward historically successful patterns—without overriding trend intelligence from the strategic theme engine. Learning augments, does not replace, trend-driven recommendations.

The BOLT pipeline populates `expected_content_items` and `actual_posts_published` when runs complete. `engagement_score` and `conversion_score` are intended for later enrichment when performance data is ingested from analytics.

## Testing

1. Run the SQL migration.
2. Ensure Redis is running and REDIS_URL is set.
3. Start the Next.js app and the worker process.
4. Use BOLT from a Strategic Theme Card on the Trend Campaigns tab.
5. UI should poll and redirect when the pipeline completes.
