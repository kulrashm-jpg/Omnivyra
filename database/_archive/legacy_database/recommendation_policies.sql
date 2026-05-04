-- =====================================================
-- RECOMMENDATION POLICY CONFIGURATION
-- =====================================================
CREATE TABLE IF NOT EXISTS recommendation_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    weights JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO recommendation_policies (name, is_active, weights)
VALUES (
    'Default Policy',
    true,
    '{
      "trend_score": 1,
      "geo_fit": 1,
      "audience_fit": 1,
      "category_fit": 1,
      "platform_fit": 1,
      "health_multiplier": 1,
      "historical_accuracy": 1,
      "effort_penalty": 0.1
    }'::jsonb
)
ON CONFLICT DO NOTHING;
