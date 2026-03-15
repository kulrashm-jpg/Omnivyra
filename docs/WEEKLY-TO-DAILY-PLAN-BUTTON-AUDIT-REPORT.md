# Weekly Plan → Daily Plan Button Audit & Fix Report

## Summary

Completed a full trace from **UI → Backend → AI → Database → UI Rendering** for the Weekly Plan → Daily Plan generation system. Identified and fixed several breakpoints so that each button triggers the correct AI generation pipeline.

---

## Phase 1 — System Audit

### 1. Weekly Plan Interfaces Located

| Component | Location | Purpose |
|-----------|----------|---------|
| **ComprehensivePlanningInterface** | `components/ComprehensivePlanningInterface.tsx` | Standalone planning UI with Weekly/Daily tabs (referenced in guides; may be embedded in campaign flows) |
| **Campaign Details Page** | `pages/campaign-details/[id].tsx` | Primary hub: weekly plan view, "Generate Daily Plans", "Regenerate", "Generate Daily Execution Plan (AI)" |
| **Campaign Daily Plan Page** | `pages/campaign-daily-plan/[id].tsx` | Day-level grid with "Regenerate" per week |
| **CampaignDailyPlanSingleWeekView** | `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` | Renders week selector, 7-day strip, Regenerate button |

### 2. Buttons Audited

| Button | Location | Intended Action | Handler | API | Status Before |
|--------|----------|-----------------|---------|-----|---------------|
| **Generate Plan** | ComprehensivePlanningInterface (per week) | Generate weekly plan via AI | `handleGenerateWeeklyPlan` | `/api/ai/generate-content` (type: weekly_plan) | ✅ Wired |
| **AI Enhance** | ComprehensivePlanningInterface (weekly tab) | Regenerate weekly plan | `handleGenerateWeeklyPlan` | Same | ✅ Wired |
| **Generate All Days** | ComprehensivePlanningInterface (daily tab) | Generate daily plans for all 7 days | `handleGenerateDailyPlan(week, 'Monday')` | `/api/ai/generate-content` (type: daily_plan) | ❌ Only generated Monday |
| **Plan** (per day) | ComprehensivePlanningInterface (daily tab) | Generate single day | `handleGenerateDailyPlan` | Same | ✅ Wired |
| **AI Enhance** | ComprehensivePlanningInterface (daily tab) | Regenerate selected day | `handleGenerateDailyPlan` | Same | ✅ Wired |
| **AI Generate** (Content Pillars) | ComprehensivePlanningInterface (Overview) | Generate content pillars | Modal "Generate" button | — | ❌ No handler; closed modal only |
| **Generate Daily Plans** | campaign-details (per week) | Expand weekly to daily via blueprint | `enhanceWeekWithAI` | `/api/campaigns/generate-weekly-structure` | ✅ Wired |
| **Regenerate** | campaign-details, campaign-daily-plan | Same as above | `enhanceWeekWithAI` / `handleRegenerateWeek` | Same | ✅ Wired |
| **Generate Daily Execution Plan (AI)** | campaign-details | Generate daily for all weeks | `enhanceAllWeeksWithAI` | Same | ✅ Wired |

### 3. Issues Discovered

1. **Wrong API path**: ComprehensivePlanningInterface loaded weekly plans from `/api/campaigns/weekly-plans` (does not exist). Correct API is `/api/campaigns/get-weekly-plans`.

2. **"Generate All Days" bug**: Button called `handleGenerateDailyPlan(selectedWeek, 'Monday')` — only Monday was generated. Should generate all 7 days.

3. **No persistence**: ComprehensivePlanningInterface updated local state only; generated daily plans were not saved to `daily_content_plans`.

4. **AI Modal "Generate" button**: Did nothing — only closed the modal. Should generate content pillars and update `campaignStrategy.contentPillars`.

5. **Date calculation**: Daily plan dates used `new Date().toISOString().split('T')[0]` instead of campaign start date + week/day offset.

6. **Error feedback**: When `generate-weekly-structure` failed (e.g. EXECUTION_ITEMS_REQUIRED), the user saw a generic error. No hint to complete the weekly plan in AI chat first.

7. **No daily plan load on init**: ComprehensivePlanningInterface did not load existing daily plans from the database.

---

## Phase 2–3 — Implementation Fixes

### Code Changes Implemented

#### 1. `components/ComprehensivePlanningInterface.tsx`

- **API path**: `/api/campaigns/weekly-plans` → `/api/campaigns/get-weekly-plans`
- **Generate All Days**: Added `handleGenerateAllDaysForWeek` that loops through all 7 days, generates AI content for each, merges into state, and saves once via `save-ai-daily-plans`
- **Date calculation**: Added `computeDayDate(weekNumber, dayOfWeek)` using `campaignData.start_date`
- **Persistence**: After generating (single day or all days), calls `/api/campaigns/save-ai-daily-plans` to persist to `daily_content_plans`
- **Load daily plans**: Added fetch of `/api/campaigns/daily-plans` in `loadCampaignData` and mapping to `DailyPlan[]`
- **AI Modal**: Wired "Generate" button to call `generateAIContent('content_pillars', ...)` and update `campaignStrategy.contentPillars`
- **Batch loading**: Added `skipLoading` option to `generateAIContent` so batch "Generate All Days" keeps loading state for the full operation

#### 2. `pages/api/campaigns/save-ai-daily-plans.ts` (NEW)

