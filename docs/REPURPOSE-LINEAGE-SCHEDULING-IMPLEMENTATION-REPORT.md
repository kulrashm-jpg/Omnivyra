# Repurpose Lineage Scheduling — Implementation Report

**Date:** 2025-03-13  
**Goal:** Persist repurpose lineage on `scheduled_posts` so calendar and activity views can show "1/3", "2/3", "3/3" for repurposed content.

---

## Summary

- **Schema:** Added `repurpose_index`, `repurpose_total`, `repurpose_parent_execution_id` to `scheduled_posts`.
- **Scheduler:** All `structuredPlanScheduler` insert paths now write `repurpose_index` and `repurpose_total`.
- **Types:** `ScheduledPost`, `LegacyScheduledPost`, `CalendarActivity` extended with repurpose fields.
- **APIs:** `listLegacyScheduledPosts` / `getLegacyScheduledPostById` return repurpose fields.
- **Calendar:** Campaign calendar derives and displays repurpose lineage for daily-plans and shows "(1/3)" badge when `repurpose_total > 1`.
- **Backward compatibility:** Existing rows get `repurpose_index = 1`, `repurpose_total = 1` via defaults and migration backfill.

---

## Files Modified

| File | Changes |
|------|---------|
| `database/scheduled_posts_repurpose_lineage.sql` | **New** — Migration adding columns |
| `backend/services/structuredPlanScheduler.ts` | Repurpose logic in `scheduleFromDailyPlans`; defaults in other paths; `LegacyScheduledPost` and `mapDbRowToLegacyScheduledPost`; `createLegacyScheduledPost` payload |
| `backend/db/queries.ts` | `ScheduledPost` interface extended with `repurpose_index?`, `repurpose_total?` |
| `lib/types/scheduling.ts` | `ScheduledPost` interface extended |
| `pages/campaign-calendar/[id].tsx` | `CalendarActivity` type; repurpose derivation for daily-plans; "(1/3)" badge on card |

---

## Schema Changes

**Table:** `scheduled_posts`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `repurpose_index` | INTEGER | 1 | Order of post in repurpose chain (1-based, e.g. 1 for first of 3) |
| `repurpose_total` | INTEGER | 1 | Total posts in repurpose chain (e.g. 3 for 1/3, 2/3, 3/3) |
| `repurpose_parent_execution_id` | TEXT | NULL | Execution ID of original activity this post was repurposed from (optional) |

Migration file: `database/scheduled_posts_repurpose_lineage.sql`

---

## Scheduler Changes

### `scheduleFromDailyPlans` (BOLT daily_content_plans)

- Groups plans by `(topic||title, week_number)`.
- Within each group, sorts by platform order: `['linkedin', 'facebook', 'instagram', 'x', 'twitter', 'youtube', 'tiktok', 'pinterest']`.
- Assigns `repurpose_index = 1..N` and `repurpose_total = N` per row.
- Writes `repurpose_index` and `repurpose_total` on each inserted `scheduled_posts` row.

Example:

- LinkedIn (AI introduction) → `repurpose_index = 1`, `repurpose_total = 3`
- Facebook (AI introduction) → `repurpose_index = 2`, `repurpose_total = 3`
- Instagram (AI introduction) → `repurpose_index = 3`, `repurpose_total = 3`

### `scheduleFromExecutionJobs`, `scheduleFromAllocation`, `scheduleFromLegacy`

- Do not derive repurpose chains.
- Write `repurpose_index: 1`, `repurpose_total: 1` for backward compatibility.

### `createLegacyScheduledPost`

- Inserts with `repurpose_index: 1`, `repurpose_total: 1`.

---

## Backward Compatibility Handling

1. **Migration:** Columns have `DEFAULT 1`; `UPDATE` sets `repurpose_index = 1`, `repurpose_total = 1` for existing rows where NULL.
2. **Reads:** `mapDbRowToLegacyScheduledPost` uses `row.repurpose_index ?? 1` and `row.repurpose_total ?? 1`.
3. **Display:** Calendar checks `(activity.repurpose_total ?? 1) > 1` before showing "(1/3)" badge.
4. **No behavior change:** Existing scheduling logic unchanged; only schema and write behavior extended.

---

## Type Updates

| Type | Location | Fields Added |
|------|----------|--------------|
| `ScheduledPost` | `backend/db/queries.ts` | `repurpose_index?: number`, `repurpose_total?: number` |
| `ScheduledPost` | `lib/types/scheduling.ts` | `repurpose_index?: number`, `repurpose_total?: number` |
| `LegacyScheduledPost` | `structuredPlanScheduler.ts` | `repurpose_index?: number`, `repurpose_total?: number` |
| `CalendarActivity` | `pages/campaign-calendar/[id].tsx` | `repurpose_index?: number`, `repurpose_total?: number` |

---

## API / Display

### APIs returning scheduled posts

- **GET /api/schedule/posts:** Uses `listLegacyScheduledPosts`; responses include `repurpose_index` and `repurpose_total` via `mapDbRowToLegacyScheduledPost`.
- **GET /api/schedule/posts/[id]:** Uses `getLegacyScheduledPostById`; same fields included.

### Campaign calendar

- **Daily-plans fallback:** Derives repurpose by grouping `(title||topic, week)` and ordering by platform; each `CalendarActivity` gets `repurpose_index` and `repurpose_total`.
- **Card display:** When `repurpose_total > 1`, shows `(repurpose_index/repurpose_total)` next to the title (e.g. "AI introduction (1/3)").

---

## Example

`scheduled_posts` row:

```json
{
  "platform": "linkedin",
  "title": "AI introduction",
  "repurpose_index": 1,
  "repurpose_total": 3
}
```

Calendar label:

```
LinkedIn — AI introduction (1/3)
```

---

## Migration Instructions

1. Run the migration: `psql -f database/scheduled_posts_repurpose_lineage.sql` (or via Supabase SQL editor).
2. Redeploy backend and frontend; no other configuration required.
