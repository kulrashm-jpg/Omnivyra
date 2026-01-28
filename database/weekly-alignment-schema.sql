-- =====================================================
-- WEEKLY ALIGNMENT NOTIFICATION SYSTEM
-- =====================================================
-- Extends existing campaign management with weekly alignment tracking

-- Weekly Alignment Tracking Table
CREATE TABLE weekly_alignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,
    theme VARCHAR(255) NOT NULL,
    focus_area TEXT NOT NULL,
    content_types TEXT[] NOT NULL,
    platforms TEXT[] NOT NULL,
    objectives TEXT[] NOT NULL,
    
    -- Alignment Status
    alignment_status VARCHAR(50) DEFAULT 'pending' CHECK (alignment_status IN ('pending', 'in-review', 'aligned', 'needs-adjustment', 'completed')),
    alignment_notes TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Content Status
    planned_content_count INTEGER DEFAULT 0,
    created_content_count INTEGER DEFAULT 0,
    scheduled_content_count INTEGER DEFAULT 0,
    published_content_count INTEGER DEFAULT 0,
    
    -- Performance Tracking
    engagement_score DECIMAL(5,2) DEFAULT 0.00,
    reach_score DECIMAL(5,2) DEFAULT 0.00,
    conversion_score DECIMAL(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE (campaign_id, week_number)
);

-- Weekly Alignment Notifications Table
CREATE TABLE weekly_alignment_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('alignment_reminder', 'content_review', 'performance_check', 'plan_adjustment')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    
    -- Notification Status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'read', 'dismissed')),
    sent_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    dismissed_at TIMESTAMP WITH TIME ZONE,
    
    -- Action Required
    action_required BOOLEAN DEFAULT true,
    action_type VARCHAR(50), -- 'review_content', 'adjust_plan', 'approve_week', 'modify_schedule'
    action_deadline TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12-Week Plan Review Table
CREATE TABLE campaign_plan_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    review_type VARCHAR(50) NOT NULL CHECK (review_type IN ('initial_plan', 'weekly_check', 'monthly_review', 'quarterly_assessment')),
    
    -- Review Data
    original_plan JSONB NOT NULL,
    current_progress JSONB NOT NULL,
    suggested_changes JSONB DEFAULT '{}',
    approved_changes JSONB DEFAULT '{}',
    
    -- Review Status
    review_status VARCHAR(50) DEFAULT 'pending' CHECK (review_status IN ('pending', 'in-review', 'approved', 'needs-revision', 'rejected')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Review Notes
    strengths TEXT[],
    weaknesses TEXT[],
    opportunities TEXT[],
    recommendations TEXT[],
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Weekly Content Performance Tracking
CREATE TABLE weekly_content_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    
    -- Performance Metrics
    posts_published INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    total_reach INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    total_conversions INTEGER DEFAULT 0,
    
    -- Calculated Scores
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach_rate DECIMAL(5,2) DEFAULT 0.00,
    click_through_rate DECIMAL(5,2) DEFAULT 0.00,
    conversion_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Comparison with Goals
    goal_achievement_percentage DECIMAL(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE (campaign_id, week_number, platform, content_type)
);

-- Indexes for Performance
CREATE INDEX idx_weekly_alignments_campaign_week ON weekly_alignments(campaign_id, week_number);
CREATE INDEX idx_weekly_alignments_status ON weekly_alignments(alignment_status);
CREATE INDEX idx_weekly_notifications_campaign ON weekly_alignment_notifications(campaign_id);
CREATE INDEX idx_weekly_notifications_status ON weekly_alignment_notifications(status);
CREATE INDEX idx_plan_reviews_campaign ON campaign_plan_reviews(campaign_id);
CREATE INDEX idx_content_performance_campaign_week ON weekly_content_performance(campaign_id, week_number);

-- Success message
SELECT 'Weekly alignment notification system created successfully!' as message;
