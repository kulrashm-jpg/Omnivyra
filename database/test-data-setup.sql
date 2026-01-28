-- TEST DATA FOR ENHANCED PLANNING SYSTEM
-- This script creates sample data to test the comprehensive planning system

-- ==============================================
-- CREATE TEST CAMPAIGN
-- ==============================================

-- Insert a test campaign (if one doesn't exist)
INSERT INTO campaigns (
    id,
    name,
    description,
    start_date,
    end_date,
    status,
    current_stage,
    timeframe,
    user_id,
    thread_id,
    weekly_themes,
    ai_generated_summary,
    created_at,
    updated_at
) VALUES (
    'test-campaign-123',
    'Drishiq Music Promotion Test Campaign',
    'Test campaign for comprehensive 12-week content planning system',
    '2024-01-01',
    '2024-03-31',
    'planning',
    'planning',
    'quarter',
    '550e8400-e29b-41d4-a716-446655440000',
    'thread_test_123',
    '[]'::jsonb,
    'AI-generated test campaign for music promotion',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- CREATE TEST CAMPAIGN STRATEGY
-- ==============================================

INSERT INTO campaign_strategies (
    campaign_id,
    objective,
    target_audience,
    key_platforms,
    campaign_phases,
    content_pillars,
    content_frequency,
    visual_identity,
    voice_tone,
    overall_goals,
    weekly_kpis,
    hashtag_strategy,
    posting_guidelines,
    ai_enhancement_notes
) VALUES (
    'test-campaign-123',
    'Build brand awareness and audience engagement for Drishiq using existing music catalog',
    'Music lovers, indie music fans, playlist curators, emerging artists',
    ARRAY['instagram', 'tiktok', 'youtube', 'twitter', 'facebook'],
    '{
        "Foundation": {
            "name": "Foundation & Discovery",
            "weeks": [1, 2, 3],
            "description": "Build initial awareness and establish brand presence"
        },
        "Growth": {
            "name": "Growth & Momentum", 
            "weeks": [4, 5, 6],
            "description": "Expand reach through viral content and collaborations"
        },
        "Consolidation": {
            "name": "Consolidation & Amplification",
            "weeks": [7, 8, 9], 
            "description": "Strengthen community and drive conversions"
        },
        "Sustain": {
            "name": "Sustain & Scale",
            "weeks": [10, 11, 12],
            "description": "Maintain momentum and plan for future growth"
        }
    }'::jsonb,
    '[
        {
            "id": "pillar-1",
            "name": "Music Showcases",
            "description": "Featured tracks, albums, and playlists to highlight the music catalog",
            "percentage": 40,
            "contentTypes": ["post", "video", "story", "reel"],
            "platforms": ["instagram", "tiktok", "youtube"],
            "hashtagCategories": ["music", "newmusic", "indie"],
            "visualStyle": {
                "colors": ["#1DB954", "#191414", "#FFFFFF"],
                "fonts": ["Montserrat", "Helvetica"],
                "templates": ["music-showcase", "album-cover", "track-highlight"]
            }
        },
        {
            "id": "pillar-2", 
            "name": "Behind-the-Scenes",
            "description": "Creative process, studio sessions, and artist life content",
            "percentage": 25,
            "contentTypes": ["story", "video", "post"],
            "platforms": ["instagram", "youtube"],
            "hashtagCategories": ["behindthescenes", "studio", "creative"],
            "visualStyle": {
                "colors": ["#FF6B6B", "#4ECDC4", "#45B7D1"],
                "fonts": ["Open Sans", "Roboto"],
                "templates": ["studio-tour", "process-video", "artist-life"]
            }
        },
        {
            "id": "pillar-3",
            "name": "Fan Engagement", 
            "description": "User-generated content, testimonials, and community features",
            "percentage": 20,
            "contentTypes": ["post", "story", "reel"],
            "platforms": ["instagram", "tiktok", "facebook"],
            "hashtagCategories": ["fancontent", "testimonial", "community"],
            "visualStyle": {
                "colors": ["#FFD93D", "#6BCF7F", "#4D96FF"],
                "fonts": ["Poppins", "Inter"],
                "templates": ["fan-feature", "testimonial-card", "community-spotlight"]
            }
        },
        {
            "id": "pillar-4",
            "name": "Educational",
            "description": "Music tips, industry insights, and tutorials", 
            "percentage": 10,
            "contentTypes": ["post", "video", "article"],
            "platforms": ["linkedin", "youtube", "instagram"],
            "hashtagCategories": ["musictips", "industry", "tutorial"],
            "visualStyle": {
                "colors": ["#8B5CF6", "#06B6D4", "#10B981"],
                "fonts": ["Source Sans Pro", "Lato"],
                "templates": ["tip-card", "tutorial-video", "insight-post"]
            }
        },
        {
            "id": "pillar-5",
            "name": "Promotional",
            "description": "Links, calls-to-action, and conversion-focused content",
            "percentage": 5,
            "contentTypes": ["post", "story"],
            "platforms": ["instagram", "facebook", "twitter"],
            "hashtagCategories": ["promotion", "linkinbio", "cta"],
            "visualStyle": {
                "colors": ["#EF4444", "#F59E0B", "#8B5CF6"],
                "fonts": ["Bebas Neue", "Impact"],
                "templates": ["cta-banner", "promo-card", "link-post"]
            }
        }
    ]'::jsonb,
    '{
        "instagram": {
            "posts": 4,
            "stories": 7,
            "reels": 3
        },
        "tiktok": {
            "videos": 6
        },
        "youtube": {
            "videos": 2,
            "shorts": 4
        },
        "twitter": {
            "tweets": 10,
            "threads": 2
        },
        "facebook": {
            "posts": 3,
            "stories": 4
        }
    }'::jsonb,
    '{
        "colors": ["#1DB954", "#191414", "#FFFFFF", "#FF6B6B"],
        "fonts": ["Montserrat", "Helvetica", "Open Sans"],
        "templates": ["music-showcase", "album-cover", "studio-tour", "fan-feature"]
    }'::jsonb,
    'Authentic and relatable, passionate about music, community-focused, encouraging and supportive',
    '{
        "totalImpressions": 75000,
        "totalEngagements": 5000,
        "followerGrowth": 2000,
        "ugcSubmissions": 200,
        "playlistAdds": 1000,
        "websiteTraffic": 3000
    }'::jsonb,
    '{
        "impressions": 5000,
        "engagements": 300,
        "followerGrowth": 150,
        "ugcSubmissions": 15
    }'::jsonb,
    '{
        "branded": ["#DrishiqMusic", "#DrishiqVibes", "#DrishiqCommunity"],
        "industry": ["#IndieMusic", "#NewMusic", "#MusicDiscovery", "#EmergingArtist"],
        "trending": ["#MusicTok", "#NewMusicFriday", "#IndieMusic", "#MusicLovers"]
    }'::jsonb,
    'Focus on authentic storytelling and community building. Maintain consistent brand voice and visual identity.',
    'AI-enhanced content strategy with multi-provider support for optimal engagement'
) ON CONFLICT (campaign_id) DO UPDATE SET
    objective = EXCLUDED.objective,
    target_audience = EXCLUDED.target_audience,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- CREATE TEST WEEKLY PLANS
