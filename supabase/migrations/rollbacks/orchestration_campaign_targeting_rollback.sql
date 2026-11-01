-- ROLLBACK for 20261231000000_orchestration_campaign_targeting.sql
--
-- ############################################################################
-- #  WARNING — THIS DELETES CAMPAIGN SELECTION HISTORY                        #
-- ############################################################################
--
-- Dropping prospect_campaign_targets destroys every recorded selection fact,
-- and dropping the execution_instances target FK re-opens the gap 20261228000000
-- deferred: an instance could then name a target that does not exist.
--
-- BEFORE RUNNING, confirm nothing depends on it:
--   SELECT count(*) FROM public.prospect_campaign_targets;
--   SELECT count(*) FROM public.execution_instances WHERE target_id IS NOT NULL;
-- The guard below refuses while any instance references a target.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.execution_instances') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.execution_instances WHERE target_id IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: execution instances reference campaign targets';
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.execution_instances DROP CONSTRAINT IF EXISTS execution_instances_target_tenant_fk;

DROP TABLE IF EXISTS public.prospect_campaign_targets;
DROP FUNCTION IF EXISTS public.prospect_campaign_targets_guard();
DROP TABLE IF EXISTS public.prospect_campaign_lists;

DROP TRIGGER IF EXISTS trg_prospect_campaigns_targeting_guard ON public.prospect_campaigns;
DROP FUNCTION IF EXISTS public.prospect_campaigns_targeting_guard();
ALTER TABLE IF EXISTS public.prospect_campaigns
  DROP CONSTRAINT IF EXISTS prospect_campaigns_icp_version_tenant_fk,
  DROP CONSTRAINT IF EXISTS prospect_campaigns_min_icp_score_range,
  DROP CONSTRAINT IF EXISTS prospect_campaigns_targeting_coherent,
  DROP CONSTRAINT IF EXISTS prospect_campaigns_targeting_mode_valid,
  DROP COLUMN IF EXISTS min_icp_score,
  DROP COLUMN IF EXISTS icp_version,
  DROP COLUMN IF EXISTS icp_id,
  DROP COLUMN IF EXISTS targeting_mode;

ALTER TABLE IF EXISTS public.prospect_lists
  DROP CONSTRAINT IF EXISTS prospect_lists_icp_tenant_fk,
  DROP COLUMN IF EXISTS icp_id;

COMMIT;
