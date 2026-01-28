-- =====================================================
-- COMPANY PROFILE REFINEMENT AUDIT
-- =====================================================
CREATE TABLE IF NOT EXISTS company_profile_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    before_profile JSONB NOT NULL,
    after_profile JSONB NOT NULL,
    source_urls JSONB,
    source_summaries JSONB,
    changed_fields JSONB,
    extraction_output JSONB,
    missing_fields_questions JSONB,
    overall_confidence INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_profile_refinements_company_id
    ON company_profile_refinements(company_id);

CREATE INDEX IF NOT EXISTS idx_company_profile_refinements_created_at
    ON company_profile_refinements(created_at);
