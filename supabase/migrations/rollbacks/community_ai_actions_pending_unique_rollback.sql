-- Rollback of 20270217000008_community_ai_actions_pending_unique.sql.
-- The code tolerates the index's absence (it only reads 23505 as "already pending"), so the order
-- does not matter; without the index, concurrent writers can again create duplicate pending rows.
-- SOUND TO DROP: the apply's preflight refuses any pre-existing object of this name that is not
-- exactly this index, so the only index this can remove is the one the migration created (or an
-- identical one from a re-apply). It removes no data.
BEGIN;
DROP INDEX IF EXISTS public.community_ai_actions_one_pending;
DO $verify$
BEGIN
  IF to_regclass('public.community_ai_actions_one_pending') IS NOT NULL THEN
    RAISE EXCEPTION 'CAPU rollback postcondition: the index must be gone';
  END IF;
END
$verify$;
COMMIT;
