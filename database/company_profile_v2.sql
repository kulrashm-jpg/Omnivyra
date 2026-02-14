-- Campaign Purpose & Strategic Intent (Define Target Customer extension)
-- Add structured JSONB field for AI-derived campaign purpose.
-- No data deletion. No changes to existing fields.

ALTER TABLE company_profiles
ADD COLUMN IF NOT EXISTS campaign_purpose_intent JSONB;
