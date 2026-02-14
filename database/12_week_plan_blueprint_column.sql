-- Add blueprint JSONB column to 12_week_plan for canonical CampaignBlueprint storage.
-- Run in Supabase SQL Editor. Idempotent.
ALTER TABLE 12_week_plan ADD COLUMN IF NOT EXISTS blueprint JSONB;
