-- Shared Creator Media Asset Inheritance — additive sidecar
--
-- PURE ADDITIVE. Lets ONE Creator media asset (image/video/thumbnail/
-- infographic) belong to a CONTENT CORE and propagate across all
-- compatible platform variants, while platform-native TEXT
-- (captions/hashtags/CTA/metadata) stays untouched (BOLT Text + Step-6
-- packaging are NOT modified anywhere).
--
-- Scheduler isolation: nothing here is read by the scheduler. The
-- planning/workspace layer RESOLVES inheritance and writes the finalized
-- per-platform media_url into the EXISTING content channel the scheduler
-- already consumes (content.uploaded_media_url → scheduled_posts.media_urls).
--
-- Reuses existing conventions: raise_ledger_immutable (immutable
-- lineage), omnivyra_touch_updated_at (mutable side state). No FK to
-- unknown asset tables — content_core_id / asset_id are logical text ids
-- (decoupled, backward-compatible).
--
-- Sections:
--   §1  content_core_asset            (IMMUTABLE asset↔content-core lineage)
--   §2  content_asset_attachment      (mutable attachment + inheritance)
--   §3  content_asset_platform_override (mutable per-platform override/revert)
--   §4  indexes

------------------------------------------------------------------------------
-- §1  IMMUTABLE ASSET ↔ CONTENT-CORE LINEAGE
------------------------------------------------------------------------------
-- The asset belongs to the CONTENT CORE, never to a platform text
-- variant. `content_spec_hash` is the Step-R0 deterministic hash of the
-- visual/storyboard core — it is the render-reuse identity (same hash ⇒
-- the SAME rendered media may be reused; differing ⇒ a NEW render).
CREATE TABLE IF NOT EXISTS public.content_core_asset (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_core_id        text NOT NULL,
  asset_id               text NOT NULL,
  asset_type             text NOT NULL,
  canonical_asset_family text NOT NULL
    CHECK (canonical_asset_family IN ('image','carousel','video','post_with_asset')),
  content_spec_hash      text NOT NULL,
  organization_id        uuid,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- No duplicate media lineage rows for the same (core, asset).
  UNIQUE (content_core_id, asset_id)
);

DROP TRIGGER IF EXISTS content_core_asset_immutable_update ON public.content_core_asset;
CREATE TRIGGER content_core_asset_immutable_update
  BEFORE UPDATE ON public.content_core_asset
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS content_core_asset_immutable_delete ON public.content_core_asset;
CREATE TRIGGER content_core_asset_immutable_delete
  BEFORE DELETE ON public.content_core_asset
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §2  ATTACHMENT + INHERITANCE (mutable operational state)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_asset_attachment (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_core_id       text NOT NULL,
  asset_id              text NOT NULL,
  attachment_role       text NOT NULL DEFAULT 'primary'
    CHECK (attachment_role IN ('primary','thumbnail','infographic','alt','derivative')),
  -- platforms that currently inherit this shared asset (normalized keys)
  inherited_by_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default_selected   boolean NOT NULL DEFAULT true,
  -- 'inherit_all' (default) | 'manual' (per-platform only) | 'locked'
  override_policy       text NOT NULL DEFAULT 'inherit_all'
    CHECK (override_policy IN ('inherit_all','manual','locked')),
  -- 'registry' (CreatorAssetRegistry decides) | 'strict' | 'lenient'
  compatibility_policy  text NOT NULL DEFAULT 'registry'
    CHECK (compatibility_policy IN ('registry','strict','lenient')),
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- one attachment per (core, asset, role); revert/override mutate this
  -- row's inheritance, never create duplicates.
  UNIQUE (content_core_id, asset_id, attachment_role)
);

DROP TRIGGER IF EXISTS trg_caa_attach_touch ON public.content_asset_attachment;
CREATE TRIGGER trg_caa_attach_touch
  BEFORE UPDATE ON public.content_asset_attachment
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

------------------------------------------------------------------------------
-- §3  PER-PLATFORM OVERRIDE / REVERT (mutable)
------------------------------------------------------------------------------
-- Absence of a row for (attachment, platform) ⇒ the platform INHERITS
-- the shared asset. A row records an explicit deviation; reverting =
-- deleting the row OR setting override_kind='inherited'. Both are
-- supported so "revert" is always lossless.
CREATE TABLE IF NOT EXISTS public.content_asset_platform_override (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id  uuid NOT NULL
    REFERENCES public.content_asset_attachment(id) ON DELETE CASCADE,
  platform       text NOT NULL,
  override_kind  text NOT NULL
    CHECK (override_kind IN ('inherited','disabled','replaced')),
  -- set only when override_kind='replaced'
  override_asset_id text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, platform)
);

DROP TRIGGER IF EXISTS trg_capo_touch ON public.content_asset_platform_override;
CREATE TRIGGER trg_capo_touch
  BEFORE UPDATE ON public.content_asset_platform_override
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

------------------------------------------------------------------------------
-- §4  INDEXES
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cca_core   ON public.content_core_asset(content_core_id);
CREATE INDEX IF NOT EXISTS idx_cca_asset  ON public.content_core_asset(asset_id);
CREATE INDEX IF NOT EXISTS idx_cca_hash   ON public.content_core_asset(content_spec_hash);
CREATE INDEX IF NOT EXISTS idx_cca_org    ON public.content_core_asset(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_caatt_core ON public.content_asset_attachment(content_core_id);
CREATE INDEX IF NOT EXISTS idx_caatt_asset ON public.content_asset_attachment(asset_id);

CREATE INDEX IF NOT EXISTS idx_capo_attach ON public.content_asset_platform_override(attachment_id);
CREATE INDEX IF NOT EXISTS idx_capo_platform ON public.content_asset_platform_override(attachment_id, platform);
