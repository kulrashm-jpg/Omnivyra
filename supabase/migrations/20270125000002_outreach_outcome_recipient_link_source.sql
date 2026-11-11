-- Email engine (closure D, SC-4): a source value for an outcome the RECIPIENT asserted by
-- following a signed link: today, the unsubscribe link.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to any real environment needs a separate owner decision.
--
-- WHY. `recordOutreachUnsubscribe` records canonical governance but no `outreach_outcomes`
-- row. The link path knows the task (unsubscribeService.ts:66-78), but the source CHECK
-- (20260915000000_ws3_feedback_ingestion.sql) has no honest value for it: a click on our
-- own signed link is neither `provider_webhook` nor `manual`.
--
-- The source CHECK gains exactly one value, `recipient_link`. Nothing else changes, and
-- no existing row changes. The outcome writer is NOT wired: the outcome contract for
-- non-WS-3 engines (SC-4) is still to be agreed with Orchestration, and task-less
-- (list-level) unsubscribes remain unrecordable while `task_id` is NOT NULL.
--
-- Rollback: supabase/migrations/rollbacks/outreach_outcome_recipient_link_source_rollback.sql

DO $$
BEGIN
  ALTER TABLE public.outreach_outcomes DROP CONSTRAINT IF EXISTS outreach_outcomes_source_valid;
  ALTER TABLE public.outreach_outcomes ADD CONSTRAINT outreach_outcomes_source_valid CHECK (
    source IS NULL OR source IN (
      'provider_webhook', 'provider_poll', 'manual', 'import', 'derived', 'internal',
      -- SC-4: the recipient followed a signed link we sent (unsubscribe).
      'recipient_link'
    )
  );
END
$$;