-- ==============================================

-- Insert test weekly plans for first 3 weeks
INSERT INTO weekly_content_refinements (
    campaign_id,
    week_number,
    theme,
    focus_area,
    phase,
    key_messaging,
    content_types,
    platform_strategy,
    call_to_action,
    target_metrics,
    content_guidelines,
    hashtag_suggestions,
    completion_percentage,
    refinement_status,
    created_at,
    updated_at
) VALUES 
(
    'test-campaign-123',
    1,
    'Brand Introduction & Music Catalog Showcase',
    'Introduce the brand, showcase top tracks',
    'Foundation',
    'Meet Drishiq - Your New Music Discovery',
    ARRAY['post', 'story', 'video', 'reel'],
    '[
        {"platform": "instagram", "posts": 4, "stories": 7, "reels": 3},
        {"platform": "tiktok", "videos": 6},
        {"platform": "youtube", "videos": 2, "shorts": 4}
    ]'::jsonb,
    'Follow for more music discovery',
    '{
        "impressions": 5000,
        "engagements": 300,
        "conversions": 50,
        "ugcSubmissions": 25
    }'::jsonb,
    'Focus on brand introduction and music catalog showcase. Use engaging visuals and authentic storytelling.',
    ARRAY['#DrishiqMusic', '#NewMusic', '#IndieMusic', '#MusicDiscovery'],
    25,
    'ai-enhanced',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'test-campaign-123',
    2,
    'Artist Story & Music Journey',
    'Artist background, musical influences, creative process',
    'Foundation',
    'The Story Behind the Sound',
    ARRAY['story', 'video', 'post'],
    '[
        {"platform": "instagram", "posts": 4, "stories": 7, "reels": 3},
        {"platform": "youtube", "videos": 2, "shorts": 4},
        {"platform": "twitter", "tweets": 10, "threads": 2}
    ]'::jsonb,
    'Discover the artist behind the music',
    '{
        "impressions": 6000,
        "engagements": 350,
        "conversions": 60,
        "ugcSubmissions": 30
    }'::jsonb,
    'Share behind-the-scenes content and artist journey. Build personal connection with audience.',
    ARRAY['#BehindTheScenes', '#ArtistStory', '#MusicJourney', '#CreativeProcess'],
    15,
    'ai-enhanced',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'test-campaign-123',
    3,
    'Fan Engagement Launch',
    'User-generated content, fan testimonials, playlist creation',
    'Foundation',
    'Your Soundtrack, Your Story',
    ARRAY['post', 'story', 'reel'],
    '[
        {"platform": "instagram", "posts": 4, "stories": 7, "reels": 3},
        {"platform": "tiktok", "videos": 6},
        {"platform": "facebook", "posts": 3, "stories": 4}
    ]'::jsonb,
    'Share your story with us',
    '{
        "impressions": 7000,
        "engagements": 400,
        "conversions": 70,
        "ugcSubmissions": 40
    }'::jsonb,
    'Encourage user-generated content and community participation. Feature fan stories and testimonials.',
    ARRAY['#FanContent', '#YourStory', '#Community', '#Testimonial'],
    10,
    'ai-enhanced',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT (campaign_id, week_number) DO UPDATE SET
    theme = EXCLUDED.theme,
    focus_area = EXCLUDED.focus_area,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- CREATE TEST DAILY PLANS
