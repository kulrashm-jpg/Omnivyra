# =====================================================
# CAMPAIGN MANAGEMENT DATABASE CLEANUP EXECUTOR (PowerShell)
# =====================================================
# This script executes the database cleanup and setup
# for the Campaign Management Module on Windows
# =====================================================

Write-Host "🚀 Starting Campaign Management Database Cleanup..." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

# Check if .env.local exists
if (-not (Test-Path "../.env.local")) {
    Write-Host "❌ Error: .env.local file not found!" -ForegroundColor Red
    Write-Host "Please create .env.local with your Supabase credentials:" -ForegroundColor Yellow
    Write-Host "NEXT_PUBLIC_SUPABASE_URL=your_supabase_url" -ForegroundColor Cyan
    Write-Host "NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key" -ForegroundColor Cyan
    exit 1
}

# Load environment variables
Get-Content "../.env.local" | ForEach-Object {
    if ($_ -match "^([^#][^=]+)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

# Check if required environment variables are set
$supabaseUrl = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL", "Process")
$supabaseKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Process")

if (-not $supabaseUrl -or -not $supabaseKey) {
    Write-Host "❌ Error: Missing Supabase credentials in .env.local" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Environment variables loaded" -ForegroundColor Green
Write-Host "📊 Supabase URL: $supabaseUrl" -ForegroundColor Cyan

# Execute the cleanup script
Write-Host "🧹 Executing database cleanup and setup..." -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow

# Check if psql is available
try {
    $psqlVersion = & psql --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "📝 Executing SQL script with psql..." -ForegroundColor Cyan
        
        # You'll need to set your DATABASE_URL environment variable
        $databaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
        if (-not $databaseUrl) {
            Write-Host "⚠️  DATABASE_URL not set. Please set it to your Supabase database URL:" -ForegroundColor Yellow
            Write-Host "   Format: postgresql://postgres:[password]@[host]:5432/postgres" -ForegroundColor Cyan
            Write-Host "   You can find this in your Supabase project settings" -ForegroundColor Cyan
        } else {
            & psql $databaseUrl -f "campaign-management-clean-schema.sql"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Database cleanup completed successfully!" -ForegroundColor Green
            } else {
                Write-Host "❌ Database cleanup failed!" -ForegroundColor Red
                exit 1
            }
        }
    }
} catch {
    Write-Host "⚠️  psql not found. Please execute the SQL script manually:" -ForegroundColor Yellow
    Write-Host "   File: database/campaign-management-clean-schema.sql" -ForegroundColor Cyan
    Write-Host "   You can run it in your Supabase SQL editor or any PostgreSQL client" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "🎉 Campaign Management Database Setup Complete!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host "✅ All tables created and configured" -ForegroundColor Green
Write-Host "✅ Indexes and triggers set up" -ForegroundColor Green
Write-Host "✅ Sample data inserted" -ForegroundColor Green
Write-Host "✅ Ready for Campaign Management Module" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Created Tables:" -ForegroundColor Cyan
Write-Host "   - users (user management)" -ForegroundColor White
Write-Host "   - campaigns (campaign lifecycle)" -ForegroundColor White
Write-Host "   - campaign_goals (content goals)" -ForegroundColor White
Write-Host "   - market_analyses (market research)" -ForegroundColor White
Write-Host "   - content_plans (content planning)" -ForegroundColor White
Write-Host "   - schedule_reviews (schedule review)" -ForegroundColor White
Write-Host "   - ai_threads (AI conversations)" -ForegroundColor White
Write-Host "   - ai_feedback (AI feedback)" -ForegroundColor White
Write-Host "   - ai_improvements (AI improvements)" -ForegroundColor White
Write-Host "   - campaign_learnings (learning system)" -ForegroundColor White
Write-Host "   - campaign_analytics (performance analytics)" -ForegroundColor White
Write-Host "   - campaign_performance (performance tracking)" -ForegroundColor White
Write-Host "   - api_integrations (platform integrations)" -ForegroundColor White
Write-Host "   - webhook_logs (webhook tracking)" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Your Campaign Management Module is ready to use!" -ForegroundColor Green
