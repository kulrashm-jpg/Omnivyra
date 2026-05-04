-- Content Architect–editable strategic inputs for Trend Campaigns (per company).
-- strategic_aspects: list of aspect labels (e.g. "Personal Clarity & Mental Peace").
-- offerings_by_aspect: JSON object keyed by aspect name, values = array of offering labels.
-- strategic_objectives: list of objective labels (e.g. "Brand awareness", "Lead generation").
-- These override or supplement backend-generated values and are returned in recommendation_strategic_config.
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS strategic_inputs JSONB DEFAULT NULL;

COMMENT ON COLUMN company_profiles.strategic_inputs IS 'Content Architect–editable: strategic_aspects[], offerings_by_aspect{}, strategic_objectives[]. Used on Trend Campaigns page.';
