-- COMPREHENSIVE DATABASE STRUCTURE PLAN
-- Based on Real Platform Specifications (2024)

-- ==============================================
-- LINKEDIN TABLES
-- ==============================================

-- LinkedIn Posts (Text + Media)
CREATE TABLE linkedin_posts (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(200),                    -- LinkedIn post title (max 200 chars)
    content TEXT CHECK (LENGTH(content) <= 3000),  -- Main content (max 3000 chars)
    hashtags TEXT[],                       -- Array of hashtags (max 5 recommended)
    
    -- Media Fields
    media_urls TEXT[],                     -- Array of media URLs (max 9 images)
    media_types VARCHAR(20)[],             -- ['image', 'video', 'document']
    media_sizes BIGINT[],                  -- File sizes in bytes
    media_formats VARCHAR(10)[],           -- ['jpg', 'png', 'mp4', 'pdf']
    
    -- Video Specific (if media_type = 'video')
    video_duration INTEGER,                -- Duration in seconds (max 600 = 10 min)
    video_resolution VARCHAR(20),          -- '1920x1080', '1280x720', etc
    video_aspect_ratio VARCHAR(10),        -- '16:9', '1:1', '9:16'
    video_bitrate INTEGER,                 -- Bitrate in kbps (max 30000)
    
    -- Image Specific (if media_type = 'image')
    image_width INTEGER,                   -- Width in pixels
    image_height INTEGER,                  -- Height in pixels
    image_aspect_ratio VARCHAR(10),        -- '1.91:1', '1:1', '4:5'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',    -- 'draft', 'scheduled', 'published', 'failed'
    published_at TIMESTAMP,
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_linkedin_content_length CHECK (LENGTH(content) <= 3000),
    CONSTRAINT chk_linkedin_hashtags_count CHECK (ARRAY_LENGTH(hashtags, 1) <= 5),
    CONSTRAINT chk_linkedin_media_count CHECK (ARRAY_LENGTH(media_urls, 1) <= 9),
    CONSTRAINT chk_linkedin_video_duration CHECK (video_duration IS NULL OR video_duration <= 600),
    CONSTRAINT chk_linkedin_video_bitrate CHECK (video_bitrate IS NULL OR video_bitrate <= 30000)
);

-- LinkedIn Articles (Long-form content)
CREATE TABLE linkedin_articles (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(200) NOT NULL,           -- Article title (max 200 chars)
    content TEXT NOT NULL,                 -- Article content (max 125,000 chars)
    excerpt TEXT CHECK (LENGTH(excerpt) <= 500), -- Article excerpt (max 500 chars)
    tags TEXT[],                           -- Article tags (max 3 recommended)
    
    -- Media Fields
    cover_image_url VARCHAR(500),          -- Cover image URL
    cover_image_width INTEGER,             -- Cover image width
    cover_image_height INTEGER,            -- Cover image height
    cover_image_size BIGINT,               -- Cover image size in bytes (max 5MB)
    
    -- Content Metrics
    word_count INTEGER,                    -- Calculated word count
    reading_time INTEGER,                  -- Estimated reading time in minutes
    paragraph_count INTEGER,               -- Number of paragraphs
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_linkedin_article_title CHECK (LENGTH(title) <= 200),
    CONSTRAINT chk_linkedin_article_content CHECK (LENGTH(content) <= 125000),
    CONSTRAINT chk_linkedin_article_excerpt CHECK (LENGTH(excerpt) <= 500),
    CONSTRAINT chk_linkedin_article_tags CHECK (ARRAY_LENGTH(tags, 1) <= 3),
    CONSTRAINT chk_linkedin_cover_image_size CHECK (cover_image_size IS NULL OR cover_image_size <= 5242880) -- 5MB
);

