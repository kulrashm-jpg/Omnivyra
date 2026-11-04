-- Rollback of 20270125000001_outreach_outcome_complained.sql.
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- REFUSES rather than loses history. `outreach_outcomes` is append-only (its trigger
-- rejects UPDATE and DELETE), so a `complained` row can be neither removed nor rewritten
-- to fit the narrower CHECK. If any exists the rollback stops with a count and changes
-- nothing. Roll the writer back first. One transaction.

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.outreach_outcomes WHERE outcome_type = 'complained';
  IF n > 0 THEN
    RAISE EXCEPTION 'outreach_outcome_complained rollback: % complained outcome row(s) exist and outreach_outcomes is append-only; not rolled back', n;
  END IF;
END
$$;

ALTER TABLE public.outreach_outcomes DROP CONSTRAINT IF EXISTS outreach_outcomes_type_valid;
ALTER TABLE public.outreach_outcomes ADD CONSTRAINT outreach_outcomes_type_valid CHECK (
  outcome_type IN (
    'opened', 'clicked', 'replied', 'meeting_booked',
    'rejected', 'no_response',
    'unsubscribed', 'converted'
  )
);

COMMIT;
