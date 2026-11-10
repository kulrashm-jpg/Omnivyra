-- ROLLBACK — Orchestration (G-11): the opt-out hold's company-admin review.
-- Reverses supabase/migrations/20270127000001_contact_opt_out_reviews.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. Every review is dropped with the table: which holds a review adopted, which
-- channels a STOP or an unsubscribe locked, and every admin decision with its reason. The HOLDS
-- themselves are untouched: they live in contact_governance_records, so every contact held by a
-- pending review stays closed on every channel, and nothing can reopen it until the review store
-- returns. Roll the application back first (it reads and writes the table). The audit rows in
-- execution_audit stay.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DROP TRIGGER IF EXISTS trg_contact_opt_out_reviews_guard ON public.contact_opt_out_reviews;
DROP FUNCTION IF EXISTS public.contact_opt_out_reviews_guard();
DROP TABLE IF EXISTS public.contact_opt_out_reviews;

DO $$
BEGIN
  IF to_regclass('public.contact_opt_out_reviews') IS NOT NULL THEN
    RAISE EXCEPTION 'G-11 rollback postcondition: contact_opt_out_reviews still exists';
  END IF;
END
$$;

COMMIT;
