# Daily Execution Planner — Week Button & Day/Date Fix Report

## Summary

Fixed week button generation, day/date calculation, default selected day, and added optional week activity counts in the Daily Execution Planner (campaign-daily-plan page).

---

## Files Modified

| File | Changes |
|------|---------|
| `pages/campaign-daily-plan/[id].tsx` | Added strategy_context.duration_weeks fallback for totalWeeks; added addDays, getWeekdayName, handleWeekSelect; default day selection uses date-based calculation |
| `components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx` | Replaced fixed DAYS_ORDER with date-based day strip; day cells use addDays(startDate, weekIndex*7 + dayIndex); format "EEE dd" (e.g., Fri 13); week buttons show activity count |

---

## Week Button Generation Fix

**Before:** Only one week button appeared when totalWeeks was 1.

**After:**
- `totalWeeks` derived from: `durationWeeks` (campaign), `strategy_context.duration_weeks` (plan), `totalFromPlan`, `totalFromWeekly`
- Week buttons: `Array.from({ length: totalWeeks }, (_, i) => i + 1)` → [Week 1, Week 2, … Week N]
- State: `selectedWeekIndex` (0-based)
- Click updates `selectedWeekIndex` via `handleWeekSelect(weekNumber)`
- Selected week highlighted with `bg-indigo-600 text-white`
- Optional: Week buttons show activity count, e.g. `Week 1 • 3`

---

## Day Date Calculation Fix

**Before:** Day labels incorrect (e.g., TU 14 when 14 is not Tuesday). Used fixed Mon–Sun order regardless of campaign start.

**After:**
- Day cells computed from campaign start date:
  - `dayDate = addDays(campaignStartDate, (selectedWeekIndex * 7) + dayIndex)`
  - `format(dayDate, "EEE dd")` → e.g., Fri 13, Sat 14, Sun 15, Mon 16, Tue 17, Wed 18, Thu 19
- Activity matching: activities with `day === getWeekdayName(dayDate)` (e.g., "Friday") map to the correct cell
- Each cell shows: day abbreviation, date number, activity count badge (e.g., `Fri 13 [2]` or `Fri 13`)

---

## Default Selected Day

- On initial load: first day with activities for the selected week, or day 0
- When week changes: `handleWeekSelect` sets `selectedDayIndex` to first day with activities, or 0
- Uses date-based weekday matching (not fixed Mon–Sun order)

---

## Optional Week Activity Counts

- Week buttons show: `Week 1 • 3`, `Week 2 • 5`, etc. when count > 0
- Count = `activities.filter(a => a.week_number === wn).length`

---

## Not Modified (As Requested)

- Campaign logic
- Activity generation
- Scheduling logic
- Database schemas
