-- Add feature_area column to usage_events for product-area cost attribution.
-- Maps raw process_type operation names to user-facing product areas
-- (e.g. generateDailyPlan → 'Daily Plan', generateRecommendation → 'Recommendations').

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS feature_area text;

CREATE INDEX IF NOT EXISTS idx_usage_events_feature_area
  ON usage_events (organization_id, feature_area, created_at DESC)
  WHERE feature_area IS NOT NULL;

COMMENT ON COLUMN usage_events.feature_area IS
  'User-facing product area label (e.g. Campaign Planning, Daily Plan, Recommendations). '
  'Derived from process_type at write time by aiGateway.ts.';
