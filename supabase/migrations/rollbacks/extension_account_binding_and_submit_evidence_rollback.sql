-- Rollback for 20270207000000_extension_account_binding_and_submit_evidence.sql.
--
-- Drops the binding table and the four community_ai_actions columns. Destructive
-- for any binding or submit evidence recorded since the forward migration: run
-- only before 1.5.0 has served real traffic, or after exporting those rows.
-- Re-runnable.

BEGIN;

DROP TABLE IF EXISTS public.extension_account_bindings;

ALTER TABLE public.community_ai_actions
  DROP COLUMN IF EXISTS post_submit_evidence,
  DROP COLUMN IF EXISTS pre_submit_evidence,
  DROP COLUMN IF EXISTS acting_member_urn,
  DROP COLUMN IF EXISTS submit_attempted_at;

COMMIT;
