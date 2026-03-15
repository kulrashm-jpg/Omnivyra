# Content Opportunity Engine Implementation Report

**Date:** 2026-03-07

---

## 1 — Tables Created

| Table | File | Purpose |
|-------|------|---------|
| `content_opportunities` | `database/content_opportunities.sql` | Structured content opportunities from strategic themes |
| `campaign_narratives` | `database/campaign_narratives.sql` | Story-driven campaign angles from content opportunities |

**content_opportunities columns:** id, theme_id, company_id, opportunity_title, opportunity_description, opportunity_type, priority_score, momentum_score, created_at

**campaign_narratives columns:** id, opportunity_id, narrative_angle, narrative_summary, target_audience, platform, created_at

---

## 2 — Content Opportunity Engine

**File:** `backend/services/contentOpportunityEngine.ts`

**Function:** `generateContentOpportunities()`

**Logic:**
1. Load strategic themes from last 24 hours (`created_at >= now - 24h`)
2. Get active company IDs (from `fetchActiveCompanies` or fallback to active companies)
3. For each (theme, company): get `relevance_score` from `theme_company_relevance` (default 0.5)
4. Compute `priority_score = momentum_score * 0.6 + relevance_score * 0.4`
5. Generate 2–3 opportunity types per theme: `thought_leadership`, `educational_framework`, `industry_analysis`
6. Insert into `content_opportunities`

**Opportunity types:** thought_leadership, industry_analysis, contrarian_take, educational_framework, trend_explainer

---

## 3 — Narrative Engine

**File:** `backend/services/narrativeEngine.ts`

**Function:** `generateCampaignNarratives()`

**Logic:**
1. Load content opportunities without existing narratives
2. For each opportunity: generate 3 narrative angles × 4 platforms
3. Angles: founder_insight, industry_shift, practical_guide
4. Platforms: LinkedIn, Twitter/X, Blog, Newsletter
5. Insert into `campaign_narratives`

---

## 4 — Priority Scoring Logic

```
priority_score = (momentum_score * 0.6) + (relevance_score * 0.4)
```

- `momentum_score` → from `strategic_themes`
- `relevance_score` → from `theme_company_relevance` (company + theme); default 0.5 if missing

---

## 5 — APIs Created

| Endpoint | File | Parameters | Response |
|----------|------|------------|----------|
| `GET /api/intelligence/content-opportunities` | `pages/api/intelligence/content-opportunities.ts` | companyId, limit, priority_threshold | `{ opportunities: [{ title, description, priority_score, momentum_score }] }` |
| `GET /api/intelligence/narratives` | `pages/api/intelligence/narratives.ts` | companyId, opportunityId, platform | `{ narratives: [{ angle, summary, platform }] }` |

**Note:** `GET /api/intelligence/opportunities` exists and returns campaign opportunities from `intelligenceOrchestrationService`. Content opportunities are served at `/api/intelligence/content-opportunities`.

---

## 6 — Scheduler Integration

**schedulerService.ts:**
- `runContentOpportunityEngine()` → `generateContentOpportunities()` — every 2 hours
- `runNarrativeEngine()` → `generateCampaignNarratives()` — every 4 hours

**cron.ts:**
- `CONTENT_OPPORTUNITY_INTERVAL_MS` = 2 hours
- `NARRATIVE_ENGINE_INTERVAL_MS` = 4 hours
- Both run in `runSchedulerCycle()`

---

## Pipeline Flow

```
strategic_themes
  → contentOpportunityEngine.generateContentOpportunities()
  → content_opportunities
  → narrativeEngine.generateCampaignNarratives()
  → campaign_narratives
```