-- LinkedIn Videos
CREATE TABLE linkedin_videos (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(200),                    -- Video title (max 200 chars)
    description TEXT CHECK (LENGTH(description) <= 2000), -- Video description (max 2000 chars)
    hashtags TEXT[],                       -- Video hashtags (max 5)
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (max 600)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 5GB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov', 'avi', etc
    video_resolution VARCHAR(20),          -- '1920x1080', '1280x720', etc
    video_aspect_ratio VARCHAR(10),        -- '16:9', '1:1', '9:16'
    video_bitrate INTEGER,                 -- Bitrate in kbps (max 30000)
    video_fps INTEGER,                     -- Frames per second (max 60)
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_linkedin_video_title CHECK (LENGTH(title) <= 200),
    CONSTRAINT chk_linkedin_video_description CHECK (LENGTH(description) <= 2000),
    CONSTRAINT chk_linkedin_video_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 5),
    CONSTRAINT chk_linkedin_video_duration CHECK (video_duration <= 600),
    CONSTRAINT chk_linkedin_video_size CHECK (video_file_size <= 5368709120), -- 5GB
    CONSTRAINT chk_linkedin_video_bitrate CHECK (video_bitrate IS NULL OR video_bitrate <= 30000),
    CONSTRAINT chk_linkedin_video_fps CHECK (video_fps IS NULL OR video_fps <= 60)
);

-- LinkedIn Audio Events
CREATE TABLE linkedin_audio_events (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(200) NOT NULL,           -- Event title (max 200 chars)
    description TEXT CHECK (LENGTH(description) <= 500), -- Event description (max 500 chars)
    hashtags TEXT[],                       -- Event hashtags (max 3)
    
    -- Event Fields
    event_duration INTEGER,                -- Duration in minutes
    max_participants INTEGER,              -- Maximum participants
    event_type VARCHAR(50),                -- 'audio_event', 'live_audio'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    
    -- Analytics
    attendees INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_linkedin_audio_title CHECK (LENGTH(title) <= 200),
    CONSTRAINT chk_linkedin_audio_description CHECK (LENGTH(description) <= 500),
    CONSTRAINT chk_linkedin_audio_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 3)
);

-- ==============================================
-- TWITTER/X TABLES
-- ==============================================

-- Twitter Tweets
CREATE TABLE twitter_tweets (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    content VARCHAR(280) NOT NULL,         -- Tweet content (max 280 chars)
    hashtags TEXT[],                       -- Tweet hashtags (max 2 recommended)
    mentions TEXT[],                       -- @mentions in tweet
    media_urls TEXT[],                     -- Media URLs (max 4 images/videos)
    media_types VARCHAR(20)[],             -- ['image', 'video', 'gif']
    
    -- Media Specific
    media_sizes BIGINT[],                  -- File sizes in bytes
    media_formats VARCHAR(10)[],           -- ['jpg', 'png', 'gif', 'mp4', 'mov']
    
    -- Video Specific
    video_duration INTEGER,                -- Duration in seconds (max 140)
    video_file_size BIGINT,                -- File size in bytes (max 15MB)
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- '16:9', '1:1', '9:16'
    
    -- Image Specific
    image_width INTEGER,                   -- Image width in pixels
    image_height INTEGER,                  -- Image height in pixels
    image_file_size BIGINT,                -- Image file size in bytes (max 5MB)
    
    -- Thread Fields
    thread_id INTEGER,                     -- Parent thread ID
    thread_position INTEGER,               -- Position in thread (1, 2, 3...)
    is_thread_start BOOLEAN DEFAULT FALSE, -- Is this the first tweet in thread?
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    tweet_id VARCHAR(50),                  -- Twitter's tweet ID after publishing
    
    -- Analytics
    retweets INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_twitter_content CHECK (LENGTH(content) <= 280),
    CONSTRAINT chk_twitter_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 2),
    CONSTRAINT chk_twitter_media_count CHECK (ARRAY_LENGTH(media_urls, 1) <= 4),
    CONSTRAINT chk_twitter_video_duration CHECK (video_duration IS NULL OR video_duration <= 140),
    CONSTRAINT chk_twitter_video_size CHECK (video_file_size IS NULL OR video_file_size <= 15728640), -- 15MB
    CONSTRAINT chk_twitter_image_size CHECK (image_file_size IS NULL OR image_file_size <= 5242880) -- 5MB
);

-- Twitter Threads
CREATE TABLE twitter_threads (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(200),                    -- Thread title
    description TEXT,                      -- Thread description
    hashtags TEXT[],                       -- Thread hashtags (max 1 recommended)
    
    -- Thread Structure
    tweet_ids INTEGER[],                   -- Array of tweet IDs in thread
    thread_length INTEGER,                 -- Number of tweets in thread
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    
    -- Analytics
    total_retweets INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_replies INTEGER DEFAULT 0,
    total_quotes INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_twitter_thread_title CHECK (LENGTH(title) <= 200),
    CONSTRAINT chk_twitter_thread_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 1)
);

