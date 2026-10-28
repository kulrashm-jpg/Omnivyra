-- ===========================================================================
-- ROLLBACK for 20261231000006_community_identity_link.sql
--
-- Refuses while any link exists: every link made under 20261231000006 depends on
-- the person proof this removes, and removing it would leave links that a
-- pre-20261231000006 adapter would execute without proving the person. An
-- operator must first decide what happens to those links (each is immutable;
-- remove it with DELETE once its step no longer needs it).
--
-- Drops ONLY what 20261231000006 added. community_action_journey_links itself,
-- its 20261231000003 guard and every other table are left as they are.
-- ===========================================================================

DO $$
BEGIN
  IF to_regclass('public.community_action_journey_links') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.community_action_journey_links) THEN
    RAISE EXCEPTION 'rollback refused: community_action_journey_links has rows whose person proof depends on 20261231000006';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_community_action_journey_links_identity_guard ON public.community_action_journey_links;
DROP FUNCTION IF EXISTS public.community_action_journey_links_identity_guard();
DROP FUNCTION IF EXISTS public.community_identity_normalize_external_id(text);
DROP INDEX IF EXISTS public.ix_community_action_journey_links_person;
ALTER TABLE IF EXISTS public.community_action_journey_links
  DROP CONSTRAINT IF EXISTS community_action_journey_links_person_fk;
ALTER TABLE IF EXISTS public.community_action_journey_links DROP COLUMN IF EXISTS identity_claim_id;
ALTER TABLE IF EXISTS public.community_action_journey_links DROP COLUMN IF EXISTS person_id;
