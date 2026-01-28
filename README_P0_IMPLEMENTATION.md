# P0 Implementation Guide

This guide covers the production-ready starter code for critical P0 infrastructure: Queue Worker, Cron Scheduler, OAuth Posting, and Token Encryption.

## 📁 File Structure

```
backend/
├── queue/
│   ├── bullmqClient.ts       # BullMQ Queue/Worker factory
│   ├── worker.ts              # Worker entry point
│   └── jobProcessors/
│       └── publishProcessor.ts # Job processing logic
├── scheduler/
│   ├── cron.ts               # Cron scheduler entry point
│   └── schedulerService.ts   # Service to find due posts and enqueue
├── auth/
│   └── tokenStore.ts         # Token encryption/decryption utilities
├── adapters/
│   ├── platformAdapter.ts    # Main adapter router
│   ├── linkedinAdapter.ts    # LinkedIn posting implementation
│   ├── xAdapter.ts           # X/Twitter posting implementation
│   ├── instagramAdapter.ts   # Instagram placeholder
│   ├── facebookAdapter.ts    # Facebook placeholder
│   └── youtubeAdapter.ts     # YouTube placeholder
├── db/
│   ├── supabaseClient.ts     # Supabase client initialization
│   └── queries.ts            # Typed database query functions
└── tests/
    └── integration/
        └── publish_flow.test.ts # Integration test

.env.example                   # Environment variables template
```

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+ and npm
- Redis (for queue processing)
- Supabase project with schema applied (`db-utils/safe-database-migration.sql`)
- Apply `database/external-api-sources.sql` before `database/external_api_health.sql`

### 2. Install Dependencies

```bash
npm install bullmq ioredis @supabase/supabase-js axios uuid
npm install --save-dev @types/node @types/uuid
```

### 3. Setup Environment Variables

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

**Required variables:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (NOT anon key)
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `ENCRYPTION_KEY` - 32-byte hex string for token encryption (generate with: `openssl rand -hex 32`)

**Optional variables:**
- `USE_MOCK_PLATFORMS=true` - Use mock adapters (for testing without API keys)
- `CRON_INTERVAL_SECONDS=60` - Cron interval (default: 60)

**Platform OAuth credentials** (required for real posting):
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`
- (And similar for Instagram, Facebook, YouTube)

### 4. Start Redis

```bash
# Using Docker (recommended)
docker run -d -p 6379:6379 --name redis redis:7

# Or install Redis locally
# macOS: brew install redis && brew services start redis
# Linux: apt-get install redis-server && systemctl start redis
```

### 5. Run the Queue Worker

```bash
# Add to package.json scripts:
# "start:worker": "node -r ts-node/register backend/queue/worker.ts"

npm run start:worker
```

You should see: `✅ Queue worker started. Listening for jobs...`

### 6. Run the Cron Scheduler

```bash
# Add to package.json scripts:
# "start:cron": "node -r ts-node/register backend/scheduler/cron.ts"

npm run start:cron
```

You should see: `⏰ Starting cron scheduler (interval: 60s)...`

### 7. Run Integration Test

```bash
# Add to package.json scripts:
# "test": "jest backend/tests/integration/publish_flow.test.ts"

npm test
```

## 🔐 Security Notes

### Token Encryption

- **Never commit `ENCRYPTION_KEY` to version control**
- Generate key: `openssl rand -hex 32` (32 bytes = 64 hex chars)
- In production, use secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate encryption key periodically

### Supabase RLS

- Backend uses **service role key** which bypasses RLS
- **Never expose service role key to frontend**
- Enable RLS on `social_accounts` table for frontend access
- Use service role only for backend server operations

### Environment Variables

- Use `.env.local` for local development (gitignored)
- Use environment variables or secrets manager in production
- Never commit real API keys or tokens

## 📝 Acceptance Criteria

### Token Encryption ✅
- [x] Tokens in `social_accounts.access_token` encrypted at rest (AES-256-GCM)
- [x] `tokenStore.getToken()` returns decrypted object
- [x] `tokenStore.setToken()` encrypts before storing

### OAuth Posting ✅
- [x] `platformAdapter.publish()` updates `scheduled_posts.platform_post_id` on success
- [x] `platformAdapter.publish()` updates `scheduled_posts.post_url` on success
- [x] Refresh flow triggered when `token_expires_at < now()`
- [x] LinkedIn and X adapters implemented
- [ ] Instagram, Facebook, YouTube adapters (placeholders)

### Queue Worker ✅
- [x] Jobs enqueued in BullMQ correspond to `queue_jobs` DB rows
- [x] Worker updates `queue_jobs.status`: 'pending' → 'processing' → 'completed'/'failed'
- [x] Worker creates `queue_job_logs` entries
- [x] Idempotent processing (checks `queue_jobs.status` and `platform_post_id`)

### Cron Scheduler ✅
- [x] Cron finds due posts (`scheduled_for <= NOW()`, `status='scheduled'`)
- [x] Creates `queue_jobs` rows and enqueues in BullMQ
- [x] Prevents duplicate jobs (checks existing `queue_jobs`)

### Integration Test ✅
- [x] Seeds test `scheduled_post` and `social_account`
- [x] Runs cron to create queue job
- [x] Processes job via worker
- [x] Asserts `scheduled_posts.status === 'published'`
- [x] Asserts `queue_jobs.status === 'completed'`

## 🔧 Manual Testing

### 1. Seed Demo Data

Run these SQL commands in Supabase SQL Editor:

```sql
-- Create demo user (if not exists)
INSERT INTO users (id, email, name)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'test@example.com',
  'Test User'
)
ON CONFLICT (id) DO NOTHING;

