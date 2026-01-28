-- STEP 3: CREATE SCHEDULING TABLES
-- Run this after step 2 is complete

-- Scheduled Posts Table (main scheduling entity)
CREATE TABLE scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    template_id UUID REFERENCES content_templates(id) ON DELETE SET NULL,
    
    -- Platform and Content Info
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    
    -- Content Fields
    title VARCHAR(500),
    content TEXT NOT NULL,
    hashtags TEXT[],
    mentions TEXT[],
    location VARCHAR(200),
    alt_text TEXT,
    
    -- Media Fields
    media_urls TEXT[],
    media_types VARCHAR(20)[],
    media_sizes BIGINT[],
    media_formats VARCHAR(10)[],
    
    -- Video Specific
    video_duration INTEGER,
    video_resolution VARCHAR(20),
    video_aspect_ratio VARCHAR(10),
    video_bitrate INTEGER,
    video_fps INTEGER,
    video_thumbnail_url TEXT,
    
    -- Image Specific
    image_width INTEGER,
    image_height INTEGER,
    image_aspect_ratio VARCHAR(10),
    
    -- Audio Specific
    audio_duration INTEGER,
    audio_title VARCHAR(200),
    audio_url VARCHAR(500),
    audio_artist VARCHAR(200),
    
    -- Thread/Series Specific
    parent_post_id UUID REFERENCES scheduled_posts(id),
    thread_position INTEGER,
    is_thread_start BOOLEAN DEFAULT FALSE,
    thread_title VARCHAR(500),
    
    -- Interactive Elements
    stickers JSONB,
    interactive_elements JSONB,
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    status VARCHAR(50) DEFAULT 'draft',
    published_at TIMESTAMP WITH TIME ZONE,
    post_url TEXT,
    platform_post_id VARCHAR(255),
    
    -- Error Handling
    error_message TEXT,
    error_code VARCHAR(100),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- AI Assessment
    ai_score INTEGER,
    uniqueness_score INTEGER,
    repetition_score INTEGER,
    engagement_prediction INTEGER,
    
    -- Performance Tracking
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Posts Table
CREATE TABLE recurring_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    
    content_template TEXT NOT NULL,
    hashtags TEXT[],
    media_template JSONB,
    
    frequency VARCHAR(50) NOT NULL,
    days_of_week INTEGER[],
    time_of_day TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    start_date DATE NOT NULL,
    end_date DATE,
    max_posts INTEGER,
    
    is_active BOOLEAN DEFAULT TRUE,
    last_generated_at TIMESTAMP WITH TIME ZONE,
    next_generation_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Success message
SELECT 'Scheduling tables created successfully! Now run step 4.' as message;
