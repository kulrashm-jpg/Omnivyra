-- Rollback for 20270207000002_extension_v15_delivery_path.sql.
--
-- Drops the trigger, both functions, the CHECK and the column. After this the 1.4
-- route no longer skips v15 LinkedIn writes for other users (U1 returns), and the
-- v15 route offers nothing (its filter on delivery_path errors and fails closed).
-- Roll the application back first, or accept that window. Re-runnable.

BEGIN;

DROP TRIGGER IF EXISTS community_ai_actions_delivery_path ON public.community_ai_actions;
DROP FUNCTION IF EXISTS public.community_ai_actions_set_delivery_path();
DROP FUNCTION IF EXISTS public.community_ai_action_v15_delivery_path(uuid, text, text, text);
ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_delivery_path_check;
ALTER TABLE public.community_ai_actions DROP COLUMN IF EXISTS delivery_path;

COMMIT;
