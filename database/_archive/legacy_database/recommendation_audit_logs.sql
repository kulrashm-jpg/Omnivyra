-- =====================================================
-- RECOMMENDATION AUDIT LOGS (Transparency & Debugging)
-- =====================================================
CREATE TABLE IF NOT EXISTS recommendation_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID,
    campaign_id UUID REFERENCES campaigns(id),
    company_id TEXT,
    input_snapshot_hash TEXT,
    trend_sources_used JSONB,
    platform_strategies_used JSONB,
    company_profile_used JSONB,
    scores_breakdown JSONB,
    final_score NUMERIC,
    confidence NUMERIC,
    historical_accuracy_factor NUMERIC,
    policy_id UUID,
    policy_weights_used JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
