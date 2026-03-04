# System Dashboard (Super Admin) — Implementation Report

**Status:** Implemented. Read-only. No schema changes. No modification to existing services.

---

## 1. Route

| Item | Value |
|------|--------|
| **Page** | `pages/system-dashboard.tsx` |
| **Access** | Super admin only. Uses existing auth: cookie `super_admin_session` or Supabase user + `isPlatformSuperAdmin()`. |
| **Guard** | API `GET /api/system/overview` returns 403 when not super admin; page shows “Access denied” and link back. |
| **Link** | Header includes “← Super Admin” to `/super-admin`. |

---

## 2. API

| Item | Value |
|------|--------|
| **Endpoint** | `pages/api/system/overview.ts` |
| **Method** | GET only |
| **Query** | `range=7|30|90` (default 7) |
| **Writes** | None. Read-only. |

---

## 3. Data Sources

All reads wrapped in try/catch. Missing table or query error → zeros for that part; API does not throw.

| Table | Usage |
|-------|--------|
| `queue_jobs` | 24h completed/failed counts, avg processing time (updated_at − created_at). |
| `scheduled_posts` | Publish success (7d: published vs failed), posts published (7d), active campaigns (7d). |
| `usage_events` | AI consumption in range window: tokens, cost, LLM calls, error rate, latency, by model/process_type; external_api and automation counts; strategist orgs. |
| `companies` | Total companies count. |
| `campaigns` | Total campaigns count. |
| `campaign_versions` | Resolve company_id for campaigns that have published posts (7d) → active companies. |

`usage_meter_monthly` not used (all metrics from `usage_events` for flexibility and range support).

---

## 4. Response Shape

`SystemOverviewResponse`:

- **range_days:** 7 | 30 | 90
- **system_health:** jobs_completed_24h, jobs_failed_24h, failure_rate_percent, avg_processing_time_ms, publish_success_rate_percent, status (`HEALTHY` \| `DEGRADED` \| `CRITICAL`)
- **ai_consumption:** total_tokens, total_cost, llm_calls, llm_error_rate_percent, avg_latency_ms, external_api_calls, automation_executions, tokens_by_model, tokens_by_process_type
- **tenant_growth:** total_companies, active_companies_last_7_days, total_campaigns, active_campaigns_last_7_days, posts_published_last_7_days, strategist_usage_rate_percent

---

## 5. Computation Rules (Implemented)

| Metric | Rule |
|--------|------|
| **Queue 24h** | completed = status = 'completed' AND updated_at >= now − 24h; failed = status = 'failed' AND updated_at >= now − 24h. |
| **Failure rate** | failed / (completed + failed) × 100. |
| **Avg processing time** | Mean of (updated_at − created_at) in ms for completed/failed jobs in 24h. |
| **Publish success** | From scheduled_posts: published / (published + failed) in last 7d. |
| **Status badge** | failure_rate > 15% → CRITICAL; > 5% → DEGRADED; else HEALTHY. |
| **AI consumption** | usage_events in range window: sum tokens/cost, count LLM/external_api/automation, avg latency, error rate; group by model_name and process_type. |
| **Active companies (7d)** | Distinct organization_id from usage_events (7d) ∪ distinct company_id from campaign_versions for campaigns with published posts in 7d. |
| **Active campaigns (7d)** | Distinct campaign_id from scheduled_posts with published_at or updated_at in 7d. |
| **Strategist usage rate** | Distinct organizations with process_type in (generateCampaignPlan, generateRecommendation, optimizeWeek, generateDailyPlan, generateDailyDistributionPlan) in range / total_companies × 100. |

---

## 6. UI Layout

- **Three stacked sections:** System Health, AI Consumption, Tenant Growth.
- **Top right:** Range toggle 7d / 30d / 90d (refetch on change).
- **System Health:** Status badge (Healthy / Degraded / Critical), queue metrics, publish success rate. Bordered card.
- **AI Consumption:** Totals, LLM/external/automation counts, tokens by model, tokens by process type. Bordered card. Subtitle “Last {range_days} days”.
- **Tenant Growth:** Companies, campaigns, posts published, strategist usage rate. Bordered card.
- No charts. Numbers + small labels. Tailwind, minimal, operational.

---

## 7. Safety

- No schema changes.
- No new background jobs.
- No changes to usage logging or existing services.
- No new tables.
- All queries read-only. Errors and missing tables yield zeros; no throws to client.

---

## 8. Files Created/Modified

| File | Action |
|------|--------|
| `pages/api/system/overview.ts` | Created (GET handler, super admin guard, all metrics). |
| `pages/system-dashboard.tsx` | Created (guard via API 403, three sections, range toggle). |
| `docs/SYSTEM-DASHBOARD-IMPLEMENTATION-REPORT.md` | Created (this report). |

No other files modified.
