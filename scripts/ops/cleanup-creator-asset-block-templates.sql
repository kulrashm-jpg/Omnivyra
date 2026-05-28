-- ============================================================================
-- One-shot cleanup: remove historical block_templates rows that were created
-- by the OLD "Save As Asset" path in pages/command-center/creator-content/[type].tsx.
--
-- BACKGROUND
--   That handler used to write the saved creator asset to BOTH:
--     1. block_templates (with content_type='blog', tags including 'creator-asset')
--     2. creator_assets (the canonical creator-asset store)
--   The first write was a redundant copy that polluted the Blog Templates UI
--   at /blogs/template. The handler has been updated to write only to
--   creator_assets — but the historical block_templates rows remain.
--
-- WHAT THIS SCRIPT DELETES
--   block_templates rows that are ALL of:
--     - content_type = 'blog'
--     - 'creator-asset' is in the tags array
--     - is_default = false                    (preserve any system defaults)
--     - the matching creator_assets row exists (i.e., the asset itself
--       is safe in its canonical store before we drop the duplicate)
--
-- SAFETY
--   - Dry-run SELECT first to inspect what would be deleted (Step 1).
--   - Verify the row count is what you expect.
--   - THEN run the DELETE (Step 2). The DELETE is wrapped in a transaction
--     so you can ROLLBACK if the row count surprises you.
--   - No FK cascades to user-visible artifacts: block_templates is the
--     authoring side; deleting these does NOT touch blogs/posts that
--     ALREADY embedded the asset (those reference creator_assets directly).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 1: Preview — DRY RUN. Run this first.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT
  bt.id                       AS block_template_id,
  bt.company_id,
  bt.name,
  bt.format_type,
  bt.tags,
  bt.created_at,
  EXISTS (
    SELECT 1
    FROM creator_assets ca
    WHERE ca.company_id = bt.company_id
      AND (
        ca.block_template_id = bt.id
        OR ca.metadata->>'blockTemplateId' = bt.id::text
      )
  )                            AS has_canonical_creator_asset
FROM block_templates bt
WHERE bt.content_type = 'blog'
  AND 'creator-asset' = ANY(bt.tags)
  AND COALESCE(bt.is_default, false) = false
ORDER BY bt.created_at DESC;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 2: Delete — RUN ONLY AFTER REVIEWING THE STEP 1 OUTPUT.
--
-- This deletes block_templates rows that are tagged 'creator-asset' AND
-- have a matching row in creator_assets (so the asset still exists in
-- its canonical store). Rows WITHOUT a canonical creator_assets row are
-- intentionally left in place — they may be the only surviving copy
-- and need manual review.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH deletable AS (
  SELECT bt.id
  FROM block_templates bt
  WHERE bt.content_type = 'blog'
    AND 'creator-asset' = ANY(bt.tags)
    AND COALESCE(bt.is_default, false) = false
    AND EXISTS (
      SELECT 1
      FROM creator_assets ca
      WHERE ca.company_id = bt.company_id
        AND (
          ca.block_template_id = bt.id
          OR ca.metadata->>'blockTemplateId' = bt.id::text
        )
    )
)
DELETE FROM block_templates
WHERE id IN (SELECT id FROM deletable)
RETURNING id, name, company_id, format_type, created_at;

-- Inspect the RETURNING output. If the count matches your expectation
-- from Step 1 (and excludes rows with has_canonical_creator_asset=false),
-- run:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 3 (optional): Rows WITHOUT a canonical creator_assets row.
--
-- These were saved by the old handler before the dual-write was complete,
-- OR the creator_assets POST failed silently. Review each one manually
-- before deciding to delete or migrate.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT
  bt.id,
  bt.company_id,
  bt.name,
  bt.format_type,
  bt.description,
  bt.created_at
FROM block_templates bt
WHERE bt.content_type = 'blog'
  AND 'creator-asset' = ANY(bt.tags)
  AND COALESCE(bt.is_default, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM creator_assets ca
    WHERE ca.company_id = bt.company_id
      AND (
        ca.block_template_id = bt.id
        OR ca.metadata->>'blockTemplateId' = bt.id::text
      )
  )
ORDER BY bt.created_at DESC;
