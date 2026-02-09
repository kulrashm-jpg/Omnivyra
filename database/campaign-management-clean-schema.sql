-- =====================================================
-- CAMPAIGN MANAGEMENT DATABASE CLEANUP & SETUP SCRIPT
-- =====================================================
-- This script cleans the database and creates all tables
-- needed for the Campaign Management Module including:
-- - Campaign lifecycle management
-- - AI integration and feedback
-- - Analytics and performance tracking
-- - API integrations and webhooks
-- - Learning and improvement systems
-- =====================================================

-- STEP 1: DROP ALL EXISTING TABLES (CLEAN SLATE)
-- =====================================================
DROP TABLE IF EXISTS campaign_performance CASCADE;
DROP TABLE IF EXISTS campaign_analytics CASCADE;
DROP TABLE IF EXISTS ai_feedback CASCADE;
DROP TABLE IF EXISTS ai_improvements CASCADE;
DROP TABLE IF EXISTS api_integrations CASCADE;
DROP TABLE IF EXISTS webhook_logs CASCADE;
DROP TABLE IF EXISTS campaign_learnings CASCADE;
DROP TABLE IF EXISTS ai_threads CASCADE;
DROP TABLE IF EXISTS schedule_reviews CASCADE;
DROP TABLE IF EXISTS content_plans CASCADE;
DROP TABLE IF EXISTS market_analyses CASCADE;
DROP TABLE IF EXISTS campaign_goals CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- STEP 2: CREATE CORE USER MANAGEMENT
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

-- STEP 3: CREATE CAMPAIGN MANAGEMENT TABLES
-- =====================================================
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    virality_playbook_id UUID REFERENCES virality_playbooks(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'market-analysis', 'content-creation', 'schedule-review', 'active', 'completed', 'paused', 'cancelled')),
    current_stage VARCHAR(50) DEFAULT 'planning',
    timeframe VARCHAR(50) DEFAULT 'quarter' CHECK (timeframe IN ('week', 'month', 'quarter', 'year')),
    start_date DATE,
    end_date DATE,
    thread_id VARCHAR(255) UNIQUE NOT NULL DEFAULT 'thread_' || gen_random_uuid()::text,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    launched_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE campaign_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    content_type VARCHAR(100) NOT NULL,
    platform VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    frequency VARCHAR(100),
    target_audience TEXT,
    objectives TEXT[],
    metrics JSONB DEFAULT '{"engagement": 0, "reach": 0, "conversions": 0}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE market_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    trends JSONB DEFAULT '[]',
    competitors JSONB DEFAULT '[]',
    opportunities TEXT[],
    insights TEXT[],
    recommendations TEXT[],
    analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    day_of_week VARCHAR(20),
    date DATE,
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    topic TEXT,
    content TEXT,
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'created', 'reviewed', 'scheduled', 'published', 'failed')),
    ai_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE schedule_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    review_data JSONB DEFAULT '{}',
    optimizations TEXT[],
    final_schedule JSONB DEFAULT '[]',
    approved BOOLEAN DEFAULT false,
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 4: CREATE AI INTEGRATION TABLES
-- =====================================================
CREATE TABLE ai_threads (
    id VARCHAR(255) PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    messages JSONB DEFAULT '[]',
    context JSONB DEFAULT '{}',
    stage VARCHAR(50) DEFAULT 'planning',
    provider VARCHAR(50) DEFAULT 'demo' CHECK (provider IN ('demo', 'gpt', 'claude')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE ai_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    thread_id VARCHAR(255) REFERENCES ai_threads(id) ON DELETE CASCADE,
    feedback_type VARCHAR(100) NOT NULL CHECK (feedback_type IN ('suggestion', 'improvement', 'warning', 'error', 'success')),
    content TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    provider VARCHAR(50) DEFAULT 'demo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE ai_improvements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    improvement_type VARCHAR(100) NOT NULL CHECK (improvement_type IN ('content', 'timing', 'platform', 'audience', 'strategy')),
    suggestion TEXT NOT NULL,
    impact_score DECIMAL(3,2) CHECK (impact_score >= 0 AND impact_score <= 1),
    implementation_status VARCHAR(50) DEFAULT 'pending' CHECK (implementation_status IN ('pending', 'implemented', 'rejected', 'testing')),
    ai_generated BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    implemented_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE campaign_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    learnings TEXT[],
    improvements TEXT[],
    performance JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 5: CREATE ANALYTICS AND PERFORMANCE TABLES
-- =====================================================
CREATE TABLE campaign_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    content_plan_id UUID REFERENCES content_plans(id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL,
    metric_type VARCHAR(100) NOT NULL CHECK (metric_type IN ('engagement', 'reach', 'impressions', 'clicks', 'shares', 'comments', 'likes', 'conversions')),
    metric_value DECIMAL(15,2) NOT NULL DEFAULT 0,
    metric_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE campaign_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    performance_date DATE NOT NULL,
    total_reach INTEGER DEFAULT 0,
    total_engagement DECIMAL(10,2) DEFAULT 0,
    total_conversions INTEGER DEFAULT 0,
    platform_breakdown JSONB DEFAULT '{}',
    content_type_breakdown JSONB DEFAULT '{}',
    ai_suggestions_implemented INTEGER DEFAULT 0,
    improvement_score DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 6: CREATE API INTEGRATION TABLES
-- =====================================================
CREATE TABLE api_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL CHECK (platform IN ('linkedin', 'twitter', 'instagram', 'youtube', 'facebook', 'tiktok')),
    integration_type VARCHAR(100) NOT NULL CHECK (integration_type IN ('oauth', 'api_key', 'webhook')),
    credentials JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'error')),
    last_sync TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 7: CREATE INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);
