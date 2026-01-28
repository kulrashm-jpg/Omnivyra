# 🚀 P0 Implementation - Complete Setup Guide

This guide walks you through setting up all P0 features step-by-step.

## Step 1: Install Dependencies

```bash
npm install
```

**Expected:** All packages from `package.json` are installed, including:
- `bullmq` (queue management)
- `ioredis` (Redis client)
- `@supabase/supabase-js` (database)
- `ts-node` (TypeScript execution)
- `jest` (testing)

---

## Step 2: Generate Encryption Key

### Option A: Using Helper Script (Recommended)
```bash
npm run setup:key
```

This will generate a secure 64-character hex key and display it.

### Option B: Manual Generation (PowerShell)
```powershell
# PowerShell (Windows)
-join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

### Option C: Manual Generation (Bash/Unix)
```bash
openssl rand -hex 32
```

**Copy the generated key** - you'll need it for Step 3.

---

## Step 3: Configure Environment Variables

### Option A: Using Interactive Setup (Recommended)
```bash
npm run setup:env
```

This interactive script will:
- Prompt for Supabase credentials
- Generate encryption key automatically
- Set Redis URL
- Create `.env.local` file

### Option B: Manual Setup

Create `.env.local` in the project root:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Encryption (AES-256-GCM)
ENCRYPTION_KEY=<64_character_hex_key_from_step_2>

# Development Mode (set to false for production)
USE_MOCK_PLATFORMS=true
CRON_INTERVAL_SECONDS=60
```

**⚠️ Important:**
- Never commit `.env.local` to git
- Use service role key (not anon key) for backend operations
- Encryption key must be exactly 64 hex characters

---

## Step 4: Verify Setup

Run the verification script:

```bash
npm run setup:verify
```

This checks:
- ✅ Environment file exists with all required variables
- ✅ All backend files are present
- ✅ Package.json scripts are configured
- ✅ Database migration script exists
- ✅ .gitignore protects secrets

**If any checks fail**, follow the error messages to fix issues.

---

## Step 5: Start Redis

### Option A: Docker (Recommended)
```bash
docker run -d -p 6379:6379 --name redis redis:7
```

Verify Redis is running:
```bash
docker ps | grep redis
```

### Option B: Local Installation

If Redis is installed locally:
```bash
redis-server
```

### Verify Redis Connection

```bash
npm run setup:redis
```

This will:
- ✅ Test connection to Redis
- ✅ Verify read/write operations
- ✅ Display Redis version

**Expected output:**
```
✅ Redis is connected!
✅ Redis read/write test passed!
✅ Redis is ready for BullMQ queue operations!
```

---

## Step 6: Apply Database Schema

1. **Open Supabase Dashboard**
   - Go to: https://app.supabase.com
   - Select your project
   - Navigate to **SQL Editor**

2. **Run Migration Script**
   - Open file: `db-utils/safe-database-migration.sql`
   - Copy entire contents
   - Paste into Supabase SQL Editor
   - Click **Run** (or press `Ctrl+Enter`)

3. **Verify Tables Created**

Run this query in Supabase SQL Editor:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'queue_jobs',
  'queue_job_logs', 
  'scheduled_posts',
  'social_accounts'
)
ORDER BY table_name;
```

**Expected:** All 4 tables should be listed.

---

## Step 7: Seed Test Data (Optional)

1. **Open Supabase SQL Editor**

2. **Run Seed Script**
   - Open file: `scripts/seed-demo-data.sql`
   - Copy contents
   - Paste into Supabase SQL Editor
   - Click **Run**

3. **Note the Generated IDs**
   - The script returns `social_account_id` and `scheduled_post_id`
   - Save these for verification

4. **Verify Data**

```sql
-- Check scheduled post
SELECT id, status, platform, scheduled_for 
FROM scheduled_posts 
WHERE status = 'scheduled'
ORDER BY created_at DESC 
LIMIT 1;

-- Check social account
SELECT id, platform, account_name, is_active 
FROM social_accounts 
ORDER BY created_at DESC 
LIMIT 1;
```

---

## Step 8: Start Queue Worker

Open **Terminal 1**:

```bash
npm run start:worker
```

**Expected output:**
```
✅ Queue worker started. Listening for jobs...
Worker ready: publish
```

**Keep this terminal open** - it will process jobs continuously.

---

## Step 9: Start Cron Scheduler

Open **Terminal 2**:

```bash
npm run start:cron
```

**Expected output:**
```
⏰ Starting cron scheduler (interval: 60s)...
✅ Scheduler cycle completed (0 jobs enqueued)
```

**Keep this terminal open** - it runs every 60 seconds.

**After 60 seconds**, if test data was seeded:
```
✅ Scheduler cycle completed (1 jobs enqueued)
```

---

## Step 10: Verify End-to-End Flow

### Check Queue Jobs Created

Run in Supabase SQL Editor:

```sql
SELECT 
  id,
  scheduled_post_id,
  status,
  attempts,
  created_at
