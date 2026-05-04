-- STEP 13: CREATE ADVANCED ANALYTICS AND REPORTING TABLES
-- Run this after step 12 is complete

-- Audience Insights Table
CREATE TABLE audience_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    age_groups JSONB, -- {"18-24": 25, "25-34": 40, "35-44": 20, "45-54": 10, "55+": 5}
    gender_distribution JSONB, -- {"male": 60, "female": 35, "other": 5}
    location_data JSONB, -- Top countries/cities with percentages
    interests TEXT[], -- Top interests/topics
    activity_times JSONB, -- Peak activity hours
    device_types JSONB, -- Mobile vs Desktop usage
    language_distribution JSONB, -- Language preferences
    follower_growth INTEGER DEFAULT 0,
    engagement_trends JSONB, -- Week-over-week trends
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, date)
);

-- Custom Reports Table
CREATE TABLE custom_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_name VARCHAR(255) NOT NULL,
    report_description TEXT,
    report_config JSONB NOT NULL, -- Filters, metrics, date ranges, etc.
    report_type VARCHAR(50) NOT NULL, -- 'performance', 'audience', 'content', 'engagement'
    schedule VARCHAR(50), -- 'daily', 'weekly', 'monthly', 'quarterly', 'manual'
    last_generated_at TIMESTAMP WITH TIME ZONE,
    next_generation_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Report Data Table
CREATE TABLE report_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
    data JSONB NOT NULL, -- The actual report data
    data_type VARCHAR(50) NOT NULL, -- 'summary', 'detailed', 'chart_data', 'raw_data'
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    file_url TEXT, -- URL to exported file (PDF, CSV, etc.)
    file_format VARCHAR(20) -- 'pdf', 'csv', 'xlsx', 'json'
);

-- Content Performance Insights Table
CREATE TABLE content_performance_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    
    -- Performance Metrics
    viral_coefficient DECIMAL(5,2), -- How viral the content became
    engagement_velocity DECIMAL(5,2), -- Rate of engagement growth
    reach_amplification DECIMAL(5,2), -- How much reach was amplified
    click_through_rate DECIMAL(5,2),
    conversion_rate DECIMAL(5,2),
    
    -- Content Analysis
    sentiment_score DECIMAL(3,2), -- -1.0 to 1.0
    topic_relevance_score DECIMAL(3,2), -- 0.0 to 1.0
    brand_consistency_score DECIMAL(3,2), -- 0.0 to 1.0
    readability_score DECIMAL(3,2), -- 0.0 to 1.0
    
    -- Timing Analysis
    optimal_posting_score DECIMAL(3,2), -- How optimal the posting time was
    audience_activity_score DECIMAL(3,2), -- How active the audience was
    
    -- Comparative Analysis
    vs_previous_performance DECIMAL(5,2), -- % change from previous similar content
    vs_platform_average DECIMAL(5,2), -- % change vs platform average
    vs_competitor_average DECIMAL(5,2), -- % change vs competitor average
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Competitor Analysis Table
CREATE TABLE competitor_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    competitor_name VARCHAR(255) NOT NULL,
    competitor_handle VARCHAR(255) NOT NULL,
    analysis_date DATE NOT NULL,
    
    -- Competitor Metrics
    follower_count INTEGER,
    following_count INTEGER,
    post_count INTEGER,
    avg_engagement_rate DECIMAL(5,2),
    avg_likes INTEGER,
    avg_comments INTEGER,
    avg_shares INTEGER,
    
    -- Content Analysis
    top_hashtags TEXT[],
    content_themes TEXT[],
    posting_frequency DECIMAL(5,2), -- Posts per day
    optimal_posting_times JSONB,
    
    -- Growth Analysis
    follower_growth_rate DECIMAL(5,2),
    engagement_growth_rate DECIMAL(5,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, competitor_handle, analysis_date)
);

-- ROI Analysis Table
CREATE TABLE roi_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analysis_period_start DATE NOT NULL,
    analysis_period_end DATE NOT NULL,
    
    -- Investment Metrics
    time_invested_hours DECIMAL(5,2),
    content_creation_cost DECIMAL(10,2),
    advertising_spend DECIMAL(10,2),
    tool_costs DECIMAL(10,2),
    total_investment DECIMAL(10,2),
    
    -- Return Metrics
    leads_generated INTEGER,
    conversions INTEGER,
    revenue_generated DECIMAL(10,2),
    brand_awareness_score DECIMAL(5,2),
    customer_acquisition_cost DECIMAL(10,2),
    
    -- ROI Calculations
    roi_percentage DECIMAL(5,2),
    cost_per_engagement DECIMAL(10,4),
    cost_per_lead DECIMAL(10,2),
    cost_per_conversion DECIMAL(10,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Trends Table
CREATE TABLE content_trends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL,
    trend_date DATE NOT NULL,
    trend_type VARCHAR(50) NOT NULL, -- 'hashtag', 'topic', 'format', 'style'
    trend_name VARCHAR(255) NOT NULL,
    trend_score DECIMAL(5,2), -- 0.0 to 100.0
    engagement_impact DECIMAL(5,2), -- How much this trend impacts engagement
    reach_impact DECIMAL(5,2), -- How much this trend impacts reach
    sample_size INTEGER, -- Number of posts analyzed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (platform, trend_date, trend_type, trend_name)
);

-- A/B Test Results Table
CREATE TABLE ab_test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_name VARCHAR(255) NOT NULL,
    test_type VARCHAR(50) NOT NULL, -- 'content', 'timing', 'hashtags', 'media'
    platform VARCHAR(50) NOT NULL,
    
    -- Test Configuration
    variant_a_config JSONB NOT NULL,
    variant_b_config JSONB NOT NULL,
    test_start_date DATE NOT NULL,
    test_end_date DATE NOT NULL,
    
    -- Results
    variant_a_posts INTEGER DEFAULT 0,
    variant_b_posts INTEGER DEFAULT 0,
    variant_a_engagement DECIMAL(5,2) DEFAULT 0.00,
    variant_b_engagement DECIMAL(5,2) DEFAULT 0.00,
    statistical_significance DECIMAL(5,2), -- 0.0 to 1.0
    winner VARCHAR(10), -- 'A', 'B', 'tie'
    confidence_level DECIMAL(5,2), -- 0.0 to 1.0
    
    -- Test Status
    status VARCHAR(50) DEFAULT 'running', -- 'running', 'completed', 'cancelled'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Success message
SELECT 'Advanced analytics and reporting tables created successfully! Now run step 14.' as message;
