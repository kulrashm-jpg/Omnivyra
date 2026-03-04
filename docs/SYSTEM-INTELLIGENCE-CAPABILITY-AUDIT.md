# SYSTEM INTELLIGENCE CAPABILITY AUDIT

**Status:** Analysis only. No implementation, schema changes, or refactors.

**Scope:** What already exists to support System Health, AI Consumption, Tenant Growth, and related observability.

---

## 1️⃣ AI Consumption

### Tables found

| Table | Purpose |
|------|--------|
| **usage_events** | Append-only ledger: per-request LLM, external API, and automation execution telemetry. |
| **usage_meter_monthly** | Monthly aggregated counters per organization (tokens, external API calls, automation executions, total_cost). |

### usage_events columns (relevant)

- `organization_id`, `campaign_id`, `user_id`
- `source_type` ('llm' \| 'external_api' \| 'automation_execution')
- `provider_name`, `model_name`, `model_version`
- `source_name`, `process_type`
- `input_tokens`, `output_tokens`, `total_tokens`
- `latency_ms`, `error_flag`, `error_type`
- `unit_cost`, `total_cost`, `pricing_snapshot`, `metadata`
- `created_at`

### usage_meter_monthly columns

- `organization_id`, `year`, `month`
- `llm_input_tokens`, `llm_output_tokens`, `llm_total_tokens`
- `external_api_calls`, `automation_executions`
- `total_cost`
- `created_at`, `updated_at`

No `campaign_id`, `process_type`, or `model_name` on the meter; aggregation is org + year + month only.

### Where writes happen

- **usage_events:**  
  - `backend/services/usageLedgerService.ts` — `logUsageEvent()`.  
  - Callers: `backend/services/aiGateway.ts` (LLM: success + failure), `backend/services/llm/openaiAdapter.ts` (diagnostic), `backend/services/externalApiService.ts` (external API), `backend/services/communityAiActionExecutor.ts` (automation execution).  
- **usage_meter_monthly:**  
  - `backend/services/usageMeterService.ts` — `incrementUsageMeter()` → RPC `increment_usage_meter`.  
  - Callers: same success paths as above (after `logUsageEvent`): aiGateway, externalApiService, communityAiActionExecutor. Fire-and-forget; never blocks.

### Central table for token tracking

- **Yes:** `usage_events` is the central per-request table. It has model name, tokens, org, process type, and timestamp.  
- **Campaign:** `usage_events.campaign_id` exists but is **not** set by `aiGateway` (always `null` for LLM). So per-campaign token aggregation is **not** currently populated for LLM; it would require passing `campaignId` into the gateway and ledger.

### Usage stored per request or aggregated?

- **Per request:** `usage_events` (append-only).  
- **Aggregated:** `usage_meter_monthly` (incremented via RPC; no scan of `usage_events`).

### Estimated cost stored or derivable?

- **Stored:** `usage_events.unit_cost`, `usage_events.total_cost`; `usage_meter_monthly.total_cost`.  
- **Derivable:** `usageLedgerService.resolveLlmCost()` uses a fixed `PROVIDER_PRICING` map (openai: gpt-4o-mini, gpt-4o; anthropic: claude-3-5-sonnet). Unknown models get tokens logged but cost null.  
- **Reporting:** `database/usage_report_rpc.sql` defines `get_usage_report()` (read-only): aggregates `usage_events` by org (optional campaign, process_type, source, provider, model, date range); returns totals and optional detail. Cost is included in totals.

### Summary

| Question | Answer |
|----------|--------|
| Central table for token tracking? | Yes: `usage_events`. |
| Records model, tokens, campaign_id, company_id, process type, timestamp? | Model, tokens, company (org), process type, timestamp: **yes**. campaign_id: column exists, **not set** for LLM in current code. |
| Per request vs aggregated? | Both: `usage_events` per request, `usage_meter_monthly` per org/month. |
| Cost stored/derivable? | Yes: stored in both tables; derivable via `resolveLlmCost` for known models. |
| Tokens per campaign/company aggregatable? | **Company:** yes (org + date range). **Campaign:** only if `campaign_id` is populated (currently not for LLM). |

---

## 2️⃣ Queue & Job Monitoring

### Tables involved

