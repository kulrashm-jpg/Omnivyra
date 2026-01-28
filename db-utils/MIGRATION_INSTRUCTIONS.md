# 🚀 Complete Integration Migration Guide

## 📋 Overview

The `complete-integration-migration.sql` script contains **ALL** required database changes for:
- ✅ **P0:** Queue system, scheduler, OAuth integration
- ✅ **P1:** Media management, posting infrastructure  
- ✅ **P2:** Analytics, templates, team collaboration, activity logging

## ✨ Key Features

- **Fully Idempotent:** Can be run multiple times safely (uses `IF NOT EXISTS`)
- **No Duplication:** Checks for existing tables/columns before creating
- **Complete:** Includes all tables, indexes, functions, and constraints
- **Performance Optimized:** Creates all necessary indexes for fast queries
- **Well Documented:** Includes comments explaining each component

## 📊 Tables Created (14 tables)

1. `social_accounts` - OAuth accounts with encrypted tokens
2. `scheduled_posts` - Posts with priority and error tracking
3. `queue_jobs` - Background job queue
4. `queue_job_logs` - Job execution logs
5. `media_files` - Uploaded media storage
6. `scheduled_post_media` - Post-media linking
7. `content_analytics` - Post-level analytics
8. `platform_performance` - Platform metrics aggregation
9. `hashtag_performance` - Hashtag effectiveness
10. `content_templates` - Reusable templates
11. `weekly_content_refinements` - Weekly plans with team assignments
12. `daily_content_plans` - Daily content planning
13. `activity_feed` - Audit log and activity tracking
14. Plus existing `campaigns` and `users` tables (already exist)

## 🔧 Columns Added to Existing Tables

- `scheduled_posts.priority` - Priority for job scheduling
- `scheduled_posts.error_code` - Error categorization
- `scheduled_posts.error_message` - User-friendly error messages
- `weekly_content_refinements.assigned_to_user_id` - Team assignments
- `weekly_content_refinements.assigned_by_user_id` - Assignment creator
- `weekly_content_refinements.status` - Assignment status tracking
- `weekly_content_refinements.completed_at` - Completion timestamp
- `weekly_content_refinements.notes` - Assignment notes

## 📈 Indexes Created (30+ indexes)

All critical indexes for:
- Foreign key lookups
- Status-based queries
- Date range queries
- Priority-based scheduling
- Conflict detection
- Analytics aggregations
- Activity feed filtering

## 🎯 How to Apply

### Option 1: Supabase SQL Editor (Recommended)

1. **Open Supabase Dashboard**
   - Go to your project
   - Navigate to **SQL Editor**

2. **Create New Query**
   - Click "New Query"
   - Copy entire contents of `db-utils/complete-integration-migration.sql`
   - Paste into editor

3. **Execute**
   - Click "Run" or press `Ctrl+Enter`
   - Wait for completion (should show "Success")

4. **Verify**
   - Check for any errors in output
   - Run verification queries (provided in script comments)

### Option 2: Command Line (If Supabase CLI available)

```bash
# Using Supabase CLI
supabase db reset  # Only if you want to reset
psql $DATABASE_URL -f db-utils/complete-integration-migration.sql
```

## ✅ Verification Steps

After running the migration, verify success:

### 1. Check Table Counts

```sql
SELECT 
    'social_accounts' as table_name, COUNT(*) as row_count 
FROM social_accounts
UNION ALL
SELECT 'scheduled_posts', COUNT(*) FROM scheduled_posts
UNION ALL
SELECT 'queue_jobs', COUNT(*) FROM queue_jobs
UNION ALL
SELECT 'media_files', COUNT(*) FROM media_files
UNION ALL
SELECT 'content_templates', COUNT(*) FROM content_templates
UNION ALL
SELECT 'activity_feed', COUNT(*) FROM activity_feed
UNION ALL
SELECT 'content_analytics', COUNT(*) FROM content_analytics
UNION ALL
SELECT 'platform_performance', COUNT(*) FROM platform_performance;
```

**Expected:** All should return `0` rows (tables are empty, which is normal)

### 2. Check Indexes

```sql
SELECT 
    schemaname, 
    tablename, 
    indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN (
    'scheduled_posts', 
    'queue_jobs', 
    'social_accounts', 
    'content_analytics',
    'activity_feed'
)
ORDER BY tablename, indexname;
```

**Expected:** Should see multiple indexes per table

### 3. Check Functions

```sql
SELECT 
    routine_name, 
    routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name = 'increment_template_usage';
```

**Expected:** Should return 1 row

### 4. Check Column Existence

```sql
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'scheduled_posts' 
AND column_name IN ('priority', 'error_code', 'error_message');
```

**Expected:** Should return 3 rows

### 5. Check Foreign Keys

```sql
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE constraint_type = 'FOREIGN KEY'
AND tc.table_name IN ('scheduled_posts', 'queue_jobs', 'activity_feed')
ORDER BY tc.table_name;
```

**Expected:** Should see multiple foreign key relationships

## 🚨 Troubleshooting

### Error: "relation already exists"
**Cause:** Table/column already exists  
**Solution:** Script is idempotent, but if you see this, the object already exists (this is fine)

### Error: "column already exists"
**Cause:** Column was already added in a previous migration  
**Solution:** This is safe to ignore - the script uses `IF NOT EXISTS` where possible

### Error: "foreign key constraint violation"
**Cause:** Referenced table doesn't exist or has wrong structure  
**Solution:** Ensure `users` and `campaigns` tables exist first (they should based on your current schema)

### Error: "permission denied"
**Cause:** Database user doesn't have CREATE privileges  
**Solution:** Use Supabase service role key or ensure your user has admin privileges

## 📝 Post-Migration Checklist

- [ ] All 14 tables created successfully
- [ ] All indexes created (check query performance)
- [ ] Function `increment_template_usage` exists
- [ ] Priority column added to `scheduled_posts`
- [ ] Error code columns added to `scheduled_posts`
- [ ] Team assignment columns added to `weekly_content_refinements`
- [ ] Activity feed table created
- [ ] All foreign keys properly linked
- [ ] No duplicate tables/columns

## 🎉 Success Indicators

✅ Migration completes without errors  
✅ All verification queries return expected results  
✅ Tables appear in Supabase Table Editor  
✅ Indexes show up in table details  
✅ Backend services can connect and query tables  

## 📚 Next Steps

After successful migration:

1. **Test Backend Services**
   ```bash
   npm run setup:verify
   npm run start:worker  # Should connect to queue_jobs
   npm run start:cron    # Should query scheduled_posts
   ```

2. **Seed Test Data** (Optional)
   ```bash
   # Run scripts/seed-demo-data.sql in Supabase SQL Editor
   ```

3. **Test API Endpoints**
   - `/api/analytics/post/[postId]` - Should query `content_analytics`
   - `/api/templates` - Should query `content_templates`
   - `/api/activity/feed` - Should query `activity_feed`

## 🔒 Security Notes

- **Access Tokens:** Stored encrypted in `social_accounts.access_token`
- **Service Role:** Backend uses service role key (bypasses RLS)
- **RLS Policies:** Consider adding Row Level Security policies for production
- **Indexes:** All indexes are performance-focused, not security-related

---

**Migration Script:** `db-utils/complete-integration-migration.sql`  
**Created:** Based on current schema analysis  
**Status:** ✅ Ready for production use

