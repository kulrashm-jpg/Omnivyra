# OPPORTUNITY RADAR — IMPLEMENTATION REPORT

**Date:** 2025-03-09

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| `database/opportunity_radar_indexes.sql` | Indexes for aggregation queries |
| `backend/services/opportunityRadarService.ts` | Service layer for cross-thread opportunity counts |
| `pages/api/engagement/opportunity-radar.ts` | GET endpoint for Opportunity Radar stats |
| `docs/OPPORTUNITY-RADAR-IMPLEMENTATION-REPORT.md` | This report |

---

## FILES_MODIFIED

None. Existing detection systems and APIs were not modified.

---

## SQL_MIGRATIONS

### database/opportunity_radar_indexes.sql

**Dependencies:** Run after `engagement_opportunities.sql`, `engagement_lead_signals.sql`

**Indexes added:**

| Table | Index Name | Column(s) |
|-------|------------|-----------|
| engagement_opportunities | idx_opportunity_radar_opportunity_type | opportunity_type |
| engagement_opportunities | idx_opportunity_radar_opportunity_detected_at | detected_at |
| engagement_lead_signals | idx_opportunity_radar_lead_intent | lead_intent |
| engagement_lead_signals | idx_opportunity_radar_lead_detected_at | detected_at |

**Apply:**
```bash
psql $DATABASE_URL -f database/opportunity_radar_indexes.sql
```
Or run via Supabase SQL Editor / migration runner.

---

## API_ENDPOINTS

### GET /api/engagement/opportunity-radar

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| organization_id | string | Yes | — | Organization scope |
| window_hours | number | No | 24 | Time window (1–168 hours) |

**Response:**
```json
{
  "competitor_complaints": 0,
  "recommendation_requests": 0,
  "product_comparisons": 0,
  "buying_intent": 0,
  "window_hours": 24
}
```

**Auth:** Uses `resolveUserContext` and `enforceCompanyAccess`. Credentials required.

**Example:**
```
GET /api/engagement/opportunity-radar?organization_id=<uuid>&window_hours=24
```

---

## SERVICE_FUNCTIONS

### getOpportunityRadarStats(organizationId, windowHours?)

**File:** `backend/services/opportunityRadarService.ts`

**Parameters:**
- `organizationId: string` — Organization scope
- `windowHours: number` — Default 24. Time window in hours

**Returns:** `OpportunityRadarStats`

**Logic:**
- `windowStart = NOW() - windowHours`
- Four parallel Supabase count queries:
  1. `engagement_opportunities`: `opportunity_type = 'competitor_complaint'`, `resolved = false`, `detected_at >= windowStart`
  2. `engagement_opportunities`: `opportunity_type = 'recommendation_request'`, `resolved = false`, `detected_at >= windowStart`
  3. `engagement_opportunities`: `opportunity_type = 'product_comparison'`, `resolved = false`, `detected_at >= windowStart`
  4. `engagement_lead_signals`: `lead_intent IN ('pricing_inquiry','demo_request','trial_interest')`, `detected_at >= windowStart`

---

## PERFORMANCE_NOTES

1. **Parallel queries:** All four count queries run via `Promise.all`. No sequential dependency.

2. **Index usage:** New indexes support:
   - `opportunity_type` and `detected_at` for engagement_opportunities filters
   - `lead_intent` and `detected_at` for engagement_lead_signals filters

3. **Count-only:** Uses `select('id', { count: 'exact', head: true })` — no row data transferred.

4. **Target:** &lt;100ms for typical datasets. With indexes, count-only queries should complete quickly. Monitor via `EXPLAIN ANALYZE` if needed.

5. **Caching:** Not implemented. For high-frequency UI polling, consider adding a short TTL cache (e.g. 60s) in a future iteration.
