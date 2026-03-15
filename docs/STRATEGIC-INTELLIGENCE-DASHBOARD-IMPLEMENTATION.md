# STRATEGIC INTELLIGENCE DASHBOARD IMPLEMENTATION

**AI Social Media Command Center — Frontend Dashboard Layer**

---

## 1 Dashboard Page

| Item | Details |
|------|---------|
| Route | `/intelligence` |
| File | `pages/intelligence/index.tsx` |
| Layout | Header with title; two-column grid on XL (main content 2/3, timeline 1/3) |
| Sections | Emerging Opportunities, Strategic Recommendations, Signal Correlations, Intelligence Activity Timeline |
| Data source | `useIntelligenceDashboard` hook |

---

## 2 Components Created

| Component | File | Purpose |
|-----------|------|---------|
| OpportunityPanel | `components/intelligence/OpportunityPanel.tsx` | Displays opportunity cards grouped by type (emerging_trend, competitor_weakness, market_gap, customer_pain_signal). Sorted by opportunity_score DESC. |
| RecommendationPanel | `components/intelligence/RecommendationPanel.tsx` | Displays strategic recommendations sorted by confidence_score DESC. Types: content_opportunity, product_opportunity, marketing_opportunity, competitive_opportunity. |
| CorrelationPanel | `components/intelligence/CorrelationPanel.tsx` | Displays correlated signals in a graph-like grid. Shows pair topic_a ↔ topic_b with correlation_score. Grouped by correlation_type. |
| IntelligenceTimeline | `components/intelligence/IntelligenceTimeline.tsx` | Timeline of recent signals (topic, detected_at, related opportunity). Aggregates from correlations, opportunities, recommendations. |

All components are memoized (`React.memo`).

---

## 3 API Integration

| API | Usage |
|-----|-------|
| `GET /api/intelligence/opportunities` | `companyId`, `windowHours`, optional `buildGraph` |
| `GET /api/intelligence/recommendations` | `companyId`, `windowHours`, optional `buildGraph` |
| `GET /api/intelligence/correlations` | `companyId`, `windowHours` |

Requests use `credentials: 'include'` for auth. Parallel fetch via `Promise.all`.

---

## 4 Data Hook

| Hook | File | Behavior |
|------|------|----------|
| `useIntelligenceDashboard` | `hooks/useIntelligenceDashboard.ts` | Fetches opportunities, recommendations, correlations in parallel. Params: `companyId`, `windowHours`, `buildGraph`. Returns `{ opportunities, recommendations, correlations, loading, error, refresh }`. Handles loading, errors, empty state. |

---

## 5 Auto Refresh

| Setting | Value |
|---------|-------|
| Interval | 10 minutes |
| Mechanism | `setInterval` in `useEffect` inside `useIntelligenceDashboard` |
| Cleanup | Interval cleared on unmount or when `companyId`/`fetchData` changes |

---

## 6 Filtering

| Filter | Control | Options |
|--------|----------|---------|
| windowHours | `<select>` | 24h, 48h, 72h |
| buildGraph | Checkbox | Toggles graph build on opportunities/recommendations fetch |
| Company | `useCompanyContext().selectedCompanyId` or `?companyId=` query param |

---

## 7 UI Layout

- **Header:** Title, description, filter controls (window selector, build graph checkbox, Refresh button)
- **Empty company:** Amber notice to select company or add `companyId` to URL
- **Error:** Red alert banner
- **Grid:** Main column (OpportunityPanel, RecommendationPanel, CorrelationPanel); sidebar (IntelligenceTimeline)
- **Responsive:** Single column on smaller screens; 3-column grid on XL
- **Loading:** Skeleton placeholders in each panel
- **Empty states:** In-panel messages when no data

---

**Implementation complete.** No backend intelligence services were modified.
