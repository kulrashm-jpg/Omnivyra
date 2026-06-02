-- ============================================================
-- Creator → Lead Attribution Extension
-- ============================================================
-- Carries the creator-side identifiers (asset / variant / strategy)
-- through the EXISTING attribution spine so a converted lead can be
-- traced back not just to a campaign/platform/page, but to the exact
-- generated asset, A/B variant, and creator strategy that produced it.
--
-- This migration is purely ADDITIVE. It adds three nullable columns
-- to two already-existing tables (lead_attributions, campaign_touchpoints
-- — both defined in 20260677_website_intelligence_foundation_phase1.sql).
-- No existing column, constraint, index, or RLS policy is altered.
-- Every existing INSERT (which omits these columns) keeps working
-- unchanged because the columns are NULLable with no default.
--
-- Column shape rationale:
--   * TEXT (not UUID, no FK) — mirrors how utm_campaign already stores
--     a campaign UUID as text. The values arrive as string URL params
--     (omn_asset_id / omn_variant_id / omn_strategy_id) and variant_id
--     is free-form (the variant experiment tracker is not a DB table).
--     Avoiding an FK keeps the best-effort attribution inserts from
--     ever hard-failing on an unknown/test id — attribution must never
--     block lead creation.
--
-- Hard requirement from the implementation spec:
--   "Do NOT redesign attribution. Extend the existing attribution spine."
--
-- Idempotent via IF NOT EXISTS. Safe to apply to a partially-applied DB.
-- ============================================================

-- ─── lead_attributions: capture-time snapshot on the converted lead ──
ALTER TABLE public.lead_attributions
  ADD COLUMN IF NOT EXISTS asset_id            TEXT NULL,
  ADD COLUMN IF NOT EXISTS variant_id          TEXT NULL,
  ADD COLUMN IF NOT EXISTS creator_strategy_id TEXT NULL;

-- ─── campaign_touchpoints: per-touch trail across the journey ────────
ALTER TABLE public.campaign_touchpoints
  ADD COLUMN IF NOT EXISTS asset_id            TEXT NULL,
  ADD COLUMN IF NOT EXISTS variant_id          TEXT NULL,
  ADD COLUMN IF NOT EXISTS creator_strategy_id TEXT NULL;

-- ─── Reporting indexes ───────────────────────────────────────────────
-- Support getLeadsByStrategy / getLeadsByVariant / getLeadsByAsset:
-- partial indexes (WHERE col IS NOT NULL) so they cost nothing for the
-- overwhelming majority of legacy rows that have no creator id.
CREATE INDEX IF NOT EXISTS idx_lead_attributions_strategy
  ON public.lead_attributions (company_id, creator_strategy_id, created_at DESC)
  WHERE creator_strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_attributions_variant
  ON public.lead_attributions (company_id, variant_id, created_at DESC)
  WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_attributions_asset
  ON public.lead_attributions (company_id, asset_id, created_at DESC)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_strategy
  ON public.campaign_touchpoints (company_id, creator_strategy_id, touched_at DESC)
  WHERE creator_strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_variant
  ON public.campaign_touchpoints (company_id, variant_id, touched_at DESC)
  WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_asset
  ON public.campaign_touchpoints (company_id, asset_id, touched_at DESC)
  WHERE asset_id IS NOT NULL;

COMMENT ON COLUMN public.lead_attributions.asset_id IS
  'Creator content asset id (content_assets.asset_id) carried via the omn_asset_id link param. Nullable; legacy/non-creator leads have none.';
COMMENT ON COLUMN public.lead_attributions.variant_id IS
  'A/B variant id carried via the omn_variant_id link param. Free-form text (variant experiment tracker is not a DB table). Nullable.';
COMMENT ON COLUMN public.lead_attributions.creator_strategy_id IS
  'Creator strategy id carried via the omn_strategy_id link param. Nullable; mirrors bolt_failure_summary.strategy_id semantics (best-effort).';
COMMENT ON COLUMN public.campaign_touchpoints.asset_id IS
  'Creator content asset id for this touch, carried from the visit attribution. Nullable.';
COMMENT ON COLUMN public.campaign_touchpoints.variant_id IS
  'A/B variant id for this touch, carried from the visit attribution. Nullable.';
COMMENT ON COLUMN public.campaign_touchpoints.creator_strategy_id IS
  'Creator strategy id for this touch, carried from the visit attribution. Nullable.';
