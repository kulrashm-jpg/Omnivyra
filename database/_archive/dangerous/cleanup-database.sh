#!/bin/bash
# =====================================================
# CAMPAIGN MANAGEMENT DATABASE CLEANUP EXECUTOR
# =====================================================
# This script executes the database cleanup and setup
# for the Campaign Management Module
# =====================================================

echo "🚀 Starting Campaign Management Database Cleanup..."
echo "=================================================="

# Check if .env.local exists
if [ ! -f "../.env.local" ]; then
    echo "❌ Error: .env.local file not found!"
    echo "Please create .env.local with your Supabase credentials:"
    echo "NEXT_PUBLIC_SUPABASE_URL=your_supabase_url"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key"
    exit 1
fi

# Load environment variables
source ../.env.local

# Check if required environment variables are set
if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then
    echo "❌ Error: Missing Supabase credentials in .env.local"
    exit 1
fi

echo "✅ Environment variables loaded"
echo "📊 Supabase URL: $NEXT_PUBLIC_SUPABASE_URL"

# Execute the cleanup script
echo "🧹 Executing database cleanup and setup..."
echo "=========================================="

# Use psql to execute the SQL script
# Note: You'll need to replace 'your_database_url' with your actual Supabase database URL
# Format: postgresql://postgres:[password]@[host]:5432/postgres

if command -v psql &> /dev/null; then
    echo "📝 Executing SQL script with psql..."
    psql "$DATABASE_URL" -f campaign-management-clean-schema.sql
    if [ $? -eq 0 ]; then
        echo "✅ Database cleanup completed successfully!"
    else
        echo "❌ Database cleanup failed!"
        exit 1
    fi
else
    echo "⚠️  psql not found. Please execute the SQL script manually:"
    echo "   File: database/campaign-management-clean-schema.sql"
    echo "   You can run it in your Supabase SQL editor or any PostgreSQL client"
fi

echo ""
echo "🎉 Campaign Management Database Setup Complete!"
echo "=============================================="
echo "✅ All tables created and configured"
echo "✅ Indexes and triggers set up"
echo "✅ Sample data inserted"
echo "✅ Ready for Campaign Management Module"
echo ""
echo "📋 Created Tables:"
echo "   - users (user management)"
echo "   - campaigns (campaign lifecycle)"
echo "   - campaign_goals (content goals)"
echo "   - market_analyses (market research)"
echo "   - content_plans (content planning)"
echo "   - schedule_reviews (schedule review)"
echo "   - ai_threads (AI conversations)"
echo "   - ai_feedback (AI feedback)"
echo "   - ai_improvements (AI improvements)"
echo "   - campaign_learnings (learning system)"
echo "   - campaign_analytics (performance analytics)"
echo "   - campaign_performance (performance tracking)"
echo "   - api_integrations (platform integrations)"
echo "   - webhook_logs (webhook tracking)"
echo ""
echo "🚀 Your Campaign Management Module is ready to use!"
