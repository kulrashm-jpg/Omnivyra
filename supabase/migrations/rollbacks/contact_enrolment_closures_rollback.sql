-- ROLLBACK — Orchestration (G-11): a company admin's manual closure of a prospect to new journeys.
-- Reverses supabase/migrations/20270127000004_contact_enrolment_closures.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. Every manual closure and its history go with the table, so a prospect an
-- admin closed by hand becomes open to new journeys again (the review-derived gate, read from
-- contact_opt_out_reviews, is unaffected). The enrolment gate treats an unreadable closure store
-- as CLOSED (`contact_closure_unreadable`), so roll the application back FIRST, or every prospect
-- is refused. The add/reopen audit rows in execution_audit stay.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DROP FUNCTION IF EXISTS public.g11_redact_enrolment_closure_reasons(uuid, uuid[]);
DROP TRIGGER IF EXISTS trg_contact_enrolment_closures_guard ON public.contact_enrolment_closures;
DROP FUNCTION IF EXISTS public.contact_enrolment_closures_guard();
DROP TABLE IF EXISTS public.contact_enrolment_closures;

DO $$
BEGIN
  IF to_regclass('public.contact_enrolment_closures') IS NOT NULL THEN
    RAISE EXCEPTION 'G-11 rollback postcondition: contact_enrolment_closures still exists';
  END IF;
END
$$;

COMMIT;
