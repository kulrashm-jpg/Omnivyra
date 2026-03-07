# Phase 3 — Weekly Activity Card Model — Implementation Report

**Date:** 2025-03-07  
**Phase:** 3 — Visual Weekly Card System  
**Constraint:** No scheduling logic modified; cards read from `execution_items[].topic_slots[]` only.

---

## 1. Objective

Render each weekly activity as a **visual card** using the scheduling structure from Phase 2. Cards display topic code, content code, topic title, platform, content type, execution category, scheduled day/time, and repurpose indicator.

---

## 2. Weekly Card Component

**File:** `components/weekly-board/WeeklyActivityCard.tsx`

**Card structure:**

| Section | Content | Example |
|--------|---------|---------|
| **Header** | `content_code` + topic title | `A1 | AI adoption barriers` |
| **Platform / Content Type** | Platform icon + content type icon + label | `LinkedIn Post` |
| **Schedule** | Day + Time | `Tue 09:00` |
| **Repurpose** | When `repurpose_total > 1` | `1/3` (top-right corner) |

**Execution category colors (left border):**

| Mode | Color |
|------|-------|
| AI Assisted | Green (`border-l-emerald-500`) |
| Hybrid / Conditional AI | Orange (`border-l-amber-500`) |
| Creator Dependent | Red (`border-l-rose-500`) |

**Card actions (on hover):**

- Open Workspace  
- Edit Schedule  
- Move Card  
- Regenerate  

*(Actions are UI triggers only; backend wiring deferred.)*

---

## 3. Content Type Icons

**File:** `components/weekly-board/contentTypeIcons.tsx`

| Content Type | Lucide Icon |
|--------------|-------------|
| Post / Document | `FileText` |
| Article | `FileText` |
| Blog | `Newspaper` |
| Carousel | `Layers` |
| Video / Reel | `Video` |
| Short Video / Shorts | `Smartphone` |
| Podcast | `Mic` |
| Thread | `List` |

---

## 4. Weekly Activity Board

**File:** `components/weekly-board/WeeklyActivityBoard.tsx`

- **Layout:** 7 columns (Mon, Tue, Wed, Thu, Fri, Sat, Sun)
- **Grouping:** Cards placed by `scheduled_day` (1–7)
- **Improve Plan button:** UI trigger for AI chat with weekly plan context (no chat logic in this phase)

---

## 5. Data Adapter

**File:** `lib/planning/weeklyActivityAdapter.ts`

**Function:** `buildWeeklyActivitiesFromExecutionItems(week)`

**Responsibilities:**

- Flattens `execution_items[].topic_slots[]` into `WeeklyActivity[]`
- Reads: `content_code`, `topic_code`, `topic`, `platform`, `content_type`, `scheduled_day`, `scheduled_time`, `repurpose_index`, `repurpose_total`
- Applies defaults when fields are missing (`scheduled_day` from `day_index` or round-robin, `scheduled_time` = `"09:00"`)

---

## 6. Integration

**File:** `pages/campaign-daily-plan/[id].tsx`

**Changes:**

- Added `planWeeks` state to hold raw blueprint weeks
- For each week with `execution_items` containing `topic_slots`, render `WeeklyActivityBoard` above the day grid
- `Open Workspace` from card maps `WeeklyActivity` to `GridActivity` and reuses existing `openActivityWorkspace` flow
- `Improve Plan` navigates to `/campaign-planning?campaignId=...&week=...&openChat=1`

---

## 7. Files Created / Modified

| File | Change |
|------|--------|
| `lib/planning/weeklyActivityAdapter.ts` | New — flatten execution_items to WeeklyActivity[] |
| `components/weekly-board/contentTypeIcons.tsx` | New — content type → Lucide icon mapping |
| `components/weekly-board/executionCategoryColors.ts` | New — execution mode → border/stripe colors |
| `components/weekly-board/WeeklyActivityCard.tsx` | New — single activity card |
| `components/weekly-board/WeeklyActivityBoard.tsx` | New — 7-column board + Improve Plan button |
| `pages/campaign-daily-plan/[id].tsx` | Modified — integrate board, planWeeks state |

---

## 8. Confirmation Checklist

1. **Weekly card component created** — `WeeklyActivityCard.tsx`  
2. **Card fields rendered** — content_code, topic title, platform, content type, schedule, repurpose indicator  
3. **Execution category color system implemented** — green/orange/red left borders  
4. **Content type icon system implemented** — Post, Article, Blog, Carousel, Video, Short Video, Podcast, Thread  
5. **Weekly board grouping by scheduled_day** — 7 columns Mon–Sun  
6. **AI chat entry button added** — "Improve Plan" on each week board  

---

## 9. Scheduling Logic

Scheduling logic was **not** modified. Cards consume data from `execution_items[].topic_slots[]` as produced by Phase 2 `weeklyScheduleAllocator`.
