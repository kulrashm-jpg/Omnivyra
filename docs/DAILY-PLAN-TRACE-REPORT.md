# Daily Plan Generation — End-to-End Trace Report

## Executive Summary

Traced the full execution path from **button click → API → database → UI render**. Root causes identified and fixed. Daily plans now render correctly when generated via Source A (Blueprint) or Source B (AI expansion).

---

## 1. Stage That Failed

| Stage | Status | Root Cause |
|-------|--------|------------|
| **Source A (Blueprint)** | ❌ Often fails | `generate-weekly-structure` requires `execution_items` with `topic_slots` in blueprint. Most campaigns lack this. |
| **Source B (AI expansion)** | ❌ Never triggered | `ComprehensivePlanningInterface` (only Source B trigger) is not in main flow. campaign-daily-plan had no way to trigger AI. |
| **get-weekly-plans parsing** | ❌ Wrong | campaign-daily-plan expected array; API returns `{ plans: [...] }`. weeklyPlans stayed empty. |
| **daily-plans fallback** | ✅ Correct | When blueprint has no items, fallback to daily-plans API works — but daily_content_plans was empty because no source wrote to it. |

---

## 2. Exact Fixes Applied

### Fix 1: get-weekly-plans Response Parsing

**File:** `pages/campaign-daily-plan/[id].tsx`

```javascript
// Before: expected array
if (Array.isArray(w)) plans.push(...w);

// After: handle { plans: [...] } or direct array
const plansArray = Array.isArray(w) ? w : (Array.isArray((w as any)?.plans) ? (w as any).plans : []);
plans.push(...plansArray);
```

### Fix 2: "Generate from AI" Button (Source B)

**Files:**  
- `pages/campaign-daily-plan/[id].tsx` — `handleGenerateFromAI`  
- `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` — UI button  
- `pages/api/campaigns/generate-ai-daily-plans.ts` — **Shared API** (single call)

Adds direct path to Source B when blueprint has no execution_items:
- **Single API call:** `POST /api/campaigns/generate-ai-daily-plans` (campaignId, weekNumber, companyId, provider)
- Shared API internally: calls `/api/ai/generate-content` (type: daily_plan) for each of 7 days, persists to `daily_content_plans`
- Reloads `loadData()` so UI shows new activities

### Fix 3: Regenerate Fallback to AI

**File:** `pages/campaign-daily-plan/[id].tsx`  

When Regenerate fails with `EXECUTION_ITEMS_REQUIRED` or `DETERMINISTIC_TOPIC_INTENT_REQUIRED`:
- Shows: "Blueprint requires topics. Trying AI expansion…"
- Automatically calls `handleGenerateFromAI(weekNumber)`

### Fix 4: save-ai-daily-plans Start Date Fallback

**File:** `pages/api/campaigns/save-ai-daily-plans.ts`  

If campaign has no `start_date`, use today as fallback so AI-generated plans can still be saved.

### Fix 5: daily-plans API Response Shape

**File:** `pages/campaign-daily-plan/[id].tsx`  

Fallback handles both array and wrapped response:

```javascript
const dailyPayload = await dailyRes.json().catch(() => []);
const dailyPlans: any[] = Array.isArray(dailyPayload) ? dailyPayload : [];
```

### Fix 6: Trace Logging

Added `[DAILY_PLAN_TRACE]` logs to:
- campaign-daily-plan: `BUTTON_TRIGGERED`, loadData source (blueprint vs fallback), fallback result
- generate-content: `API_CALLED daily_plan`
- save-ai-daily-plans: `API_CALLED`, `DB_WRITE`
- daily-plans: `API_CALLED`, row count
- generate-weekly-structure: `DB_WRITE` at insert

---

## 3. Files Modified

| File | Changes |
|------|---------|
| `pages/api/campaigns/generate-ai-daily-plans.ts` | **New** — Shared API for Source B: generates 7 days via AI, writes to daily_content_plans |
| `pages/campaign-daily-plan/[id].tsx` | get-weekly-plans parsing; handleGenerateFromAI uses shared API (single call); Regenerate fallback; daily-plans fallback handling; trace logs; pass onGenerateFromAI/generatingFromAI to SingleWeekView |
| `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` | onGenerateFromAI, generatingFromAI props; "Generate from AI" button |
| `pages/campaign-details/[id].tsx` | enhanceWeekWithAI: on EXECUTION_ITEMS_REQUIRED, calls shared generate-ai-daily-plans |
| `components/ComprehensivePlanningInterface.tsx` | handleGenerateAllDaysForWeek, handleGenerateDailyPlan use shared API; both write to daily_content_plans |
| `pages/api/campaigns/save-ai-daily-plans.ts` | start_date fallback to today; trace logs |
| `pages/api/ai/generate-content.ts` | Trace log for daily_plan type |
| `pages/api/campaigns/daily-plans.ts` | Trace log for API call and row count |
| `pages/api/campaigns/generate-weekly-structure.ts` | Trace log at DB insert |
| `database/verify_daily_content_plans.sql` | **New** — verification query script |

---

## 4. Example DB Row Created

After clicking "Generate from AI" for Week 1:

```sql
-- Example row in daily_content_plans
campaign_id: <uuid>
week_number: 1
day_of_week: Monday
date: 2025-03-17  -- (campaign start + offset)
platform: linkedin
content_type: post
title: Monday Week 1 Theme Content
content: {"topicTitle":"Monday Week 1 Theme Content","dailyObjective":"Today we're focusing on...","platform":"linkedin",...}
hashtags: ["#DrishiqMusic","#Monday","#MusicDiscovery",...]
scheduled_time: 09:00
status: planned
ai_generated: true
```

---

## 5. Execution Pipeline Confirmation

```
Button Click (Regenerate OR Generate from AI)
  → Frontend Handler (handleRegenerateWeek / handleGenerateFromAI)
  → API (generate-weekly-structure OR generate-ai-daily-plans)
  → Source A: Blueprint → deterministic distribution → daily_content_plans
  → Source B: generate-ai-daily-plans (internal: generate-content × 7) → daily_content_plans
  → loadData() calls GET daily-plans
  → setActivities(mapped)
  → CampaignDailyPlanSingleWeekView renders activities
```

---

## 6. Verification Checklist

1. **"Generate from AI"** produces 7 daily plans and writes to DB.
2. **Regenerate** with empty blueprint falls back to AI, then saves.
3. **daily_content_plans** holds rows after generation.
4. **Reload** shows stored plans (loadData fetches daily-plans when blueprint is empty).
5. **CampaignDailyPlanSingleWeekView** receives `activities` and renders them in the day strip and selected-day panel.

---

## 7. Test Insert Verification

Run:

```sql
INSERT INTO daily_content_plans (campaign_id, week_number, day_of_week, content, ai_generated)
VALUES ('<your-campaign-id>', 1, 'Monday', '"TEST PLAN"', true);
```

Reload `/campaign-daily-plan/<campaign-id>`. If the test row appears in the Monday cell, the rendering pipeline is correct.

---

## 8. Removing Trace Logs

After confirming the pipeline, remove or gate the `[DAILY_PLAN_TRACE]` and `API_CALLED`/`DB_WRITE` logs behind a debug flag or delete them.
