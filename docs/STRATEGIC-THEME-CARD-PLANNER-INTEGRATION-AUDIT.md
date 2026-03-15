# Strategic Theme Card Integration (Trend Campaign + Planner) — Audit Report

**Objective:** Determine whether existing Strategic Theme Card generation used in Trend Campaigns can be reused inside the Campaign Planner. The planner should allow generating theme cards from (1) Trend campaign inputs, (2) Campaign description/context, and (3) AI chat prompt — and optionally populate the campaign skeleton.

---

## 1. Strategic Theme Generation Services

| Service | File | Function | Purpose |
|---------|------|----------|---------|
| **strategicThemeEngine** | `backend/services/strategicThemeEngine.ts` | `generateStrategicThemes()` | Converts `signal_intelligence` (momentum ≥ 0.6, trend UP) → `strategic_themes` table. Template-based, no LLM. |
| **strategicThemeEngine** |同上 | `getStrategicThemesAsOpportunities()` | Loads `strategic_themes` as OpportunityInput[] for suggest-themes, Campaign Builder, regenerate-blueprint. |
| **strategicThemeEngine** |同上 | `generateThemesForCampaignWeeks()` | Generates theme titles per week using Weekly Angle Distribution Engine. Topic + weeks → `string[]`. |
| **strategicThemeEngine** |同上 | `generateAdditionalStrategicThemes()` | LLM-based additional themes; uses `strategicPayload`, ranking context, existing keys. |
| **recommendationEngineService** | `backend/services/recommendationEngineService.ts` | `generateRecommendations()` | Orchestrates Trend Campaign flow: `insight_source` (hybrid/api/llm) → signals + `getStrategicThemesAsOpportunities` (when llm) → trends_used cards. |
| **themeAngleEngine** | `backend/services/themeAngleEngine.ts` | `generateThemeFromTopic()` | Editorial angle templates; diverse themes from topic. |
| **themePreviewService** | `backend/services/themePreviewService.ts` | `getThemePreview()` | Loads theme + signal intelligence + opportunities for display. |

**Note:** `generateStrategicThemes()` is batch/scheduled (schedulerService, cron). `getStrategicThemesAsOpportunities()` is on-demand. `generateRecommendations()` is the main Trend Campaign entry.

---

## 2. Trend Campaign Theme Flow

### UI Components

