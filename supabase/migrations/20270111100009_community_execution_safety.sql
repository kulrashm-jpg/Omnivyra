-- Community execution safety — duplicate-execution and concurrency defects.
--
-- Two changes, both owned by the community engine:
--
-- 1. community_ai_actions.status CHECK becomes the explicit, complete
--    vocabulary every writer uses:
--      pending, approved, scheduled, dispatched, acknowledged, executing,
--      executed, sent_unverified, failed, skipped, blocked, uncertain
--    The production CHECK (supabase/_schema/baseline.sql) allows only
--    pending/approved/executed/failed/skipped, so in production the manual
--    execute route's claim ('executing') and the executor's 'sent_unverified'
--    / 'blocked' terminal writes are rejected. A database built from every
--    migration (20260523) already allows the first 11 values above.
--      'executing' — an atomic claim (approved -> executing) is held.
--      'uncertain' — the platform MAY have received the action (timeout, lost
--                    response, failure after the submit interaction, expired
--                    claim). Terminal; human review; never executed
--                    automatically again.
--    The constraint is only ever WIDENED: the migration refuses if the current
--    allow-list contains a value outside the new vocabulary or if any row
--    holds such a value. The previous definition is stored in the constraint
--    comment so the rollback restores it verbatim.
--
-- 2. rpa_retry_queue gains a compare-and-set claim (claim_token, claimed_at).
--    A flush must win `UPDATE ... WHERE claim_token IS NULL` before it runs a
--    row. A claim that is never released is NOT re-claimed automatically; it
--    is surfaced for review (the action may have run).
--
-- NOT changed here (out of this slot's scope, reported separately): the lease
-- reaper reap_community_ai_action_leases() still marks expired leases and
-- executing timeouts 'failed' with error codes DISPATCH_LEASE_EXPIRED /
-- DISPATCH_LEASE_EXPIRED_IN_FLIGHT / EXECUTING_TIMEOUT. Readers must treat
-- those codes as may-have-acted.
--
-- Idempotent: re-running is a no-op. Guarded by pre- and postconditions.
-- NOT applied anywhere yet. ROLLBACK:
--   supabase/migrations/rollbacks/community_execution_safety_rollback.sql

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'community execution safety: public.community_ai_actions is absent';
  END IF;
  IF to_regclass('public.rpa_retry_queue') IS NULL THEN
    RAISE EXCEPTION 'community execution safety: public.rpa_retry_queue is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
       AND column_name IN ('status', 'tenant_id', 'organization_id', 'cancel_requested_at')
     GROUP BY table_name HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'community execution safety: community_ai_actions lacks a required column';
  END IF;
  -- Existing claim columns must have the expected types (re-run safety).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rpa_retry_queue'
       AND ((column_name = 'claim_token' AND data_type <> 'text')
         OR (column_name = 'claimed_at'  AND data_type <> 'timestamp with time zone'))
  ) THEN
    RAISE EXCEPTION 'community execution safety: rpa_retry_queue claim columns exist with unexpected types';
  END IF;
END
$$;

