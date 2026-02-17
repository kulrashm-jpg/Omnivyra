-- Stage 37 — Auto-optimization toggle for campaigns
-- Add auto_optimize_enabled column (default false)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS auto_optimize_enabled BOOLEAN DEFAULT false;
