# .env.example Template

Since `.env.example` is protected, copy this content to create `.env.example` manually:

```env
# ==========================================
# P0 IMPLEMENTATION - ENVIRONMENT CONFIG
# Copy this file to .env.local and fill in your values
# Never commit .env.local to version control!
# ==========================================

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Encryption (AES-256-GCM)
# Generate with: npm run setup:key
# Must be exactly 64 hex characters (32 bytes)
ENCRYPTION_KEY=your_64_character_hex_encryption_key_here

# Development Mode
# Set to 'true' to use mock adapters (no real API calls)
USE_MOCK_PLATFORMS=true

# Cron Configuration
# Interval in seconds (default: 60)
CRON_INTERVAL_SECONDS=60

# Social Media API Credentials (Optional for dev, required for production)
# LinkedIn
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret

# X (Twitter)
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret

# Facebook
FACEBOOK_CLIENT_ID=your_facebook_client_id
FACEBOOK_CLIENT_SECRET=your_facebook_client_secret

# Instagram
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret

# YouTube
YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret

# TikTok
TIKTOK_CLIENT_ID=your_tiktok_client_id
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret

# Spotify
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Star Maker
STARMAKER_CLIENT_ID=your_starmaker_client_id
STARMAKER_CLIENT_SECRET=your_starmaker_client_secret

# Suno
SUNO_CLIENT_ID=your_suno_client_id
SUNO_CLIENT_SECRET=your_suno_client_secret

# Pinterest
PINTEREST_CLIENT_ID=your_pinterest_client_id
PINTEREST_CLIENT_SECRET=your_pinterest_client_secret
PINTEREST_APP_ID=your_pinterest_app_id

# Test Configuration (for integration tests)
TEST_USER_ID=your_test_user_uuid
```

