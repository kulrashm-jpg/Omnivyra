# Phase 6 — Regional Scheduling Intelligence — Implementation Report

**Date:** 2025-03-07  
**Phase:** 6 — Scheduling intelligence layer for optimal days, times, and holiday awareness  

---

## 1. Objective

Provide regional scheduling intelligence for:

- Optimal posting days per platform  
- Optimal posting time windows  
- Regional timezone logic  
- Holiday / festival awareness  

Used by `weeklyScheduleAllocator` and `contentDistributionIntelligence`.

---

## 2. schedulingIntelligence Service

**File:** `backend/services/schedulingIntelligence.ts`

**Functions:**

| Function | Returns |
|----------|---------|
| `getPlatformBestDays(platform)` | `['Tue','Wed','Thu']` etc. |
| `getPlatformBestDayNumbers(platform)` | `[2,3,4]` (day numbers 1–7) |
| `getPlatformBestTimes(platform)` | `[{ start: '08:00', end: '10:00' }, ...]` |
| `getPlatformDefaultTime(platform)` | `'08:00'` (first window start) |
| `getRegionalHolidaysByYear(region, year)` | `{ date, name }[]` |
| `getRegionalHolidays(region, dateRange)` | holidays in range |
| `isDateHoliday(dateStr, regions)` | `HolidayEntry | null` |

---

## 3. Platform Best-Day Rules

| Platform | Best days |
|----------|-----------|
| LinkedIn | Tue, Wed, Thu |
| Twitter / X | Tue, Wed, Thu, Fri |
| Blog | Wed, Fri |
| YouTube | Thu, Fri, Sat |
| Instagram | Tue, Wed, Fri |
| Facebook | Wed, Thu, Fri |
| TikTok | Tue, Thu, Fri |
| Pinterest | Sat, Sun |

---

## 4. Platform Best-Time Windows

| Platform | Windows |
|----------|---------|
| LinkedIn | 08:00–10:00, 17:00–18:00 |
| Twitter | 12:00–15:00 |
| Blog | 09:00–11:00 |
| YouTube | 18:00–21:00 |
| Instagram | 11:00–13:00, 19:00–21:00 |
| Facebook | 09:00–13:00 |
| TikTok | 19:00–21:00 |

---

## 5. Holiday Calendar

**File:** `lib/calendar/holidayCalendar.ts`

**Function:** `getRegionalHolidays(region, year): HolidayEntry[]`

**Regions:** india, usa, uk

**Example:** `{ date: "2025-10-24", name: "Diwali" }`

---

## 6. weeklyScheduleAllocator Integration

- **Best days:** When assigning `scheduled_day`, prefers platform best days. Falls back to existing spread rules if no best day is free.
- **Best times:** Uses `getPlatformDefaultTime(platform)` for `scheduled_time` instead of a fixed `"09:00"`.
- **Platform:** Taken from `execution_item.selected_platforms[0]`.

---

## 7. Distribution Insight Rules

**Suboptimal day (Rule 6):**

- Triggers: Post scheduled on a day outside the platform’s best days.
- Example: LinkedIn on Sunday.
- Insight: `"LinkedIn posts typically perform better on Tue–Thu."`
- Severity: info  
- Deduplicated by platform.

**Holiday (Rule 7):**

- Triggers: Post falls on a regional holiday when `campaignStartDate`, `region`, and `weekNumber` are passed.
- Example: Post on Diwali (India).
- Insight: `"Scheduled post falls on Diwali. Consider adjusting messaging or schedule."`
- Severity: info  
- Deduplicated by date.

**Options:** `analyzeWeeklyDistribution(weekPlan, { campaignStartDate?, region?, weekNumber? })`

---

## 8. Files Created / Modified

| File | Change |
|------|--------|
| `backend/services/schedulingIntelligence.ts` | **New** |
| `lib/calendar/holidayCalendar.ts` | **New** |
| `backend/services/weeklyScheduleAllocator.ts` | **Modified** — best days, best times |
| `lib/planning/contentDistributionIntelligence.ts` | **Modified** — suboptimal day, holiday rules |
| `pages/campaign-daily-plan/[id].tsx` | **Modified** — pass `campaignStartDate`, `weekNumber` to analysis |
| `backend/tests/unit/weeklyScheduleAllocator.test.ts` | **Modified** — accept 08:00 or 09:00 for LinkedIn |

---

## 9. Confirmation Checklist

1. **schedulingIntelligence service created** — `backend/services/schedulingIntelligence.ts`  
2. **Best-day logic implemented** — `getPlatformBestDays`, `getPlatformBestDayNumbers`  
3. **Best-time windows implemented** — `getPlatformBestTimes`, `getPlatformDefaultTime`  
4. **Holiday calendar service created** — `lib/calendar/holidayCalendar.ts`  
5. **Weekly scheduler integration completed** — prefer best days, use platform default time  
6. **New insight rules added** — suboptimal day, holiday  
