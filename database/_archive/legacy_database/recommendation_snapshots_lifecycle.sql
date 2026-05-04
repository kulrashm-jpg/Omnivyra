-- Backward-compatible: add lifecycle fields for user-initiated, multi-region recommendations.
-- Run in Supabase SQL editor or your migration pipeline.

ALTER TABLE recommendation_snapshots
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS regions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_signals_count INTEGER,
  ADD COLUMN IF NOT EXISTS signals_source TEXT;

-- Optional: allow 'manual' and keep existing refresh_source CHECK or extend it
-- (existing: manual, auto_weekly, profile_update; no change needed for status)
