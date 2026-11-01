-- ROLLBACK for 20261231000002_community_execution_safety.sql
--
-- Refuses (raises, changing nothing) when rolling back would lose data or
-- safety information:
--   - any community_ai_actions row holds a status the PRIOR CHECK did not
--     allow (e.g. 'uncertain' — an action that may have been performed and
--     awaits review; or 'executing' where the prior CHECK lacked it);
--   - any rpa_retry_queue row is claimed (claim_token set): dropping the claim
--     would make a possibly-executed row runnable again;
--   - the prior status CHECK definition was not recorded by the migration.
--
-- ROLLBACK ORDER for the 20261231 chain (verified on real PostgreSQL 2026-10-28):
--   0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000
-- KEEP THIS MIGRATION while anything that writes 'uncertain' is installed: the
-- restored CHECK rejects 'uncertain', so every reap with work would then error
-- and no lapsed claim would ever be surfaced. It therefore also refuses when:
--   - the 20261231000009 guard trigger (which converts reaps to 'uncertain') is
--     installed: roll back 20261231000009 first;
--   - the installed reap_community_ai_action_leases() writes 'uncertain' (the
--     20261231000005 body, which extension_dispatch_safety_rollback.sql KEEPS by
--     default; only its explicitly acknowledged restore replaces it);
--   - public.engagement_request_idempotency (20261231000008, whose precondition
--     is this migration) exists: roll back 20261231000008 first.
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_src text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.community_ai_actions'::regclass
                AND tgname = 'trg_community_ai_actions_reap_uncertain_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'community execution safety rollback refused: the 20261231000009 reaper guard (writes uncertain) is installed; roll back 20261231000009 first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.reap_community_ai_action_leases()');
  IF v_src IS NOT NULL AND v_src LIKE '%''uncertain''%' THEN
    RAISE EXCEPTION 'community execution safety rollback refused: the installed lease reaper writes uncertain (20261231000005), which the prior CHECK rejects; keep this migration, or roll back 20261231000005 with its explicit restore acknowledgement first';
  END IF;
  IF to_regclass('public.engagement_request_idempotency') IS NOT NULL THEN
    RAISE EXCEPTION 'community execution safety rollback refused: 20261231000008 (engagement_request_idempotency) depends on this migration; roll it back first';
  END IF;
END
$$;

DO $$
DECLARE
  v_cmt   text;
  v_prior_def text;
  v_prior text[];
  v_bad   bigint;
  v_claimed bigint;
  v_prefix constant text := 'community_execution_safety prior_definition: ';
BEGIN
  SELECT obj_description(c.oid, 'pg_constraint') INTO v_cmt
    FROM pg_constraint c
   WHERE c.conrelid = 'public.community_ai_actions'::regclass
     AND c.conname  = 'community_ai_actions_status_check';
  IF v_cmt IS NULL OR left(v_cmt, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'community execution safety rollback: prior status CHECK definition not recorded; refusing';
  END IF;
  v_prior_def := substr(v_cmt, length(v_prefix) + 1);
  IF v_prior_def NOT LIKE 'CHECK ((status = ANY (%' THEN
    RAISE EXCEPTION 'community execution safety rollback: recorded prior definition has an unexpected shape: %', v_prior_def;
  END IF;
  SELECT array_agg(t.m[1]) INTO v_prior
    FROM regexp_matches(v_prior_def, '''([^'']+)''', 'g') AS t(m);
  IF v_prior IS NULL THEN
    RAISE EXCEPTION 'community execution safety rollback: could not read the prior allow-list';
  END IF;

  SELECT count(*) INTO v_bad FROM public.community_ai_actions
   WHERE status IS NOT NULL AND NOT (status = ANY (v_prior));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'community execution safety rollback: % community_ai_actions rows hold a status the prior CHECK forbids (e.g. uncertain/executing); resolve them first', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'rpa_retry_queue' AND column_name = 'claim_token') THEN
    EXECUTE 'SELECT count(*) FROM public.rpa_retry_queue WHERE claim_token IS NOT NULL' INTO v_claimed;
    IF v_claimed > 0 THEN
      RAISE EXCEPTION 'community execution safety rollback: % rpa_retry_queue rows are claimed (possibly executed); review them first', v_claimed;
    END IF;
  END IF;

  ALTER TABLE public.community_ai_actions DROP CONSTRAINT community_ai_actions_status_check;
  EXECUTE 'ALTER TABLE public.community_ai_actions ADD CONSTRAINT community_ai_actions_status_check ' || v_prior_def;
END
$$;

DROP INDEX IF EXISTS public.idx_rpa_retry_queue_due_unclaimed;
DROP INDEX IF EXISTS public.idx_rpa_retry_queue_claimed;
ALTER TABLE public.rpa_retry_queue DROP CONSTRAINT IF EXISTS rpa_retry_queue_claim_pair;
ALTER TABLE public.rpa_retry_queue DROP COLUMN IF EXISTS claimed_at;
ALTER TABLE public.rpa_retry_queue DROP COLUMN IF EXISTS claim_token;

-- Postcondition: the prior CHECK is back and the claim columns are gone.
DO $$
BEGIN
  IF obj_description((SELECT oid FROM pg_constraint
                       WHERE conrelid = 'public.community_ai_actions'::regclass
                         AND conname = 'community_ai_actions_status_check'), 'pg_constraint') IS NOT NULL THEN
    RAISE EXCEPTION 'community execution safety rollback postcondition: status CHECK still carries the migration comment';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'rpa_retry_queue'
                AND column_name IN ('claim_token', 'claimed_at')) THEN
    RAISE EXCEPTION 'community execution safety rollback postcondition: claim columns remain';
  END IF;
END
$$;