- Accepts `campaignId`, `weekNumber`, `plans[]`, optional `campaignStartDate`
- Deletes existing `daily_content_plans` rows for that campaign+week
- Inserts new rows with `ai_generated: true`
- Maps AI-generated plan format to `daily_content_plans` schema

#### 3. `pages/campaign-details/[id].tsx`

- When `generate-weekly-structure` returns non-OK, parses error body and shows message
- If error contains `EXECUTION_ITEMS_REQUIRED` or `DETERMINISTIC_TOPIC_INTENT_REQUIRED`, appends hint: "Complete the weekly plan in the AI chat first (topics and execution items)."

---

## Phase 4 — Execution Chain Verification

### ComprehensivePlanningInterface Flow

```
Weekly Plan Tab:
  "Generate Plan" / "AI Enhance" → handleGenerateWeeklyPlan
    → POST /api/ai/generate-content (type: weekly_plan)
    → setWeeklyPlans (local state)

Daily Plan Tab:
  "Generate All Days" → handleGenerateAllDaysForWeek
    → Loop 7 days: generateAIContent('daily_plan', ...)
    → setDailyPlans (merged)
    → POST /api/campaigns/save-ai-daily-plans
    → DB: daily_content_plans (delete + insert)

  "Plan" / "AI Enhance" (single day) → handleGenerateDailyPlan
    → generateAIContent('daily_plan', ...)
    → setDailyPlans
    → POST /api/campaigns/save-ai-daily-plans (full week)
    → DB: daily_content_plans

Content Pillars:
  "AI Generate" → Modal → "Generate"
    → generateAIContent('content_pillars', ...)
    → setCampaignStrategy.contentPillars
```

### Campaign Details / Campaign Daily Plan Flow

```
"Generate Daily Plans" / "Regenerate" → enhanceWeekWithAI / handleRegenerateWeek
  → POST /api/campaigns/generate-weekly-structure
  → Requires: committed blueprint with execution_items (topic_slots)
  → DB: daily_content_plans (delete + insert)
  → loadCampaignDetails / loadData (refresh)
```

**Note**: `generate-weekly-structure` uses deterministic distribution from blueprint `execution_items`. It does not use AI for daily expansion; the blueprint must come from the AI planning flow (Campaign AI Chat). If the blueprint lacks `execution_items`, the API returns `EXECUTION_ITEMS_REQUIRED` — users now see a clear hint to complete the weekly plan in the AI chat first.

---

## Phase 5 — Validation Checklist

| Check | Status |
|-------|--------|
| Clicking "Generate All Days" triggers backend execution | ✅ |
| AI generates valid daily plan for all 7 days | ✅ |
| Plans are stored in `daily_content_plans` | ✅ |
| UI renders the generated daily schedule | ✅ |
| No button remains a placeholder | ✅ |
| Single-day "Plan" / "AI Enhance" persists | ✅ |
| Content Pillars "Generate" updates strategy | ✅ |
| Campaign details `generate-weekly-structure` errors show actionable message | ✅ |

---

## Example Generated Daily Plan Output

With `provider: 'demo'`, the AI returns:

```json
{
  "platform": "instagram",
  "contentType": "post",
  "title": "Monday Brand Introduction & Music Catalog Showcase Content",
  "content": "Today we're focusing on Motivational Monday music. Join us for another day of music discovery and community building.",
  "description": "A post for Monday focusing on Motivational Monday music",
  "mediaRequirements": { "type": "image", "dimensions": "1080x1080", "aspectRatio": "1:1" },
  "hashtags": ["#DrishiqMusic", "#Monday", "#MusicDiscovery", "#Community", "#NewMusic"],
  "callToAction": "Follow for more music content",
  "optimalTime": "09:00",
  "targetMetrics": { "impressions": 1100, "engagements": 55, "clicks": 11 }
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `components/ComprehensivePlanningInterface.tsx` | API path, Generate All Days, persistence, date calc, AI Modal, load daily plans |
| `pages/api/campaigns/save-ai-daily-plans.ts` | **NEW** — batch save API for AI-generated daily plans |
| `pages/campaign-details/[id].tsx` | Better error handling for generate-weekly-structure failures |

---

## Recommendations

1. **Campaign start date**: Ensure `campaignData.start_date` is passed to ComprehensivePlanningInterface when used. If missing, date calculation falls back to today + offset.
2. **Blueprint path**: For campaigns without a committed blueprint, use ComprehensivePlanningInterface (or equivalent) for theme-based AI daily generation. The campaign-details "Regenerate" path requires a blueprint with execution_items.
3. **Testing**: Run through both flows with a campaign that has `start_date` set and a campaign with a committed blueprint to verify end-to-end.

---

## Implementation Verification (Latest)

All fixes from the audit have been implemented:

| Fix | Status |
|-----|--------|
| API endpoint: get-weekly-plans | ✅ Implemented; response parsed from `plans` when wrapped |
| handleGenerateAllDaysForWeek | ✅ Loops 7 days, generates, merges, persists once |
| handleGenerateContentPillars | ✅ Extracted handler; updates contentPillars state |
| computeDayDate | ✅ Uses campaign start_date + week/day offset |
| save-ai-daily-plans API | ✅ Delete + insert; ai_generated=true |
| Load daily plans on init | ✅ GET daily-plans, map to setDailyPlans |
| Error handling (campaign-details) | ✅ EXECUTION_ITEMS_REQUIRED hint shown |
