-- Email engine (closure D, CR-4 / S-1): a spam complaint becomes a business outcome of
-- its own, `complained`, instead of surfacing only as an inferred `delivered` row.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to any real environment needs a separate owner decision.
--
-- The outcome_type CHECK (last set by 20260915000000_ws3_feedback_ingestion.sql) gains
-- exactly one value. Nothing else changes: the append-only trigger, the idempotency keys,
-- RLS and grants are untouched, and no existing row changes.
--
-- Wiring follows separately and only after this is applied (ENGINE-READINESS-D7.md §1.5):
-- `BUSINESS_OUTCOME_TYPES` gains `complained`; `FEEDBACK_SIGNALS` must NOT, because only
-- the authenticated SES path may assert a complaint; the SES ingestion appends the outcome
-- after its delivery row. The readers that today count the complaint-implied delivery
-- (journeyEvents, feedbackSummary) are corrected under CR-4 with Orchestration.
--
-- Rollback: supabase/migrations/rollbacks/outreach_outcome_complained_rollback.sql

DO $$
BEGIN
  ALTER TABLE public.outreach_outcomes DROP CONSTRAINT IF EXISTS outreach_outcomes_type_valid;
  ALTER TABLE public.outreach_outcomes ADD CONSTRAINT outreach_outcomes_type_valid CHECK (
    outcome_type IN (
      'opened', 'clicked', 'replied', 'meeting_booked',
      'rejected', 'no_response',
      'unsubscribed', 'converted',
      -- CR-4: only the authenticated SES complaint path writes this.
      'complained'
    )
  );
END
$$;
