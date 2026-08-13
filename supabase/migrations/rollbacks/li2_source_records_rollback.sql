-- ROLLBACK for 20261002000000_li2_source_records.sql
--
-- ############################################################################
-- #  DESTRUCTIVE — THIS DESTROYS THE ONLY COPY OF SOURCE EVIDENCE            #
-- ############################################################################
--
-- `source_records` and `source_assertions` ARE the second copy. Everything else
-- in the platform holds a canonical value; these two hold what the providers
-- actually said, including the assertions that LOST. Dropping them does not
-- degrade the system to its previous state — it erases the evidence that made
-- a canonical value defensible, and there is nowhere else to recover it from.
--
-- Consequences, concretely:
--   - every competing assertion (Apollo said X, LinkedIn said Y) is gone
--   - `applied_reason` — why a canonical value was chosen — is gone
--   - the raw provider payloads are gone; re-ingestion means re-paying for them
--   - LI-1's `attributes_source` survives, but it only names a source for the
--     whole block; it cannot reconstruct any of the above
--
-- The canonical spine is NOT affected: unified_persons and prospect_accounts
-- keep every attribute value. What is lost is the ability to explain them.
--
-- BEFORE RUNNING, measure what you are destroying:
--
--   SELECT count(*) FROM public.source_records;
--   SELECT count(*) FROM public.source_assertions;
--   SELECT count(*) FROM public.source_assertions WHERE applied_to_canonical_at IS NOT NULL;
--   SELECT attribute, count(DISTINCT value_hash) FROM public.source_assertions
--    WHERE superseded_at IS NULL GROUP BY 1 HAVING count(DISTINCT value_hash) > 1;
--
-- The last query lists attributes where sources currently DISAGREE. Every one
-- of those conflicts is unrecoverable after this runs.
--
-- This is cheap only while both tables are empty, which is their state on
-- arrival and until LI-7 activates a provider.

BEGIN;

DO $guard$
DECLARE
  v_ack     TEXT := current_setting('li2.confirm_drop_source_evidence', true);
  v_records BIGINT;
  v_assert  BIGINT;
  v_applied BIGINT;
BEGIN
  IF v_ack IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'LI-2 rollback refused. Dropping these tables DESTROYS all source evidence and '
      'every competing provider assertion, with no second copy anywhere. '
      'To proceed deliberately: SET LOCAL "li2.confirm_drop_source_evidence" = ''yes'';';
  END IF;

  SELECT count(*) INTO v_records FROM public.source_records;
  SELECT count(*) INTO v_assert  FROM public.source_assertions;
  SELECT count(*) INTO v_applied FROM public.source_assertions WHERE applied_to_canonical_at IS NOT NULL;

  IF v_records > 0 OR v_assert > 0 THEN
    RAISE WARNING 'LI-2 ROLLBACK: destroying % source record(s) and % assertion(s), of which % justify a live canonical value.',
      v_records, v_assert, v_applied;
  END IF;
END
$guard$;

-- Dependency order: assertions reference records.
DROP TABLE IF EXISTS public.source_assertions;
DROP TABLE IF EXISTS public.source_records;

-- Nothing else is touched. The canonical spine, identity resolution,
-- identity_claims, the W5 composite keys and the LI-1 attribute columns are all
-- untouched by this rollback — only the ability to explain them is removed.

COMMIT;
