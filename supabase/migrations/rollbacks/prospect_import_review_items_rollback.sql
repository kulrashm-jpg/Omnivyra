-- ROLLBACK for 20270206000000_prospect_import_review_items.sql
--
-- Drops the staging table and everything it owns (indexes, policy, grants,
-- constraints). The table is a review QUEUE of NOT-imported provider records:
-- dropping it imports nothing and erases no person, but every pending review
-- decision is lost and the held leads become re-pullable. Grants nothing back.
--
-- Run only after the application code that reads/writes the table is gone.

BEGIN;

DROP TABLE IF EXISTS public.prospect_import_review_items;

DO $verify$
BEGIN
  IF to_regclass('public.prospect_import_review_items') IS NOT NULL THEN
    RAISE EXCEPTION 'PIRI rollback postcondition: prospect_import_review_items still exists';
  END IF;
END
$verify$;

COMMIT;