-- Create demo social account
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
  -- Note: In real scenario, this would be encrypted via tokenStore.setToken()
  'mock_encrypted_token_for_testing',
  true
)
RETURNING id;

-- Save the returned id as SOCIAL_ACCOUNT_ID

-- Create demo scheduled post (due now)
INSERT INTO scheduled_posts (
  id, user_id, social_account_id, platform, content_type,
  content, scheduled_for, status, timezone
)
VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000',
  '<SOCIAL_ACCOUNT_ID>', -- Use id from above
  'linkedin',
  'post',
  'Test post from P0 implementation 🚀',
  NOW() - INTERVAL '1 minute', -- Due 1 minute ago
  'scheduled',
  'UTC'
)
RETURNING id;
```

### 2. Verify Queue Job Created

Check `queue_jobs` table:
```sql
SELECT * FROM queue_jobs 
WHERE scheduled_post_id = '<SCHEDULED_POST_ID>'
ORDER BY created_at DESC;
```

### 3. Check Worker Processing

Monitor worker logs - should see:
```
📝 Processing publish job <job_id> for scheduled_post <post_id>
🚀 Publishing to platform via adapter...
✅ Post published successfully
```

### 4. Verify Published Post

Check `scheduled_posts` table:
```sql
SELECT status, platform_post_id, post_url, published_at 
FROM scheduled_posts 
WHERE id = '<SCHEDULED_POST_ID>';
```

Should show: `status='published'`, `platform_post_id` and `post_url` populated.

## 🐛 Troubleshooting

### Redis Connection Error
- Ensure Redis is running: `docker ps | grep redis`
- Check `REDIS_URL` matches Redis connection
- Test connection: `redis-cli ping` (should return `PONG`)

### Supabase Connection Error
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
- Check Supabase project is active
- Ensure schema is applied (`db-utils/safe-database-migration.sql`)

### Token Decryption Error
- Verify `ENCRYPTION_KEY` is 32 bytes (64 hex chars)
- Check tokens were encrypted with same key
- Regenerate key and re-encrypt tokens if key changed

### Queue Jobs Not Processing
- Check worker is running: `npm run start:worker`
- Check Redis connection
- Verify `queue_jobs` table has rows with `status='pending'`
- Check worker logs for errors

## 📚 Next Steps

1. **Complete Platform Adapters**
   - Implement Instagram, Facebook, YouTube adapters
   - Add media upload handling for each platform

2. **Token Refresh Implementation**
   - Implement actual OAuth refresh flow in `platformAdapter.refreshToken()`
   - Handle refresh token expiration

3. **Media Upload**
   - Integrate Supabase Storage for media files
   - Add media upload to adapters

4. **Monitoring & Alerts**
   - Add logging service (Winston, Pino)
   - Set up error alerting (Sentry, etc.)
   - Add metrics dashboard

5. **Production Deployment**
   - Deploy worker as separate process (PM2, systemd, Kubernetes)
   - Setup cron via Vercel Cron or system cron
   - Configure secrets manager for encryption key

## 🔗 Related Documentation

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [LinkedIn API v2](https://docs.microsoft.com/en-us/linkedin/shared/integrations/people/share-api)
- [Twitter API v2](https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets)