-- ==============================================
-- INSTAGRAM TABLES
-- ==============================================

-- Instagram Feed Posts
CREATE TABLE instagram_feed_posts (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    caption TEXT CHECK (LENGTH(caption) <= 2200), -- Post caption (max 2200 chars)
    hashtags TEXT[],                       -- Hashtags (max 30)
    location VARCHAR(200),                 -- Location tag
    alt_text TEXT,                         -- Alt text for accessibility
    
    -- Media Fields
    media_urls TEXT[] NOT NULL,            -- Media URLs (max 10 images/videos)
    media_types VARCHAR(20)[],             -- ['image', 'video', 'carousel']
    media_sizes BIGINT[],                  -- File sizes in bytes
    media_formats VARCHAR(10)[],           -- ['jpg', 'png', 'mp4', 'mov']
    
    -- Image Specific
    image_widths INTEGER[],                -- Image widths in pixels
    image_heights INTEGER[],               -- Image heights in pixels
    image_aspect_ratios VARCHAR(10)[],     -- ['1:1', '4:5', '1.91:1']
    
    -- Video Specific
    video_durations INTEGER[],             -- Video durations in seconds (max 60)
    video_file_sizes BIGINT[],            -- Video file sizes in bytes (max 100MB)
    video_resolutions VARCHAR(20)[],       -- Video resolutions
    video_aspect_ratios VARCHAR(10)[],     -- Video aspect ratios
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    instagram_post_id VARCHAR(50),         -- Instagram's post ID
    
    -- Analytics
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_instagram_caption CHECK (LENGTH(caption) <= 2200),
    CONSTRAINT chk_instagram_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 30),
    CONSTRAINT chk_instagram_media_count CHECK (ARRAY_LENGTH(media_urls, 1) <= 10),
    CONSTRAINT chk_instagram_video_duration CHECK (
        NOT EXISTS (
            SELECT 1 FROM unnest(video_durations) AS duration 
            WHERE duration > 60
        )
    ),
    CONSTRAINT chk_instagram_video_size CHECK (
        NOT EXISTS (
            SELECT 1 FROM unnest(video_file_sizes) AS size 
            WHERE size > 104857600 -- 100MB
        )
    )
);

-- Instagram Stories
CREATE TABLE instagram_stories (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    content TEXT CHECK (LENGTH(content) <= 2200), -- Story text
    media_url VARCHAR(500) NOT NULL,       -- Media URL
    media_type VARCHAR(20) NOT NULL,       -- 'image', 'video'
    stickers JSONB,                        -- Stickers and interactive elements
    
    -- Media Specific
    media_file_size BIGINT,                -- File size in bytes (max 100MB)
    media_format VARCHAR(10),              -- 'jpg', 'png', 'mp4', 'mov'
    
    -- Image Specific
    image_width INTEGER,                   -- Width in pixels
    image_height INTEGER,                  -- Height in pixels (should be 9:16)
    image_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    
    -- Video Specific
    video_duration INTEGER,                -- Duration in seconds (max 15)
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    story_id VARCHAR(50),                  -- Instagram's story ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_instagram_story_content CHECK (LENGTH(content) <= 2200),
    CONSTRAINT chk_instagram_story_size CHECK (media_file_size <= 104857600), -- 100MB
    CONSTRAINT chk_instagram_story_video_duration CHECK (video_duration IS NULL OR video_duration <= 15),
    CONSTRAINT chk_instagram_story_aspect_ratio CHECK (image_aspect_ratio = '9:16' OR video_aspect_ratio = '9:16')
);

