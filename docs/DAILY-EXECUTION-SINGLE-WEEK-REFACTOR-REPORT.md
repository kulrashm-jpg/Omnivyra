# Daily Execution Planner — Single-Week Focus Refactor

## Summary

Refactored the Daily Execution Planner UI to follow a **single-week focus model**. Removed vertically stacked week sections and implemented a cleaner flow: week selector → 7-day strip → selected day panel.

---

## Files Modified

| File | Changes |
|------|---------|
| `components/planner/PlanningCanvas.tsx` | Replaced stacked week/day views with SingleWeekExecutionView; added default selection logic; removed weekBlocks, WeekTimelineNavigator, PlannerDayDetailPanel; removed dayDetailPanelOpen state |
| `components/planner/SingleWeekExecutionView.tsx` | **New** — Single-week execution layout with week selector, day strip (previews), and selected day panel |

---

## Components Refactored

### PlanningCanvas
- **Removed:** Stacked week grid (Week 1, Week 2, Week 3…)
- **Removed:** Separate week view and day view; both use `SingleWeekExecutionView`
- **Removed:** WeekTimelineNavigator, PlannerDayDetailPanel slide-over
- **Added:** `useEffect` for default selection: Week 1, first day with activities or Monday
- **Changed:** `viewMode === 'week'` and `viewMode === 'day'` both render `SingleWeekExecutionView`

### SingleWeekExecutionView (New)
- **Week selector:** Horizontal buttons (Week 1, Week 2, … Week N) from `calendarPlan.weeks`
- **7-day strip:** Mo 13 [2], Tu 14, … with `[N]` activity count badge
- **Day cell previews:** First 2 activities (PlatformIcon + content type), "+N more" if additional
- **Selected day panel:** Date header, theme, full activity cards below the strip
- **Activity click:** Opens Activity Workspace (`openActivityWorkspace`) from strip previews and panel cards

---

## Week Selector Added

- **Location:** Top of SingleWeekExecutionView
- **Buttons:** One per week from campaign duration (calendarPlan.weeks)
- **State:** `selectedDay.weekNumber` (default 1)
- **Behavior:** Click updates `selectedDay`, no reload
- **Highlight:** Selected week uses `bg-indigo-600 text-white`

---

## Day Detail Panel Integrated

- **Location:** Inline below the 7-day strip
- **Header:** Day name • date (e.g. Monday • Mar 13)
- **Subheader:** Week N — theme (e.g. Week 1 — Awareness)
- **Activities:** Full ActivityCardWithControls (platform icon, content type, topic, repurpose dots, ratio, time)
- **Click:** Opens Activity Workspace

---

## Removed Stacked Week Layout

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
Week 1  Week 2  Week 3  ...  Week N   [selector]

Mo 13 [2]  Tu 14  We 15 [1]  Th 16  Fr 17  Sa 18  Su 19  [7-day strip]

Monday • Mar 13
Week 1 — Awareness

[Activity cards for selected day]
```

---

## Not Modified (As Requested)

- Campaign logic
- Planner APIs
- Scheduling logic
- Activity workspace routes (`/activity-workspace?workspaceKey=...`)
- `calendarPlan.weeks` data source

---

## Activity Card Format (Unchanged)

- Platform icon (top-left)
- Content type label
- Topic
- Repurpose dots (● ○ ○) when shared
- Repurpose ratio (1/3)
- Scheduled time (if present)
