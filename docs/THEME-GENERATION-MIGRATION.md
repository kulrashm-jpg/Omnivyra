# Theme Generation: Legacy → Intelligence Pipeline

This document describes the replacement of the **legacy LLM-based trend theme generation** with the **External API Intelligence System** (strategic themes from `strategic_themes` table).

---

## What Changed

| Before (legacy) | After (new system) |
|-----------------|---------------------|
| `generateTrendOpportunities(companyId, strategicPayload)` in `opportunityGenerators.ts` | `getStrategicThemesAsOpportunities({ companyId, limit })` in `strategicThemeEngine.ts` |
| LLM prompt with company context, regions, cluster inputs → 6 theme pillars | Themes from pipeline: `strategic_themes` (momentum ≥ 0.6, trend UP), ordered by momentum |
| suggest-themes API built full strategic payload and called LLM | suggest-themes loads from `strategic_themes`, same response shape `{ themes: [{ id, title, summary, payload }] }` |
| regenerate-blueprint used LLM themes for topicSet | regenerate-blueprint uses strategic themes from pipeline for topicSet |
| getGenerator('TREND') → generateTrendOpportunities | getGenerator('TREND') → getStrategicThemesAsOpportunities |

---

## Benefits Preserved

- **Same API shape:** suggest-themes and consumers still get `title`, `summary`, `payload` (payload now includes `momentum_score`, `trend_direction`, `keywords`, `companies`, `influencers`, `strategic_theme_id`).
- **Opportunity slots:** fillOpportunitySlots(companyId, 'TREND') still receives `OpportunityInput[]` and fills TREND slots from the new source.
- **Campaign planning:** regenerate-blueprint still gets a set of theme titles for `recommended_topics` / context; source is now pipeline themes instead of LLM.

---

## What Was Removed

- **`generateTrendOpportunities`** — removed from `backend/services/opportunityGenerators.ts`.
- **LLM-based trend theme generation** — the prompt, `TrendThemeItem`, and `runDiagnosticPrompt` usage for TREND themes.
- **Strategic payload usage for TREND** — suggest-themes and regenerate-blueprint no longer build `StrategicPayload` for theme generation (payload is still used elsewhere, e.g. `generateTrendRecommendationForRegion`).

---

## Files Touched

- `backend/services/strategicThemeEngine.ts` — added `getStrategicThemesAsOpportunities()`.
- `backend/services/opportunityGenerators.ts` — TREND case uses new function; removed `generateTrendOpportunities` and LLM block.
- `pages/api/campaigns/[id]/suggest-themes.ts` — uses `getStrategicThemesAsOpportunities`; removed payload/version/profile usage for themes.
- `pages/api/campaigns/regenerate-blueprint.ts` — uses `getStrategicThemesAsOpportunities` for topicSet; removed FocusModule/StrategicPayload usage for themes.

---

## Dependency

Strategic themes are populated by the **Strategic Theme Engine** (hourly cron). If `strategic_themes` is empty, suggest-themes and TREND slots will return an empty list until the pipeline has run (polling → clustering → signal intelligence → theme generation).