-- Instagram Reels
CREATE TABLE instagram_reels (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    caption TEXT CHECK (LENGTH(caption) <= 2200), -- Reel caption
    hashtags TEXT[],                       -- Hashtags (max 30)
    audio_url VARCHAR(500),                -- Audio track URL
    audio_title VARCHAR(200),              -- Audio track title
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (5-90)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 100MB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov'
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    reel_id VARCHAR(50),                   -- Instagram's reel ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_instagram_reel_caption CHECK (LENGTH(caption) <= 2200),
    CONSTRAINT chk_instagram_reel_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 30),
    CONSTRAINT chk_instagram_reel_duration CHECK (video_duration >= 5 AND video_duration <= 90),
    CONSTRAINT chk_instagram_reel_size CHECK (video_file_size <= 104857600), -- 100MB
    CONSTRAINT chk_instagram_reel_aspect_ratio CHECK (video_aspect_ratio = '9:16')
);

-- Instagram IGTV
CREATE TABLE instagram_igtv (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500) NOT NULL,           -- IGTV title (max 500 chars)
    description TEXT CHECK (LENGTH(description) <= 2200), -- IGTV description
    hashtags TEXT[],                       -- Hashtags (max 30)
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (min 60)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 100MB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov'
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- '9:16' or '16:9'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    igtv_id VARCHAR(50),                   -- Instagram's IGTV ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_instagram_igtv_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_instagram_igtv_description CHECK (LENGTH(description) <= 2200),
    CONSTRAINT chk_instagram_igtv_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 30),
    CONSTRAINT chk_instagram_igtv_duration CHECK (video_duration >= 60),
    CONSTRAINT chk_instagram_igtv_size CHECK (video_file_size <= 104857600), -- 100MB
    CONSTRAINT chk_instagram_igtv_aspect_ratio CHECK (video_aspect_ratio IN ('9:16', '16:9'))
);

-- ==============================================
-- YOUTUBE TABLES
-- ==============================================

-- YouTube Shorts
CREATE TABLE youtube_shorts (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500) NOT NULL,           -- Short title (max 500 chars)
    description TEXT CHECK (LENGTH(description) <= 5000), -- Short description
    hashtags TEXT[],                       -- Hashtags (max 15)
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (max 60)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 256GB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov', 'avi'
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    video_bitrate INTEGER,                 -- Video bitrate
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    video_id VARCHAR(50),                  -- YouTube's video ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_youtube_shorts_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_youtube_shorts_description CHECK (LENGTH(description) <= 5000),
    CONSTRAINT chk_youtube_shorts_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 15),
    CONSTRAINT chk_youtube_shorts_duration CHECK (video_duration <= 60),
    CONSTRAINT chk_youtube_shorts_size CHECK (video_file_size <= 274877906944), -- 256GB
    CONSTRAINT chk_youtube_shorts_aspect_ratio CHECK (video_aspect_ratio = '9:16')
);

-- YouTube Videos
CREATE TABLE youtube_videos (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500) NOT NULL,           -- Video title (max 500 chars)
    description TEXT CHECK (LENGTH(description) <= 5000), -- Video description
    tags TEXT[],                           -- Video tags (max 15)
    category VARCHAR(100),                 -- Video category
    language VARCHAR(10),                  -- Video language code
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (max 43200 = 12 hours)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 256GB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov', 'avi'
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- '16:9', '9:16', '1:1'
    video_bitrate INTEGER,                 -- Video bitrate
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    video_id VARCHAR(50),                  -- YouTube's video ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_youtube_video_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_youtube_video_description CHECK (LENGTH(description) <= 5000),
    CONSTRAINT chk_youtube_video_tags CHECK (ARRAY_LENGTH(tags, 1) <= 15),
    CONSTRAINT chk_youtube_video_duration CHECK (video_duration <= 43200), -- 12 hours
    CONSTRAINT chk_youtube_video_size CHECK (video_file_size <= 274877906944), -- 256GB
    CONSTRAINT chk_youtube_video_aspect_ratio CHECK (video_aspect_ratio IN ('16:9', '9:16', '1:1'))
);

-- YouTube Live
CREATE TABLE youtube_live (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500) NOT NULL,           -- Live stream title
    description TEXT CHECK (LENGTH(description) <= 5000), -- Live stream description
    tags TEXT[],                           -- Live stream tags
    
    -- Live Stream Fields
    scheduled_for TIMESTAMP NOT NULL,      -- Live stream start time
    duration INTEGER,                      -- Expected duration in minutes
    stream_key VARCHAR(100),               -- YouTube stream key
    stream_url VARCHAR(500),               -- Stream URL
    
    -- Scheduling & Status
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    live_video_id VARCHAR(50),             -- YouTube's live video ID
    
    -- Analytics
    peak_viewers INTEGER DEFAULT 0,
    total_viewers INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_youtube_live_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_youtube_live_description CHECK (LENGTH(description) <= 5000),
    CONSTRAINT chk_youtube_live_tags CHECK (ARRAY_LENGTH(tags, 1) <= 15)
);