| Table | Purpose |
|------|--------|
| **queue_jobs** | One row per job (e.g. publish); links to `scheduled_posts` via `scheduled_post_id`. |
| **queue_job_logs** | Log rows per job: `job_id`, `level`, `message`, `metadata`, `created_at`. |

### queue_jobs schema (relevant)

- `id`, `scheduled_post_id`, `recurring_post_id`
- `job_type` ('publish', 'retry', 'analytics', 'generate_recurring')
- `status` ('pending', 'processing', 'completed', 'failed', 'cancelled')
- `priority`, `attempts`, `max_attempts`
- `scheduled_for`, `next_retry_at`
- `error_message`, `error_code`, `metadata`
- `created_at`, `updated_at`

**No** dedicated `completed_at` or `failed_at` column; completion/failure time is implied by `updated_at` when `status` is `completed` or `failed`.

### BullMQ usage

- **backend/queue/bullmqClient.ts:** defines queue(s) and workers (publish, engagement-polling).  
- **backend/queue/jobProcessors/publishProcessor.ts:** updates `queue_jobs.status` in DB and `scheduled_posts` on success/failure; creates `queue_job_logs`.  
- **backend/scheduler/schedulerService.ts:** finds due `scheduled_posts`, creates `queue_jobs` rows and enqueues to BullMQ.  
- Jobs are in both Postgres (`queue_jobs`) and Redis (BullMQ). Worker reads/updates DB (`getQueueJob`, `updateQueueJobStatus`).

### Computable metrics

| Metric | Derivable? | How |
|--------|------------|-----|
| Jobs processed in last 24h | Yes | Count `queue_jobs` where `status = 'completed'` and `updated_at` in last 24h. |
| Jobs failed in last 24h | Yes | Count `queue_jobs` where `status = 'failed'` and `updated_at` in last 24h. |
| Average processing time | Approximate | For rows with `status = 'completed'`, use `updated_at - created_at` (no dedicated completed_at). |

### Publish success rate

- **From scheduled_posts:** Yes. Count `scheduled_posts` where `status = 'published'` and `published_at` in window vs `status = 'failed'` (and optionally other terminal states). Success rate = published / (published + failed) for the window.  
- **From queue_jobs:** Yes. For `job_type = 'publish'`, count `status = 'completed'` vs `status = 'failed'` in the time window.

### Queue latency

- **Derivable:** Time from `scheduled_for` (or `created_at`) to `updated_at` for completed/failed jobs gives “time to completion” per job; average over a window is a proxy for queue + processing latency. No separate “queued_at” vs “started_at” in DB.

### Return

| Item | Result |
|------|--------|
| Tables | `queue_jobs`, `queue_job_logs` (and `scheduled_posts` for publish outcomes). |
| Relevant fields | `queue_jobs`: job_type, status, created_at, updated_at, scheduled_for, error_message. |
| Publish success rate derivable? | Yes, from `scheduled_posts` (published_at + status) or from `queue_jobs` (status completed/failed). |
| Queue latency derivable? | Yes, approximately: (updated_at - created_at) or (updated_at - scheduled_for) for completed/failed jobs. |

---

## 3️⃣ Engagement Polling Visibility

### Components

- **backend/scheduler/cron.ts:** Runs a cycle (e.g. every 60s); calls `enqueueEngagementPolling()` when `Date.now() - lastEngagementPollingEnqueue >= ENGAGEMENT_POLLING_INTERVAL_MS` (10 min). In-memory `lastEngagementPollingEnqueue` only.  
- **backend/scheduler/schedulerService.ts:** `enqueueEngagementPolling()` adds a job to BullMQ `engagement-polling` queue. No DB write for “polling run”.  
- **backend/queue/bullmqClient.ts:** Defines `engagement-polling` queue and `getEngagementPollingWorker()`.  
- **backend/queue/jobProcessors/engagementPollingProcessor.ts:** Selects published posts (e.g. last 30 days), calls `ingestComments(post.id)` per post, returns and **logs** a summary (total_processed, total_ingested_comments, failures_count) via `console.log` only.

### Persistent logging

