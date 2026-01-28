-- Comprehensive Database Schema for Multi-Platform Content Management
-- Each platform has its own table with specific content types

-- LinkedIn Content Tables
CREATE TABLE linkedin_posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT,
    hashtags TEXT[],
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE linkedin_articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT,
    excerpt TEXT,
    cover_image_url VARCHAR(500),
    tags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    word_count INTEGER,
    reading_time INTEGER,
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE linkedin_videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE linkedin_audio_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    scheduled_for TIMESTAMP,
    duration INTEGER,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Twitter Content Tables
CREATE TABLE twitter_tweets (
    id SERIAL PRIMARY KEY,
    content VARCHAR(280),
    hashtags TEXT[],
    media_urls TEXT[],
    reply_to_tweet_id VARCHAR(100),
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE twitter_threads (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    tweets JSONB, -- Array of tweet objects
    hashtags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE twitter_videos (
    id SERIAL PRIMARY KEY,
    content VARCHAR(280),
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Instagram Content Tables
CREATE TABLE instagram_feed_posts (
    id SERIAL PRIMARY KEY,
    caption TEXT,
    hashtags TEXT[],
    media_urls TEXT[],
    location VARCHAR(200),
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE instagram_stories (
    id SERIAL PRIMARY KEY,
    content TEXT,
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    stickers JSONB,
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE instagram_reels (
    id SERIAL PRIMARY KEY,
    caption TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    audio_url VARCHAR(500),
    duration INTEGER,
    hashtags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE instagram_igtv (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    hashtags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- YouTube Content Tables
CREATE TABLE youtube_shorts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    hashtags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE youtube_videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    category VARCHAR(100),
    tags TEXT[],
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE youtube_live (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    scheduled_for TIMESTAMP,
    duration INTEGER,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Facebook Content Tables
CREATE TABLE facebook_posts (
    id SERIAL PRIMARY KEY,
    content TEXT,
    media_urls TEXT[],
    hashtags TEXT[],
    location VARCHAR(200),
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE facebook_stories (
    id SERIAL PRIMARY KEY,
    content TEXT,
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE facebook_videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration INTEGER,
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE facebook_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    description TEXT,
    location VARCHAR(200),
    scheduled_for TIMESTAMP,
    duration INTEGER,
    status VARCHAR(50) DEFAULT 'draft',
    engagement_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Campaign Management Tables
CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    description TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) DEFAULT 'draft',
    budget DECIMAL(10,2),
    goals TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaign_content (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES campaigns(id),
    platform VARCHAR(50),
    content_type VARCHAR(50),
    content_id INTEGER,
    scheduled_for TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Analytics Tables
CREATE TABLE content_analytics (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50),
    content_type VARCHAR(50),
    content_id INTEGER,
    date DATE,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX idx_linkedin_posts_scheduled ON linkedin_posts(scheduled_for);
CREATE INDEX idx_twitter_tweets_scheduled ON twitter_tweets(scheduled_for);
CREATE INDEX idx_instagram_posts_scheduled ON instagram_feed_posts(scheduled_for);
CREATE INDEX idx_youtube_videos_scheduled ON youtube_videos(scheduled_for);
CREATE INDEX idx_facebook_posts_scheduled ON facebook_posts(scheduled_for);
CREATE INDEX idx_campaign_content_campaign ON campaign_content(campaign_id);
CREATE INDEX idx_content_analytics_platform ON content_analytics(platform, content_type, content_id);