CREATE INDEX idx_campaign_goals_campaign_id ON campaign_goals(campaign_id);
CREATE INDEX idx_market_analyses_campaign_id ON market_analyses(campaign_id);
CREATE INDEX idx_content_plans_campaign_id ON content_plans(campaign_id);
CREATE INDEX idx_content_plans_status ON content_plans(status);
CREATE INDEX idx_content_plans_scheduled_at ON content_plans(scheduled_at);
CREATE INDEX idx_ai_threads_campaign_id ON ai_threads(campaign_id);
CREATE INDEX idx_ai_feedback_campaign_id ON ai_feedback(campaign_id);
CREATE INDEX idx_ai_feedback_type ON ai_feedback(feedback_type);
CREATE INDEX idx_campaign_analytics_campaign_id ON campaign_analytics(campaign_id);
CREATE INDEX idx_campaign_analytics_date ON campaign_analytics(metric_date);
CREATE INDEX idx_campaign_performance_campaign_id ON campaign_performance(campaign_id);
CREATE INDEX idx_campaign_performance_date ON campaign_performance(performance_date);
CREATE INDEX idx_api_integrations_user_id ON api_integrations(user_id);
CREATE INDEX idx_api_integrations_platform ON api_integrations(platform);
CREATE INDEX idx_webhook_logs_campaign_id ON webhook_logs(campaign_id);
CREATE INDEX idx_webhook_logs_processed ON webhook_logs(processed);

-- STEP 8: CREATE TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaign_goals_updated_at BEFORE UPDATE ON campaign_goals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_market_analyses_updated_at BEFORE UPDATE ON market_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_plans_updated_at BEFORE UPDATE ON content_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_schedule_reviews_updated_at BEFORE UPDATE ON schedule_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_threads_updated_at BEFORE UPDATE ON ai_threads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaign_learnings_updated_at BEFORE UPDATE ON campaign_learnings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaign_performance_updated_at BEFORE UPDATE ON campaign_performance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_api_integrations_updated_at BEFORE UPDATE ON api_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- STEP 9: CREATE VIEWS FOR COMMON QUERIES
-- =====================================================
CREATE VIEW campaign_summary AS
SELECT 
    c.id,
    c.name,
    c.status,
    c.current_stage,
    c.timeframe,
    c.start_date,
    c.end_date,
    c.created_at,
    c.launched_at,
    COUNT(cg.id) as total_goals,
    COUNT(cp.id) as total_content_plans,
    COUNT(CASE WHEN cp.status = 'published' THEN 1 END) as published_content,
    COALESCE(SUM(cg.quantity), 0) as total_content_quantity
FROM campaigns c
LEFT JOIN campaign_goals cg ON c.id = cg.campaign_id
LEFT JOIN content_plans cp ON c.id = cp.campaign_id
GROUP BY c.id, c.name, c.status, c.current_stage, c.timeframe, c.start_date, c.end_date, c.created_at, c.launched_at;

