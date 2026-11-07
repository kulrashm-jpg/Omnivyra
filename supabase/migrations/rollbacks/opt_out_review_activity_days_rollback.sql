-- ROLLBACK — Orchestration (G-11): the days a company's admin opened the opt-out reviews.
-- Reverses supabase/migrations/20270127000002_opt_out_review_activity_days.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. The record of admin activity days goes with the table, so "overdue" can no
-- longer be counted from activity: the service treats an unreadable activity record as
-- weekdays-only and flags it. No hold, send or decision changes (a due date is informational).
-- Roll the application back first (it reads and writes the table).
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DROP TABLE IF EXISTS public.contact_opt_out_review_activity_days;

DO $$
BEGIN
  IF to_regclass('public.contact_opt_out_review_activity_days') IS NOT NULL THEN
    RAISE EXCEPTION 'G-11 rollback postcondition: contact_opt_out_review_activity_days still exists';
  END IF;
END
$$;

COMMIT;
