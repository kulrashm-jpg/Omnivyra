-- Rollback of 20270217000031_transactional_email_idempotency.sql.
-- Drops the idempotency ledger of send-transactional-email, its resolution audit and its five functions. LOSES the dedupe record:
-- after a rollback, a retried keyed email can be sent again (the behaviour before the apply).
-- SOUND TO DROP: the apply's preflight refuses unless the table and all four functions were absent, or all present
-- exactly as it makes them (columns, types, NOT NULL, function bodies) - nothing that predated it is removed.
-- ORDER: roll the EDGE FUNCTION back first. The current function RESERVES before every keyed send; without these
-- functions every keyed email is refused (503, nothing sent - fail closed) until the code is rolled back too.
BEGIN;
DROP FUNCTION IF EXISTS public.transactional_email_reserve(text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.transactional_email_confirm(text, text);
DROP FUNCTION IF EXISTS public.transactional_email_release(text);
DROP FUNCTION IF EXISTS public.transactional_email_mark_uncertain(text, text);
DROP FUNCTION IF EXISTS public.transactional_email_resolve_uncertain(text, text, text);
DROP TABLE IF EXISTS public.transactional_email_sends;
-- The resolution AUDIT is dropped too: it only ever records decisions about rows of the table above.
DROP TABLE IF EXISTS public.transactional_email_resolutions;
DO $verify$
BEGIN
  IF to_regclass('public.transactional_email_sends') IS NOT NULL
     OR to_regprocedure('public.transactional_email_reserve(text, text, text, integer, integer)') IS NOT NULL
     OR to_regprocedure('public.transactional_email_confirm(text, text)') IS NOT NULL
     OR to_regprocedure('public.transactional_email_release(text)') IS NOT NULL
     OR to_regprocedure('public.transactional_email_mark_uncertain(text, text)') IS NOT NULL
     OR to_regprocedure('public.transactional_email_resolve_uncertain(text, text, text)') IS NOT NULL
     OR to_regclass('public.transactional_email_resolutions') IS NOT NULL THEN
    RAISE EXCEPTION 'TEI rollback postcondition: both tables and all five functions must be gone';
  END IF;
END
$verify$;
COMMIT;
