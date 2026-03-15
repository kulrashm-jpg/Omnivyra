# Daily Plan Generation System — Complete Audit Report

**Audit Date:** March 13, 2025  
**Scope:** Discover all Daily Plan generators, DB tables, APIs, UI components; identify root cause of plans not appearing; document fix path.

---

## PHASE 1 — DAILY PLAN GENERATORS DISCOVERED

### 1.1 Generator List

| # | Generator Name | File Location | Trigger | API Endpoint | Table Written |
|---|----------------|---------------|---------|--------------|---------------|
| 1 | **generate-ai-daily-plans** | `pages/api/campaigns/generate-ai-daily-plans.ts` | "Generate from AI" (campaign-daily-plan), "Generate All Days" (ComprehensivePlanningInterface), fallback from campaign-details | `POST /api/campaigns/generate-ai-daily-plans` | `daily_content_plans` |
| 2 | **generate-weekly-structure** | `pages/api/campaigns/generate-weekly-structure.ts` | "Regenerate" (campaign-daily-plan), "Regenerate daily plan" (campaign-details), BOLT pipeline | `POST /api/campaigns/generate-weekly-structure` | `daily_content_plans` |
| 3 | **save-ai-daily-plans** | `pages/api/campaigns/save-ai-daily-plans.ts` | ComprehensivePlanningInterface (save path) | `POST /api/campaigns/save-ai-daily-plans` | `daily_content_plans` |
| 4 | **save-week-daily-plan** | via save-week-daily-plan API | Activity workspace / creator asset (reorder/save) | `POST /api/campaigns/save-week-daily-plan` | `daily_content_plans` (upsert) |
| 5 | **commit-daily-plan** | `pages/api/campaigns/commit-daily-plan.ts` | Commit flow | `POST /api/campaigns/commit-daily-plan` | `daily_content_plans` |
| 6 | **commit-weekly-plan** | `pages/api/campaigns/commit-weekly-plan.ts` | Weekly plan commit | `POST /api/campaigns/commit-weekly-plan` | `daily_content_plans` |
| 7 | **save-daily-plan** | `pages/api/campaigns/save-daily-plan.ts` | Single plan save | `POST /api/campaigns/save-daily-plan` | `daily_content_plans` (upsert) |

### 1.2 AI Services Behind Generators

| Service | File | Used By |
|---------|------|---------|
| `generateDailyPlanDemo` | `backend/services/dailyPlanAiGenerator.ts` | generate-ai-daily-plans (in-process, no HTTP) |
| `generate-content` | `pages/api/ai/generate-content.ts` | save-ai-daily-plans, ComprehensivePlanningInterface (legacy path) |
| Blueprint-based distribution | `generate-weekly-structure.ts` | Uses `execution_items` from blueprint |

---

## PHASE 2 — DATABASE TABLES

### 2.1 Primary Table: `daily_content_plans`

| Column | Purpose |
|--------|---------|
| `id` | PK |
| `campaign_id` | FK → campaigns |
| `week_number` | 1-based week |
| `day_of_week` | Monday–Sunday |
| `date` | ISO date |
| `platform` | linkedin, x, instagram, etc. |
| `content_type` | post, video, carousel, etc. |
| `title` | Plan title |
| `content` | JSON (v2: topicTitle, dailyObjective, writingIntent, etc.) |
| `hashtags` | Array |
| `scheduled_time` | HH:mm |
| `status` | planned, completed, etc. |
| `ai_generated` | Boolean |
| `priority` | medium, high, etc. |

**Foreign keys:** `campaign_id` → `campaigns`; referenced by `campaign_execution_checkpoint`, `ai_enhancement_logs`.

### 2.2 Related Tables (Different Purpose)

| Table | Purpose |
|-------|---------|
| `weekly_content_plans` | Weekly-level plans |
| `content_plans` | Weekly content plans |
| `twelve_week_plan` | Blueprint (weeks, execution_items) |
| `campaign_execution_checkpoint` | Progress; references daily_content_plans.id |
| `campaign_execution_state` | References daily_content_plans |

---

## PHASE 3 — DATABASE WRITES

### 3.1 INSERT / UPSERT into `daily_content_plans`

| File | Function | Table | Operation |
|------|----------|-------|-----------|
| `pages/api/campaigns/generate-ai-daily-plans.ts` | handler | daily_content_plans | INSERT (after DELETE for week) |
| `pages/api/campaigns/save-ai-daily-plans.ts` | handler | daily_content_plans | INSERT |
| `pages/api/campaigns/generate-weekly-structure.ts` | handler | daily_content_plans | INSERT |
| `pages/api/campaigns/commit-daily-plan.ts` | handler | daily_content_plans | INSERT |
| `pages/api/campaigns/commit-weekly-plan.ts` | handler | daily_content_plans | INSERT |
| `pages/api/campaigns/save-daily-plan.ts` | handler | daily_content_plans | UPSERT |
| `pages/api/campaigns/save-week-daily-plan.ts` | handler | daily_content_plans | INSERT / update |