- **No.** Polling runs are not written to any table. No `engagement_polling_runs` or similar.  
- **Last run timestamp:** Not stored; only in-memory in cron (last enqueue time).  
- **Count of polling runs in last 24h:** Not derivable from DB; would require new instrumentation (e.g. append-only table or job log).  
- **Ingestion success/failure:** Processor returns and logs counts; not persisted. Individual comment ingestion outcomes are reflected in `post_comments` (and related) when successful, but there is no dedicated “poll run” or “ingestion run” table.

### Return

| Question | Answer |
|----------|--------|
| Is polling logged anywhere persistent? | No. Only `console.log` in processor. |
| Is last polling run timestamp stored? | No. |
| Can we count polling runs in last 24h? | No, without new instrumentation. |
| Is ingestion success/failure persisted? | Per-comment success is reflected in `post_comments`; run-level success/failure counts are not persisted. |

**What would require instrumentation:** A small append-only table (e.g. `engagement_polling_runs`: `id`, `started_at`, `finished_at`, `total_processed`, `total_ingested`, `failures_count`, optional `error`) written by the processor (or a wrapper), plus optionally storing “last run” in a key-value or config table for “last successful run” visibility.

---

## 4️⃣ Tenant & Campaign Growth Metrics

### Tables

| Table | Relevant columns |
|------|------------------|
| **companies** | id, name, website, industry, status ('active'/'inactive'), created_at. No last_login or last_activity. |
| **campaigns** | id, user_id, name, status, created_at, updated_at, etc. No company_id; company comes from campaign_versions. |
| **campaign_versions** | company_id, campaign_id, created_at, campaign_snapshot, etc. Links campaign → company. |
| **users** | id, email, name, created_at, updated_at. Some schemas add last_login, is_active; not in every migration. |
| **user_company_roles** | user_id, company_id, role, status. Links users to companies. |
| **scheduled_posts** | id, campaign_id, user_id, status, scheduled_for, published_at, created_at, updated_at. |

### Computable metrics

| Metric | Computable? | How |
|--------|-------------|-----|
| Total companies | Yes | `SELECT COUNT(*) FROM companies`. |
| Active companies (e.g. last 7d activity) | Yes, with joins | No `last_activity` on companies. Derive “active” by: e.g. companies with ≥1 row in `usage_events` (created_at in last 7d), or with `scheduled_posts` updated/published in last 7d via campaign_id → campaign_versions.company_id, or with recent campaign_versions.updated_at. |
| Total campaigns | Yes | Count `campaigns` or distinct `campaign_id` in `campaign_versions`. |
| Active campaigns (e.g. posts in last 7d) | Yes | Campaigns that have at least one `scheduled_posts` with published_at or updated_at in last 7d (join scheduled_posts.campaign_id → campaigns.id). |
| Posts published in last 7d | Yes | Count `scheduled_posts` where status = 'published' and published_at >= now() - 7d. |

### Strategist usage rate

- **Definition:** “Strategist” is not a single table; it refers to AI/planning features (e.g. campaign plan, recommendations, optimize week).  
- **Trackable:** Partially. `usage_events` has `process_type` (e.g. 'generateCampaignPlan', 'generateRecommendation', 'optimizeWeek', 'generateDailyPlan', 'generateDailyDistributionPlan'). So “strategist” usage can be approximated by filtering `usage_events` where `source_type = 'llm'` and `process_type` in a defined set of strategist operations. Rate = (companies or users with such events in period) / (total companies or users in scope).  
- **Limitation:** aiGateway does not set `campaign_id` on LLM events, so per-campaign strategist usage is not available without code change.

### Auto distribution adoption rate

- **Definition:** Distribution strategy (e.g. STAGGERED, AUTO, INTELLIGENT) is a week-level concept in blueprint/week data (e.g. `week_extras.distribution_strategy` or similar), not a single “campaign distribution mode” column.  
- **Trackable:** Only by inspecting snapshot/week data. E.g. from `campaign_versions.campaign_snapshot` (or weekly plan tables) parse week-level `distribution_strategy` and count campaigns/weeks using AUTO or INTELLIGENT vs STAGGERED. No dedicated “distribution_strategy” column on campaigns; would require parsing JSON/snapshots or a new column/view.

### Return

