-- Rollback for 20270128000000_outreach_manual_outcome_once.sql
--
-- Drops the index only. Manual repeats are then accepted again with a new occurred_at.

DROP INDEX IF EXISTS public.idx_outreach_outcomes_manual_once;