-- ── 1. Status CHECK: explicit complete vocabulary (widening only) ───────────
DO $$
DECLARE
  v_vocab text[] := ARRAY['pending', 'approved', 'scheduled', 'dispatched', 'acknowledged',
                          'executing', 'executed', 'sent_unverified', 'failed', 'skipped',
                          'blocked', 'uncertain'];
  v_def   text;
  v_prior text[];
  v_extra text[];
  v_bad   bigint;
  v_list  text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.community_ai_actions'::regclass
     AND c.conname  = 'community_ai_actions_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'community execution safety: community_ai_actions_status_check is absent';
  END IF;

  -- Only a plain allow-list over `status` is rewritten.
  IF v_def NOT LIKE 'CHECK ((status = ANY (%' THEN
    RAISE EXCEPTION 'community execution safety: unexpected status CHECK shape: %', v_def;
  END IF;

  SELECT array_agg(t.m[1] ORDER BY t.ord) INTO v_prior
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, ord);
  IF v_prior IS NULL OR array_length(v_prior, 1) = 0 THEN
    RAISE EXCEPTION 'community execution safety: could not read the status allow-list from %', v_def;
  END IF;

  -- Already applied: the allow-list IS the vocabulary.
  IF v_prior @> v_vocab AND v_vocab @> v_prior THEN
    RAISE NOTICE 'community execution safety: status CHECK already is the complete vocabulary';
    RETURN;
  END IF;

  -- Never narrow: refuse if the current allow-list has a value outside it.
  SELECT array_agg(x) INTO v_extra FROM unnest(v_prior) AS x WHERE NOT (x = ANY (v_vocab));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'community execution safety: current status CHECK allows % which the new vocabulary lacks', v_extra;
  END IF;
  SELECT count(*) INTO v_bad FROM public.community_ai_actions
   WHERE status IS NOT NULL AND NOT (status = ANY (v_vocab));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'community execution safety: % rows hold a status outside the vocabulary', v_bad;
  END IF;

  SELECT string_agg(quote_literal(u.x), ', ' ORDER BY u.ord) INTO v_list
    FROM unnest(v_vocab) WITH ORDINALITY AS u(x, ord);

  ALTER TABLE public.community_ai_actions DROP CONSTRAINT community_ai_actions_status_check;
  EXECUTE format(
    'ALTER TABLE public.community_ai_actions ADD CONSTRAINT community_ai_actions_status_check CHECK (status IN (%s))',
    v_list);
  EXECUTE format(
    'COMMENT ON CONSTRAINT community_ai_actions_status_check ON public.community_ai_actions IS %L',
    'community_execution_safety prior_definition: ' || v_def);
END
$$;

-- ── 2. rpa_retry_queue compare-and-set claim ────────────────────────────────
ALTER TABLE public.rpa_retry_queue ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE public.rpa_retry_queue ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.rpa_retry_queue'::regclass
       AND conname  = 'rpa_retry_queue_claim_pair'
  ) THEN
    ALTER TABLE public.rpa_retry_queue
      ADD CONSTRAINT rpa_retry_queue_claim_pair
      CHECK ((claim_token IS NULL) = (claimed_at IS NULL));
  END IF;
END
$$;

COMMENT ON COLUMN public.rpa_retry_queue.claim_token IS
  'Compare-and-set claim held by the flush that is running this row. Never '
  're-claimed automatically: a row left claimed may have been executed and is '
  'surfaced for human review.';

CREATE INDEX IF NOT EXISTS idx_rpa_retry_queue_due_unclaimed
  ON public.rpa_retry_queue (organization_id, next_retry_at)
  WHERE claim_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpa_retry_queue_claimed
  ON public.rpa_retry_queue (claimed_at)
  WHERE claim_token IS NOT NULL;

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_vocab text[] := ARRAY['pending', 'approved', 'scheduled', 'dispatched', 'acknowledged',
                          'executing', 'executed', 'sent_unverified', 'failed', 'skipped',
                          'blocked', 'uncertain'];
  v_def   text;
  v_now   text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.community_ai_actions'::regclass
     AND c.conname  = 'community_ai_actions_status_check';
  SELECT array_agg(t.m[1]) INTO v_now
    FROM regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') AS t(m);
  IF v_now IS NULL OR NOT (v_now @> v_vocab AND v_vocab @> v_now) THEN
    RAISE EXCEPTION 'community execution safety postcondition: status CHECK is %', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rpa_retry_queue' AND column_name = 'claim_token')
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rpa_retry_queue' AND column_name = 'claimed_at')
  OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.rpa_retry_queue'::regclass AND conname = 'rpa_retry_queue_claim_pair') THEN
    RAISE EXCEPTION 'community execution safety postcondition: rpa_retry_queue claim is incomplete';
  END IF;
END
$$;