| Item | Result |
|------|--------|
| Tables | companies, campaigns, campaign_versions, users, user_company_roles, scheduled_posts. |
| Columns | companies: id, status, created_at. campaigns: id, user_id, status, created_at. campaign_versions: company_id, campaign_id, created_at. scheduled_posts: campaign_id, status, published_at, created_at, updated_at. users: id, created_at (and last_login/is_active where present). |
| Metrics computable? | Total/active companies, total/active campaigns, posts published in last 7d: yes. Active requires joining to activity (usage_events or scheduled_posts). |
| Strategist usage trackable? | Yes at org level via usage_events.process_type (LLM); not per campaign without populating campaign_id in LLM path. |
| Auto distribution adoption | Only by deriving from week/campaign snapshot data; no first-class column. |

---

## 5️⃣ Gaps Identified

1. **AI consumption**  
   - `usage_events.campaign_id` is not set by aiGateway (always null for LLM). Per-campaign token and cost breakdown requires passing campaignId into the gateway and ledger.

2. **Queue / jobs**  
   - No dedicated `completed_at` or `failed_at` on `queue_jobs`; only `updated_at` + status. Processing time and “last 24h” counts are derivable but approximate.  
   - No first-class “queue latency” (time-in-queue vs time-in-worker) without an extra “started_at” or equivalent.

3. **Engagement polling**  
   - No persistent record of polling runs, last run time, or run-level success/failure. Cron health for engagement polling is not stored; only console logs.

4. **Tenant growth**  
   - Companies have no `last_activity_at`; “active companies” requires joining to usage_events or scheduled_posts.  
   - Users: `last_login` / `is_active` exist only in some schemas.  
   - Auto distribution adoption is not a first-class metric; requires parsing snapshot/week data.

5. **Cross-cutting**  
   - No single “system health” or “platform activity” table; health is derived from usage_events, queue_jobs, scheduled_posts, and (if added) engagement_polling_runs.

---

## 6️⃣ Phase 1 Feasible Metrics (read-only, no schema change)

Using only existing tables and no new instrumentation:

| Area | Metric | Source | Notes |
|------|--------|--------|--------|
| AI consumption | Tokens per org (and optionally by month) | usage_events or usage_meter_monthly | By month: use usage_meter_monthly. By arbitrary range: aggregate usage_events. |
| AI consumption | Cost per org (and by month) | usage_events, usage_meter_monthly | Same as above. |
| AI consumption | Events/calls by process_type | usage_events | Filter by process_type, date range. |
| AI consumption | Error rate (LLM) | usage_events | error_flag = true vs total for source_type = 'llm'. |
| Queue / jobs | Jobs completed in last 24h | queue_jobs | status = 'completed', updated_at in window. |
| Queue / jobs | Jobs failed in last 24h | queue_jobs | status = 'failed', updated_at in window. |
| Queue / jobs | Approx. avg processing time | queue_jobs | (updated_at - created_at) for completed/failed. |
| Publish | Publish success rate in window | scheduled_posts or queue_jobs | published / (published + failed) from scheduled_posts or from publish job status. |
| Tenant | Total companies | companies | COUNT(*). |
| Tenant | Total campaigns | campaigns or campaign_versions | COUNT(*) or COUNT(DISTINCT campaign_id). |
| Tenant | Active companies (last 7d) | companies + usage_events or scheduled_posts + campaign_versions | Join to activity in last 7d. |
| Tenant | Active campaigns (last 7d) | campaigns + scheduled_posts | Campaigns with scheduled_posts updated/published in last 7d. |
| Tenant | Posts published last 7d | scheduled_posts | status = 'published', published_at in window. |
| Strategist | Org-level “strategist” usage rate | usage_events | Filter process_type in (e.g. generateCampaignPlan, generateRecommendation, optimizeWeek, …); count orgs with ≥1 event in period. |

**Not feasible without new instrumentation (Phase 1, no schema change):**

- Engagement polling: run count in last 24h, last run timestamp, run-level success/failure.  
- Queue: true “time in queue” vs “time in worker” (would need started_at or equivalent).  
- Auto distribution adoption: would need a dedicated column or materialized view from snapshot data (or accept one-off snapshot parsing).

---

*End of audit. No files were modified; findings are based on current code and schema only.*
