-- =====================================================
-- COMPANY PROFILE (Canonical Company Intelligence Layer)
-- =====================================================
CREATE TABLE IF NOT EXISTS company_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    name TEXT,
    industry TEXT,
    category TEXT,
    website_url TEXT,
    products_services TEXT,
    target_audience TEXT,
    geography TEXT,
    brand_voice TEXT,
    goals TEXT,
    competitors TEXT,
    unique_value TEXT,
    content_themes TEXT,
    confidence_score INTEGER DEFAULT 0,
    source TEXT DEFAULT 'user' CHECK (source IN ('user', 'ai_refined')),
    last_refined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_profiles_company_id
    ON company_profiles(company_id);

ALTER TABLE company_profiles
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
    ADD COLUMN IF NOT EXISTS facebook_url TEXT,
    ADD COLUMN IF NOT EXISTS instagram_url TEXT,
    ADD COLUMN IF NOT EXISTS x_url TEXT,
    ADD COLUMN IF NOT EXISTS youtube_url TEXT,
    ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
    ADD COLUMN IF NOT EXISTS reddit_url TEXT,
    ADD COLUMN IF NOT EXISTS blog_url TEXT,
    ADD COLUMN IF NOT EXISTS other_social_links JSONB,
    ADD COLUMN IF NOT EXISTS industry_list JSONB,
    ADD COLUMN IF NOT EXISTS category_list JSONB,
    ADD COLUMN IF NOT EXISTS geography_list JSONB,
    ADD COLUMN IF NOT EXISTS competitors_list JSONB,
    ADD COLUMN IF NOT EXISTS content_themes_list JSONB,
    ADD COLUMN IF NOT EXISTS products_services_list JSONB,
    ADD COLUMN IF NOT EXISTS target_audience_list JSONB,
    ADD COLUMN IF NOT EXISTS goals_list JSONB,
    ADD COLUMN IF NOT EXISTS brand_voice_list JSONB,
    ADD COLUMN IF NOT EXISTS social_profiles JSONB,
    ADD COLUMN IF NOT EXISTS field_confidence JSONB,
    ADD COLUMN IF NOT EXISTS overall_confidence INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_urls JSONB;
