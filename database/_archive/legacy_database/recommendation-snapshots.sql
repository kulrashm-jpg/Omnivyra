-- =====================================================
-- RECOMMENDATION SNAPSHOTS (Trend + Profile Insights)
-- =====================================================
CREATE TABLE IF NOT EXISTS recommendation_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    campaign_id UUID REFERENCES campaigns(id),
    snapshot_hash TEXT,
    trend_topic TEXT NOT NULL,
    category TEXT,
    audience JSONB,
    geo JSONB,
    platforms JSONB,
    promotion_mode TEXT CHECK (promotion_mode IN ('organic', 'paid', 'mixed')),
    effort_score NUMERIC,
    success_projection JSONB,
    final_score NUMERIC,
    scores JSONB,
    confidence NUMERIC,
    explanation TEXT,
    refresh_source TEXT CHECK (refresh_source IN ('manual', 'auto_weekly', 'profile_update')),
    refreshed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