-- ==============================================

-- Insert test daily plans for week 1
INSERT INTO daily_content_plans (
    campaign_id,
    week_number,
    day_of_week,
    date,
    platform,
    content_type,
    title,
    content,
    description,
    media_requirements,
    hashtags,
    call_to_action,
    optimal_posting_time,
    target_metrics,
    status,
    priority,
    ai_generated,
    created_at,
    updated_at
) VALUES 
(
    'test-campaign-123',
    1,
    'Monday',
    '2024-01-01',
    'instagram',
    'post',
    'Monday Music Discovery',
    'Start your week with fresh sounds from Drishiq! 🎵 Discover our latest tracks and let us know which one gets you moving. #MondayMotivation #NewMusic',
    'Monday motivational post introducing Drishiq music catalog',
    '{
        "type": "image",
        "dimensions": "1080x1080",
        "aspectRatio": "1:1"
    }'::jsonb,
    ARRAY['DrishiqMusic', 'MondayMotivation', 'NewMusic', 'MusicDiscovery'],
    'Follow for more music discovery',
    '09:00',
    '{
        "impressions": 1000,
        "engagements": 50,
        "clicks": 10
    }'::jsonb,
    'planned',
    'medium',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'test-campaign-123',
    1,
    'Tuesday',
    '2024-01-02',
    'tiktok',
    'video',
    'Trending Tuesday: Drishiq Vibes',
    'Tuesday vibes with Drishiq! 🎶 Which track should we feature next? Drop your requests below! #TrendingTuesday #MusicTok',
    'Tuesday TikTok video featuring trending music content',
    '{
        "type": "video",
        "dimensions": "1080x1920",
        "aspectRatio": "9:16"
    }'::jsonb,
    ARRAY['TrendingTuesday', 'MusicTok', 'DrishiqVibes', 'MusicRequest'],
    'Drop your music requests below',
    '18:00',
    '{
        "impressions": 2000,
        "engagements": 100,
        "clicks": 20
    }'::jsonb,
    'planned',
    'high',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'test-campaign-123',
    1,
    'Wednesday',
    '2024-01-03',
    'instagram',
    'story',
    'Behind-the-Scenes Wednesday',
    'Behind the music! 🎤 Take a peek into our creative process and studio sessions. What would you like to see more of? #BehindTheScenes #StudioLife',
    'Wednesday behind-the-scenes Instagram story',
    '{
        "type": "image",
        "dimensions": "1080x1920",
        "aspectRatio": "9:16"
    }'::jsonb,
    ARRAY['BehindTheScenes', 'StudioLife', 'CreativeProcess', 'MusicMaking'],
    'What would you like to see more of?',
    '14:00',
    '{
        "impressions": 800,
        "engagements": 40,
        "clicks": 8
    }'::jsonb,
    'planned',
    'medium',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT (campaign_id, week_number, day_of_week) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- CREATE TEST PLATFORM STRATEGIES