-- ==============================================
-- FACEBOOK TABLES
-- ==============================================

-- Facebook Posts
CREATE TABLE facebook_posts (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    content TEXT CHECK (LENGTH(content) <= 63206), -- Post content (max 63,206 chars)
    hashtags TEXT[],                       -- Hashtags (max 30)
    location VARCHAR(200),                 -- Location tag
    
    -- Media Fields
    media_urls TEXT[],                     -- Media URLs (max 12 images/videos)
    media_types VARCHAR(20)[],             -- ['image', 'video']
    media_sizes BIGINT[],                  -- File sizes in bytes
    media_formats VARCHAR(10)[],           -- ['jpg', 'png', 'gif', 'mp4', 'mov']
    
    -- Image Specific
    image_widths INTEGER[],                -- Image widths in pixels
    image_heights INTEGER[],               -- Image heights in pixels
    image_aspect_ratios VARCHAR(10)[],     -- ['1:1', '4:5', '1.91:1']
    image_file_sizes BIGINT[],            -- Image file sizes in bytes (max 4MB each)
    
    -- Video Specific
    video_durations INTEGER[],             -- Video durations in seconds (max 1200 = 20 min)
    video_file_sizes BIGINT[],            -- Video file sizes in bytes (max 1GB each)
    video_resolutions VARCHAR(20)[],       -- Video resolutions
    video_aspect_ratios VARCHAR(10)[],     -- Video aspect ratios
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    post_id VARCHAR(50),                   -- Facebook's post ID
    
    -- Analytics
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_facebook_content CHECK (LENGTH(content) <= 63206),
    CONSTRAINT chk_facebook_hashtags CHECK (ARRAY_LENGTH(hashtags, 1) <= 30),
    CONSTRAINT chk_facebook_media_count CHECK (ARRAY_LENGTH(media_urls, 1) <= 12),
    CONSTRAINT chk_facebook_image_size CHECK (
        NOT EXISTS (
            SELECT 1 FROM unnest(image_file_sizes) AS size 
            WHERE size > 4194304 -- 4MB
        )
    ),
    CONSTRAINT chk_facebook_video_duration CHECK (
        NOT EXISTS (
            SELECT 1 FROM unnest(video_durations) AS duration 
            WHERE duration > 1200 -- 20 minutes
        )
    ),
    CONSTRAINT chk_facebook_video_size CHECK (
        NOT EXISTS (
            SELECT 1 FROM unnest(video_file_sizes) AS size 
            WHERE size > 1073741824 -- 1GB
        )
    )
);

-- Facebook Stories
CREATE TABLE facebook_stories (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    content TEXT CHECK (LENGTH(content) <= 500), -- Story text (max 500 chars)
    media_url VARCHAR(500) NOT NULL,       -- Media URL
    media_type VARCHAR(20) NOT NULL,       -- 'image', 'video'
    stickers JSONB,                        -- Stickers and interactive elements
    
    -- Media Specific
    media_file_size BIGINT,                -- File size in bytes (max 100MB)
    media_format VARCHAR(10),              -- 'jpg', 'png', 'mp4', 'mov'
    
    -- Image Specific
    image_width INTEGER,                   -- Width in pixels
    image_height INTEGER,                  -- Height in pixels (should be 9:16)
    image_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    
    -- Video Specific
    video_duration INTEGER,                -- Duration in seconds (max 15)
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- Should be '9:16'
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    story_id VARCHAR(50),                  -- Facebook's story ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_facebook_story_content CHECK (LENGTH(content) <= 500),
    CONSTRAINT chk_facebook_story_size CHECK (media_file_size <= 104857600), -- 100MB
    CONSTRAINT chk_facebook_story_video_duration CHECK (video_duration IS NULL OR video_duration <= 15),
    CONSTRAINT chk_facebook_story_aspect_ratio CHECK (image_aspect_ratio = '9:16' OR video_aspect_ratio = '9:16')
);

