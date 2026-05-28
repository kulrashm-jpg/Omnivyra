  -- 20260808_thread_publish_states.sql
  --
  -- Phase 1B.2.1 — extend chk_status with 'blocked' to support thread-publish
  -- failure isolation.
  --
  -- BACKGROUND
  -- ─────────
  -- The 1B.2 thread orchestrator publishes a multi-row thread by walking
  -- root → children in thread_position order. When a node fails to publish,
  -- the orchestrator marks all downstream siblings 'blocked' (NOT 'failed' and
  -- NOT left at 'draft') so:
  --   1. The cron's status='scheduled' filter never picks them up
  --   2. The post-publish UI can distinguish "siblings of a failed node" from
  --      "rows the user manually paused" (cancelled) or "rows that themselves
  --      failed at the platform" (failed)
  --   3. Resume-from-failed semantics know which rows to retry vs. which to
  --      leave PUBLISHED untouched
  --
  -- CURRENT chk_status (from comprehensive-scheduling-schema.sql:720):
  --   ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')
  --
  -- AFTER THIS MIGRATION:
  --   ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'blocked')
  --
  -- RISK ANALYSIS
  -- ─────────────
  -- - Pure additive change to the CHECK constraint allowed-set.
  -- - ZERO existing rows can violate (no row has status='blocked' today).
  -- - The constraint is DROP + CREATE in one transaction; brief window where
  --   no constraint exists, but the new value is invalid anywhere else so no
  --   write could inject a bad value during the gap.
  -- - Reversible:
  --     ALTER TABLE scheduled_posts DROP CONSTRAINT chk_status;
  --     ALTER TABLE scheduled_posts ADD CONSTRAINT chk_status CHECK (
  --       status IN ('draft', 'scheduled', 'publishing', 'published',
  --                  'failed', 'cancelled')
  --     );
  --   (Only safe if no rows have status='blocked' at rollback time.)
  -- - Idempotent: re-applying the migration drops and re-creates with the
  --   same allowed-set.

  DO $$
  BEGIN
    -- Drop the existing chk_status if present.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_status') THEN
      ALTER TABLE scheduled_posts DROP CONSTRAINT chk_status;
      RAISE NOTICE 'Dropped existing chk_status constraint';
    END IF;

    -- Re-add with the extended set including 'blocked'.
    ALTER TABLE scheduled_posts
      ADD CONSTRAINT chk_status CHECK (
        status IN (
          'draft',
          'scheduled',
          'publishing',
          'published',
          'failed',
          'cancelled',
          'blocked'
        )
      );
    RAISE NOTICE 'Recreated chk_status with blocked included';
  END $$;