-- ==============================================

INSERT INTO platform_strategies (
    campaign_id,
    platform,
    content_frequency,
    optimal_posting_times,
    content_types,
    character_limits,
    media_requirements,
    hashtag_limit,
    engagement_tactics,
    community_management,
    target_metrics,
    success_criteria
) VALUES 
(
    'test-campaign-123',
    'instagram',
    '{
        "posts": 4,
        "stories": 7,
        "reels": 3
    }'::jsonb,
    '{
        "Monday": ["09:00", "18:00"],
        "Tuesday": ["09:00", "18:00"],
        "Wednesday": ["09:00", "18:00"],
        "Thursday": ["09:00", "18:00"],
        "Friday": ["09:00", "18:00"],
        "Saturday": ["10:00", "19:00"],
        "Sunday": ["10:00", "19:00"]
    }'::jsonb,
    ARRAY['post', 'story', 'reel', 'igtv'],
    '{
        "posts": 2200,
        "stories": 100
    }'::jsonb,
    '{
        "images": "1080x1080",
        "videos": "1080x1080",
        "stories": "1080x1920"
    }'::jsonb,
    30,
    ARRAY['polls', 'questions', 'user_tags', 'collaborations'],
    'Respond to comments within 2 hours, engage with user content',
    '{
        "impressions": 15000,
        "engagements": 1000,
        "followers": 500
    }'::jsonb,
    'Achieve 5% engagement rate and 500 new followers per week'
),
(
    'test-campaign-123',
    'tiktok',
    '{
        "videos": 6
    }'::jsonb,
    '{
        "Monday": ["18:00", "21:00"],
        "Tuesday": ["18:00", "21:00"],
        "Wednesday": ["18:00", "21:00"],
        "Thursday": ["18:00", "21:00"],
        "Friday": ["18:00", "21:00"],
        "Saturday": ["19:00", "22:00"],
        "Sunday": ["19:00", "22:00"]
    }'::jsonb,
    ARRAY['video', 'live'],
    '{
        "videos": 300
    }'::jsonb,
    '{
        "videos": "1080x1920",
        "aspectRatio": "9:16"
    }'::jsonb,
    5,
    ARRAY['trending_sounds', 'challenges', 'duets', 'stitches'],
    'Participate in trending challenges and sounds',
    '{
        "impressions": 25000,
        "engagements": 2000,
        "followers": 800
    }'::jsonb,
    'Achieve 8% engagement rate and viral potential'
) ON CONFLICT (campaign_id, platform) DO UPDATE SET
    content_frequency = EXCLUDED.content_frequency,
    target_metrics = EXCLUDED.target_metrics,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- VERIFICATION QUERIES
-- ==============================================

-- Check if test data was inserted successfully
SELECT 
    'TEST DATA VERIFICATION' as check_type,
    'Campaign created' as item,
    CASE WHEN COUNT(*) > 0 THEN '✅ SUCCESS' ELSE '❌ FAILED' END as status
FROM campaigns 
WHERE id = 'test-campaign-123';

SELECT 
    'TEST DATA VERIFICATION' as check_type,
    'Campaign strategy created' as item,
    CASE WHEN COUNT(*) > 0 THEN '✅ SUCCESS' ELSE '❌ FAILED' END as status
FROM campaign_strategies 
WHERE campaign_id = 'test-campaign-123';

SELECT 
    'TEST DATA VERIFICATION' as check_type,
    'Weekly plans created' as item,
    CASE WHEN COUNT(*) > 0 THEN '✅ SUCCESS' ELSE '❌ FAILED' END as status
FROM weekly_content_refinements 
WHERE campaign_id = 'test-campaign-123';

SELECT 
    'TEST DATA VERIFICATION' as check_type,
    'Daily plans created' as item,
    CASE WHEN COUNT(*) > 0 THEN '✅ SUCCESS' ELSE '❌ FAILED' END as status
FROM daily_content_plans 
WHERE campaign_id = 'test-campaign-123';

SELECT 
    'TEST DATA VERIFICATION' as check_type,
    'Platform strategies created' as item,
    CASE WHEN COUNT(*) > 0 THEN '✅ SUCCESS' ELSE '❌ FAILED' END as status
FROM platform_strategies 
WHERE campaign_id = 'test-campaign-123';



