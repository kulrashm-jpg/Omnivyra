# Bulk Repurpose & Schedule — Implementation Report

## Overview

Implemented a **single-button bulk repurpose and schedule** capability in the Day View. The flow reuses existing services (`generateContentForDailyPlans`, `scheduleStructuredPlan`) without modifying them.

---

## Files Created

| File | Purpose |
|------|---------|
| `pages/api/campaigns/[id]/repurpose-and-schedule.ts` | New POST API endpoint for bulk repurpose and schedule |

---

## Files Modified

| File | Changes |
|------|---------|
| `pages/campaign-daily-plan/[id].tsx` | Added "Repurpose & Schedule Entire Campaign" button in header, `handleRepurposeAndSchedule`, `isRepurposeScheduling` and `notice` state, Loader2 icon import |

---

## API Route Added

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/campaigns/[id]/repurpose-and-schedule` | POST | Bulk repurpose (generate platform variants) and schedule (insert into scheduled_posts) |

**Request:** No body required. Campaign ID from URL param `[id]`.

**Response (success):**
```json
{
  "success": true,
  "scheduledPostsCreated": 12,
  "skippedCreatorActivities": 0,
  "skipped_platforms": []
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "No daily plans found for this campaign. Generate daily plans first."
}
```

---

## Service Flow

```
1. Load daily_content_plans (campaign_id)
2. Safety check: count creator-required activities without creator_asset
3. Build minimal plan.weeks (for scheduleStructuredPlan validation)
4. Call scheduleStructuredPlan(plan, campaignId, { generateContent: true })
   ├── Internally: load daily_content_plans
   ├── Internally: generateContentForDailyPlans (master + platform variants)
   └── Internally: scheduleFromDailyPlans → insert scheduled_posts
5. Return { success, scheduledPostsCreated, skippedCreatorActivities }
```

---

## Services Used (Not Modified)

| Service | File | Role |
|---------|------|------|
| `scheduleStructuredPlan` | `backend/services/structuredPlanScheduler.ts` | Orchestrates content generation + scheduling; inserts into `scheduled_posts` |
| `generateContentForDailyPlans` | `backend/services/boltContentGenerationForSchedule.ts` | Called by scheduleStructuredPlan when `generateContent: true`; generates master content and platform variants |
| `requireCampaignAccess` | `backend/services/campaignAccessService.ts` | Ensures authenticated user has access to campaign |

---

## Safety Checks

- **Creator-required activities:** Content types `video`, `reel`, `carousel`, `podcast`, `livestream`, `live`, `short`, `image`, `story` require `creator_asset`.
- **skippedCreatorActivities:** Count of activities that are creator-required but lack `creator_asset`. Returned in the response for visibility. The scheduler still processes all plans; creator-required rows without asset may receive placeholder content.
- **Empty daily plans:** Returns 400 if no daily plans exist.

---

## UI Changes

- **Button:** "Repurpose & Schedule Entire Campaign" — primary style, right side of header above week grid.
- **Loading state:** Button shows spinner and is disabled during API call.
- **Success:** Toast: "Campaign content generated and scheduled." Page refreshes daily plans.
- **Error:** Error message displayed in existing error banner.

---

## Test Result

- **TypeScript:** No compile errors reported.
- **Build:** Build lock prevented full run; TypeScript check passed.
- **Manual test:** Recommended — open a campaign with daily plans, click button, confirm scheduled posts appear in Dashboard Calendar.

---

## Safety & Visibility Improvements (FIX 1–6)

### FIX 1 — Prevent Double Scheduling
- Before scheduling, API queries `scheduled_posts` where `campaign_id = campaignId`.
- If rows exist, returns `{ success: false, error: "Campaign already scheduled." }` (400).

### FIX 2 — Scheduler Lock
- Uses existing `SchedulerLockService`: `acquireSchedulerLock`, `releaseSchedulerLock`.
- DB-based lock via `campaigns.scheduler_lock_id` and `campaigns.scheduler_locked_at`.
- If lock cannot be acquired: `{ success: false, error: "Scheduling already in progress." }` (409).
- Lock released in `finally` block after scheduling completes.

### FIX 3 — Ensure Campaign Start Date
- Before scheduling, API queries `campaigns` for `start_date`.
- If `start_date` is NULL: `{ success: false, error: "Campaign start date missing." }` (400).

### FIX 4 — Enhanced API Response
```json
{
  "success": true,
  "scheduledPostsCreated": 12,
  "skippedCreatorActivities": 0,
  "weeksScheduled": 4,
  "platformsScheduled": ["linkedin", "twitter", "instagram"],
  "skipped_platforms": []
}
```

### FIX 5 — UI Confirmation Modal
- Button click opens modal before executing.
- Title: **Schedule Entire Campaign?**
- Message: *This will automatically generate and schedule content for all activities in this campaign.*
- Buttons: **Cancel**, **Schedule Campaign**

### FIX 6 — Disable Button After Success
- After successful scheduling, button is disabled.
- Label changes to **Campaign Scheduled**.
- On page load, fetches `stage-availability-batch`; if `scheduledPosts > 0`, button shows **Campaign Scheduled** and is disabled.

---

## Notes

- `structuredPlanScheduler`, `generateContentForDailyPlans`, and `boltPipelineService` were **not modified**.
- Scheduler lock is now used (FIX 2); prevents concurrent runs with `schedule-structured-plan` API.
- Campaign must have `start_date` set; validated before scheduling (FIX 3).
