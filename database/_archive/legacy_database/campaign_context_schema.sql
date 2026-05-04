-- Campaign Context Schema
-- Stores per-campaign context snapshot (at plan time) + memory (post execution).
-- Additive only — no changes to existing tables.
--
-- context_snapshot: account state + validation + paid decision captured at finalize
-- memory: performance insights written after execution begins
--
-- Upsert-safe: unique constraint on campaign_id, updated_at refreshed on conflict.

CREATE TABLE IF NOT EXISTS campaign_context (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key — cascade delete when campaign is deleted
  campaign_id         UUID        NOT NULL UNIQUE,
  -- Denormalized for efficient company-level lookups (avoids JOIN on campaigns table)
  company_id          UUID        NOT NULL,

  -- ── Context snapshot (written at planner-finalize time) ──────────────────
  -- Account state at the moment the campaign was created
  account_context     JSONB,
  -- CampaignValidation output from validateCampaignPlan()
  validation          JSONB,
  -- PaidRecommendation output from generatePaidRecommendation()
  paid_recommendation JSONB,
  -- When the snapshot was captured
  context_created_at  TIMESTAMPTZ,

  -- ── Campaign memory (written after execution begins) ─────────────────────
  -- PerformanceInsight output from analyzeCampaignPerformance()
  performance_insights JSONB,
  -- When insights were last refreshed
  memory_updated_at   TIMESTAMPTZ,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: most recent completed campaign for a company (used when seeding new plan)
CREATE INDEX IF NOT EXISTS idx_campaign_context_company
  ON campaign_context (company_id, context_created_at DESC);

-- Fast lookup: fetch context for a specific campaign
CREATE INDEX IF NOT EXISTS idx_campaign_context_campaign
  ON campaign_context (campaign_id);

-- Auto-refresh updated_at on row change
CREATE OR REPLACE FUNCTION update_campaign_context_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_context_updated_at ON campaign_context;
CREATE TRIGGER trg_campaign_context_updated_at
  BEFORE UPDATE ON campaign_context
  FOR EACH ROW EXECUTE FUNCTION update_campaign_context_updated_at();
