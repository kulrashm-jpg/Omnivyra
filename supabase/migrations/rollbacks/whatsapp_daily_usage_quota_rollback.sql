-- Rollback for <version>_whatsapp_daily_usage_quota.sql.
--
-- Removes the WhatsApp daily-usage table and its check-and-consume function.
-- WARNING: the application's database fallback calls this function and fails
-- CLOSED without it - while Redis is unavailable, every WhatsApp send is refused.
-- Roll back the application change (whatsappRateLimiter.ts) FIRST, or accept that.
-- The table's usage rows are lost; they only matter for the current UTC day.

BEGIN;

DROP FUNCTION IF EXISTS public.whatsapp_consume_daily_quota(uuid, date, integer, integer);
DROP TABLE IF EXISTS public.whatsapp_daily_usage;

DO $verify$
BEGIN
  IF to_regclass('public.whatsapp_daily_usage') IS NOT NULL THEN
    RAISE EXCEPTION 'WDU rollback: whatsapp_daily_usage still exists';
  END IF;
  IF to_regprocedure('public.whatsapp_consume_daily_quota(uuid, date, integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'WDU rollback: whatsapp_consume_daily_quota still exists';
  END IF;
END
$verify$;

COMMIT;
