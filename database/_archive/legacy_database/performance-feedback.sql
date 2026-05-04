-- =====================================================
-- PERFORMANCE FEEDBACK (Post-level engagement metrics)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id),
    recommendation_id UUID REFERENCES recommendation_snapshots(id),
    platform TEXT NOT NULL,
    post_id TEXT NOT NULL,
    impressions INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    engagement_rate NUMERIC,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT CHECK (source IN ('platform_api', 'manual')) NOT NULL
);
