# Campaign Management Database Cleanup & Setup

This directory contains scripts to clean and set up the database for the Campaign Management Module.

## 🗄️ Database Schema Overview

The cleanup script creates a comprehensive database schema that includes:

### Core Tables
- **`users`** - User management and authentication
- **`campaigns`** - Campaign lifecycle management
- **`campaign_goals`** - Content goals and objectives
- **`market_analyses`** - Market research and competitor analysis
- **`content_plans`** - Day-wise content planning
- **`schedule_reviews`** - Schedule review and approval

### AI Integration Tables
- **`ai_threads`** - Campaign-specific AI conversations
- **`ai_feedback`** - AI suggestions and feedback
- **`ai_improvements`** - AI-driven improvements and optimizations
- **`campaign_learnings`** - Learning from past campaigns

### Analytics & Performance Tables
- **`campaign_analytics`** - Detailed performance metrics
- **`campaign_performance`** - Aggregated performance data

### API Integration Tables
- **`api_integrations`** - Platform API connections
- **`webhook_logs`** - Webhook event tracking

## 🚀 Quick Start

### Option 1: Automated Script (Recommended)

**For Windows (PowerShell):**
```powershell
cd database
.\cleanup-database.ps1
```

**For Linux/Mac (Bash):**
```bash
cd database
chmod +x cleanup-database.sh
./cleanup-database.sh
```

### Option 2: Manual Execution

1. **Set up environment variables** in `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
   ```

2. **Execute the SQL script** in your Supabase SQL editor or PostgreSQL client:
   ```sql
   -- Run the contents of campaign-management-clean-schema.sql
   ```

3. **Verify the setup**:
   ```sql
   -- Run the contents of verify-database.sql
   ```

## 📋 What Gets Cleaned

The cleanup script will:
- ✅ **Drop all existing tables** (clean slate)
- ✅ **Create optimized table structure** with proper relationships
- ✅ **Add performance indexes** for fast queries
- ✅ **Set up automatic triggers** for timestamp updates
- ✅ **Create useful views** for common queries
- ✅ **Add utility functions** for campaign operations
- ✅ **Insert sample data** for testing

## 🔧 Key Features

### Performance Optimizations
- **Indexes** on all foreign keys and frequently queried columns
- **JSONB columns** for flexible data storage
- **Automatic timestamp updates** via triggers
- **Optimized data types** for better performance

### AI Integration
- **Campaign-specific threads** for AI conversations
- **Feedback tracking** with confidence scores
- **Improvement suggestions** with impact scoring
- **Learning system** that tracks campaign performance

### Analytics & Tracking
- **Real-time performance metrics** per platform
- **Aggregated performance data** for insights
- **Webhook logging** for API integrations
- **Campaign progress tracking** across all stages

### Data Integrity
- **Foreign key constraints** for data consistency
- **Check constraints** for data validation
- **Cascade deletes** for cleanup
- **Unique constraints** where needed

## 🎯 Campaign Flow Integration

The database schema supports the complete campaign flow:

```
1. Campaign Creation → campaigns table
2. Goals Definition → campaign_goals table
3. Market Analysis → market_analyses table
4. Content Planning → content_plans table
5. Schedule Review → schedule_reviews table
6. AI Conversations → ai_threads table
7. Performance Tracking → campaign_analytics table
8. Learning & Improvement → campaign_learnings table
```

## 🔍 Verification

After running the cleanup script, verify everything is working:

```sql
-- Check all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check sample data
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM campaigns;
```

## 🚨 Important Notes

1. **Backup First**: This script will delete all existing data. Make sure to backup important data first.

2. **Environment Variables**: Ensure your `.env.local` file has the correct Supabase credentials.

3. **Database URL**: You'll need the full PostgreSQL connection string for automated execution.

4. **Permissions**: Make sure your database user has CREATE, DROP, and ALTER permissions.

## 🆘 Troubleshooting

### Common Issues

**"psql not found"**
- Install PostgreSQL client tools
- Or run the SQL script manually in Supabase SQL editor

**"Permission denied"**
- Check your database user permissions
- Ensure you have DROP and CREATE privileges

**"Connection failed"**
- Verify your DATABASE_URL is correct
- Check if your IP is whitelisted in Supabase

### Manual Verification

If automated scripts fail, you can:
1. Copy the SQL from `campaign-management-clean-schema.sql`
2. Paste it into your Supabase SQL editor
3. Run it manually
4. Use `verify-database.sql` to check the results

## 📊 Sample Data

The script includes sample data for testing:
- 2 test users
- 2 sample campaigns
- Ready for immediate testing

## 🎉 Success Indicators

After successful execution, you should see:
- ✅ 14 tables created
- ✅ Multiple indexes created
- ✅ Triggers and functions created
- ✅ 2 views created
- ✅ Sample data inserted
- ✅ All foreign key relationships working

Your Campaign Management Module is now ready to use! 🚀
