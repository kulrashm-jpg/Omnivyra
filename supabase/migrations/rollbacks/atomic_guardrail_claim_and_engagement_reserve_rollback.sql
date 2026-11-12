-- Rollback of 20270217000021_atomic_guardrail_claim_and_engagement_reserve.sql.
-- ORDER: roll the CODE back first - it calls community_ai_claim_within_limits and
-- usage_execution_reserve / usage_execution_release. Drops the three functions and the reservation
-- table (live reservations are lost: plan usage is then counted from the meter alone, as before).
BEGIN;
DROP FUNCTION IF EXISTS public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer);
DROP FUNCTION IF EXISTS public.usage_execution_release(uuid, uuid);
DROP TABLE IF EXISTS public.usage_execution_reservations;
DO $verify$
BEGIN
  IF to_regprocedure('public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)') IS NOT NULL
     OR to_regprocedure('public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)') IS NOT NULL
     OR to_regprocedure('public.usage_execution_release(uuid, uuid)') IS NOT NULL
     OR to_regclass('public.usage_execution_reservations') IS NOT NULL THEN
    RAISE EXCEPTION 'AGCR rollback postcondition: the functions and the table must be gone';
  END IF;
END
$verify$;
COMMIT;
