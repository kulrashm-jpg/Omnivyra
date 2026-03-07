# Phase-4 Company Intelligence Dashboard Service — Implementation Report

---

## 1. Files Created

| File | Path |
|------|------|
| Company Intelligence Dashboard Service | `backend/services/companyIntelligenceDashboardService.ts` |
| Company Intelligence Signals API | `pages/api/company/intelligence/signals.ts` |

---

## 2. Service Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| fetchCompanySignals | `(companyId: string, windowHours?: number) => Promise<FetchedSignal[]>` | Fetch recent signals ordered by signal_score DESC |
| categorizeSignals | `(signals: FetchedSignal[]) => Record<Category, FetchedSignal[]>` | Assign signals to categories by priority rules |
| buildDashboardSignals | `(companyId: string, windowHours?: number) => Promise<DashboardSignalsResponse>` | Main method; returns dashboard structure |

---

## 3. Category Classification Logic

**Priority order:** Competitor → Product → Partnership → Marketing → Market

| Category | Rule |
|----------|------|
| Competitor | matched_competitors NOT NULL and length > 0 |
| Product | topic or matched_topics contains product terms (product, launch, release, feature, platform, saas, software, tool, app) |
| Partnership | topic contains partnership terms (partnership, alliance, collaboration, acquisition, merge, joint venture, deal) |
| Marketing | topic contains marketing terms (campaign, ads, brand, engagement, content, marketing, social media, influencer) |
| Market | topic_match true (matched_topics length > 0) AND competitor_match false |

**Limit per category:** 10 signals.

---

## 4. Database Queries Used

**Table:** company_intelligence_signals

**Join:** intelligence_signals (via signal_id → intelligence_signals.id)

**Query:**
```sql
SELECT
  signal_id,
  signal_score,
  priority_level,
  matched_topics,
  matched_competitors,
  matched_regions,
  created_at,
  intelligence_signals.topic
FROM company_intelligence_signals
JOIN intelligence_signals ON company_intelligence_signals.signal_id = intelligence_signals.id
WHERE company_id = $1
  AND created_at >= $2  -- since (default: 7 days ago)
ORDER BY signal_score DESC NULLS LAST
```

**Supabase:** `.from('company_intelligence_signals').select('signal_id, signal_score, priority_level, matched_topics, matched_competitors, matched_regions, created_at, intelligence_signals!inner(topic)').eq('company_id', companyId).gte('created_at', sinceStr).order('signal_score', { ascending: false })`

---

## 5. API Route File

**Path:** `pages/api/company/intelligence/signals.ts`

**Method:** GET only

**Query params:** companyId (required), windowHours (optional, default 168)

**Auth:** withRBAC — COMPANY_ADMIN, ADMIN, SUPER_ADMIN, CONTENT_CREATOR, CONTENT_PLANNER

---

## 6. API Response Structure

```json
{
  "market_signals": [
    {
      "signal_id": "uuid",
      "topic": "string | null",
      "signal_score": 0.85,
      "priority_level": "HIGH | MEDIUM | LOW | null",
      "matched_topics": ["string"] | null,
      "matched_competitors": ["string"] | null,
      "matched_regions": ["string"] | null,
      "created_at": "ISO8601 | null"
    }
  ],
  "competitor_signals": [],
  "product_signals": [],
  "marketing_signals": [],
  "partnership_signals": []
}
```

**Endpoint:** `GET /api/company/intelligence/signals?companyId=<uuid>`

---

## 7. Final Execution Flow

```
intelligence_signals
  → companySignalFilteringEngine.filterSignalsForCompany
  → companySignalRankingEngine.rankSignalsForCompany
  → computeSignalPriority
  → insertRankedCompanyIntelligenceSignals
  → company_intelligence_signals
  → companyIntelligenceDashboardService.buildDashboardSignals
  → GET /api/company/intelligence/signals
```
