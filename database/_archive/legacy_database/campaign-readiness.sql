-- Campaign Readiness Table
-- Stores readiness evaluation results for campaigns
CREATE TABLE IF NOT EXISTS campaign_readiness (
    campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
    readiness_percentage INT NOT NULL,
    readiness_state TEXT CHECK (readiness_state IN ('not_ready', 'partial', 'ready')),
    blocking_issues JSONB,
    last_evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_readiness_state
    ON campaign_readiness(readiness_state);
CREATE INDEX IF NOT EXISTS idx_campaign_readiness_evaluated_at
    ON campaign_readiness(last_evaluated_at);
