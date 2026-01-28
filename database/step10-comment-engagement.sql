-- STEP 10: CREATE COMMENT MANAGEMENT AND ENGAGEMENT TABLES
-- Run this after step 9 is complete

-- Post Comments Table
CREATE TABLE post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform_comment_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    author_username VARCHAR(255),
    author_profile_url TEXT,
    author_avatar_url TEXT,
    content TEXT NOT NULL,
    parent_comment_id UUID REFERENCES post_comments(id),
    is_reply BOOLEAN DEFAULT FALSE,
    is_author_reply BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    sentiment_score DECIMAL(3,2), -- -1.0 to 1.0
    sentiment_label VARCHAR(20), -- 'positive', 'negative', 'neutral'
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason VARCHAR(100),
    is_hidden BOOLEAN DEFAULT FALSE,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    platform_created_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, platform_comment_id)
);

-- Comment Replies Table
CREATE TABLE comment_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    platform_reply_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'deleted'
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Comment Likes Table
CREATE TABLE comment_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform_like_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (comment_id, user_id)
);

-- Comment Flags Table
CREATE TABLE comment_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL, -- 'spam', 'inappropriate', 'harassment', 'other'
    reason TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'reviewed', 'dismissed', 'action_taken'
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Direct Messages Table
CREATE TABLE direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    platform_message_id VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_username VARCHAR(255),
    sender_profile_url TEXT,
    content TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'image', 'video', 'file'
    media_urls TEXT[],
    is_read BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    platform_created_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (social_account_id, platform_message_id)
);

-- Message Replies Table
CREATE TABLE message_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    platform_reply_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Engagement Rules Table
CREATE TABLE engagement_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- 'auto_reply', 'auto_like', 'auto_follow', 'keyword_alert'
    trigger_conditions JSONB NOT NULL,
    action_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Success message
SELECT 'Comment management and engagement tables created successfully! Now run step 11.' as message;
