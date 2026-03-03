-- Company-only context for recommendations (used when generating Trend/Lead recommendations for this company).
-- Content Architect (or admin) can set this per company; it is included in recommendation context next time onwards.
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS recommendation_context TEXT;

COMMENT ON COLUMN company_profiles.recommendation_context IS 'Optional context added for this company only; used when generating recommendations (Trend Campaigns, etc.).';