-- Facebook Videos
CREATE TABLE facebook_videos (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500),                    -- Video title
    description TEXT CHECK (LENGTH(description) <= 5000), -- Video description
    hashtags TEXT[],                       -- Hashtags
    
    -- Video Fields
    video_url VARCHAR(500) NOT NULL,       -- Video file URL
    thumbnail_url VARCHAR(500),            -- Thumbnail URL
    video_duration INTEGER NOT NULL,       -- Duration in seconds (max 14400 = 4 hours)
    video_file_size BIGINT NOT NULL,       -- File size in bytes (max 1GB)
    video_format VARCHAR(10) NOT NULL,     -- 'mp4', 'mov', 'avi'
    video_resolution VARCHAR(20),          -- Video resolution
    video_aspect_ratio VARCHAR(10),        -- Video aspect ratio
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    video_id VARCHAR(50),                  -- Facebook's video ID
    
    -- Analytics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_facebook_video_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_facebook_video_description CHECK (LENGTH(description) <= 5000),
    CONSTRAINT chk_facebook_video_duration CHECK (video_duration <= 14400), -- 4 hours
    CONSTRAINT chk_facebook_video_size CHECK (video_file_size <= 1073741824) -- 1GB
);

-- Facebook Events
CREATE TABLE facebook_events (
    id SERIAL PRIMARY KEY,
    -- Content Fields
    title VARCHAR(500) NOT NULL,           -- Event title
    description TEXT CHECK (LENGTH(description) <= 5000), -- Event description
    location VARCHAR(200),                 -- Event location
    event_type VARCHAR(50),                -- Event type
    
    -- Event Fields
    scheduled_for TIMESTAMP NOT NULL,      -- Event start time
    end_time TIMESTAMP,                    -- Event end time
    duration INTEGER,                      -- Event duration in minutes
    max_attendees INTEGER,                 -- Maximum attendees
    
    -- Scheduling & Status
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    event_id VARCHAR(50),                  -- Facebook's event ID
    
    -- Analytics
    attendees INTEGER DEFAULT 0,
    interested INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_facebook_event_title CHECK (LENGTH(title) <= 500),
    CONSTRAINT chk_facebook_event_description CHECK (LENGTH(description) <= 5000)
);

-- ==============================================
-- CAMPAIGN MANAGEMENT TABLES
-- ==============================================

-- Campaigns
CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY,
    -- Campaign Fields
    name VARCHAR(200) NOT NULL,            -- Campaign name
    description TEXT,                      -- Campaign description
    start_date DATE NOT NULL,              -- Campaign start date
    end_date DATE NOT NULL,                -- Campaign end date
    status VARCHAR(20) DEFAULT 'draft',    -- 'draft', 'active', 'paused', 'completed'
    
    -- Budget & Goals
    budget DECIMAL(10,2),                  -- Campaign budget
    goals TEXT[],                          -- Campaign goals array
    target_audience TEXT,                  -- Target audience description
    key_metrics TEXT[],                    -- Key metrics to track
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_campaign_name CHECK (LENGTH(name) <= 200),
    CONSTRAINT chk_campaign_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_campaign_budget CHECK (budget IS NULL OR budget >= 0)
);

-- Campaign Content Mapping
CREATE TABLE campaign_content (
    id SERIAL PRIMARY KEY,
    -- Foreign Keys
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Content Identification
    platform VARCHAR(50) NOT NULL,        -- 'linkedin', 'twitter', 'instagram', etc.
    content_type VARCHAR(50) NOT NULL,     -- 'post', 'article', 'video', etc.
    content_id INTEGER NOT NULL,           -- ID from respective platform table
    
    -- Scheduling
    scheduled_for TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_campaign_content_platform CHECK (platform IN ('linkedin', 'twitter', 'instagram', 'youtube', 'facebook')),
    CONSTRAINT chk_campaign_content_type CHECK (content_type IN ('post', 'article', 'video', 'audio', 'tweet', 'thread', 'story', 'reel', 'igtv', 'short', 'live', 'event'))
);

