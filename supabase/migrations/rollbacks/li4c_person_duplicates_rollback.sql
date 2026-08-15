-- ROLLBACK for 20261004000000_li4c_person_duplicates.sql
--
-- ############################################################################
-- #  LOSSLESS ONLY BEFORE THE FIRST MERGE. DESTRUCTIVE AFTER IT.             #
-- ############################################################################
--
-- The ADR (§13) states this limit rather than claiming general reversibility,
-- and it is the single thing to check before running this file.
--
-- WHILE NO PERSON HAS BEEN MERGED:
--   Every row is status='active' with merged_into_id NULL. Dropping the two
--   columns and the candidate table restores the exact pre-LI-4C shape and
--   loses nothing — the columns carried only their defaults.
--
-- ONCE A PERSON HAS BEEN MERGED:
--   `merged_into_id` is the ONLY record that two person rows describe the same
--   human. It exists nowhere else — not in source_records (which records what a
--   provider observed, not what an operator concluded), and not in
--   identity_claims. Dropping it means:
--
--     drop the column -> the merge is forgotten -> both persons look canonical
--     again -> the survivor and the merged person are both contactable -> the
--     same human is contacted twice, and any DNC held by the merged person
--     stops being followed for the survivor
--
--   and nothing will report it, because from every reader's perspective there
--   were simply always two unrelated people.
--
--   The resolution history in person_duplicate_candidates — who merged what and
--   why — is destroyed with the table. That is the tenant's audit trail for a
--   compliance-relevant decision.
--
-- BEFORE RUNNING, measure exactly what will be destroyed:
--
--   SELECT count(*) FILTER (WHERE merged_into_id IS NOT NULL) AS merged_persons,
--          count(*) FILTER (WHERE status <> 'active')         AS non_active_persons
--     FROM public.unified_persons;
--
--   SELECT status, count(*) FROM public.person_duplicate_candidates GROUP BY status;
--
-- If merged_persons is 0 and non_active_persons is 0, this rollback is lossless.
-- If either is non-zero, STOP: export both tables first, and treat this as a
-- data-destroying operation requiring the same authority as deleting identity.
--
-- This file is deliberately NOT idempotent-by-omission: it drops in dependency
-- order and will error rather than silently half-complete.

BEGIN;

-- Guard. Refuses to run once a merge exists, so the destructive case must be an
-- explicit, deliberate act rather than an accident of running the rollback.
DO $guard$
DECLARE
  v_merged INT := 0;
  v_resolved INT := 0;
BEGIN
  IF to_regclass('public.unified_persons') IS NOT NULL THEN
    SELECT count(*) INTO v_merged FROM public.unified_persons WHERE merged_into_id IS NOT NULL;
  END IF;
  IF to_regclass('public.person_duplicate_candidates') IS NOT NULL THEN
    SELECT count(*) INTO v_resolved FROM public.person_duplicate_candidates WHERE status <> 'open';
  END IF;

  IF v_merged > 0 OR v_resolved > 0 THEN
    RAISE EXCEPTION
      'LI-4C rollback refused: % merged person(s) and % resolved candidate(s) exist. This rollback would destroy merge history and the tenant audit trail. Export both tables and remove this guard deliberately if that is genuinely intended.',
      v_merged, v_resolved;
  END IF;
END
$guard$;

-- 1. The review queue. Indexes, constraints and policy go with the table.
DROP TABLE IF EXISTS public.person_duplicate_candidates;

-- 2. Person lifecycle. Constraints first, then the columns they reference.
ALTER TABLE public.unified_persons DROP CONSTRAINT IF EXISTS unified_persons_merge_tenant_fk;
ALTER TABLE public.unified_persons DROP CONSTRAINT IF EXISTS unified_persons_no_self_merge;
ALTER TABLE public.unified_persons DROP CONSTRAINT IF EXISTS unified_persons_merge_coherent;
ALTER TABLE public.unified_persons DROP CONSTRAINT IF EXISTS unified_persons_status_valid;

DROP INDEX IF EXISTS public.idx_unified_persons_merged_into;
DROP INDEX IF EXISTS public.idx_unified_persons_company_status;

ALTER TABLE public.unified_persons DROP COLUMN IF EXISTS merged_into_id;
ALTER TABLE public.unified_persons DROP COLUMN IF EXISTS status;

-- Postcondition: the spine is back to its pre-LI-4C shape and still populated.
DO $verify$
DECLARE
  v_cols INT;
  v_people INT;
BEGIN
  SELECT count(*) INTO v_cols FROM pg_attribute
   WHERE attrelid='public.unified_persons'::regclass AND NOT attisdropped
     AND attname IN ('status', 'merged_into_id');
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'LI-4C rollback: lifecycle columns still present (%)', v_cols;
  END IF;

  IF to_regclass('public.person_duplicate_candidates') IS NOT NULL THEN
    RAISE EXCEPTION 'LI-4C rollback: person_duplicate_candidates still present';
  END IF;

  SELECT count(*) INTO v_people FROM public.unified_persons;
  RAISE NOTICE 'LI-4C rolled back: lifecycle columns and candidate queue removed, % person(s) intact.', v_people;
END
$verify$;

COMMIT;
