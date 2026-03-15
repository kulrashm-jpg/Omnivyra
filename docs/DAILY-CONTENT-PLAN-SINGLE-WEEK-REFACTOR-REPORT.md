# Daily Content Plan — Single-Week Refactor Implementation Report

## Summary

Refactored the **campaign-daily-plan** page (`pages/campaign-daily-plan/[id].tsx`) to implement the Daily Execution Planner layout: week selector → 7-day strip → selected day panel. Removed stacked week sections and fixed activity rendering.

---

## Files Modified

| File | Changes |
|------|---------|
| `pages/campaign-daily-plan/[id].tsx` | Replaced stacked weeks loop with single-week view; added selectedWeekIndex, selectedDayIndex; removed WeeklyActivityBoard, drag-and-drop, aiPreviewByWeek, aiConfidenceByWeek; updated title to "Daily Execution Planner"; added empty state |
| `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` | **New** — Single-week execution layout with week selector, 7-day strip (previews), selected day panel, Regenerate button |

---

## Stacked Week Layout Removed

**Before:**
```
Week 1
Mon Tue Wed Thu Fri Sat Sun
  [activities per day]

Week 2
Mon Tue Wed Thu Fri Sat Sun
  [activities per day]

Week 3
...
```

**After:**
```
[Week 1] [Week 2] [Week 3] ... [Week N]  [Regenerate]

Mo 13 [2]  Tu 14  We 15 [1]  Th 16  Fr 17  Sa 18  Su 19  [7-day strip]

Monday • Mar 13
Week 1 — Awareness

[Activity cards for selected day]
```

---

## Week Selector Added

- **Location:** Top of planner, inside white card
- **Buttons:** One per week from `weeksToShow` (derived from `totalWeeks`)
- **State:** `selectedWeekIndex` (default 0 = Week 1)
- **Behavior:** Click updates `selectedWeekIndex`, no reload
- **Highlight:** Selected week uses `bg-indigo-600 text-white`
- **Regenerate:** Button next to week selector for selected week

---

## Day Strip Added

- **Location:** Below week selector
- **Layout:** 7-day grid (Mo, Tu, We, Th, Fr, Sa, Su)
- **Format:** `Mo 13 [2]` — day abbreviation, date, activity count
- **State:** `selectedDayIndex` (0–6, default: first day with activities or Monday)
- **Preview:** First 2 activities per day (PlatformIcon + content type)
- **+N more:** Shown when day has more than 2 activities
- **Click:** Day cell selects day; activity preview opens Activity Workspace

---

## Activity Rendering Fixed

- **Source:** `activities` (GridActivity[]) from `loadData`
- **Mapping:** `retrieve-plan` → `blueprintItemToUnifiedExecutionUnit` + `applyDistributionForWeek`, or `daily-plans` API when plan empty
- **Filter:** `activities.filter(a => a.week_number === weekNumber && a.day === day)`
- **Card format:** Platform icon, content type, topic, repurpose dots (● ○ ○), (1/3), scheduled time (if present)
- **Click:** Opens Activity Workspace via `openActivityWorkspace` (sessionStorage + `/activity-workspace?workspaceKey=...`)

---

## Page Title Fix

- **Before:** Daily Content Plan — Daily Content Plan
- **After:** Daily Execution Planner — {campaignName}

---

## Empty State

- **Condition:** Selected week has no activities
- **Message:** "No daily activities yet. Click Regenerate to create them."
- **Regenerate:** Kept in week selector; calls `handleRegenerateWeek` → `generate-weekly-structure` API

---

## Not Modified (As Requested)

- Campaign generation logic
- Scheduling logic
- Database schemas
- `loadData` / API calls
- `openActivityWorkspace` behavior
- Repurpose & Schedule Entire Campaign flow

---

## Removed

- Stacked week loop (`weeksToShow.map(...)`)
- WeeklyActivityBoard
- Drag-and-drop (dragged, dropTarget, handleDrop)
- aiPreviewByWeek, aiConfidenceByWeek
- openWorkspaceFromCard, handleImprovePlan
- getActivitiesFor (unused after refactor)
- GripVertical, ExternalLink, RefreshCw from page (RefreshCw moved to component)