-- ==============================================
-- ANALYTICS TABLES
-- ==============================================

-- Content Analytics
CREATE TABLE content_analytics (
    id SERIAL PRIMARY KEY,
    -- Content Identification
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    content_id INTEGER NOT NULL,
    
    -- Date & Time
    date DATE NOT NULL,
    hour INTEGER CHECK (hour >= 0 AND hour <= 23),
    
    -- Engagement Metrics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,               -- Instagram saves
    retweets INTEGER DEFAULT 0,            -- Twitter retweets
    quotes INTEGER DEFAULT 0,              -- Twitter quotes
    
    -- Calculated Metrics
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_analytics_platform CHECK (platform IN ('linkedin', 'twitter', 'instagram', 'youtube', 'facebook')),
    CONSTRAINT chk_analytics_engagement CHECK (engagement_rate >= 0 AND engagement_rate <= 100)
);

-- ==============================================
-- INDEXES FOR PERFORMANCE
-- ==============================================

-- LinkedIn Indexes
CREATE INDEX idx_linkedin_posts_scheduled ON linkedin_posts(scheduled_for);
CREATE INDEX idx_linkedin_posts_status ON linkedin_posts(status);
CREATE INDEX idx_linkedin_articles_scheduled ON linkedin_articles(scheduled_for);
CREATE INDEX idx_linkedin_videos_scheduled ON linkedin_videos(scheduled_for);

-- Twitter Indexes
CREATE INDEX idx_twitter_tweets_scheduled ON twitter_tweets(scheduled_for);
CREATE INDEX idx_twitter_tweets_status ON twitter_tweets(status);
CREATE INDEX idx_twitter_threads_scheduled ON twitter_threads(scheduled_for);

-- Instagram Indexes
CREATE INDEX idx_instagram_posts_scheduled ON instagram_feed_posts(scheduled_for);
CREATE INDEX idx_instagram_posts_status ON instagram_feed_posts(status);
CREATE INDEX idx_instagram_stories_scheduled ON instagram_stories(scheduled_for);
CREATE INDEX idx_instagram_reels_scheduled ON instagram_reels(scheduled_for);
CREATE INDEX idx_instagram_igtv_scheduled ON instagram_igtv(scheduled_for);

-- YouTube Indexes
CREATE INDEX idx_youtube_shorts_scheduled ON youtube_shorts(scheduled_for);
CREATE INDEX idx_youtube_videos_scheduled ON youtube_videos(scheduled_for);
CREATE INDEX idx_youtube_live_scheduled ON youtube_live(scheduled_for);

-- Facebook Indexes
CREATE INDEX idx_facebook_posts_scheduled ON facebook_posts(scheduled_for);
CREATE INDEX idx_facebook_posts_status ON facebook_posts(status);
CREATE INDEX idx_facebook_stories_scheduled ON facebook_stories(scheduled_for);
CREATE INDEX idx_facebook_videos_scheduled ON facebook_videos(scheduled_for);
CREATE INDEX idx_facebook_events_scheduled ON facebook_events(scheduled_for);

-- Campaign Indexes
CREATE INDEX idx_campaign_content_campaign ON campaign_content(campaign_id);
CREATE INDEX idx_campaign_content_scheduled ON campaign_content(scheduled_for);
CREATE INDEX idx_campaign_content_platform ON campaign_content(platform, content_type);

-- Analytics Indexes
CREATE INDEX idx_content_analytics_platform ON content_analytics(platform, content_type, content_id);
CREATE INDEX idx_content_analytics_date ON content_analytics(date);
CREATE INDEX idx_content_analytics_engagement ON content_analytics(engagement_rate);

-- ==============================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ==============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables
CREATE TRIGGER update_linkedin_posts_updated_at BEFORE UPDATE ON linkedin_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_linkedin_articles_updated_at BEFORE UPDATE ON linkedin_articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_linkedin_videos_updated_at BEFORE UPDATE ON linkedin_videos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_twitter_tweets_updated_at BEFORE UPDATE ON twitter_tweets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_instagram_posts_updated_at BEFORE UPDATE ON instagram_feed_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_youtube_videos_updated_at BEFORE UPDATE ON youtube_videos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_facebook_posts_updated_at BEFORE UPDATE ON facebook_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();























