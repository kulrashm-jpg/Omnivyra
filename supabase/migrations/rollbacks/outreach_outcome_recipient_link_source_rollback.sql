-- Rollback of 20270125000002_outreach_outcome_recipient_link_source.sql.
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- REFUSES rather than loses history: `outreach_outcomes` is append-only, so a row with
-- source `recipient_link` cannot be removed or rewritten. If any exists the rollback
-- stops with a count and changes nothing. One transaction.

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.outreach_outcomes WHERE source = 'recipient_link';
  IF n > 0 THEN
    RAISE EXCEPTION 'outreach_outcome_recipient_link_source rollback: % recipient_link outcome row(s) exist and outreach_outcomes is append-only; not rolled back', n;
  END IF;
END
$$;

ALTER TABLE public.outreach_outcomes DROP CONSTRAINT IF EXISTS outreach_outcomes_source_valid;
ALTER TABLE public.outreach_outcomes ADD CONSTRAINT outreach_outcomes_source_valid CHECK (
  source IS NULL OR source IN ('provider_webhook', 'provider_poll', 'manual', 'import', 'derived', 'internal')
);

COMMIT;
