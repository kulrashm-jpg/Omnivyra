-- Rollback of 20270217000009_outreach_quota_atomic_consume.sql.
-- Drops the WS-3 database limiter layer. Loses only live reservations (seconds old by design).
-- SOUND TO DROP: the apply's preflight refuses unless the table and both functions were all absent, or
-- all present exactly as it makes them (columns, types, FK, function bodies) - nothing that predated
-- it is removed.
-- ORDER: roll the CODE back first - the database layer of quota.ts calls outreach_quota_consume, and
-- without it a limited tenant's dispatch is refused (fail closed) while Redis is unusable.
BEGIN;
DROP FUNCTION IF EXISTS public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer);
DROP FUNCTION IF EXISTS public.outreach_quota_release(uuid, uuid);
DROP TABLE IF EXISTS public.outreach_quota_reservations;
DO $verify$
BEGIN
  IF to_regclass('public.outreach_quota_reservations') IS NOT NULL
     OR to_regprocedure('public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)') IS NOT NULL
     OR to_regprocedure('public.outreach_quota_release(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'OQAC rollback postcondition: the table and both functions must be gone';
  END IF;
END
$verify$;
COMMIT;
