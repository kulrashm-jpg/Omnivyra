-- External Video Asset — additive sidecar (HUMAN-PRODUCTION ONLY)
--
-- Omnivyra does NOT generate video. This registers an EXTERNALLY
-- produced video (uploaded file or pasted URL) into the SAME shared-
-- media lineage the image/shared-asset system already uses, so the
-- existing inheritance / override / finalize pipeline (shared-asset +
-- Steps 15/16) auto-propagates it across compatible platforms with
-- platform-native captions untouched.
--
-- PURE ADDITIVE. No AI rendering, no render queue, no scheduler change.
-- Immutable lineage (reuses raise_ledger_immutable). Decoupled logical
-- ids (no FK to unknown asset tables) → backward-compatible.
--
--   §1  content_external_video_asset   (IMMUTABLE external-video lineage)
--   §2  per-platform thumbnail override (additive column)
--   §3  indexes

------------------------------------------------------------------------------
-- §1  IMMUTABLE EXTERNAL VIDEO LINEAGE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_external_video_asset (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_core_id     text NOT NULL,
  asset_id            text NOT NULL,           -- shared-media lineage key
  external_video_url  text NOT NULL,
  thumbnail_url       text,
  duration_seconds    integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  aspect_ratio        text,                    -- '9:16' | '16:9' | '1:1' | …
  provider_type       text NOT NULL DEFAULT 'upload'
    CHECK (provider_type IN ('upload','youtube','vimeo','loom','external_cdn')),
  uploaded_by         uuid,
  organization_id     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- No duplicate external-video lineage rows for the same (core, asset).
  UNIQUE (content_core_id, asset_id)
);

DROP TRIGGER IF EXISTS content_external_video_immutable_update ON public.content_external_video_asset;
CREATE TRIGGER content_external_video_immutable_update
  BEFORE UPDATE ON public.content_external_video_asset
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS content_external_video_immutable_delete ON public.content_external_video_asset;
CREATE TRIGGER content_external_video_immutable_delete
  BEFORE DELETE ON public.content_external_video_asset
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §2  PER-PLATFORM THUMBNAIL OVERRIDE (additive; revert = drop the row)
------------------------------------------------------------------------------
ALTER TABLE public.content_asset_platform_override
  ADD COLUMN IF NOT EXISTS override_thumbnail_url text;

------------------------------------------------------------------------------
-- §3  INDEXES
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cev_core  ON public.content_external_video_asset(content_core_id);
CREATE INDEX IF NOT EXISTS idx_cev_asset ON public.content_external_video_asset(asset_id);
CREATE INDEX IF NOT EXISTS idx_cev_org   ON public.content_external_video_asset(organization_id, created_at DESC);
