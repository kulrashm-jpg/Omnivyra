# Phase-4 Dashboard Performance and Query Safety — Implementation Report

---

## 1. Indexes Added

| Index | Definition |
|-------|------------|
| idx_company_signals_dashboard | (company_id, signal_score DESC NULLS LAST, created_at DESC) |
| idx_company_signals_priority | (company_id, priority_level, signal_score DESC NULLS LAST) |
| idx_company_signals_competitors | GIN (matched_competitors) |
| idx_company_signals_topics | GIN (matched_topics) |
| idx_company_signals_regions | GIN (matched_regions) |

---

## 2. Database Migration File

**Path:** `database/company_intelligence_signals_dashboard_indexes.sql`

**Prerequisite:** Run after `company_intelligence_signals_phase4.sql`

---

## 3. Dashboard Query Change

**File:** `backend/services/companyIntelligenceDashboardService.ts`

**Constant added:** `DASHBOARD_FETCH_LIMIT = 200`

**Change in fetchCompanySignals():**
- Added `.limit(DASHBOARD_FETCH_LIMIT)` to the Supabase query
- Fetch top 200 signals by signal_score DESC before categorization
- Categorization and slice(0, 10) per category unchanged

---

## 4. API Validation Logic

**File:** `pages/api/company/intelligence/signals.ts`

**Rules:**

| Parameter | Validation | Rejection |
|-----------|------------|-----------|
| companyId | Required, trimmed | 400 if missing or empty |
| windowHours | Positive integer, max 720 | 400 if NaN, < 1, or > 720 |

**Error responses:**
- `companyId required`
- `windowHours must be a positive number`
- `windowHours max is 720 (30 days)`

---

## 5. Final Dashboard Query Structure

```
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
INNER JOIN intelligence_signals ON company_intelligence_signals.signal_id = intelligence_signals.id
WHERE company_id = $1
  AND created_at >= $2
ORDER BY signal_score DESC NULLS LAST
LIMIT 200
```

**Flow:** Fetch 200 → categorize → return top 10 per category.
