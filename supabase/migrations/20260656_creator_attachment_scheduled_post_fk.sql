-- ──────────────────────────────────────────────────────────────────────────
-- Add `scheduled_post_id` FK column on `daily_content_plans` for attachment-
-- required creator rows.
--
-- Why:
--   The attachment-required lifecycle (video / reel / short / podcast)
--   stores its `scheduled_post_id` inside the `content` JSON. The publish-
--   failure rollback path in `backend/services/publishNowService.ts`
--   currently scans rows heuristically (filter by content_status='scheduled'
--   and parse JSON). That works but is O(N) and can miss rows when the
--   queue fires for a post not in the recent N scanned.
--
--   This migration tightens the linkage with a real FK column + backfill +
--   index, so `markAttachmentRowPublishFailed` becomes a precise lookup.
--
-- Compatibility:
--   - Nullable column → existing autonomous rows (which don't go through
--     the upload lifecycle) keep working unchanged.
--   - `ON DELETE SET NULL` so a deleted scheduled_post doesn't cascade
--     into the daily plan row.
--   - Backfill ONLY for rows whose `content.scheduled_post_id` exists
--     AND references a real scheduled_posts row.
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Add the column if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'scheduled_post_id'
  ) THEN
    ALTER TABLE public.daily_content_plans
      ADD COLUMN scheduled_post_id UUID;
    RAISE NOTICE 'Added daily_content_plans.scheduled_post_id';
  END IF;
END$$;

-- 2. Backfill: pull `content.scheduled_post_id` from JSON content and
-- populate the column. Only when:
--   - content is JSON-parseable (we guard with `jsonb_typeof`)
--   - the value is a valid UUID
--   - the target scheduled_posts row still exists
DO $$
BEGIN
  WITH parsed AS (
    SELECT
      dcp.id AS dcp_id,
      CASE
        WHEN dcp.content IS NULL THEN NULL
        WHEN jsonb_typeof(dcp.content) IS NULL THEN NULL
        ELSE (dcp.content->>'scheduled_post_id')
      END AS sp_id_text
    FROM public.daily_content_plans dcp
    WHERE dcp.scheduled_post_id IS NULL
  ),
  filtered AS (
    SELECT
      p.dcp_id,
      p.sp_id_text::UUID AS sp_id
    FROM parsed p
    WHERE p.sp_id_text IS NOT NULL
      AND p.sp_id_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  UPDATE public.daily_content_plans dcp
  SET scheduled_post_id = f.sp_id
  FROM filtered f
  JOIN public.scheduled_posts sp ON sp.id = f.sp_id
  WHERE dcp.id = f.dcp_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Backfill skipped due to error: %', SQLERRM;
END$$;

-- 3. Add the FK constraint (ON DELETE SET NULL) if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND constraint_name = 'daily_content_plans_scheduled_post_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.daily_content_plans
        ADD CONSTRAINT daily_content_plans_scheduled_post_id_fkey
        FOREIGN KEY (scheduled_post_id)
        REFERENCES public.scheduled_posts(id)
        ON DELETE SET NULL;
      RAISE NOTICE 'Added FK daily_content_plans_scheduled_post_id_fkey';
    EXCEPTION WHEN OTHERS THEN
      -- If FK creation fails (e.g. lingering orphan IDs), null them out
      -- and retry. Better to land the column with a clean FK than to
      -- block the migration entirely.
      UPDATE public.daily_content_plans dcp
      SET scheduled_post_id = NULL
      WHERE dcp.scheduled_post_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.scheduled_posts sp WHERE sp.id = dcp.scheduled_post_id
        );
      ALTER TABLE public.daily_content_plans
        ADD CONSTRAINT daily_content_plans_scheduled_post_id_fkey
        FOREIGN KEY (scheduled_post_id)
        REFERENCES public.scheduled_posts(id)
        ON DELETE SET NULL;
      RAISE NOTICE 'Added FK daily_content_plans_scheduled_post_id_fkey (after orphan cleanup)';
    END;
  END IF;
END$$;

-- 4. Index for FK lookups (publish failure rollback hot path).
CREATE INDEX IF NOT EXISTS idx_daily_content_plans_scheduled_post_id
  ON public.daily_content_plans(scheduled_post_id)
  WHERE scheduled_post_id IS NOT NULL;

COMMENT ON COLUMN public.daily_content_plans.scheduled_post_id IS
  'Direct FK to scheduled_posts(id) for attachment-required creator rows. Set by the scheduler when the row enters `scheduled` state; null for autonomous rows or rows that have never been scheduled.';