FROM queue_jobs
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** See jobs with `status = 'pending'` or `'processing'`.

### Check Worker Processing

Watch **Terminal 1** (worker) for:

```
✅ Processing job: <job_id>
✅ Post published successfully: <platform_post_id>
✅ Job completed: <job_id>
```

### Check Scheduled Post Updated

Run in Supabase SQL Editor:

```sql
SELECT 
  id,
  status,
  platform_post_id,
  post_url,
  published_at
FROM scheduled_posts
WHERE status = 'published'
ORDER BY published_at DESC
LIMIT 1;
```

**Expected:** 
- `status = 'published'`
- `platform_post_id` is populated (mock ID if `USE_MOCK_PLATFORMS=true`)
- `published_at` timestamp is set

---

## Troubleshooting

### Issue: "Redis connection error"

**Solution:**
```bash
# Check if Redis container is running
docker ps | grep redis

# If not running, start it:
docker start redis

# Or create new container:
docker run -d -p 6379:6379 --name redis redis:7

# Verify connection:
npm run setup:redis
```

### Issue: "ENCRYPTION_KEY must be 32 bytes"

**Solution:**
```bash
# Regenerate key:
npm run setup:key

# Update .env.local with new key
# Key must be exactly 64 hex characters
```

### Issue: "Cannot find module './schedulerService'"

**Solution:**
```bash
# Ensure TypeScript config exists:
ls backend/tsconfig.json

# Install ts-node if missing:
npm install ts-node --save-dev

# Try running with explicit register:
node -r ts-node/register backend/scheduler/cron.ts
```

### Issue: "Scheduled post not found"

**Solution:**
1. Verify test data exists:
```sql
SELECT COUNT(*) FROM scheduled_posts WHERE status = 'scheduled';
```

2. If count is 0, run seed script:
```bash
# Open scripts/seed-demo-data.sql in Supabase SQL Editor and run it
```

3. Ensure `scheduled_for` is in the past:
```sql
SELECT id, scheduled_for, status 
FROM scheduled_posts 
WHERE status = 'scheduled' 
AND scheduled_for <= NOW();
```

### Issue: Queue jobs created but not processing

**Solution:**
1. Verify worker is running: Check Terminal 1
2. Check worker logs for errors
3. Verify Redis connection: `npm run setup:redis`
4. Check for job errors:
```sql
SELECT id, status, error_message 
FROM queue_jobs 
WHERE status = 'failed'
ORDER BY created_at DESC;
```

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Set `USE_MOCK_PLATFORMS=false` in `.env`
- [ ] Add real OAuth credentials for each platform
- [ ] Configure production Redis (use managed service)
- [ ] Set up proper encryption key storage (secrets manager)
- [ ] Deploy worker as background service (PM2/systemd)
- [ ] Deploy cron as background service
- [ ] Set up monitoring and alerts
- [ ] Configure proper logging (centralized)
- [ ] Enable Supabase RLS policies
- [ ] Review and test token refresh flows
- [ ] Set up backup and recovery procedures

---

## Quick Reference

### Helper Commands

```bash
# Generate encryption key
npm run setup:key

# Interactive environment setup
npm run setup:env

# Verify all setup steps
npm run setup:verify

# Check Redis connection
npm run setup:redis

# Start worker
npm run start:worker

# Start cron
npm run start:cron
```

### Database Verification Queries

```sql
-- Check all P0 tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('queue_jobs', 'queue_job_logs', 'scheduled_posts', 'social_accounts');

-- Check queue jobs status
SELECT status, COUNT(*) 
FROM queue_jobs 
GROUP BY status;

-- Check recent scheduled posts
SELECT id, platform, status, scheduled_for, platform_post_id 
FROM scheduled_posts 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## Next Steps

After completing setup:

1. ✅ Review `README_P0_IMPLEMENTATION.md` for detailed API docs
2. ✅ Check `P0_QUICK_START.md` for quick reference
3. ✅ Explore `backend/` directory to understand code structure
4. ✅ Add real OAuth credentials for production use
5. ✅ Implement remaining platform adapters (Instagram, Facebook, YouTube)
6. ✅ Set up monitoring and alerting
7. ✅ Configure CI/CD pipeline

---

**✅ Setup Complete!** You're now ready to test and extend the P0 implementation.

