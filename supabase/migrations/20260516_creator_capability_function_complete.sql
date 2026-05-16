-- ============================================================
-- BOLT creator capability function — complete platform coverage
-- ------------------------------------------------------------
-- The original `is_valid_creator_platform_asset_combo` (migration
-- 20260422_creator_execution_reliability.sql) only enumerated five
-- platforms (linkedin, instagram, x, tiktok, pinterest). Any platform
-- outside that list fell through to `RETURN FALSE`, including
-- facebook and threads — both of which canonically support image,
-- carousel, and video creator content per
-- `lib/shared/social/platformCapabilities.ts`.
--
-- Result: BOLT Creator campaigns that included facebook (or threads)
-- with an image / carousel / video format hit
-- `daily_content_plans_creator_capability_check` at insert time and
-- the whole batch rolled back.
--
-- This `CREATE OR REPLACE` is non-destructive — it replaces the
-- function body in place without rewriting any rows or dropping
-- anything. The constraint itself is unchanged; it just gets the
-- expanded vocabulary on its next evaluation.
--
-- Canonical capability mapping (kept in sync with
-- platformCapabilities.ts PLATFORM_CAPABILITY_REGISTRY):
--   linkedin  : image, carousel, video
--   instagram : image, carousel, video, creator
--   facebook  : image, carousel, video        <-- added
--   threads   : image, video                  <-- added
--   x         : image, video
--   pinterest : image, carousel
--   tiktok    : video, creator
--   youtube   : video, creator
-- Plus `post_with_asset` and `thread_with_asset` continue as
-- platform-specific asset families.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_valid_creator_platform_asset_combo(
  p_intent_type TEXT,
  p_platform TEXT,
  p_asset_type TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_platform TEXT := lower(trim(coalesce(p_platform, '')));
BEGIN
  IF coalesce(p_intent_type, '') <> 'creator' THEN
    RETURN TRUE;
  END IF;
  IF normalized_platform = 'twitter' THEN
    normalized_platform := 'x';
  END IF;

  IF normalized_platform = 'linkedin' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'instagram' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'facebook' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'threads' THEN
    RETURN p_asset_type IN ('image', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'x' THEN
    RETURN p_asset_type IN ('image', 'video', 'thread_with_asset', 'post_with_asset');
  ELSIF normalized_platform = 'tiktok' THEN
    RETURN p_asset_type IN ('video');
  ELSIF normalized_platform = 'pinterest' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'post_with_asset');
  ELSIF normalized_platform = 'youtube' THEN
    RETURN p_asset_type IN ('video', 'post_with_asset');
  END IF;
  RETURN FALSE;
END;
$$;
