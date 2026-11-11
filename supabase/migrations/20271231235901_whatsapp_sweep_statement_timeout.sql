-- A server-side statement_timeout on the WhatsApp unconfirmed-send sweep functions
-- (PLACEHOLDER VERSION - to be renamed to 83's reservation; must order after 20270128000007).
--
-- WHY (05, 2026-11-11). The sweep is now scheduled (cron, every 10 minutes) and the job
-- abandons a hung call client-side (a 30 s race per tenant). Abandoning only stops the
-- client listening: the statement keeps running on the server and keeps its connection,
-- so a genuinely hung function would leave one orphan per run - six an hour - until the
-- pool is exhausted, with the symptom appearing wherever the pool runs dry.
--
-- statement_timeout = 10s on each of the four functions the sweep calls CANCELS the
-- statement (its transaction rolls back) and frees the connection. The pairing is
-- LIFETIME vs CADENCE, not nesting: an abandoned statement lives at most 10 s after the
-- client gives up, ~60x under the 10-minute run interval, so nothing accumulates. (No
-- per-function value can nest under the client race: that race bounds a SEQUENCE -
-- candidates, then up to batchSize attach/mark/flag calls.) One value fits all four
-- because each is a single bounded statement: whatsapp_unconfirmed_sends is LIMITed by the
-- batch, the other three act on one row.
--
-- DO NOT LOSE THIS: ALTER FUNCTION ... SET stores the setting in pg_proc.proconfig, and a
-- later CREATE OR REPLACE FUNCTION without its own SET clauses DROPS proconfig entirely -
-- this timeout AND the search_path pin 20270128000007 gave each function. Any future
-- replace of these functions must carry both SET clauses inline.
--
-- WHAT THE POSTCONDITION GUARANTEES - and what it does not (05). It asserts the exact
-- statement_timeout and the PRESENCE of a search_path setting: it catches proconfig being
-- DROPPED (the main risk), not a replace that writes a WEAKER path - this migration does
-- not own 0007's search_path values, so it does not pin them. And a postcondition fires
-- on apply and replay only, so the three protections divide cleanly:
--   - this postcondition catches a dropped proconfig on the next full REPLAY (CI);
--   - a review-time gate rule (a CREATE OR REPLACE over a non-empty proconfig with no
--     SET clause of its own; proposed to 83) catches it where it is cheap to fix;
--   - nothing catches it in a live database between applies - which is why the gate
--     rule is the load-bearing one.
--
-- 20270128000007 is reviewed and on the apply list, so it is not edited; this is a new
-- migration.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer)') IS NULL
     OR to_regprocedure('public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid)') IS NULL
     OR to_regprocedure('public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid)') IS NULL
     OR to_regprocedure('public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'WST preflight: the sweep functions of 20270128000007 are missing - apply it first';
  END IF;
END
$preflight$;

ALTER FUNCTION public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer)
  SET statement_timeout = '10s';
ALTER FUNCTION public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid)
  SET statement_timeout = '10s';
ALTER FUNCTION public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid)
  SET statement_timeout = '10s';
ALTER FUNCTION public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid)
  SET statement_timeout = '10s';

DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn, p.proconfig AS cfg
      FROM pg_proc p
     WHERE p.oid IN (
       to_regprocedure('public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer)'),
       to_regprocedure('public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid)'),
       to_regprocedure('public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid)'),
       to_regprocedure('public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid)'))
  LOOP
    IF r.cfg IS NULL
       OR NOT ('statement_timeout=10s' = ANY (r.cfg))
       OR NOT EXISTS (SELECT 1 FROM unnest(r.cfg) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'WST postcondition: % must carry statement_timeout=10s AND still carry a search_path setting, found %',
        r.fn, coalesce(r.cfg::text, '{}');
    END IF;
  END LOOP;
  RAISE NOTICE 'WST: the four sweep functions carry statement_timeout=10s and still carry a search_path setting.';
END
$verify$;

COMMIT;
