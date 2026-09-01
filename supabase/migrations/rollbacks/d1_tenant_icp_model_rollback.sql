-- ROLLBACK for 20261012000000_d1_tenant_icp_model.sql
--
-- ############################################################################
-- #  DESTRUCTIVE — THIS DESTROYS RATIFIED DEFINITIONS OF A TENANT'S ICP      #
-- ############################################################################
--
-- What is lost is not a cache and not a derived artefact. A ratified ICP
-- version is a STATEMENT A PERSON MADE, under a capability grant, recorded with
-- their user id and the moment they made it. Contract 16 exists precisely
-- because that statement is the only thing standing between a model's opinion
-- and a platform fact. Dropping these tables erases:
--
--   * every ratified version, and the identity of the human who ratified it;
--   * the superseded chain, which is the only record of how a tenant's
--     definition of a good customer changed over time;
--   * every draft and proposal awaiting review.
--
-- There is NO second copy. `company_profiles.ideal_customer_profile` is free
-- text written by a different surface for a different purpose; it is not a
-- backup of this, and nothing reconstructs criteria from it.
--
-- ─── THE FAILURE MODE IS SILENT, AND IT IS SAFE ──────────────────────────
-- Unusually for this programme, the immediate consequence of running this is
-- NOT a wrong answer. Contract 18 makes "no ratified ICP" mean ABSTAIN: the
-- evaluator emits no contribution at all, `combineDimension` reports
-- `abstained: true`, and the ICP dimension simply disappears from scoring. So
-- the platform will not start scoring leads against a fabricated profile — it
-- will stop scoring them against any profile, without complaint.
--
-- That is the danger. Nothing will page anyone. Scores will shift, explanations
-- will quietly stop citing an ICP, and the cause will be invisible unless
-- someone remembers this ran.
--
-- BEFORE RUNNING, measure exactly what will be destroyed:
--
--   SELECT status, count(*)
--     FROM public.prospect_icp_versions GROUP BY 1 ORDER BY 2 DESC;
--
--   SELECT count(DISTINCT organization_id) AS tenants_losing_a_live_icp
--     FROM public.prospect_icp_versions WHERE status = 'ratified';
--
--   SELECT count(DISTINCT ratified_by) AS people_whose_decision_is_erased
--     FROM public.prospect_icp_versions WHERE ratified_by IS NOT NULL;
--
-- If the first figure is greater than zero, this rollback should almost
-- certainly not run; prefer fixing forward. Re-ratification is not a migration
-- step — it requires each tenant's admin to make the decision again.
--
-- To keep the data and only disable the surface, do NOT run this: withhold the
-- `prospect.icp.manage` grant instead, or leave the tables in place. They are
-- inert on their own; nothing reads them unless a caller asks.
--
-- This is cheap ONLY while both tables are empty — their state on arrival, and
-- until the first tenant ratifies.

BEGIN;

DO $guard$
DECLARE
  v_ack        TEXT := current_setting('d1.confirm_drop_prospect_icp', true);
  v_icps       BIGINT := 0;
  v_versions   BIGINT := 0;
  v_ratified   BIGINT := 0;
  v_superseded BIGINT := 0;
  v_tenants    BIGINT := 0;
BEGIN
  IF v_ack IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'D1 rollback refused. Dropping these tables DESTROYS every ratified Ideal '
      'Customer Profile and the record of who ratified it. There is no second copy, '
      'and the resulting failure is SILENT: scoring abstains rather than erroring. '
      'To proceed deliberately: '
      'SET LOCAL "d1.confirm_drop_prospect_icp" = ''yes'';';
  END IF;

  IF to_regclass('public.prospect_icps') IS NOT NULL THEN
    SELECT count(*) INTO v_icps FROM public.prospect_icps;
  END IF;

  IF to_regclass('public.prospect_icp_versions') IS NOT NULL THEN
    SELECT count(*) INTO v_versions   FROM public.prospect_icp_versions;
    SELECT count(*) INTO v_ratified   FROM public.prospect_icp_versions WHERE status = 'ratified';
    SELECT count(*) INTO v_superseded FROM public.prospect_icp_versions WHERE status = 'superseded';
    SELECT count(DISTINCT organization_id) INTO v_tenants
      FROM public.prospect_icp_versions WHERE status = 'ratified';
  END IF;

  IF v_ratified > 0 THEN
    RAISE WARNING 'D1 ROLLBACK: % tenant(s) will lose their LIVE ratified ICP. Scoring will ABSTAIN silently, not error.', v_tenants;
  END IF;
  IF v_superseded > 0 THEN
    RAISE WARNING 'D1 ROLLBACK: % superseded version(s) will be lost — the entire history of how these definitions changed.', v_superseded;
  END IF;
  RAISE WARNING 'D1 ROLLBACK: destroying % ICP object(s) and % version(s) in total.', v_icps, v_versions;
END
$guard$;

-- Order matters only for clarity: the composite FK from versions to icps is
-- ON DELETE CASCADE, and CASCADE on the DROP would handle it either way.
DROP TABLE IF EXISTS public.prospect_icp_versions;
DROP TABLE IF EXISTS public.prospect_icps;

-- The trigger dies with its table; the function does not, so it is removed
-- explicitly. Leaving it behind would be a dangling reference to a table that
-- no longer exists, and would make a later re-application of the migration
-- non-obvious to read.
DROP FUNCTION IF EXISTS public.prospect_icp_versions_guard_immutable();

-- Nothing else is touched. `companies`, `company_profiles`, the W1/W4 identity
-- spine, LI-1 attributes, LI-2 evidence and `personaIcp.ts` are all unaffected:
-- the ICP model was purely additive and nothing outside it took a dependency.
--
-- NOT removed here, deliberately: the `prospect.icp.manage` capability. It is a
-- code constant in shared/contracts/security/SecurityCapabilities.ts, not a
-- database object, and reverting it is a code revert. Granting a capability
-- whose surface does not exist authorises nothing.

COMMIT;
