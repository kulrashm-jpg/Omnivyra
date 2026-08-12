-- ROLLBACK — W0: Engagement Threads window columns.
-- Reverses supabase/migrations/20260917000000_engagement_threads_window_columns.sql
--
-- SAFETY
-- ------
-- The forward migration adds two columns and one index and writes no rows, so
-- at the moment of application this rollback has ZERO data-loss exposure:
-- every existing row carries window_open=FALSE (schema default) and
-- window_expires_at=NULL, which is exactly the state dropping the columns
-- returns them to.
--
-- That property is LOST the instant the WhatsApp inbound webhook processor
-- persists its first thread, because window_expires_at then holds an observed
-- messaging-window instant that exists nowhere else. Meta does not re-issue
-- it, and it cannot be recomputed from any other column — the originating
-- message timestamp is the only other trace, and only while the raw payload
-- survives. Dropping the column after that point destroys the only record of
-- whether a tenant was permitted to send a free-form reply.
--
-- The guard below therefore refuses to drop once any row carries a non-NULL
-- window_expires_at. Bypassing it is a deliberate, data-destroying act and
-- must be an explicit operator decision, not an incidental rollback.
--
-- Dropping the columns also drops idx_eng_threads_window implicitly; it is not
-- listed separately.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).
--
-- IMPORTANT: rolling this back re-breaks GET /api/engagement/threads for every
-- tenant (42703) and re-breaks WhatsApp inbound persistence. Roll back ONLY if
-- the forward migration itself caused a worse failure — otherwise the correct
-- remedy is to fix forward.

DO $$
DECLARE
  populated bigint;
BEGIN
  SELECT count(*) INTO populated
  FROM public.engagement_threads
  WHERE window_expires_at IS NOT NULL;

  IF populated > 0 THEN
    RAISE EXCEPTION
      'w0_rollback_refused: % engagement_threads row(s) carry an observed window_expires_at. Dropping these columns would destroy WhatsApp messaging-window evidence that cannot be reconstructed. Resolve deliberately before rolling back.',
      populated
      USING ERRCODE = 'restrict_violation';
  END IF;
END $$;

ALTER TABLE public.engagement_threads
  DROP COLUMN IF EXISTS window_open,
  DROP COLUMN IF EXISTS window_expires_at;
