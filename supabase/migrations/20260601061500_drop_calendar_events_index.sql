-- 20260601061500_drop_calendar_events_index.sql
-- Calendar Legacy Teardown — remove the obsolete `calendar_events_index`
-- pre-aggregation, now fully superseded by /api/calendar/activity-events
-- (which reads scheduled_posts + pending daily_content_plans directly).
--
-- Evidence (audit 2026-06-01): the index's ONLY reader was
-- pages/api/calendar/batch.ts (deleted in this change); no view, pg_cron job,
-- or other function reads it. It was maintained by 4 triggers on
-- scheduled_posts plus 3 redundant app writers (calendar/messages.ts,
-- schedule/reschedule.ts, campaigns/[id].ts) — all removed in this change.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ APPLY ORDERING (IMPORTANT): apply this migration ONLY AFTER the Phase 1–2 │
-- │ code (batch.ts deletion + writer removal) is deployed. The currently-     │
-- │ deployed API routes still write to this table; dropping it before that    │
-- │ code ships would make message creation / reschedule / campaign deletion   │
-- │ error against a missing relation.                                          │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- The table + triggers were created out-of-band (no CREATE in the migration
-- ledger), so this is a forward-only teardown — there is no prior migration to
-- revert. Fully idempotent (IF EXISTS everywhere) and safe to re-run.
--
-- Order: drop triggers → drop functions → drop table (CASCADE removes the
-- table's RLS policy + indexes). Triggers/functions go first so a scheduled_posts
-- write never fires a trigger whose function references a dropped table.

BEGIN;

-- 1) Triggers on scheduled_posts (maintained the index; no longer needed).
DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_insert         ON public.scheduled_posts;
DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_update         ON public.scheduled_posts;
DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_platform_title ON public.scheduled_posts;
DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_delete         ON public.scheduled_posts;

-- 2) Trigger functions (canonical names confirmed via pg_proc).
DROP FUNCTION IF EXISTS public.fn_calendar_events_index_on_scheduled_post_insert();
DROP FUNCTION IF EXISTS public.fn_calendar_events_index_on_scheduled_post_update();
DROP FUNCTION IF EXISTS public.fn_calendar_events_index_on_scheduled_post_platform_title();
DROP FUNCTION IF EXISTS public.fn_calendar_events_index_on_scheduled_post_delete();

-- 3) The table itself. CASCADE drops the `service_role_full_access` RLS policy
--    and the table's indexes along with it.
DROP TABLE IF EXISTS public.calendar_events_index CASCADE;

COMMIT;
