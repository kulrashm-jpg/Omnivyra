-- ROLLBACK for 20261231000008_engagement_request_idempotency.sql
--
-- ROLLBACK ORDER for the 20261231 chain (verified on real PostgreSQL 2026-10-28):
--   0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000
-- Run BEFORE community_execution_safety_rollback.sql (20261231000002 is this
-- migration's precondition); that rollback refuses while this table exists.
--
-- Refuses (raises, changing nothing) while any request record is LIVE:
--   - 'reserved'  — a request may be between reservation and its external
--                   call; dropping the record would let a concurrent or retried
--                   request send again;
--   - 'uncertain' — the request may have reached the platform and awaits
--                   review; dropping it would let the same key resend.
-- Also refuses while any 'completed' record is still inside its replay window
-- (expires_at > now()), unless the operator explicitly accepts that retries of
-- those requests will no longer be recognised:
--   SET LOCAL omnivyra.engagement_request_idempotency_drop_replay_window = 'i-accept-replay-loss';
--
-- Deploy the prior application code (which does not read this table) BEFORE
-- running this rollback: the current code fails closed (503
-- IDEMPOTENCY_UNAVAILABLE, nothing sent) without the table.
--
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_live bigint;
  v_window bigint;
BEGIN
  IF to_regclass('public.engagement_request_idempotency') IS NULL THEN
    RAISE NOTICE 'engagement request idempotency rollback: table absent, nothing to do';
    RETURN;
  END IF;
  EXECUTE $q$SELECT count(*) FROM public.engagement_request_idempotency WHERE state IN ('reserved', 'uncertain')$q$ INTO v_live;
  IF v_live > 0 THEN
    RAISE EXCEPTION 'engagement request idempotency rollback: % live reservation(s) (reserved/uncertain) exist; resolve them first', v_live;
  END IF;
  EXECUTE $q$SELECT count(*) FROM public.engagement_request_idempotency WHERE state = 'completed' AND expires_at > now()$q$ INTO v_window;
  IF v_window > 0
     AND coalesce(current_setting('omnivyra.engagement_request_idempotency_drop_replay_window', true), '') <> 'i-accept-replay-loss' THEN
    RAISE EXCEPTION 'engagement request idempotency rollback: % completed record(s) are still inside their replay window; retry after expiry or acknowledge explicitly', v_window;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.engagement_request_idempotency;
