-- ROLLBACK for 20261231000003_community_journey_link.sql
--
-- Dropping community_action_journey_links forgets which community action each
-- journey step executes. A step whose request was already claimed would then
-- resolve no binding, and its executed action could no longer be attributed to
-- the journey. The guard below therefore REFUSES while any link exists.
--
-- BEFORE RUNNING, confirm nothing depends on it:
--   SELECT count(*) FROM public.community_action_journey_links;

-- ROLLBACK ORDER for the 20261231 chain (verified on real PostgreSQL 2026-10-28):
--   0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000
-- Refuses while 20261231000006 (which evolves this table: person columns and
-- the identity guard) is installed: roll back 20261231000007, then
-- 20261231000006, first. Otherwise their functions would be left orphaned.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.community_action_journey_links_identity_guard()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'community_action_journey_links'
                   AND column_name IN ('person_id', 'identity_claim_id')) THEN
    RAISE EXCEPTION 'rollback refused: 20261231000006 (community identity link) is still installed and evolves this table; roll back 20261231000007 and 20261231000006 first';
  END IF;
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
