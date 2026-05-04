# =====================================================
# CLEAR CAMPAIGN DATA - PowerShell Script
# =====================================================
# This script clears all campaign-related data from Supabase
# =====================================================

Write-Host "🗑️  Clearing Campaign Data..." -ForegroundColor Red
Write-Host "=================================" -ForegroundColor Red

# Load environment variables
if (Test-Path "../.env.local") {
    Get-Content "../.env.local" | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
    Write-Host "✅ Environment variables loaded" -ForegroundColor Green
} else {
    Write-Host "❌ .env.local not found!" -ForegroundColor Red
    exit 1
}

# Get Supabase credentials
$supabaseUrl = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL", "Process")
$supabaseKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Process")

if (-not $supabaseUrl -or -not $supabaseKey) {
    Write-Host "❌ Missing Supabase credentials!" -ForegroundColor Red
    exit 1
}

# SQL commands to clear data
$clearDataSQL = @"
-- Clear all campaign-related data
DELETE FROM daily_content_plans;
DELETE FROM weekly_content_refinements;
DELETE FROM campaign_performance;
DELETE FROM campaign_goals;
DELETE FROM campaigns;

-- Show final counts
SELECT 'campaigns' as table_name, COUNT(*) as count FROM campaigns
UNION ALL
SELECT 'campaign_goals', COUNT(*) FROM campaign_goals
UNION ALL
SELECT 'weekly_content_refinements', COUNT(*) FROM weekly_content_refinements
UNION ALL
SELECT 'daily_content_plans', COUNT(*) FROM daily_content_plans
UNION ALL
SELECT 'campaign_performance', COUNT(*) FROM campaign_performance;
"@

Write-Host "⚠️  WARNING: This will permanently delete all campaign data!" -ForegroundColor Yellow
$confirmation = Read-Host "Are you sure you want to continue? (yes/no)"

if ($confirmation -eq "yes") {
    Write-Host "🧹 Clearing campaign data..." -ForegroundColor Yellow
    
    # Execute SQL via Supabase REST API
    $headers = @{
        "apikey" = $supabaseKey
        "Authorization" = "Bearer $supabaseKey"
        "Content-Type" = "application/json"
    }
    
    $body = @{
        query = $clearDataSQL
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/rpc/exec_sql" -Method Post -Headers $headers -Body $body
        Write-Host "✅ Campaign data cleared successfully!" -ForegroundColor Green
        Write-Host "📊 Final counts:" -ForegroundColor Cyan
        $response | ForEach-Object { Write-Host "   $($_.table_name): $($_.count)" -ForegroundColor White }
    } catch {
        Write-Host "❌ Error clearing data: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "💡 Try running the SQL manually in Supabase SQL Editor:" -ForegroundColor Yellow
        Write-Host "   File: database/clear-campaign-data.sql" -ForegroundColor Cyan
    }
} else {
    Write-Host "❌ Operation cancelled" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 Campaign data cleanup complete!" -ForegroundColor Green