**All generators write to `daily_content_plans`.** No duplicate daily-plan tables found.

---

## PHASE 4 — UI RENDERING

### 4.1 Components That Display Daily Plans

| Component | File | Props | API Source | State Variable |
|-----------|------|-------|------------|----------------|
| **CampaignDailyPlanSingleWeekView** | `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` | `activities`, `weeksToShow`, `onRegenerateWeek`, `onGenerateFromAI` | Page passes `activities` from loadData | Parent: `activities` |
| **campaign-daily-plan page** | `pages/campaign-daily-plan/[id].tsx` | — | `retrieve-plan`, `get-weekly-plans`, `daily-plans` (fallback) | `activities`, `planWeeks` |
| **campaign-calendar** | `pages/campaign-calendar/[id].tsx` | — | `retrieve-plan`, `daily-plans` (fallback) | Local state from API |
| **ComprehensivePlanningInterface** | `components/ComprehensivePlanningInterface.tsx` | — | `daily-plans`, `generate-ai-daily-plans` | Local fetch |
| **WeeklyRefinementInterface** | `components/WeeklyRefinementInterface.tsx` | — | `daily-plans` | Local fetch |
| **DailyPlanningInterface** | `components/DailyPlanningInterface.tsx` | — | `daily-plans` | Local fetch |
| **activity-workspace** | `pages/activity-workspace.tsx` | — | `daily-plans` | Local fetch |

### 4.2 Display Data Flow (campaign-daily-plan)

1. `loadData()` fetches: `retrieve-plan`, `get-weekly-plans`, campaign, stage-availability
2. **Primary:** Build `mapped` from `rawPlanWeeks` → `daily_execution_items` per week
3. **Fallback:** If `mapped.length === 0`, fetch `GET /api/campaigns/daily-plans`
4. `setActivities(mapped)`
5. `CampaignDailyPlanSingleWeekView` receives `activities`, filters by `selectedWeekIndex`, renders day strip + selected day panel

---

## PHASE 5 — API ENDPOINTS READING DAILY PLANS

| Route | Method | Query Executed | Response |
|-------|--------|----------------|----------|
| `/api/campaigns/daily-plans` | GET | `campaignId` | Array of normalized plans from `daily_content_plans` |
| `/api/campaigns/retrieve-plan` | GET | `campaignId` | `{ draftPlan, committedPlan }` — blueprint (weeks with `daily_execution_items`) |

**daily-plans query:**
```sql
SELECT * FROM daily_content_plans
WHERE campaign_id = ?
ORDER BY week_number, day_of_week
```

**Auth:** `requireCampaignAccess(req, res, campaignId)` — resolves company from DB, checks user role.

---

## PHASE 6 — SYSTEM MAP

### Path A: Generate from AI (Source B)

```
Button "Generate from AI"
  → handleGenerateFromAI (campaign-daily-plan/[id].tsx)
  → POST /api/campaigns/generate-ai-daily-plans { campaignId, weekNumber }
  → generateDailyPlanDemo (in-process)
  → INSERT daily_content_plans (7 rows)
  → loadData() → GET /api/campaigns/daily-plans
  → setActivities(mapped)
  → CampaignDailyPlanSingleWeekView renders activities
```

### Path B: Regenerate (Source A — Blueprint)

```
Button "Regenerate"
  → handleRegenerateWeek
  → POST /api/campaigns/generate-weekly-structure
  → Requires blueprint execution_items with topic_slots
  → If EXECUTION_ITEMS_REQUIRED → fallback to handleGenerateFromAI (Path A)
  → Else: deterministic distribution → INSERT daily_content_plans
  → loadData() → same as above
```

### Path C: Campaign Details Fallback

```
campaign-details enhanceWeekWithAI
  → POST generate-weekly-structure
  → On EXECUTION_ITEMS_REQUIRED → POST generate-ai-daily-plans
  → Same DB + display path
```

### Path D: ComprehensivePlanningInterface

```
"Generate All Days" / save path
  → POST generate-ai-daily-plans or save-ai-daily-plans
  → INSERT daily_content_plans
  → Refetch daily-plans
```

---

## PHASE 7 — BROKEN LINKS (Root Causes)

### 7.1 Exact Root Causes

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 1 | **Blueprint-first display** | `campaign-daily-plan/[id].tsx` | If `rawPlanWeeks` has weeks but empty `daily_execution_items`, `mapped` stays []. Fallback to daily-plans runs. **Fallback works.** |
| 2 | **No data in daily_content_plans** | — | When blueprint is empty AND no generator has run, daily-plans returns []. User sees "No daily activities yet". |
| 3 | **Regenerate fails silently for new campaigns** | `generate-weekly-structure.ts` | New campaigns lack `execution_items` in blueprint. Regenerate returns `EXECUTION_ITEMS_REQUIRED`. Frontend must fallback to AI. |
| 4 | **"Generate from AI" was missing** | `CampaignDailyPlanSingleWeekView` | Before fix: no button to trigger Source B when blueprint was empty. User stuck. |
| 5 | **get-weekly-plans response shape** | `campaign-daily-plan/[id].tsx` | API returns `{ plans: [...] }`; old code expected array. `weeklyPlans` stayed empty (affects theme display, not daily items). |
| 6 | **Auth (401/403)** | `requireCampaignAccess` | If user not logged in or no campaign access, daily-plans returns 401/403. Frontend treats as empty. |

