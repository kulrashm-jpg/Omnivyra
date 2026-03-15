# Calendar Events Index — Implementation Report

**Date:** March 2025  
**Purpose:** Improve calendar batch API performance via denormalized index

---

## Summary

A `calendar_events_index` table and related triggers/hooks were added. The batch API now reads activity events from this index instead of querying `scheduled_posts` with campaign joins. Scheduling logic was not modified.

---

## Tables Created

| Table | Purpose |
|-------|---------|
| `calendar_events_index` | Denormalized index for fast calendar queries |

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `company_id` | UUID | Company scope |
| `campaign_id` | UUID | Campaign scope |
| `event_date` | DATE | Event date |
| `event_type` | TEXT | `'activity'` or `'message'` |
| `platform` | TEXT | Platform (activity only) |
| `title` | TEXT | Title (activity only) |
| `repurpose_index` | INTEGER | Repurpose index (activity only) |
| `repurpose_total` | INTEGER | Repurpose total (activity only) |
| `scheduled_post_id` | UUID | FK to scheduled_posts (activity only) |
| `activity_execution_id` | TEXT | Execution ID (activity only) |
| `created_at` | TIMESTAMP | Created timestamp |

---

## Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_calendar_events_index_company_date` | `company_id`, `event_date` | Company + date range queries |
| `idx_calendar_events_index_campaign_date` | `campaign_id`, `event_date` | Campaign + date range queries |
| `idx_calendar_events_index_type_date` | `event_type`, `event_date` | Filter by type |
| `idx_calendar_events_index_scheduled_post` | `scheduled_post_id` | Reschedule lookups |

---

## Triggers / Hooks Added

### Database Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_calendar_events_index_on_scheduled_post_insert` | `scheduled_posts` | AFTER INSERT | Inserts activity event when `scheduled_for` and `campaign_id` are set |
| `trg_calendar_events_index_on_scheduled_post_update` | `scheduled_posts` | AFTER UPDATE | Updates `event_date` when `scheduled_for` changes |

### Application Hooks

| Location | Action |
|----------|--------|
| `pages/api/schedule/reschedule.ts` | Updates `calendar_events_index.event_date` when reschedule succeeds |
| `pages/api/calendar/messages.ts` | Inserts message event into index when calendar message is created |

---

## Files Modified

| File | Changes |
|------|----------|
| `database/calendar_events_index.sql` | **New** — table, indexes, triggers |
| `pages/api/calendar/batch.ts` | Reads activity events from `calendar_events_index` instead of `scheduled_posts` |
| `pages/api/schedule/reschedule.ts` | Updates `calendar_events_index.event_date` after reschedule |
| `pages/api/calendar/messages.ts` | Inserts into `calendar_events_index` when creating message |

---

## Migration

Run the SQL migration:

```bash
# Apply via Supabase SQL editor or psql
psql -f database/calendar_events_index.sql
```

**Backfill:** Existing `scheduled_posts` rows created before the trigger will not have index entries. Run the optional backfill in `database/calendar_events_index.sql` to populate the index for existing data.

---

## Sync Enhancement (DELETE + UPDATE platform/title)

### Triggers Added

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| `trg_calendar_events_index_on_scheduled_post_delete` | `scheduled_posts` | AFTER DELETE | `DELETE FROM calendar_events_index WHERE scheduled_post_id = OLD.id` |
| `trg_calendar_events_index_on_scheduled_post_platform_title` | `scheduled_posts` | AFTER UPDATE OF platform, title | `UPDATE calendar_events_index SET platform = NEW.platform, title = NEW.title WHERE scheduled_post_id = NEW.id` |

### Files Modified

| File | Changes |
|------|---------|
| `database/calendar_events_index.sql` | Added DELETE trigger, UPDATE OF platform/title trigger |

---

## Not Modified

- Scheduling logic (no changes to `structuredPlanScheduler` or other schedulers)
- `activityMessageCounts` in batch API (still from `activity_messages`)
- `calendarMessageCounts` in batch API (still from `calendar_messages` — index could be used for consistency; current query is indexed)
