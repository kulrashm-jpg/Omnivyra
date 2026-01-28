-- Demo Data Seeding Script for P0 Testing
-- Run this in Supabase SQL Editor to create test scheduled_post and social_account
-- 
-- After running, note the IDs returned and use them for testing

-- Step 1: Ensure test user exists
INSERT INTO users (id, email, name)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'test@example.com',
  'Test User'
)
ON CONFLICT (id) DO UPDATE SET name = 'Test User';

-- Step 2: Create demo social account (with placeholder encrypted token)
-- NOTE: In production, token should be encrypted via tokenStore.setToken()
-- For testing with USE_MOCK_PLATFORMS=true, any string works
INSERT INTO social_accounts (
  id, 
  user_id, 
  platform, 
  platform_user_id, 
  account_name, 
  username, 
  access_token, 
  is_active
)
VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  'linkedin',
  'test_linkedin_user_123',
  'Test LinkedIn Account',
  'test_linkedin',
  'mock_encrypted_token_for_testing', -- Will be replaced with encrypted token in real usage
  true
)
RETURNING id as social_account_id;

-- Step 3: Create demo scheduled post (due now - scheduled 1 minute ago)
-- Use the social_account_id from Step 2 above
INSERT INTO scheduled_posts (
  id, 
  user_id, 
  social_account_id, 
  platform, 
  content_type,
  content, 
  scheduled_for, 
  status, 
  timezone
)
SELECT
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  sa.id, -- Use the social_account_id from above
  'linkedin',
  'post',
  'Test post from P0 implementation 🚀 #TestPost #Demo',
  NOW() - INTERVAL '1 minute', -- Due 1 minute ago (will be picked up by cron)
  'scheduled',
  'UTC'
FROM social_accounts sa
WHERE sa.platform = 'linkedin'
  AND sa.user_id = '550e8400-e29b-41d4-a716-446655440000'
LIMIT 1
RETURNING id as scheduled_post_id;

-- Verification queries:

-- Check scheduled post
-- SELECT id, status, scheduled_for, platform 
-- FROM scheduled_posts 
-- WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
-- ORDER BY created_at DESC LIMIT 1;

-- Check if queue job was created by cron
-- SELECT * FROM queue_jobs 
-- WHERE scheduled_post_id IN (
--   SELECT id FROM scheduled_posts 
--   WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
-- )
-- ORDER BY created_at DESC LIMIT 1;

