-- =====================================================
-- Problem & Transformation Intelligence (company_profiles)
-- Add nullable fields. No removal or alteration of existing columns.
-- Save flow uses source='ai_refined' for AI-refined admin input.
-- =====================================================

ALTER TABLE company_profiles
    ADD COLUMN IF NOT EXISTS core_problem_statement TEXT,
    ADD COLUMN IF NOT EXISTS pain_symptoms JSONB,
    ADD COLUMN IF NOT EXISTS awareness_gap TEXT,
    ADD COLUMN IF NOT EXISTS problem_impact TEXT,
    ADD COLUMN IF NOT EXISTS life_with_problem TEXT,
    ADD COLUMN IF NOT EXISTS life_after_solution TEXT,
    ADD COLUMN IF NOT EXISTS desired_transformation TEXT,
    ADD COLUMN IF NOT EXISTS transformation_mechanism TEXT,
    ADD COLUMN IF NOT EXISTS authority_domains JSONB;
