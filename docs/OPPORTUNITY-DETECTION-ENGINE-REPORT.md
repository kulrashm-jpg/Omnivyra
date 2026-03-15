# Opportunity Detection Engine — Implementation Report

## FILES_CREATED

| file | purpose |
|------|---------|
| `backend/services/opportunityDetectionService.ts` | Core service: `detectOpportunities(input)`, `saveOpportunityReport()`; detection rules, scoring, retention (50 per company) |
| `database/opportunity_reports.sql` | Table: id, company_id, report_json, generated_at, opportunity_count, analysis_version |
| `pages/api/company/opportunities.ts` | GET endpoint; fetches trend, engagement, strategic insights, inbox; calls detectOpportunities; persists report |
| `components/dashboard/OpportunityPanel.tsx` | Dashboard panel: title, description, opportunity score, confidence, recommended action |
| `backend/tests/unit/opportunityDetectionService.test.ts` | Unit tests for detection rules, scoring, prioritization |

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| (none) | No existing files modified |

## OPPORTUNITY_ENGINE_TEST

- **opportunities_generated**: Market opportunity (emerging trend), Engagement opportunity (reply rate + low content), Market opportunity (from strategic insight), Content opportunity (repeated inbox topic)
- **opportunity_scores**: 0–100 via `computeOpportunityScore(trendStrength, engagementSignal, strategicSignal)` weighted 0.4 / 0.35 / 0.25

## API_TEST

- **endpoint**: `GET /api/company/opportunities?companyId={companyId}`
- **response**: `OpportunityReport` JSON
- **auth**: RBAC (COMPANY_ADMIN, ADMIN, SUPER_ADMIN, CONTENT_CREATOR, CONTENT_PLANNER)

## COMPILATION_STATUS

- **status**: Passed
- **errors**: None
- **warnings**: None

## Detection Rules Implemented

1. **Emerging Trend**: trend_signals.strength > 0.5 AND topic not in campaign coverage → market_opportunity
2. **Engagement Gap**: engagement_health.reply_rate > 0.08 AND content production low → engagement_opportunity
3. **Strategic Insight**: strategic_insight_report.insights with insight_category market_trend → convert to market_opportunity
4. **Inbox Demand**: inbox_signals with repeated topic (count ≥ 2) → content_opportunity

## Prioritization

Sorted by: `opportunity_score` DESC, then `confidence` DESC.

---

## Persistence Hardening (Update)

### FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `database/opportunity_reports.sql` | ALTER TABLE ADD COLUMN IF NOT EXISTS analysis_version for existing tables |
| `backend/services/opportunityDetectionService.ts` | Added getLatestOpportunityReport(companyId) with 6h TTL |
| `pages/api/company/opportunities.ts` | TTL check: return cached report if generated_at < 6h before generating |

### OPPORTUNITY_DB_TEST

- **index_created**: `idx_opportunity_reports_company_time` on (company_id, generated_at DESC)
- **analysis_version_saved**: `analysis_version` column; populated with `opportunity_v1.0` on each insert

### COMPILATION_STATUS

- **status**: Passed
- **errors**: None
- **warnings**: None

---

## Observability Completion (Update)

### FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/opportunityDetectionService.ts` | Extended OpportunityReport: evaluation_duration_ms, opportunity_count_total, signals_analyzed; compute at start/end of detectOpportunities() |
| `backend/tests/unit/opportunityDetectionService.test.ts` | Test for diagnostic fields |

### DIAGNOSTIC_TEST

- **evaluation_duration_ms**: Computed as Date.now() - evaluationStart; ≥ 0
- **signals_analyzed**: trend_signals.length + inbox_signals.length + strategic_insight_report.insights.length

### COMPILATION_STATUS

- **status**: Passed
- **errors**: None
- **warnings**: None
