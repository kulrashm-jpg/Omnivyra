-- Rollback for 20270109000002_pi_qualification_score_nullable.sql.
--
-- Restores `canonical_leads.qualification_score numeric(5,2) NOT NULL DEFAULT 0`.
-- It REFUSES while any row holds NULL: turning "unscored" back into 0 is a data
-- decision (it re-creates the ambiguity the forward migration removed) and is
-- never made silently by a rollback. Resolve those rows explicitly first.

BEGIN;

DO $rollback$
DECLARE
  v_nulls bigint;
BEGIN
  SELECT count(*) INTO v_nulls FROM public.canonical_leads WHERE qualification_score IS NULL;
  IF v_nulls > 0 THEN
    RAISE EXCEPTION 'QSCORE rollback: % canonical_leads rows are unscored (NULL); refusing to restore NOT NULL', v_nulls;
  END IF;
END
$rollback$;

ALTER TABLE public.canonical_leads ALTER COLUMN qualification_score SET DEFAULT 0;
ALTER TABLE public.canonical_leads ALTER COLUMN qualification_score SET NOT NULL;

COMMIT;
