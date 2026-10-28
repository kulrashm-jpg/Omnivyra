-- ROLLBACK for 20261231000003_community_journey_link.sql
--
-- Dropping community_action_journey_links forgets which community action each
-- journey step executes. A step whose request was already claimed would then
-- resolve no binding, and its executed action could no longer be attributed to
-- the journey. The guard below therefore REFUSES while any link exists.
--
-- BEFORE RUNNING, confirm nothing depends on it:
--   SELECT count(*) FROM public.community_action_journey_links;

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.community_action_journey_links') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.community_action_journey_links) THEN
    RAISE EXCEPTION 'rollback refused: community journey links exist';
  END IF;
END
$$;

DROP TABLE IF EXISTS public.community_action_journey_links;
DROP FUNCTION IF EXISTS public.community_action_journey_links_guard();
-- The companion key existed only for the link's composite foreign key.
DROP INDEX IF EXISTS public.uq_community_ai_actions_id_org;

COMMIT;
