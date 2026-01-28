-- ANALYTICS & PERFORMANCE TABLES
-- This script adds analytics and performance tracking tables
-- Run this AFTER critical-missing-tables.sql and additional-social-media-tables.sql

-- ==============================================
-- 1. ANALYTICS & PERFORMANCE TABLES
-- ==============================================

-- Content Analytics Table (daily engagement metrics)
CREATE TABLE IF NOT EXISTS content_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analytics_date DATE NOT NULL,
    
    -- Engagement Metrics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    
    -- Calculated Metrics
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    
    -- Platform-specific metrics
    platform_metrics JSONB DEFAULT '{}',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, analytics_date)
);

-- Platform Performance Summary Table
CREATE TABLE IF NOT EXISTS platform_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    -- Daily Summary
    total_posts INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Best Performing Post
    best_post_id UUID REFERENCES scheduled_posts(id),
    best_post_engagement DECIMAL(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, date)
);

-- Hashtag Performance Table
CREATE TABLE IF NOT EXISTS hashtag_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashtag VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    -- Performance Metrics
    usage_count INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, hashtag, platform, date)
);

-- AI Content Analysis Table
CREATE TABLE IF NOT EXISTS ai_content_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    analysis_type VARCHAR(50) NOT NULL, -- 'content_quality', 'engagement_prediction', 'brand_safety'
    score DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    confidence DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    analysis_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimal Posting Times Table
CREATE TABLE IF NOT EXISTS optimal_posting_times (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
    hour INTEGER NOT NULL, -- 0-23
    engagement_score DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    sample_size INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, day_of_week, hour)
);

-- Audience Insights Table
CREATE TABLE IF NOT EXISTS audience_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Demographics
    age_groups JSONB DEFAULT '{}',
    gender_distribution JSONB DEFAULT '{}',
    location_distribution JSONB DEFAULT '{}',
    interests JSONB DEFAULT '{}',
    
    -- Engagement Patterns
    peak_hours JSONB DEFAULT '{}',
    peak_days JSONB DEFAULT '{}',
    content_preferences JSONB DEFAULT '{}',
    
    -- Growth Metrics
    follower_growth INTEGER DEFAULT 0,
    engagement_trend DECIMAL(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, social_account_id, date)
);

-- Competitor Analysis Table
CREATE TABLE IF NOT EXISTS competitor_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competitor_name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    competitor_handle VARCHAR(255) NOT NULL,
    
    -- Analysis Data
    follower_count INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    posting_frequency DECIMAL(5,2) DEFAULT 0.00,
    content_themes JSONB DEFAULT '{}',
    top_performing_content JSONB DEFAULT '{}',
    
    -- Comparison Metrics
    growth_rate DECIMAL(5,2) DEFAULT 0.00,
    engagement_comparison DECIMAL(5,2) DEFAULT 0.00,
    
    last_analyzed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, competitor_name, platform)
);

-- ROI Analysis Table
CREATE TABLE IF NOT EXISTS roi_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analysis_date DATE NOT NULL,
    
    -- Investment Metrics
    time_invested_hours DECIMAL(5,2) DEFAULT 0.00,
    content_creation_cost DECIMAL(10,2) DEFAULT 0.00,
    advertising_spend DECIMAL(10,2) DEFAULT 0.00,
    total_investment DECIMAL(10,2) DEFAULT 0.00,
    
    -- Return Metrics
    leads_generated INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_generated DECIMAL(10,2) DEFAULT 0.00,
    brand_awareness_score DECIMAL(5,2) DEFAULT 0.00,
    
    -- Calculated ROI
    roi_percentage DECIMAL(5,2) DEFAULT 0.00,
    cost_per_lead DECIMAL(10,2) DEFAULT 0.00,
    cost_per_conversion DECIMAL(10,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, campaign_id, platform, analysis_date)
);

-- ==============================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Content Analytics indexes
CREATE INDEX IF NOT EXISTS idx_content_analytics_post_id ON content_analytics(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_content_analytics_date ON content_analytics(analytics_date);
CREATE INDEX IF NOT EXISTS idx_content_analytics_user_date ON content_analytics(user_id, analytics_date);

-- Platform Performance indexes
CREATE INDEX IF NOT EXISTS idx_platform_performance_user_date ON platform_performance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_platform_performance_platform ON platform_performance(platform);

-- Hashtag Performance indexes
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_user ON hashtag_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_hashtag ON hashtag_performance(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_date ON hashtag_performance(date);

-- AI Content Analysis indexes
CREATE INDEX IF NOT EXISTS idx_ai_content_analysis_post_id ON ai_content_analysis(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_analysis_type ON ai_content_analysis(analysis_type);

-- Optimal Posting Times indexes
CREATE INDEX IF NOT EXISTS idx_optimal_posting_times_user ON optimal_posting_times(user_id);
CREATE INDEX IF NOT EXISTS idx_optimal_posting_times_platform ON optimal_posting_times(platform);

-- Audience Insights indexes
CREATE INDEX IF NOT EXISTS idx_audience_insights_user ON audience_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_audience_insights_platform ON audience_insights(platform);
CREATE INDEX IF NOT EXISTS idx_audience_insights_date ON audience_insights(date);

-- Competitor Analysis indexes
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_user ON competitor_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_competitor ON competitor_analysis(competitor_name);

-- ROI Analysis indexes
CREATE INDEX IF NOT EXISTS idx_roi_analysis_user ON roi_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_roi_analysis_campaign ON roi_analysis(campaign_id);
CREATE INDEX IF NOT EXISTS idx_roi_analysis_date ON roi_analysis(analysis_date);

-- ==============================================
-- 3. SUCCESS MESSAGE
-- ==============================================

SELECT 'Analytics and performance tables added successfully!' as message;


