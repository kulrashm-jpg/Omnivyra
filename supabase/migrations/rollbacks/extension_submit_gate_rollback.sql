-- Rollback for 20270207000001_extension_submit_gate.sql.
--
-- Drops the submit gate and restores the original extension_commands CHECKs. The
-- CHECK restore is valid only while no row uses a 1.5 value: if any does, this
-- RAISEs and changes nothing (export or remove those rows first). Re-runnable.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.extension_commands
              WHERE action_type IN ('li.collect.own_post_comments', 'li.collect.own_inbox', 'li.salesnav.capture_saved_leads')
                 OR status IN ('dispatched', 'completed', 'refused', 'uncertain')) THEN
    RAISE EXCEPTION 'extension submit gate rollback: extension_commands holds 1.5 rows; the original CHECKs cannot be restored';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.authorize_extension_submit(uuid, uuid, text, text, uuid, text, text);

ALTER TABLE public.extension_commands DROP CONSTRAINT IF EXISTS extension_commands_action_type_check;
ALTER TABLE public.extension_commands ADD CONSTRAINT extension_commands_action_type_check
  CHECK (action_type = ANY (ARRAY['post_reply', 'like', 'follow', 'share', 'dm_reply', 'save']));
ALTER TABLE public.extension_commands DROP CONSTRAINT IF EXISTS extension_commands_status_check;
ALTER TABLE public.extension_commands ADD CONSTRAINT extension_commands_status_check
  CHECK (status = ANY (ARRAY['pending', 'executing', 'success', 'failed', 'cancelled']));

COMMIT;
