-- STEP 11: CREATE CONTENT MODERATION AND COMPLIANCE TABLES
-- Run this after step 10 is complete

-- Content Moderation Table
CREATE TABLE content_moderation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    moderation_status VARCHAR(50) NOT NULL, -- 'pending', 'approved', 'rejected', 'flagged', 'needs_review'
    moderation_score DECIMAL(3,2), -- 0.0 to 1.0
    flagged_reasons TEXT[], -- 'spam', 'inappropriate', 'copyright', 'hate_speech', 'violence'
    moderator_notes TEXT,
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMP WITH TIME ZONE,
    auto_moderation BOOLEAN DEFAULT TRUE,
    ai_confidence DECIMAL(3,2), -- AI confidence score
    manual_review_required BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compliance Violations Table
CREATE TABLE compliance_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    violation_type VARCHAR(100) NOT NULL, -- 'copyright', 'trademark', 'community_guidelines', 'ad_policy'
    violation_description TEXT,
    severity VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    platform_response JSONB,
    platform_action VARCHAR(100), -- 'warning', 'post_removed', 'account_suspended', 'no_action'
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Moderation Policies Table
CREATE TABLE moderation_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100),
    rules JSONB NOT NULL, -- JSON configuration of moderation rules
    auto_action VARCHAR(50), -- 'approve', 'reject', 'flag', 'queue_for_review'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Flags Table
CREATE TABLE content_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    flagged_by UUID REFERENCES users(id),
    flag_type VARCHAR(50) NOT NULL, -- 'spam', 'inappropriate', 'copyright', 'misinformation'
    flag_reason TEXT,
    severity VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'reviewed', 'dismissed', 'action_taken'
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Brand Safety Table
CREATE TABLE brand_safety_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    overall_score DECIMAL(3,2) NOT NULL, -- 0.0 to 1.0
    violence_score DECIMAL(3,2),
    adult_content_score DECIMAL(3,2),
    profanity_score DECIMAL(3,2),
    hate_speech_score DECIMAL(3,2),
    spam_score DECIMAL(3,2),
    political_score DECIMAL(3,2),
    ai_analysis JSONB,
    human_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Copyright Claims Table
CREATE TABLE copyright_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    claim_id VARCHAR(255) NOT NULL,
    claimant_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(50), -- 'music', 'video', 'image', 'text'
    claim_reason TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'resolved', 'disputed', 'rejected'
    platform_response JSONB,
    resolution_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Moderation Queue Table
CREATE TABLE moderation_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0, -- Higher number = higher priority
    queue_type VARCHAR(50) NOT NULL, -- 'ai_review', 'human_review', 'compliance_check'
    assigned_to UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
    estimated_duration INTEGER, -- Estimated minutes to complete
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Moderation Logs Table
CREATE TABLE moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL, -- 'auto_approved', 'auto_rejected', 'flagged_for_review', 'human_approved'
    performed_by UUID REFERENCES users(id), -- NULL for automated actions
    details JSONB,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Success message
SELECT 'Content moderation and compliance tables created successfully! Now run step 12.' as message;