| Component | Path | Role |
|-----------|------|------|
| **TrendCampaignsTab** | `components/recommendations/tabs/TrendCampaignsTab.tsx` | Builds `strategicPayload` → POST `/api/recommendations/generate`. Uses `UnifiedContextModeSelector`, `EngineContextPanel`, `insight_source` (hybrid/api/llm). |
| **RecommendationBlueprintCard** | `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Renders theme cards; "Build Campaign Blueprint" passes `sourceStrategicTheme` to campaign. |

### API Flow

| Step | API/Service | Input | Output |
|------|-------------|-------|--------|
| 1 | `POST /api/recommendations/generate` | `companyId`, `strategicPayload`, `insight_source`, `regions`, `objective`, `durationWeeks` | `RecommendationEngineResult` with `trends_used` (cards). |
| 2 | `recommendationEngineService.generateRecommendations()` | Strategic payload + execution_config | Signals (api/hybrid) or strategic_themes (llm). |
| 3 | When `insight_source === 'llm'` | — | `getStrategicThemesAsOpportunities({ companyId })` → themes from DB. |
| 4 | When api/hybrid | — | External APIs + `fetchTrendsFromApis` → ranking → sequence → blueprint. |

### Theme Card Shape (Trend Campaign result)

Cards include: `topic`, `polished_title`, `summary`, `intelligence`, `execution`, `company_context_snapshot`, `duration_weeks`, `progression_summary`, `primary/supporting_recommendations`, `themes` (string[]).

---

## 3. Theme API Endpoints

| Endpoint | Method | Purpose | Request | Response |
|----------|--------|---------|---------|----------|
| **`/api/recommendations/generate`** | POST | Generate strategic theme cards (Trend Campaign) | `companyId`, `strategicPayload`, `insight_source`, `regions`, `campaignId?`, `objective`, `durationWeeks`, `simulate` | `trends_used`, `strategy_sequence`, `campaign_blueprint`, etc. |
| **`/api/campaigns/[id]/suggest-themes`** | POST | Suggest themes for an existing campaign | `companyId` | `{ themes: [{ id, title, summary, payload }] }` — from `getStrategicThemesAsOpportunities()`. Requires `campaignId`. |
| **`/api/campaigns/ai/plan`** | POST | Generate/refine plan | `idea_spine`, `strategy_context`, `prefilledPlanning` / `collectedPlanningContext`, `message` | `plan.weeks`, `plan.calendar_plan` |

**Planner-relevant:** Planner calls `/api/campaigns/ai/plan` with `idea_spine`, `strategy_context`, `platform_content_requests`. It does **not** call `/api/recommendations/generate` or `/api/campaigns/[id]/suggest-themes` (suggest-themes requires campaignId).

---

## 4. Planner Support For Themes

### Current State

| Location | Theme Support |
|----------|---------------|
| **plannerSessionStore** | No `strategic_themes`, `theme_cards`, or `recommended_theme`. Has `idea_spine`, `strategy_context`, `calendar_plan`, `trend_context`. |
| **AIPlanningAssistantTab** | Sends `idea_spine`, `strategy_context`, `platform_content_requests` to `/api/campaigns/ai/plan`. No theme-specific payload. |
| **StructureTab** | Sends `idea_spine`, `strategy_context`, `platform_content_requests`, `company_context_mode` to ai/plan. No themes. |
| **calendar_plan / planPreviewService** | No theme metadata in `CalendarPlan` or `calendarPlanConverter`. |

### campaignAiOrchestrator (ai/plan backend)

The orchestrator **does** accept themes via `prefilledPlanning` / `collectedPlanningContext`:

- `strategic_themes` or `themes` (string[]) — mapped from `payload.strategic_themes` / `payload.themes`.
- `strategic_theme_progression` — from `payload.progression_summary`.
- `strategic_theme_duration_weeks` — from `payload.duration_weeks`.
- `strategic_theme_intelligence` — from `payload.intelligence` / `payload.recommendation_intelligence`.

Used in weekly planning: `prefilledPlanning.strategic_themes` → `effectiveThemes` → `campaignContext.strategic_themes`. Theme per week: `strategicThemes[(weekNo - 1) % themes.length]`.

---

## 5. Skeleton Mapping Capability

### Existing Mapping (campaignAiOrchestrator)

| Input | Mapping |
|-------|---------|
| `strategic_themes` (string[]) | Fed into weekly plan context. `pickedTheme = strategicThemes[(weekNo - 1) % themes.length]` used for week-level planning. |
| `strategic_theme_progression` | Injected into campaign context for LLM. |
| `strategic_theme_duration_weeks` | Used for duration alignment. |

### Theme → Activity Mapping (implied)

- Theme per week flows into LLM prompt for weekly content generation.
- No explicit `theme.week → week_number` or `theme.key_message → activity.title` in code; the orchestrator uses themes as context for the LLM that generates activities.
- `generateThemesForCampaignWeeks(topic, weeks)` produces `string[]` (one title per week) — suitable for skeleton population.

### Suggest-themes Response Shape

```json
{
  "themes": [
    { "id": "theme-0-...", "title": "...", "summary": null, "payload": { "momentum_score", "strategic_theme_id", ... } }
  ]
}
```

Used by Campaign Builder, not Planner.

---

## 6. AI Chat Theme Generation

### AIPlanningAssistantTab

- **Does NOT** have dedicated theme generation (no `generateThemes`, `strategicThemes`, `themeGeneration`).
- Sends free-form `message` to ai/plan; orchestrator interprets it for `generate_plan` or `planner_command`.
- User could ask "Generate themes for AI productivity" — but the planner does not parse or route this to a theme API; it goes to the general plan generation flow.

### Gap

No planner-specific flow to:
1. Call theme generation (e.g. `/api/recommendations/generate` or a new endpoint).
2. Store returned themes in planner state.
3. Pass themes as `prefilledPlanning.strategic_themes` to ai/plan.

---

## 7. Reuse vs New Implementation

### Classification

| Approach | Use Case | Recommendation |
|----------|----------|----------------|
| **Reuse existing service** | Theme cards from `strategic_themes` (intelligence pipeline) | ✅ `getStrategicThemesAsOpportunities()` — already used by suggest-themes. Planner can call same when companyId + optional campaignId available. |
| **Reuse existing API** | Trend-style generation (company profile, execution config) | ⚠️ `POST /api/recommendations/generate` expects `strategicPayload` (context_mode, regions, execution_config). Planner has different inputs (idea_spine, strategy_context). Needs adapter or alternate entry. |
| **Extend existing API** | Planner-specific payload | ✅ Add optional `planner_context` (idea_spine, strategy_context, trend_context) to `/api/recommendations/generate`; when present, derive strategicPayload from planner state. |
| **Create new planner endpoint** | Lightweight theme-from-context | ✅ `POST /api/campaigns/planner-themes` or extend ai/plan with `mode: 'generate_themes'` — accepts `idea_spine`, `strategy_context`, returns `{ themes: string[] }` for prefilledPlanning. |

---

## 8. Recommended Integration Approach

### Option A: Extend recommendations/generate

- Add `planner_context?: { idea_spine, strategy_context, trend_context }` to `/api/recommendations/generate`.
- When present: build minimal `strategicPayload` from planner context; run existing flow; return `trends_used` or a `themes` subset.
- Planner: call generate, map `trends_used[].topic` / `polished_title` → `strategic_themes` strings → store in plannerSessionStore → pass to ai/plan as `prefilledPlanning.strategic_themes`.

**Pros:** Reuses full Trend flow, blueprint, polish.  
**Cons:** Heavier payload, more coupling.

### Option B: New planner-themes endpoint

- Create `POST /api/campaigns/planner-themes` (or `/api/planner/generate-themes`).
- Input: `companyId`, `idea_spine`, `strategy_context`, `trend_context?`, `duration_weeks`.
- Logic:
  - If `trend_context.recommendation_id`: fetch recommendation → use its themes.
  - Else: call `generateThemesForCampaignWeeks(idea_spine.refined_title ?? description, duration_weeks)` or `getStrategicThemesAsOpportunities()` (company-scoped).
- Output: `{ themes: string[] }`.
- Planner: store in `plannerSessionStore.strategic_themes`; pass to ai/plan in `prefilledPlanning.strategic_themes`.

**Pros:** Focused, planner-specific.  
**Cons:** Duplicates some logic if not delegating to strategicThemeEngine.

### Option C: AI Chat mode for theme generation

- Add `mode: 'generate_themes'` to ai/plan when message matches "generate themes" / "suggest themes".
- Orchestrator: call `generateThemesForCampaignWeeks` or strategicThemeEngine; return `{ themes }` in response.
- Planner: merge themes into store; optionally auto-trigger skeleton generation with `prefilledPlanning.strategic_themes`.

**Pros:** Single entry (AI chat), natural UX.  
**Cons:** Requires message parsing, mode branching.

### Recommended Path

1. **Short term:** Create `POST /api/planner/generate-themes` (or extend `/api/campaigns/ai/plan` with a theme mode) that:
   - Accepts `companyId`, `idea_spine`, `strategy_context`, `trend_context`, `duration_weeks`.
   - Uses `getStrategicThemesAsOpportunities()` when appropriate, or `generateThemesForCampaignWeeks()` for campaign-description-driven themes.
   - Returns `{ themes: string[] }`.
2. **Planner UI:** Add "Generate themes" action in CampaignContextBar or StrategyTab; store result in plannerSessionStore (`strategic_themes?: string[]`).
3. **Skeleton population:** When generating plan (StructureTab or AIPlanningAssistantTab), include `prefilledPlanning: { strategic_themes: state.strategic_themes }` so campaignAiOrchestrator uses themes in weekly planning.
4. **Trend campaign path:** When `company_context_mode === 'trend_campaign'` and `trend_context.recommendation_id` exists, optionally fetch recommendation and prefill themes without extra API call.

---

## Summary Table

| Area | Current | Reusable | Gap |
|------|---------|----------|-----|
| Theme generation (signal pipeline) | `strategicThemeEngine` → `strategic_themes` | `getStrategicThemesAsOpportunities` | Planner has no campaignId for suggest-themes |
| Theme generation (campaign weeks) | `generateThemesForCampaignWeeks(topic, weeks)` | Yes | Not exposed via planner-facing API |
| Trend campaign flow | `/api/recommendations/generate` | Partial (payload differs) | Planner needs adapter or dedicated endpoint |
| Planner ai/plan | Accepts `prefilledPlanning.strategic_themes` | Yes | Planner never sends themes |
| Skeleton mapping | Theme → week via LLM context | Yes | No planner UI to trigger + store themes |
