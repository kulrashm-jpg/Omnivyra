# P0 Implementation - Quick Start Checklist

## 🚀 Runnable Checklist (15 steps)

```bash
# ✅ STEP 1: Install dependencies
npm install

# ✅ STEP 2: Create .env.local file
# Copy content from README_P0_IMPLEMENTATION.md .env.example section

# ✅ STEP 3: Generate encryption key
# On Windows PowerShell:
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
# Or use online tool: https://generate-random.org/api-key-generator?count=1&length=32&type=hex

# ✅ STEP 4: Add to .env.local:
# ENCRYPTION_KEY=<generated_64_char_hex_string>
# SUPABASE_URL=<your_supabase_url>
# SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
# REDIS_URL=redis://localhost:6379

# ✅ STEP 5: Start Redis (Docker)
docker run -d -p 6379:6379 --name redis redis:7

# ✅ STEP 6: Verify Redis running
docker ps | grep redis
# Or: redis-cli ping (should return PONG)

# ✅ STEP 7: Apply database schema (if not done)
# Run in Supabase SQL Editor: db-utils/safe-database-migration.sql

# ✅ STEP 8: Seed demo data (optional)
# Run in Supabase SQL Editor: scripts/seed-demo-data.sql
# Note the returned IDs for verification

# ✅ STEP 9: Start Queue Worker (Terminal 1)
npm run start:worker
# Expected: "✅ Queue worker started. Listening for jobs..."

# ✅ STEP 10: Start Cron Scheduler (Terminal 2)
npm run start:cron
# Expected: "⏰ Starting cron scheduler (interval: 60s)..."

# ✅ STEP 11: Wait for cron cycle (60 seconds)
# Watch Terminal 2 for: "✅ Scheduler cycle completed"

# ✅ STEP 12: Check queue_jobs created
# Run in Supabase SQL Editor: scripts/check-publish-status.sql

# ✅ STEP 13: Verify worker processed job
# Watch Terminal 1 for: "✅ Post published successfully"

# ✅ STEP 14: Verify scheduled_post updated
# Check: scheduled_posts.status = 'published', platform_post_id populated

# ✅ STEP 15: Run integration test (optional)
npm test
```

## 🔍 Demo Data Seeding Commands

### SQL Commands (Run in Supabase SQL Editor)

```sql
-- 1. Create test user
INSERT INTO users (id, email, name)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'test@example.com',
  'Test User'
)
ON CONFLICT (id) DO UPDATE SET name = 'Test User';

-- 2. Create social account (save the returned id)
INSERT INTO social_accounts (
  id, user_id, platform, platform_user_id, account_name, 
  username, access_token, is_active
)
VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  'linkedin',
  'test_linkedin_user_123',
  'Test LinkedIn Account',
  'test_linkedin',
  'mock_token_placeholder', -- In production, encrypt via tokenStore.setToken()
  true
)
RETURNING id as social_account_id;

-- 3. Create scheduled post (use social_account_id from step 2)
INSERT INTO scheduled_posts (
  id, user_id, social_account_id, platform, content_type,
  content, scheduled_for, status, timezone
)
VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  '<SOCIAL_ACCOUNT_ID_FROM_STEP_2>',
  'linkedin',
  'post',
  'Test post from P0 implementation 🚀 #TestPost',
  NOW() - INTERVAL '1 minute', -- Due 1 minute ago
  'scheduled',
  'UTC'
)
RETURNING id as scheduled_post_id;
```

### Verification Queries

```sql
-- Check scheduled post status
SELECT id, status, platform_post_id, post_url, scheduled_for
FROM scheduled_posts
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC LIMIT 1;

-- Check queue jobs
SELECT id, scheduled_post_id, status, attempts, error_message
FROM queue_jobs
ORDER BY created_at DESC LIMIT 5;

-- Check queue job logs
SELECT log_level, message, created_at
FROM queue_job_logs
ORDER BY created_at DESC LIMIT 10;
```

## 🔑 Environment Variables Reference

### Critical (Required for operation)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=<64_hex_char_string>
```

### Development (Optional - enables mock mode)
```bash
USE_MOCK_PLATFORMS=true
CRON_INTERVAL_SECONDS=60
```

### Production (Required for real posting)
```bash
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret
# ... (similar for other platforms)
```

## ⚠️ Troubleshooting

**Issue**: `Redis connection error`
- Fix: Ensure Redis is running: `docker ps | grep redis`
- Fix: Check `REDIS_URL` matches Redis instance

**Issue**: `ENCRYPTION_KEY must be 32 bytes`
- Fix: Generate new key: `openssl rand -hex 32` (64 hex chars)
- Fix: Verify key is exactly 64 characters

**Issue**: `Cannot find module './schedulerService'`
- Fix: Ensure TypeScript can resolve paths (check `tsconfig.json`)
- Fix: Run with: `node -r ts-node/register` or compile first

**Issue**: Queue jobs created but not processing
- Fix: Verify worker is running: `npm run start:worker`
- Fix: Check worker logs for errors
- Fix: Verify Redis connection in worker logs

**Issue**: `Scheduled post not found`
- Fix: Run `scripts/seed-demo-data.sql` to create test data
- Fix: Verify `scheduled_for` is in the past (due)
- Fix: Verify `status = 'scheduled'`

## 📋 Next Steps After Setup

1. ✅ Verify worker and cron are running
2. ✅ Seed test data and verify queue job created
3. ✅ Check worker processes job successfully
4. ✅ Verify `scheduled_posts.status = 'published'`
5. ✅ Add real OAuth credentials for production
6. ✅ Disable `USE_MOCK_PLATFORMS` for real posting
7. ✅ Setup production deployment (PM2/systemd)
8. ✅ Configure monitoring and alerts

---

**Status**: ✅ All P0 starter code implemented and ready for testing!