CREATE VIEW ai_insights_summary AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    COUNT(af.id) as total_feedback,
    COUNT(ai.id) as total_improvements,
    COUNT(CASE WHEN af.feedback_type = 'success' THEN 1 END) as successful_suggestions,
    AVG(af.confidence_score) as avg_confidence,
    AVG(ai.impact_score) as avg_impact_score
FROM campaigns c
LEFT JOIN ai_feedback af ON c.id = af.campaign_id
LEFT JOIN ai_improvements ai ON c.id = ai.campaign_id
GROUP BY c.id, c.name;

-- STEP 10: INSERT SAMPLE DATA FOR TESTING
-- =====================================================
INSERT INTO users (id, email, name) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 'admin@example.com', 'Admin User'),
('550e8400-e29b-41d4-a716-446655440001', 'user@example.com', 'Test User');

INSERT INTO campaigns (id, user_id, name, description, status, current_stage, timeframe) VALUES 
('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440000', 'Q1 2024 Brand Awareness', 'Brand awareness campaign for Q1 2024', 'planning', 'planning', 'quarter'),
('550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440000', 'Product Launch Campaign', 'Product launch campaign for new features', 'planning', 'planning', 'month');

-- STEP 11: CREATE FUNCTIONS FOR COMMON OPERATIONS
-- =====================================================
CREATE OR REPLACE FUNCTION get_campaign_progress(campaign_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign_id', c.id,
        'name', c.name,
        'status', c.status,
        'current_stage', c.current_stage,
        'goals_count', COUNT(cg.id),
        'content_plans_count', COUNT(cp.id),
        'published_content', COUNT(CASE WHEN cp.status = 'published' THEN 1 END),
        'ai_feedback_count', COUNT(af.id),
        'improvements_count', COUNT(ai.id)
    ) INTO result
    FROM campaigns c
    LEFT JOIN campaign_goals cg ON c.id = cg.campaign_id
    LEFT JOIN content_plans cp ON c.id = cp.campaign_id
    LEFT JOIN ai_feedback af ON c.id = af.campaign_id
    LEFT JOIN ai_improvements ai ON c.id = ai.campaign_id
    WHERE c.id = campaign_uuid
    GROUP BY c.id, c.name, c.status, c.current_stage;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION transition_campaign_stage(
    campaign_uuid UUID,
    from_stage VARCHAR(50),
    to_stage VARCHAR(50),
    stage_data JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
DECLARE
    thread_exists BOOLEAN;
BEGIN
    -- Update campaign stage
    UPDATE campaigns 
    SET current_stage = to_stage, 
        status = CASE 
            WHEN to_stage = 'active' THEN 'active'
            WHEN to_stage = 'completed' THEN 'completed'
            ELSE to_stage
        END,
        updated_at = NOW()
    WHERE id = campaign_uuid;
    
    -- Update AI thread with stage transition
    SELECT EXISTS(SELECT 1 FROM ai_threads WHERE campaign_id = campaign_uuid) INTO thread_exists;
    
    IF thread_exists THEN
        UPDATE ai_threads 
        SET stage = to_stage,
            context = context || jsonb_build_object(
                'previous_stages', COALESCE(context->'previous_stages', '[]'::jsonb) || jsonb_build_object(
                    'stage', from_stage,
                    'data', stage_data,
                    'timestamp', NOW()
                )
            ),
            updated_at = NOW()
        WHERE campaign_id = campaign_uuid;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- STEP 12: GRANT PERMISSIONS (if using Supabase)
-- =====================================================
-- These will be handled by Supabase RLS policies
-- ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_goals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE market_analyses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE content_plans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE schedule_reviews ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_threads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_improvements ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_learnings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_analytics ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_performance ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE api_integrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SCRIPT COMPLETION
-- =====================================================
-- Database has been cleaned and set up with all required tables
-- for the Campaign Management Module including:
-- ✅ Campaign lifecycle management
-- ✅ AI integration and feedback systems
-- ✅ Analytics and performance tracking
-- ✅ API integrations and webhooks
-- ✅ Learning and improvement systems
-- ✅ Performance optimization with indexes
-- ✅ Automatic timestamp updates
-- ✅ Common query views
-- ✅ Utility functions
-- ✅ Sample test data
-- =====================================================