### 7.2 Most Likely Single Root Cause

**Campaigns created without going through AI planning have no blueprint `execution_items`.**  
→ Regenerate fails with EXECUTION_ITEMS_REQUIRED  
→ Before fix: No "Generate from AI" button  
→ User had no way to populate `daily_content_plans`  
→ daily-plans returns [] → "No daily activities yet"

---

## PHASE 8 — FIX STATUS (Already Implemented)

All generators already write to `daily_content_plans`. Unification is done.

| Fix | Status |
|-----|--------|
| Single table: daily_content_plans | ✅ All generators write here |
| Display path: GET daily-plans → CampaignDailyPlanSingleWeekView | ✅ Implemented |
| "Generate from AI" button | ✅ In CampaignDailyPlanSingleWeekView |
| Regenerate → AI fallback | ✅ On EXECUTION_ITEMS_REQUIRED |
| get-weekly-plans parsing | ✅ Handles { plans } and array |
| Trace logging | ✅ [DAILY_PLAN_TRACE] in key paths |

---

## PHASE 9 — VALIDATION

### 9.1 Verification Queries

```sql
-- Check if rows exist for a campaign
SELECT id, campaign_id, week_number, day_of_week, title, platform, content_type, ai_generated
FROM daily_content_plans
WHERE campaign_id = '<campaignId>'
ORDER BY week_number, day_of_week;
```

### 9.2 Manual Test

1. Open `/campaign-daily-plan/<campaign-id>`
2. Click **"Generate from AI"** for Week 1
3. Wait for "Generated 7 daily plans"
4. Confirm 7 activities appear in the week strip
5. Reload page — activities should persist (from daily-plans API)

### 9.3 Debug: Console Logs

Look for:
- `[DAILY_PLAN_TRACE] BUTTON_TRIGGERED Generate from AI`
- `[DAILY_PLAN_TRACE] loadData fallback loaded N activities from daily-plans API`
- `[DAILY_PLAN_TRACE] daily-plans returning N plans`

---

## FINAL OUTPUT (Required Format)

### 1. Number of Daily Plan Generators Discovered

**7 generators** that write to `daily_content_plans`:

1. generate-ai-daily-plans  
2. generate-weekly-structure  
3. save-ai-daily-plans  
4. save-week-daily-plan  
5. commit-daily-plan  
6. commit-weekly-plan  
7. save-daily-plan  

### 2. Database Tables Involved

- **Primary:** `daily_content_plans` (only table storing daily execution items)
- **Reference:** `campaigns`, `campaign_versions`, `campaign_execution_checkpoint`, `ai_enhancement_logs`
- **Blueprint (not daily):** `twelve_week_plan`, `weekly_content_plans`, `content_plans`

### 3. APIs Writing Daily Plans

| API | Method | Table |
|-----|--------|-------|
| /api/campaigns/generate-ai-daily-plans | POST | daily_content_plans |
| /api/campaigns/generate-weekly-structure | POST | daily_content_plans |
| /api/campaigns/save-ai-daily-plans | POST | daily_content_plans |
| /api/campaigns/save-week-daily-plan | POST | daily_content_plans |
| /api/campaigns/commit-daily-plan | POST | daily_content_plans |
| /api/campaigns/commit-weekly-plan | POST | daily_content_plans |
| /api/campaigns/save-daily-plan | POST | daily_content_plans |

### 4. UI Components Displaying Daily Plans

- **CampaignDailyPlanSingleWeekView** (main)
- **campaign-daily-plan** page
- **campaign-calendar** page
- **ComprehensivePlanningInterface**
- **WeeklyRefinementInterface**
- **DailyPlanningInterface**
- **activity-workspace**

### 5. Exact Root Cause of Failure

**Campaigns without blueprint `execution_items` cannot use Regenerate (Source A).**  
Before the fix, there was no "Generate from AI" (Source B) on the main daily plan page.  
Users had no way to populate `daily_content_plans`, so the daily-plans fallback always returned empty.

### 6. Files Modified to Fix System

See `docs/DAILY-PLAN-TRACE-REPORT.md` for full list. Key files:

- `pages/api/campaigns/generate-ai-daily-plans.ts` (new)
- `pages/campaign-daily-plan/[id].tsx`
- `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx`
- `pages/campaign-details/[id].tsx`
- `components/ComprehensivePlanningInterface.tsx`
- `pages/api/campaigns/save-ai-daily-plans.ts`
- `pages/api/campaigns/daily-plans.ts`
- `pages/api/campaigns/generate-weekly-structure.ts`
- `database/verify_daily_content_plans.sql`
- `database/audit_daily_execution_tables.sql`
